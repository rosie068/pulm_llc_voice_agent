// Tool handlers: dispatched from the webhook route. Every handler returns a
// JSON-serializable object that becomes the tool result the assistant reads.
// Business errors are returned inside the result (never thrown to a non-200).

import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { attemptCapFor } from "@/core/attempts";
import {
  findSlots,
  parseSlotId,
  validateBooking,
  type BookedAppointment,
} from "@/core/scheduling/engine";
import {
  capacityGroupFor,
  getPrepScript,
  type AppointmentType,
  type AvailabilityRule,
  type LocationCode,
} from "@/core/scheduling/rules";
import { routeTopic } from "@/core/routing";
import { clinicContext, decideHandoff, isBusinessHours } from "@/core/escalation";
import { getEnv } from "@/lib/env";
import { canBook, type ToolExecutionRecord } from "@/core/verification";
import { getPorts } from "@/ports";

type Args = Record<string, unknown>;
type ToolResult = Record<string, unknown>;
/** Live-call context: controlUrl lets a handler act on the call (e.g. transfer). */
export interface CallContext {
  controlUrl?: string;
  callType?: string;
}
type Handler = (args: Args, vapiCallId: string, ctx?: CallContext) => Promise<ToolResult>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function loadRules(
  type: AppointmentType,
  location?: LocationCode,
): Promise<AvailabilityRule[]> {
  const rows = await db()
    .select()
    .from(schema.availabilityRules)
    .where(
      and(
        eq(schema.availabilityRules.appointmentType, type),
        eq(schema.availabilityRules.active, true),
        ...(location ? [eq(schema.availabilityRules.location, location)] : []),
      ),
    );
  return rows.map((r) => ({
    appointmentType: r.appointmentType as AppointmentType,
    location: r.location as LocationCode,
    dayOfWeek: r.dayOfWeek,
    windowStart: r.windowStart.slice(0, 5),
    windowEnd: r.windowEnd.slice(0, 5),
    capacityPerDay: r.capacityPerDay,
    slotMinutes: r.slotMinutes,
    active: r.active,
  }));
}

async function loadBooked(
  type: AppointmentType,
  from: Date,
): Promise<BookedAppointment[]> {
  const group = capacityGroupFor(type);
  const rows = await db()
    .select({
      type: schema.appointments.type,
      location: schema.appointments.location,
      startsAt: schema.appointments.startsAt,
    })
    .from(schema.appointments)
    .where(
      and(
        inArray(schema.appointments.type, group),
        gte(schema.appointments.startsAt, from),
        inArray(schema.appointments.status, ["booked", "confirmed", "rescheduled"]),
      ),
    );
  return rows.map((r) => ({
    type: r.type as AppointmentType,
    location: r.location as LocationCode,
    startsAt: r.startsAt,
  }));
}

async function executionsForCall(vapiCallId: string): Promise<ToolExecutionRecord[]> {
  const rows = await db()
    .select()
    .from(schema.toolExecutions)
    .where(eq(schema.toolExecutions.vapiCallId, vapiCallId))
    .orderBy(asc(schema.toolExecutions.createdAt));
  return rows.map((r) => ({
    toolName: r.toolName,
    result: r.result,
    status: r.status as "ok" | "error",
  }));
}

