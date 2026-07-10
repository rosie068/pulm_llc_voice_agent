// Outbound campaign runner (guide Phase 9 / spec §4). Triggered by Vercel Cron
// (business hours) or manually. Guard rails enforced in the WHERE clause:
// ready + authVerified + under cap. Claims rows atomically so overlapping
// ticks can't double-dial.

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { VapiClient } from "@vapi-ai/server-sdk";
import { db, schema } from "@/db";
import { getEnv } from "@/lib/env";
import { ACTIVE_OUTBOUND_WORKSTREAMS } from "@/core/attempts";

export const runtime = "nodejs";

const BATCH_SIZE = 2;

const WORKSTREAM_ASSISTANT_KEY: Record<string, string> = {
  sleep_study: "outbound-sleep",
  referral: "outbound-referral",
};

async function authorize(req: NextRequest): Promise<boolean> {
  const env = getEnv();
  // Vercel Cron sends Authorization: Bearer $CRON_SECRET when configured.
  if (env.CRON_SECRET) {
    return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
  }
  // Fallback: allow manual trigger with the webhook secret header.
  return req.headers.get("x-vapi-secret") === env.VAPI_WEBHOOK_SECRET;
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const env = getEnv();

  let registry: { assistants: Record<string, string> };
  try {
    registry = (await import("@/vapi/registry.json")) as unknown as {
      assistants: Record<string, string>;
    };
  } catch {
    return NextResponse.json(
      { error: "vapi registry missing — run pnpm vapi:sync first" },
      { status: 500 },
    );
  }

  // Atomically claim eligible rows (spec §4.4 gate in the WHERE clause).
  const claimed = await db()
    .update(schema.outboundQueue)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(
      and(
        eq(schema.outboundQueue.status, "ready"),
        inArray(schema.outboundQueue.workstream, [...ACTIVE_OUTBOUND_WORKSTREAMS]),
        eq(schema.outboundQueue.authVerified, true),
        lt(schema.outboundQueue.attemptCount, schema.outboundQueue.attemptCap),
        or(
          isNull(schema.outboundQueue.nextAttemptAt),
          lte(schema.outboundQueue.nextAttemptAt, new Date()),
        ),
        sql`${schema.outboundQueue.id} IN (
          SELECT id FROM outbound_queue
          WHERE status = 'ready' AND workstream IN ('referral', 'sleep_study') AND auth_verified = true
            AND attempt_count < attempt_cap
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY next_attempt_at NULLS FIRST
          LIMIT ${BATCH_SIZE}
        )`,
      ),
    )
    .returning();

  if (claimed.length === 0) return NextResponse.json({ dialed: 0 });

  const client = new VapiClient({ token: env.VAPI_API_KEY });
  const results: Array<Record<string, unknown>> = [];

  for (const row of claimed) {
    const [patient] = await db()
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.id, row.patientId))
      .limit(1);

    const assistantKey = WORKSTREAM_ASSISTANT_KEY[row.workstream];
    const assistantId = assistantKey ? registry.assistants[assistantKey] : undefined;

    if (!patient?.phone || !assistantId) {
      await db()
        .update(schema.outboundQueue)
        .set({ status: "ready", nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(schema.outboundQueue.id, row.id));
      results.push({ queueId: row.id, skipped: !patient?.phone ? "no phone" : "no assistant" });
      continue;
    }

    const attemptNumber = row.attemptCount + 1;
    try {
      const call = (await client.calls.create({
        phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
        customer: { number: patient.phone },
        assistantId,
        assistantOverrides: {
          variableValues: {
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientId: patient.id,
            studySubtype: row.studySubtype ?? "",
          },
        },
      })) as { id?: string };

      await db()
        .update(schema.outboundQueue)
        .set({ attemptCount: attemptNumber, updatedAt: new Date() })
        .where(eq(schema.outboundQueue.id, row.id));
      await db().insert(schema.callAttempts).values({
        queueId: row.id,
        vapiCallId: call.id ?? null,
        attemptNumber,
      });
      results.push({ queueId: row.id, dialed: true, vapiCallId: call.id });
    } catch (err) {
      await db()
        .update(schema.outboundQueue)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(schema.outboundQueue.id, row.id));
      results.push({ queueId: row.id, error: String(err) });
    }
  }

  return NextResponse.json({ dialed: results.filter((r) => r.dialed).length, results });
}
