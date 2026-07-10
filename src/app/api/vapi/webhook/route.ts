import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEnv } from "@/lib/env";
import {
  parseToolArguments,
  serverMessageSchema,
  type ServerMessage,
} from "@/vapi/webhook-schemas";
import { TOOL_HANDLERS } from "@/vapi/tools/handlers";
import { queueTransitionFor, type OutboundOutcome } from "@/core/outcomes";
import { nextBusinessDayRetry } from "@/core/attempts";
import { routeTopic } from "@/core/routing";
import { clinicContext, decideHandoff } from "@/core/escalation";

export const runtime = "nodejs";
// Vapi guidance: host near us-west-2 for tool-call latency.
export const preferredRegion = ["pdx1", "sfo1"];

function verifySecret(req: NextRequest): boolean {
  const env = getEnv();
  const provided = req.headers.get("x-vapi-secret") ?? "";
  const expected = env.VAPI_WEBHOOK_SECRET;
  if (!provided) return env.VAPI_ALLOW_UNVERIFIED === true;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function recordEvent(
  vapiCallId: string,
  type: string,
  dedupeKey: string,
  payload: unknown,
): Promise<void> {
  await db()
    .insert(schema.callEvents)
    .values({ vapiCallId, type, dedupeKey, payload })
    .onConflictDoNothing();
}

// ── tool-calls ───────────────────────────────────────────────────────────────

async function handleToolCalls(message: ServerMessage) {
  const vapiCallId = message.call?.id ?? "unknown";
  const toolCalls = message.toolCallList ?? [];
  const results: { name: string; toolCallId: string; result: string }[] = [];
  const call = (message.call ?? {}) as {
    type?: string;
    monitor?: { controlUrl?: string };
  };
  const callContext = { controlUrl: call.monitor?.controlUrl, callType: call.type };

  for (const tc of toolCalls) {
    const { name, args } = parseToolArguments(tc);
    const started = Date.now();

    // Idempotency: if this toolCallId already executed (webhook retry), return
    // the stored result instead of re-executing — prevents double booking.
    const [existing] = await db()
      .select()
      .from(schema.toolExecutions)
      .where(eq(schema.toolExecutions.toolCallId, tc.id))
      .limit(1);
    if (existing) {
      results.push({ name, toolCallId: tc.id, result: JSON.stringify(existing.result) });
      continue;
    }

    let result: Record<string, unknown>;
    let status: "ok" | "error" = "ok";
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      result = { error: `Unknown tool: ${name}` };
      status = "error";
    } else {
      try {
        result = await handler(args, vapiCallId, callContext);
        if (result.error) status = "error";
      } catch (err) {
        // Business errors ride inside the result — Vapi ignores non-200s.
        result = { error: "Tool failed unexpectedly. Apologize and escalate_to_staff." };
        status = "error";
        console.error(`[tool:${name}]`, err);
      }
    }

    await db()
      .insert(schema.toolExecutions)
      .values({
        vapiCallId,
        toolCallId: tc.id,
        toolName: name,
        arguments: args,
        result,
        status,
        latencyMs: Date.now() - started,
      })
      .onConflictDoNothing();

    results.push({ name, toolCallId: tc.id, result: JSON.stringify(result) });
  }

  return NextResponse.json({ results });
}

// ── end-of-call-report ───────────────────────────────────────────────────────