async function writeNote(
  patientId: string | null,
  vapiCallId: string,
  body: string,
): Promise<void> {
  if (patientId) {
    await getPorts().ehr.pushNote({
      patientId,
      vapiCallId,
      body,
      agentTag: "voice-agent",
    });
  } else {
    await db().insert(schema.notes).values({ vapiCallId, body });
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

const identify_patient: Handler = async (args) => {
  const firstName = str(args.firstName);
  const lastName = str(args.lastName);
  const dob = str(args.dob);
  const callbackNumber = str(args.callbackNumber);
  if (!firstName || !lastName || !dob) {
    return { error: "firstName, lastName, and dob are required" };
  }

  const candidates = await db()
    .select()
    .from(schema.patients)
    .where(and(eq(schema.patients.dob, dob)));
  const match = candidates.find(
    (p) =>
      p.firstName.toLowerCase() === firstName.toLowerCase() &&
      p.lastName.toLowerCase() === lastName.toLowerCase(),
  );

  // No match: do NOT silently create a record — a misheard name would fork a
  // duplicate chart. The agent must confirm spelling/DOB and that the caller
  // is genuinely new, then retry with confirmedNewPatient: true.
  if (!match && args.confirmedNewPatient !== true) {
    return {
      patientId: null,
      knownPatient: false,
      needsConfirmation: true,
      note:
        "No record found for this name and date of birth. First re-confirm the spelling of the name and the date of birth with the caller. If both are correct, ask whether they are new to the practice. If they say they are NEW, call identify_patient again with the same details plus confirmedNewPatient: true. If they say they are an EXISTING patient, the name or DOB is likely misheard — re-collect and try again; never create a duplicate record.",
    };
  }

  const patient =
    match ??
    (
      await db()
        .insert(schema.patients)
        .values({ firstName, lastName, dob, phone: callbackNumber })
        .returning()
    )[0];

  const missingDemographics = missingDemographicsOf({
    ...patient,
    phone: patient.phone ?? callbackNumber,
  });

  const statusNote = match
    ? 'RETURNING patient — greet warmly ("Welcome back!"). Default visit type: follow_up, unless the caller asks for something else (new referral, study, new concern).'
    : 'NEW patient — record just created. Say "Looks like you\'re new with us — welcome!" Default visit type: new_patient. Expect to collect full demographics.';

  return {
    patientId: patient.id,
    knownPatient: Boolean(match),
    missingDemographics,
    note: `${statusNote} ${
      missingDemographics.length
        ? `Missing on file: ${missingDemographics.join(", ")}. Tell the caller once what you need, then collect ONE item at a time (email → phone → address → insurance), confirm each back, and save each with update_demographics as soon as it is confirmed — never bundle two questions (spec §3.2/§3.4.5). Start with: ${missingDemographics[0]}. Only if the caller cannot supply an item: do not book — note it and escalate_to_staff.`
        : "Record complete."
    }`,
  };
};

function missingDemographicsOf(p: {
  email: string | null;
  phone: string | null;
  address: string | null;
  insurancePayer: string | null;
}): string[] {
  return (
    [
      ["email", p.email],
      ["phone", p.phone],
      ["address", p.address],
      ["insurance", p.insurancePayer],
    ] as const
  )
    .filter(([, v]) => v == null)
    .map(([k]) => k);
}

// Spec §3.2 new-appointment row: "collect missing demographics". Persists what
// the caller supplies mid-call so the §3.4 booking gate can clear; insurance
// given verbally is recorded as the payer only — active/HMO status still comes
// from check_insurance, never from the caller's word.
const update_demographics: Handler = async (args) => {
  const patientId = str(args.patientId);
  if (!patientId) return { error: "patientId required" };

  const updates: Partial<typeof schema.patients.$inferInsert> = {};
  const email = str(args.email);
  const phone = str(args.phone);
  const address = str(args.address);
  const insurancePayer = str(args.insurancePayer);
  if (email) updates.email = email;
  if (phone) updates.phone = phone;
  if (address) updates.address = address;
  if (insurancePayer) updates.insurancePayer = insurancePayer;

  if (Object.keys(updates).length === 0) {
    return { error: "Provide at least one of: email, phone, address, insurancePayer" };
  }

  const [patient] = await db()
    .update(schema.patients)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.patients.id, patientId))
    .returning();
  if (!patient) return { error: "Patient not found — call identify_patient first" };

  const missingDemographics = missingDemographicsOf(patient);
  return {
    updated: true,
    saved: Object.keys(updates),
    missingDemographics,
    note: missingDemographics.length
      ? `Saved. Still missing: ${missingDemographics.join(", ")}. Ask for the NEXT item now — just ${missingDemographics[0]}, one question, confirm it back, save it. If the caller cannot supply it, do not book — escalate_to_staff.`
      : insurancePayer
        ? "Demographics complete. Insurance payer recorded — run check_insurance to verify it is active before booking."
        : "Demographics complete.",
  };
};

const check_insurance: Handler = async (args) => {
  const patientId = str(args.patientId);
  if (!patientId) return { error: "patientId required" };
  const result = await getPorts().eligibility.checkInsurance(patientId);
  return {
    ...result,
    guidance: !result.verified
      ? "Insurance could not be verified right now. Do NOT book. Capture details and escalate_to_staff."
      : result.isHmo
        ? "HMO plan: a PCP/insurer referral is required before booking. Do NOT book; explain and escalate_to_staff with reason callback."
        : result.active
          ? "Insurance verified active."
          : "Insurance is not active. Do NOT book; the caller may self-pay or resolve coverage first.",
  };
};

const verify_study_auth: Handler = async (args) => {
  const patientId = str(args.patientId);
  const studyType = str(args.studyType);
  if (!patientId || !studyType) return { error: "patientId and studyType required" };
  const result = await getPorts().ehr.checkStudyAuth(patientId, studyType);
  return {
    ...result,
    guidance: result.authorized
      ? result.source === "medicare_exempt"
        ? "Medicare — no authorization needed."
        : "Active authorization on file."
      : "No active authorization. Do NOT schedule this study; escalate_to_staff with reason auth.",
  };
};

const find_slots: Handler = async (args) => {
  const type = str(args.appointmentType) as AppointmentType | null;
  if (!type) return { error: "appointmentType required" };
  const location = (str(args.location) ?? undefined) as LocationCode | undefined;
  const fromDate = str(args.fromDate);

  const from = fromDate ? new Date(`${fromDate}T00:00:00Z`) : new Date(Date.now() + 24 * 3600_000);
  const to = new Date(from.getTime() + 21 * 24 * 3600_000);

  const rules = await loadRules(type, location);
  if (rules.length === 0) {
    return {
      slots: [],
      message:
        "No bookable availability is configured for this appointment type yet. Do not offer times. Apologize and escalate_to_staff with reason callback, capturing the patient's preferred days.",
    };
  }
  const booked = await loadBooked(type, from);
  const slots = findSlots({ type, location, from, to, rules, booked, limit: 3 });
  return {
    slots: slots.map((s) => ({
      slotId: s.slotId,
      location: s.location,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      spoken: `${s.startsAt.toUTCString().slice(0, 22)} at our ${s.location === "NV" ? "Henderson" : "Summerlin"} office`,
    })),
    message: slots.length === 0 ? "No open slots in the next 3 weeks." : undefined,
  };
};

// Spec §3.2 "assign provider/location": pick a provider covering the booked
// location, least-loaded by upcoming appointments. Provisional until the
// clinic's provider-level availability grid exists (§7.1) — ops can then move
// assignment into availability_rules without changing callers.
async function assignProvider(
  location: LocationCode,
): Promise<{ id: string; name: string; role: string } | null> {
  const providers = await db().select().from(schema.providers);
  const eligible = providers.filter((p) => p.locations.includes(location));
  if (eligible.length === 0) return null;

  const upcoming = await db()
    .select({ providerId: schema.appointments.providerId })
    .from(schema.appointments)
    .where(
      and(
        gte(schema.appointments.startsAt, new Date()),
        inArray(schema.appointments.status, ["booked", "confirmed", "rescheduled"]),
      ),
    );
  const load = new Map<string, number>();
  for (const a of upcoming) {
    if (a.providerId) load.set(a.providerId, (load.get(a.providerId) ?? 0) + 1);
  }
  eligible.sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
  const chosen = eligible[0];
  return { id: chosen.id, name: chosen.name, role: chosen.role };
}