async function handleEndOfCallReport(message: ServerMessage, raw: unknown) {
  const vapiCallId = message.call?.id ?? "unknown";
  const call = (message.call ?? {}) as Record<string, unknown>;
  const analysis = message.analysis;
  const artifact = message.artifact;

  const structured = analysis?.structuredData ?? {};
  const outcomeRaw = typeof structured.outcome === "string" ? structured.outcome : null;
  const inboundOutcomes = ["resolved_scheduled", "denied_closed", "vm_left", "spoke_no_appt"];
  const direction =
    (call.type as string | undefined)?.includes("outbound") ? "outbound" : "inbound";

  const recording = artifact?.recording as Record<string, unknown> | undefined;

  // System of record under HIPAA mode: upsert everything we received.
  await db()
    .insert(schema.calls)
    .values({
      vapiCallId,
      direction,
      callerNumber: message.call?.customer?.number ?? null,
      startedAt: message.startedAt ? new Date(message.startedAt) : null,
      endedAt: message.endedAt ? new Date(message.endedAt) : null,
      endedReason: message.endedReason ?? null,
      durationSeconds: message.durationSeconds ? Math.round(message.durationSeconds) : null,
      transcript: artifact?.transcript ?? message.transcript ?? null,
      recordingUrl:
        (artifact?.recordingUrl as string | undefined) ??
        (recording?.mono as Record<string, string> | undefined)?.combinedUrl ??
        null,
      summary: analysis?.summary ?? null,
      structuredData: structured,
      outcome:
        outcomeRaw && inboundOutcomes.includes(outcomeRaw)
          ? (outcomeRaw as "resolved_scheduled" | "denied_closed" | "vm_left" | "spoke_no_appt")
          : null,
      costCents: message.cost != null ? Math.round(message.cost * 100) : null,
    })
    .onConflictDoUpdate({
      target: schema.calls.vapiCallId,
      set: {
        endedAt: message.endedAt ? new Date(message.endedAt) : null,
        endedReason: message.endedReason ?? null,
        transcript: artifact?.transcript ?? message.transcript ?? null,
        summary: analysis?.summary ?? null,
        structuredData: structured,
      },
    });

  await recordEvent(vapiCallId, "end-of-call-report", "final", raw);

  // Silent-hang-up net (spec §3.3): an off-hours inbound call that ended
  // unresolved and never produced a flag (caller hung up mid-intake, model
  // skipped escalate_to_staff, tools unreachable) still needs a backend
  // record — auto-flag it from whatever the call analysis captured.
  if (direction === "inbound" && outcomeRaw === "spoke_no_appt") {
    const startedAt = message.startedAt ? new Date(message.startedAt) : new Date();
    const context = clinicContext(startedAt);
    if (context.offHours) {
      const [existingFlag] = await db()
        .select({ id: schema.flags.id })
        .from(schema.flags)
        .where(eq(schema.flags.vapiCallId, vapiCallId))
        .limit(1);
      if (!existingFlag) {
        await db().insert(schema.flags).values({
          vapiCallId,
          reason: "low_confidence",
          intake: {
            name: typeof structured.patientName === "string" ? structured.patientName : null,
            dob: typeof structured.dob === "string" ? structured.dob : null,
            phone:
              (typeof structured.callbackNumber === "string" ? structured.callbackNumber : null) ??
              message.call?.customer?.number ??
              null,
            reason:
              "Off-hours call ended without resolution or escalation — auto-flagged from call summary.",
            summary: analysis?.summary ?? null,
            autoCreated: true,
            ...context,
          },
        });
      }
    }
  }

  // Close the outbound loop: attempt row → queue transition (spec §4.2/§4.4).
  const [attempt] = await db()
    .select()
    .from(schema.callAttempts)
    .where(eq(schema.callAttempts.vapiCallId, vapiCallId))
    .limit(1);
  if (attempt) {
    const outboundOutcome = (
      typeof structured.outcome === "string" ? structured.outcome : "no_answer"
    ) as OutboundOutcome;
    const [queueRow] = await db()
      .select()
      .from(schema.outboundQueue)
      .where(eq(schema.outboundQueue.id, attempt.queueId))
      .limit(1);
    if (queueRow) {
      const transition = queueTransitionFor(
        outboundOutcome,
        queueRow.attemptCount,
        queueRow.attemptCap,
      );
      await db()
        .update(schema.outboundQueue)
        .set({
          status: transition.status,
          closedReason: "closedReason" in transition ? transition.closedReason : null,
          nextAttemptAt:
            "retryNextBusinessDay" in transition ? nextBusinessDayRetry(new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.outboundQueue.id, queueRow.id));
      await db()
        .update(schema.callAttempts)
        .set({ outcome: outboundOutcome })
        .where(eq(schema.callAttempts.id, attempt.id));
      if ("flagForAlternatePcp" in transition) {
        await db().insert(schema.flags).values({
          vapiCallId,
          patientId: queueRow.patientId,
          reason: "callback",
          intake: {
            reason: "Outbound number unreachable/out-of-service — needs alternate PCP outreach",
            queueId: queueRow.id,
          },
        });
      }
      // Note discipline (spec §4.6): every attempt gets a memo note.
      await db().insert(schema.notes).values({
        patientId: queueRow.patientId,
        vapiCallId,
        body: `Outbound ${queueRow.workstream} attempt ${queueRow.attemptCount}/${queueRow.attemptCap}: ${outboundOutcome}.`,
      });
    }
  }

  return NextResponse.json({});
}

// ── transfer-destination-request ─────────────────────────────────────────────

async function handleTransferDestinationRequest(message: ServerMessage, raw: unknown) {
  const vapiCallId = message.call?.id ?? "unknown";
  await recordEvent(vapiCallId, "transfer-destination-request", "request", raw);

  // Topic arrives as the transferCall tool's function arguments. Shape varies
  // (functionCall.parameters vs toolCallList) — check both, default general.
  const fc = message.functionCall as
    | { parameters?: Record<string, unknown>; arguments?: unknown }
    | undefined;
  let params: Record<string, unknown> =
    (fc?.parameters as Record<string, unknown> | undefined) ?? {};
  if (Object.keys(params).length === 0 && typeof fc?.arguments === "string") {
    try {
      params = JSON.parse(fc.arguments) as Record<string, unknown>;
    } catch {
      /* keep {} */
    }
  }
  if (Object.keys(params).length === 0 && message.toolCallList?.length) {
    params = parseToolArguments(message.toolCallList[0]).args;
  }
  const topic = typeof params.topic === "string" ? params.topic : "incoming_general";

  // Web/simulation calls have no PSTN leg to bridge to a staff extension —
  // refuse so the assistant falls back to escalate_to_staff (spec §3.3).
  const callType = (message.call as { type?: string } | undefined)?.type ?? "";
  if (!callType.toLowerCase().includes("phone")) {
    return NextResponse.json({
      error: "No staff member is reachable for a live transfer right now.",
    });
  }

  const owner = routeTopic(topic);
  const staffRows = await db().select().from(schema.staffAvailability);
  const decision = decideHandoff(
    owner.ext,
    new Date(),
    staffRows.map((s) => ({
      ext: s.ext,
      ownerName: s.ownerName,
      phoneNumber: s.phoneNumber,
      available: s.available,
    })),
  );

  if (decision.action === "flag") {
    // Assistant falls back to escalate_to_staff (prompt instructs this) —
    // never a dead-end voicemail (spec §3.3).
    return NextResponse.json({
      error: "No staff member is reachable for a live transfer right now.",
    });
  }

  return NextResponse.json({
    message: `Transferring you to ${decision.ownerName} now.`,
    destination: {
      type: "number",
      number: decision.phoneNumber,
      extension: decision.ext,
      // Warm transfer: staff hears an AI summary before the caller connects.
      transferPlan: {
        mode: "warm-transfer-say-summary",
        summaryPlan: {
          enabled: true,
          messages: [
            {
              role: "system",
              content:
                "Summarize the call for the staff member about to take over: caller name, reason, what was already done. One or two sentences.",
            },
            { role: "user", content: "Transcript:\n{{transcript}}" },
          ],
        },
      },
    },
  });
}

// ── Router ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!verifySecret(req)) {
    console.warn("[vapi-webhook] rejected: bad or missing X-Vapi-Secret");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({}); // malformed body: never 500 into Vapi's retry loop
  }

  const parsed = serverMessageSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[vapi-webhook] unrecognized payload shape", parsed.error.issues[0]);
    return NextResponse.json({});
  }

  const message = parsed.data.message;
  const vapiCallId = message.call?.id ?? "unknown";

  try {
    switch (message.type) {
      case "tool-calls":
        return await handleToolCalls(message);

      case "end-of-call-report":
        return await handleEndOfCallReport(message, raw);

      case "assistant-request":
        // Phone number is statically attached to the inbound assistant today;
        // this branch supports the dynamic pattern if the number is detached.
        await recordEvent(vapiCallId, message.type, "request", raw);
        return NextResponse.json(
          getEnv().VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID
            ? { assistantId: process.env.VAPI_ASSISTANT_ID }
            : { error: "We are unable to take your call right now. Please call back shortly." },
        );

      case "transfer-destination-request":
        return await handleTransferDestinationRequest(message, raw);

      case "status-update":
        await recordEvent(vapiCallId, message.type, message.status ?? "unknown", raw);
        return NextResponse.json({});

      default:
        await recordEvent(
          vapiCallId,
          message.type,
          crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 16),
          raw,
        );
        return NextResponse.json({});
    }
  } catch (err) {
    // Log and 200: a 500 would make Vapi retry a payload we already can't process.
    console.error("[vapi-webhook] handler error", err);
    return NextResponse.json({});
  }
}