const book_appointment: Handler = async (args, vapiCallId) => {
  const patientId = str(args.patientId);
  const slotId = str(args.slotId);
  if (!patientId || !slotId) return { error: "patientId and slotId required" };

  const slot = parseSlotId(slotId);
  if (!slot) return { error: "Invalid slotId — use a slotId exactly as returned by find_slots" };

  // Checklist enforced in code (spec §3.4): derived from THIS call's tool runs.
  const gate = canBook(slot.type, await executionsForCall(vapiCallId));
  if (!gate.allowed) {
    return { booked: false, refused: true, reason: gate.reason, missingSteps: gate.missingSteps };
  }

  // Race-safe: re-validate against current bookings just before insert.
  const rules = await loadRules(slot.type, slot.location);
  const booked = await loadBooked(slot.type, new Date(slot.startsAt.getTime() - 24 * 3600_000));
  const validation = validateBooking(slot, rules, booked);
  if (!validation.ok) {
    return { booked: false, refused: true, reason: validation.violation, suggestion: "Offer a different slot from find_slots." };
  }

  const rule = rules.find(
    (r) => r.location === slot.location && r.dayOfWeek === slot.startsAt.getUTCDay(),
  );
  const endsAt = new Date(slot.startsAt.getTime() + (rule?.slotMinutes ?? 30) * 60_000);

  const provider = await assignProvider(slot.location);

  const [appt] = await db()
    .insert(schema.appointments)
    .values({
      patientId,
      type: slot.type,
      location: slot.location,
      providerId: provider?.id ?? null,
      startsAt: slot.startsAt,
      endsAt,
      bookedByVapiCallId: vapiCallId,
    })
    .returning();

  const prep = getPrepScript(slot.type);
  await writeNote(
    patientId,
    vapiCallId,
    `Booked ${slot.type} at ${slot.location} for ${slot.startsAt.toISOString()} (appt ${appt.id})${provider ? ` with ${provider.name}, ${provider.role}` : ""}.`,
  );

  return {
    booked: true,
    appointmentId: appt.id,
    startsAt: slot.startsAt.toISOString(),
    location: slot.location,
    provider: provider ? `${provider.name}, ${provider.role}` : null,
    prepInstructions: prep ?? "No special preparation needed.",
    readToCaller: prep != null,
  };
};

async function locateAppointment(patientId: string, appointmentId: string | null) {
  if (appointmentId) {
    const [a] = await db()
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, appointmentId))
      .limit(1);
    return a ?? null;
  }
  const [next] = await db()
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.patientId, patientId),
        gte(schema.appointments.startsAt, new Date()),
        inArray(schema.appointments.status, ["booked", "confirmed", "rescheduled"]),
      ),
    )
    .orderBy(asc(schema.appointments.startsAt))
    .limit(1);
  return next ?? null;
}

const reschedule_appointment: Handler = async (args, vapiCallId) => {
  const patientId = str(args.patientId);
  const newSlotId = str(args.newSlotId);
  if (!patientId || !newSlotId) return { error: "patientId and newSlotId required" };

  const existing = await locateAppointment(patientId, str(args.appointmentId));
  if (!existing) return { error: "No upcoming appointment found for this patient." };

  const slot = parseSlotId(newSlotId);
  if (!slot) return { error: "Invalid newSlotId — use a slotId from find_slots" };

  const rules = await loadRules(slot.type, slot.location);
  const booked = await loadBooked(slot.type, new Date(slot.startsAt.getTime() - 24 * 3600_000));
  const validation = validateBooking(slot, rules, booked);
  if (!validation.ok) return { rescheduled: false, reason: validation.violation };

  const rule = rules.find(
    (r) => r.location === slot.location && r.dayOfWeek === slot.startsAt.getUTCDay(),
  );
  // Location change may invalidate the assigned provider — re-assign if so.
  let providerId = existing.providerId;
  if (slot.location !== existing.location || providerId == null) {
    providerId = (await assignProvider(slot.location))?.id ?? providerId;
  }
  await db()
    .update(schema.appointments)
    .set({
      startsAt: slot.startsAt,
      endsAt: new Date(slot.startsAt.getTime() + (rule?.slotMinutes ?? 30) * 60_000),
      location: slot.location,
      providerId,
      status: "rescheduled",
    })
    .where(eq(schema.appointments.id, existing.id));

  await writeNote(
    patientId,
    vapiCallId,
    `Rescheduled appt ${existing.id} to ${slot.startsAt.toISOString()} at ${slot.location}.`,
  );
  return { rescheduled: true, appointmentId: existing.id, startsAt: slot.startsAt.toISOString() };
};

const cancel_appointment: Handler = async (args, vapiCallId) => {
  const patientId = str(args.patientId);
  if (!patientId) return { error: "patientId required" };
  const existing = await locateAppointment(patientId, str(args.appointmentId));
  if (!existing) return { error: "No upcoming appointment found for this patient." };

  await db()
    .update(schema.appointments)
    .set({ status: "cancelled" })
    .where(eq(schema.appointments.id, existing.id));

  // Cancellation feeds outbound follow-up ~1 week out (spec §3.2).
  await db().insert(schema.outboundQueue).values({
    workstream: "follow_up",
    patientId,
    authVerified: true,
    attemptCap: attemptCapFor("follow_up"),
    nextAttemptAt: new Date(Date.now() + 7 * 24 * 3600_000),
    sourceRef: `cancelled:${existing.id}`,
  });

  await writeNote(
    patientId,
    vapiCallId,
    `Cancelled appt ${existing.id} (${str(args.reason) ?? "no reason given"}). Follow-up queued ~1 week.`,
  );
  return { cancelled: true, appointmentId: existing.id, followUpQueued: true };
};

const confirm_appointment: Handler = async (args, vapiCallId) => {
  const patientId = str(args.patientId);
  const status = str(args.status);
  if (!patientId || !status || !["confirmed", "rescheduled", "cancelled"].includes(status)) {
    return { error: "patientId and status (confirmed|rescheduled|cancelled) required" };
  }
  const existing = await locateAppointment(patientId, str(args.appointmentId));
  if (!existing) return { error: "No upcoming appointment found for this patient." };

  await db()
    .update(schema.appointments)
    .set({ status: status as "confirmed" | "rescheduled" | "cancelled" })
    .where(eq(schema.appointments.id, existing.id));
  await writeNote(patientId, vapiCallId, `Confirmation callback: appt ${existing.id} → ${status}.`);
  return { updated: true, appointmentId: existing.id, status };
};

const capture_refill: Handler = async (args, vapiCallId) => {
  const patientId = str(args.patientId);
  const drug = str(args.drug);
  const pharmacy = str(args.pharmacy);
  if (!drug || !pharmacy) return { error: "drug and pharmacy required" };

  const [flag] = await db()
    .insert(schema.flags)
    .values({
      vapiCallId,
      patientId,
      reason: "refill",
      intake: { drug, pharmacy, capturedAt: new Date().toISOString() },
    })
    .returning();
  await getPorts().notify.notifyStaff({
    reason: "refill",
    routedToExt: null,
    summary: `Refill request: ${drug} → ${pharmacy}`,
    flagId: flag.id,
  });
  return {
    captured: true,
    flagId: flag.id,
    tellCaller: "The clinical team handles refills and will follow up. Do not promise the refill itself.",
  };
};

const quote_copay: Handler = async (args) => {
  const patientId = str(args.patientId);
  if (!patientId) return { error: "patientId required" };
  return { ...(await getPorts().eligibility.quoteCopay(patientId)) };
};

const classify_and_route: Handler = async (args) => {
  const topic = str(args.topic) ?? "incoming_general";
  const owner = routeTopic(topic);
  return { ext: owner.ext, ownerName: owner.ownerName, owns: owner.owns };
};

// Dynamic staff transfer (spec §3.3): route the topic, check availability, and
// execute the transfer by POSTing to the live call's control URL (Vapi dynamic
// transfer pattern). Refuses off-hours, for unavailable staff, and for calls
// with no PSTN leg (web/simulation) — the assistant then falls back to
// escalate_to_staff per its prompt.
const transfer_to_staff: Handler = async (args, vapiCallId, ctx) => {
  const topic = str(args.topic) ?? "incoming_general";
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

  // Failed transfer → write a minimal flag IMMEDIATELY, not just an instruction
  // to the model. Guarantees a backend record even if the caller hangs up
  // before intake; escalate_to_staff enriches this same flag afterwards.
  const unavailable = async () => {
    const [flag] = await db()
      .insert(schema.flags)
      .values({
        vapiCallId,
        reason: "callback",
        routedToExt: owner.ext,
        intake: {
          topic,
          summary: str(args.summary) ?? `Caller asked for ${owner.owns}; no one reachable.`,
          reason: `Transfer to ${owner.ownerName} (ext ${owner.ext}) not possible — needs follow-up.`,
          autoCreated: true,
          ...clinicContext(new Date()),
        },
      })
      .returning();
    await getPorts().notify.notifyStaff({
      reason: "callback",
      routedToExt: owner.ext,
      summary: `Unreachable transfer (${owner.owns}): ${str(args.summary) ?? topic}`,
      flagId: flag.id,
    });
    return {
      transferred: false,
      flagId: flag.id,
      tellCaller:
        "No staff member is reachable for a live transfer right now. A follow-up flag has already been created. Now capture full intake (name, date of birth, callback number, reason, actions taken) and use escalate_to_staff to complete it. Do not mention voicemail.",
    };
  };

  const isPhoneCall = (ctx?.callType ?? "").toLowerCase().includes("phone");

  // DEMO MODE (staff DIDs not wired yet): a successful in-hours routing
  // announces the named owner and ends the call as a simulated handoff.
  // Routing outcome still lands in the backend (flag + note) for the demo
  // dashboard. Off-hours keeps the normal flag/intake path.
  if (getEnv().DEMO_TRANSFER_MODE && isPhoneCall && ctx?.controlUrl) {
    const staffRow = staffRows.find((s) => s.ext === owner.ext);
    if (isBusinessHours(new Date()) && staffRow?.available) {
      // Caller-facing label ("medication refill specialist") beats internal
      // owner names when the request type has no named §2 owner.
      const specialistLabel = str(args.specialistLabel);
      const spoken = specialistLabel
        ? specialistLabel.toLowerCase().startsWith("next available")
          ? "I understand. Please hold on while I transfer you to the next available staff member."
          : `Got it — let me route you to our ${specialistLabel}. Hang on one second.`
        : `I'm transferring you to ${owner.ownerName}, who handles that — one moment, please.`;
      try {
        const response = await fetch(ctx.controlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "say", content: spoken, endCallAfterSpoken: true }),
        });
        if (response.ok) {
          const [flag] = await db()
            .insert(schema.flags)
            .values({
              vapiCallId,
              reason: "callback",
              routedToExt: owner.ext,
              intake: {
                topic,
                summary: str(args.summary) ?? topic,
                simulatedTransfer: true,
                specialistLabel: specialistLabel ?? undefined,
                reason: `Demo transfer: routed to ${owner.ownerName} (ext ${owner.ext}) for ${specialistLabel ?? owner.owns}; call ended as simulated handoff.`,
                ...clinicContext(new Date()),
              },
            })
            .returning();
          await getPorts().notify.notifyStaff({
            reason: "callback",
            routedToExt: owner.ext,
            summary: `Demo transfer (${owner.owns}): ${str(args.summary) ?? topic}`,
            flagId: flag.id,
          });
          await writeNote(
            null,
            vapiCallId,
            `Demo-mode transfer: routed caller to ${owner.ownerName} (ext ${owner.ext}) for ${owner.owns}; call ended as simulated handoff.`,
          );
          return {
            transferred: true,
            demoSimulated: true,
            ownerName: owner.ownerName,
            tellCaller:
              "The transfer announcement is playing and the call will end automatically. Do not say anything else.",
          };
        }
        console.error(`[transfer_to_staff] demo say ${response.status}`);
      } catch (err) {
        console.error("[transfer_to_staff] demo say failed", err);
      }
      // Demo announcement failed → fall through to the normal paths below.
    }
  }

  if (decision.action === "flag") return unavailable();
  if (!isPhoneCall || !ctx?.controlUrl) return unavailable();

  try {
    const response = await fetch(ctx.controlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer",
        destination: {
          type: "number",
          number: decision.phoneNumber,
          extension: decision.ext,
        },
        content: `Transferring you to ${decision.ownerName} now.`,
      }),
    });
    if (!response.ok) {
      console.error(`[transfer_to_staff] control URL ${response.status}`);
      return unavailable();
    }
  } catch (err) {
    console.error("[transfer_to_staff] control URL failed", err);
    return unavailable();
  }

  await writeNote(
    null,
    vapiCallId,
    `Transferred caller to ${decision.ownerName} (ext ${decision.ext}) for ${owner.owns}.`,
  );
  return {
    transferred: true,
    ownerName: decision.ownerName,
    tellCaller: `The caller is being transferred to ${decision.ownerName} now.`,
  };
};

const escalate_to_staff: Handler = async (args, vapiCallId) => {
  const reason = str(args.reason) ?? "low_confidence";
  const intake = (args.intake ?? {}) as Record<string, unknown>;
  const routeTopicArg = str(args.routeTopic);
  const owner = routeTopicArg ? routeTopic(routeTopicArg) : null;

  const validReasons = [
    "refill",
    "signature",
    "clinical",
    "auth",
    "billing_complaint",
    "low_confidence",
    "callback",
  ] as const;
  const flagReason = (validReasons as readonly string[]).includes(reason)
    ? (reason as (typeof validReasons)[number])
    : "low_confidence";

  const stampedIntake = { ...intake, ...clinicContext(new Date()) };

  // If transfer_to_staff already auto-created a minimal flag on this call,
  // enrich it with the full intake instead of creating a duplicate.
  const existing = (
    await db().select().from(schema.flags).where(eq(schema.flags.vapiCallId, vapiCallId))
  ).find(
    (f) =>
      f.status === "open" && (f.intake as Record<string, unknown> | null)?.autoCreated === true,
  );

  const [flag] = existing
    ? await db()
        .update(schema.flags)
        .set({
          patientId: str(args.patientId) ?? existing.patientId,
          reason: flagReason,
          routedToExt: owner?.ext ?? existing.routedToExt,
          intake: {
            ...(existing.intake as Record<string, unknown>),
            ...stampedIntake,
            autoCreated: undefined,
            enriched: true,
          },
        })
        .where(eq(schema.flags.id, existing.id))
        .returning()
    : await db()
        .insert(schema.flags)
        .values({
          vapiCallId,
          patientId: str(args.patientId),
          reason: flagReason,
          intake: stampedIntake,
          routedToExt: owner?.ext ?? null,
        })
        .returning();

  await getPorts().notify.notifyStaff({
    reason: flagReason,
    routedToExt: owner?.ext ?? null,
    summary: String(intake.reason ?? "escalation"),
    flagId: flag.id,
  });

  return {
    flagged: true,
    flagId: flag.id,
    tellCaller:
      "Tell the caller warmly, in first person: you've noted everything down and you're getting this to the right person as soon as possible — they'll reach out just as soon as they can, and the caller won't need to repeat any of it. If they ask for a specific callback time, do NOT promise one — acknowledge it matters to them and repeat the as-soon-as-possible commitment.",
  };
};

const flag_emergency: Handler = async (args, vapiCallId) => {
  const description = str(args.description) ?? "unspecified emergency";
  const callbackNumber = str(args.callbackNumber);

  const [flag] = await db()
    .insert(schema.flags)
    .values({
      vapiCallId,
      reason: "emergency_followup",
      intake: {
        description,
        callbackNumber,
        callerName: str(args.callerName),
        capturedAt: new Date().toISOString(),
        ...clinicContext(new Date()),
      },
    })
    .returning();

  // Spec §3.6: emergencies page a live human even off-hours — never only a flag.
  const page = await getPorts().notify.pageHuman(
    `Caller reported: ${description}`,
    callbackNumber,
  );

  return {
    flagged: true,
    flagId: flag.id,
    humanPaged: page.paged,
    pagedVia: page.via,
    tellCaller: page.paged
      ? "Direct the caller to call 911 or go to the nearest ER immediately. Confirm the on-call team has been alerted."
      : "Direct the caller to call 911 or go to the nearest ER immediately. Do not say the on-call team was alerted; say the emergency follow-up was documented for staff.",
  };
};

export const TOOL_HANDLERS: Record<string, Handler> = {
  identify_patient,
  update_demographics,
  check_insurance,
  verify_study_auth,
  find_slots,
  book_appointment,
  reschedule_appointment,
  cancel_appointment,
  confirm_appointment,
  capture_refill,
  quote_copay,
  classify_and_route,
  transfer_to_staff,
  escalate_to_staff,
  flag_emergency,
};
