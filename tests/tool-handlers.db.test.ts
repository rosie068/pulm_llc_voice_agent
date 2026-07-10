// DB-backed tool-handler tests (guide Phase 11 "Tool handlers" row).
// Runs against the real Neon database from .env — skipped automatically when
// DATABASE_URL is absent (e.g. CI without the secret). All rows created here
// are tagged with a unique test prefix and deleted in afterAll.

import "dotenv/config";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.DATABASE_URL);

// Unique per run so parallel/aborted runs never collide.
const RUN = crypto.randomUUID().slice(0, 8);
const LAST_NAME = `ZzTest${RUN}`;
const callId = (n: string) => `test-${RUN}-${n}`;

// next Sunday (NV PSG capacity = 3) — always in the future
function nextSunday(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

describe.skipIf(!HAS_DB)("tool handlers against Neon", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let handlers: Record<string, (args: any, vapiCallId: string) => Promise<any>>;
  let db: any;
  let schema: any;
  let eq: any, like: any, inArray: any;
  const patientIds: string[] = [];

  beforeAll(async () => {
    ({ TOOL_HANDLERS: handlers } = await import("@/vapi/tools/handlers"));
    const dbmod = await import("@/db");
    db = dbmod.db;
    schema = dbmod.schema;
    ({ eq, like, inArray } = await import("drizzle-orm"));
  });

  afterAll(async () => {
    if (!HAS_DB || patientIds.length === 0) return;
    await db().delete(schema.notes).where(like(schema.notes.vapiCallId, `test-${RUN}-%`));
    await db().delete(schema.toolExecutions).where(like(schema.toolExecutions.vapiCallId, `test-${RUN}-%`));
    await db().delete(schema.flags).where(like(schema.flags.vapiCallId, `test-${RUN}-%`));
    await db().delete(schema.flags).where(inArray(schema.flags.patientId, patientIds));
    await db().delete(schema.outboundQueue).where(inArray(schema.outboundQueue.patientId, patientIds));
    await db().delete(schema.appointments).where(inArray(schema.appointments.patientId, patientIds));
    await db().delete(schema.patients).where(eq(schema.patients.lastName, LAST_NAME));
  });

  async function recordExecution(vapiCallId: string, toolName: string, result: unknown) {
    // Mimic the webhook route: the checklist derives from tool_executions rows.
    await db().insert(schema.toolExecutions).values({
      vapiCallId,
      toolCallId: `tc-${RUN}-${toolName}-${vapiCallId}`,
      toolName,
      result,
      status: "ok",
    });
  }

  it("unknown caller: no record created until confirmedNewPatient; returning caller greeted as known", async () => {
    const cid = callId("newvsreturning");

    // 1. No match, no confirmation → needsConfirmation, NO record created.
    const first = await handlers.identify_patient(
      { firstName: "Zara", lastName: LAST_NAME, dob: "1995-02-02" },
      cid,
    );
    expect(first.needsConfirmation).toBe(true);
    expect(first.patientId).toBeNull();
    const created = await db()
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.firstName, "Zara"))
      .then((rows: any[]) => rows.filter((r) => r.lastName === LAST_NAME));
    expect(created.length).toBe(0);

    // 2. Caller confirms they are new → record created, welcomed as NEW.
    const second = await handlers.identify_patient(
      { firstName: "Zara", lastName: LAST_NAME, dob: "1995-02-02", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(second.patientId);
    expect(second.knownPatient).toBe(false);
    expect(second.patientId).toBeTruthy();
    expect(second.note).toMatch(/new with us/i);
    expect(second.note).toMatch(/new_patient/);

    // 3. Same person calls again → returning, welcomed BACK, follow_up default.
    const third = await handlers.identify_patient(
      { firstName: "Zara", lastName: LAST_NAME, dob: "1995-02-02" },
      cid,
    );
    expect(third.knownPatient).toBe(true);
    expect(third.patientId).toBe(second.patientId);
    expect(third.note).toMatch(/welcome back/i);
    expect(third.note).toMatch(/follow_up/);
  });

  it("book_appointment refuses when checklist incomplete (spec §3.4)", async () => {
    const cid = callId("refusal");
    const identity = await handlers.identify_patient(
      { firstName: "Alice", lastName: LAST_NAME, dob: "1980-01-01", callbackNumber: "+17025550001", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    await recordExecution(cid, "identify_patient", identity);

    const result = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: `psg|NV|${nextSunday().toISOString().replace("00:00:00", "20:30:00")}` },
      cid,
    );
    expect(result.booked).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.missingSteps.join(" ")).toMatch(/check_insurance/);
  });

  it("HMO patient is blocked from booking (spec §3.4.2)", async () => {
    const cid = callId("hmo");
    const identity = await handlers.identify_patient(
      { firstName: "Harry", lastName: LAST_NAME, dob: "1975-05-05", callbackNumber: "+17025550002", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    await db()
      .update(schema.patients)
      .set({
        insuranceStatus: "active",
        isHmo: true,
        email: "h@test.invalid",
        address: "1 Test St",
        insurancePayer: "TestHMO",
      })
      .where(eq(schema.patients.id, identity.patientId));

    await recordExecution(cid, "identify_patient", { ...identity, missingDemographics: [] });
    const insurance = await handlers.check_insurance({ patientId: identity.patientId }, cid);
    expect(insurance.isHmo).toBe(true);
    expect(insurance.guidance).toMatch(/HMO/);
    await recordExecution(cid, "check_insurance", insurance);

    const result = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: `psg|NV|${nextSunday().toISOString().replace("00:00:00", "20:30:00")}` },
      cid,
    );
    expect(result.booked).toBe(false);
    expect(result.missingSteps.join(" ")).toMatch(/HMO/);
  });

  it("happy path: verified Medicare patient books PSG; note + appointment rows land", async () => {
    const cid = callId("happy");
    const identity = await handlers.identify_patient(
      { firstName: "Mary", lastName: LAST_NAME, dob: "1960-03-03", callbackNumber: "+17025550003", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    await db()
      .update(schema.patients)
      .set({
        insuranceStatus: "active",
        isHmo: false,
        isMedicare: true,
        referralOnFile: true,
        email: "m@test.invalid",
        address: "2 Test St",
        insurancePayer: "Medicare",
      })
      .where(eq(schema.patients.id, identity.patientId));
    await recordExecution(cid, "identify_patient", { ...identity, missingDemographics: [] });

    const insurance = await handlers.check_insurance({ patientId: identity.patientId }, cid);
    expect(insurance.active).toBe(true);
    await recordExecution(cid, "check_insurance", insurance);

    const auth = await handlers.verify_study_auth(
      { patientId: identity.patientId, studyType: "psg" },
      cid,
    );
    expect(auth.authorized).toBe(true);
    expect(auth.source).toBe("medicare_exempt");
    await recordExecution(cid, "verify_study_auth", auth);

    const slots = await handlers.find_slots({ appointmentType: "psg", location: "NV" }, cid);
    expect(slots.slots.length).toBeGreaterThan(0);

    const booking = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: slots.slots[0].slotId },
      cid,
    );
    expect(booking.booked).toBe(true);
    expect(booking.prepInstructions).toMatch(/shower/i);
    // Spec §3.2: booking assigns a provider covering the location.
    expect(booking.provider).toBeTruthy();

    const [appt] = await db()
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, booking.appointmentId));
    expect(appt).toBeDefined();
    expect(appt.type).toBe("psg");

    const notes = await db().select().from(schema.notes).where(eq(schema.notes.vapiCallId, cid));
    expect(notes.length).toBeGreaterThan(0);
  });

  it("new patient with gaps: update_demographics fills record and unblocks booking (spec §3.2)", async () => {
    const cid = callId("demographics");
    // Referral callee not in the system yet — identify creates a shell record.
    const identity = await handlers.identify_patient(
      { firstName: "Nula", lastName: LAST_NAME, dob: "2001-07-28", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    expect(identity.knownPatient).toBe(false);
    expect(identity.missingDemographics).toEqual(
      expect.arrayContaining(["email", "phone", "address", "insurance"]),
    );
    await recordExecution(cid, "identify_patient", identity);

    // Booking must be blocked while demographics are missing.
    const slotsBefore = await handlers.find_slots({ appointmentType: "new_patient" }, cid);
    expect(slotsBefore.slots.length).toBeGreaterThan(0); // office grid is seeded
    const blocked = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: slotsBefore.slots[0].slotId },
      cid,
    );
    expect(blocked.booked).toBe(false);
    expect(blocked.missingSteps.join(" ")).toMatch(/demographics/);

    // Caller supplies the gaps on the call.
    const updated = await handlers.update_demographics(
      {
        patientId: identity.patientId,
        email: "n@test.invalid",
        phone: "608-207-8237",
        address: "620 Jones Street, San Francisco, CA",
        insurancePayer: "TestPPO",
      },
      cid,
    );
    expect(updated.updated).toBe(true);
    expect(updated.missingDemographics).toEqual([]);
    await recordExecution(cid, "update_demographics", updated);

    // Stub eligibility verifies from the stated payer (demo behavior) — no
    // manual record fix-up needed for a new patient to complete booking.
    const insurance = await handlers.check_insurance({ patientId: identity.patientId }, cid);
    expect(insurance.active).toBe(true);
    expect(insurance.verified).toBe(true);
    expect(insurance.isHmo).toBe(false);
    await recordExecution(cid, "check_insurance", insurance);

    const slots = await handlers.find_slots({ appointmentType: "new_patient" }, cid);
    expect(slots.slots.length).toBeGreaterThan(0);
    const booking = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: slots.slots[0].slotId },
      cid,
    );
    expect(booking.booked).toBe(true);
  });

  it("stated HMO payer on a new patient still blocks booking (spec §3.4.2)", async () => {
    const cid = callId("stated-hmo");
    const identity = await handlers.identify_patient(
      { firstName: "Hilda", lastName: LAST_NAME, dob: "1970-09-09", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    await handlers.update_demographics(
      {
        patientId: identity.patientId,
        email: "hi@test.invalid",
        phone: "+17025550009",
        address: "9 Test St",
        insurancePayer: "SecureChoice HMO",
      },
      cid,
    );
    const insurance = await handlers.check_insurance({ patientId: identity.patientId }, cid);
    expect(insurance.isHmo).toBe(true);
    expect(insurance.guidance).toMatch(/HMO/);
  });

  it("cancel_appointment inserts ~1-week follow-up queue row (spec §3.2)", async () => {
    const cid = callId("cancel");
    // Mary (happy path) has an upcoming appointment.
    const [mary] = await db()
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.firstName, "Mary"))
      .then((rows: any[]) => rows.filter((r) => r.lastName === LAST_NAME));
    expect(mary).toBeDefined();

    const result = await handlers.cancel_appointment(
      { patientId: mary.id, reason: "test cancellation" },
      cid,
    );
    expect(result.cancelled).toBe(true);
    expect(result.followUpQueued).toBe(true);

    const queueRows = await db()
      .select()
      .from(schema.outboundQueue)
      .where(eq(schema.outboundQueue.patientId, mary.id));
    expect(queueRows.length).toBe(1);
    expect(queueRows[0].workstream).toBe("follow_up");
    const days = (queueRows[0].nextAttemptAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8);
  });

  it("failed transfer auto-creates a flag; escalate_to_staff enriches it, no duplicate (spec §3.3)", async () => {
    const cid = callId("transfer-flag");
    // No controlUrl/phone context → transfer must fail and flag immediately.
    const transfer = await handlers.transfer_to_staff(
      { topic: "dme", summary: "CPAP supplies question" },
      cid,
    );
    expect(transfer.transferred).toBe(false);
    expect(transfer.flagId).toBeTruthy();

    const autoFlags = await db().select().from(schema.flags).where(eq(schema.flags.vapiCallId, cid));
    expect(autoFlags.length).toBe(1);
    const autoIntake = autoFlags[0].intake as Record<string, unknown>;
    expect(autoIntake.autoCreated).toBe(true);
    expect(typeof autoIntake.offHours).toBe("boolean");
    expect(typeof autoIntake.clinicLocalTime).toBe("string");
    expect(autoFlags[0].routedToExt).toBe("434"); // dme → Sakshi

    // Model follows up with full intake → same flag enriched, not duplicated.
    const escalated = await handlers.escalate_to_staff(
      {
        reason: "callback",
        intake: {
          name: "Bill Chan",
          dob: "1948-11-30",
          phone: "7025550122",
          reason: "Needs CPAP supplies",
          actionsTaken: "Captured request; transfer unavailable",
        },
      },
      cid,
    );
    expect(escalated.flagged).toBe(true);
    expect(escalated.flagId).toBe(transfer.flagId);

    const after = await db().select().from(schema.flags).where(eq(schema.flags.vapiCallId, cid));
    expect(after.length).toBe(1);
    const enriched = after[0].intake as Record<string, unknown>;
    expect(enriched.name).toBe("Bill Chan");
    expect(enriched.enriched).toBe(true);
    expect(enriched.autoCreated).toBeFalsy();
  });

  it("capacity: 4th PSG on an NV Sunday is refused (cap 3)", async () => {
    const cid = callId("capacity");
    const identity = await handlers.identify_patient(
      { firstName: "Carl", lastName: LAST_NAME, dob: "1955-07-07", callbackNumber: "+17025550004", confirmedNewPatient: true },
      cid,
    );
    patientIds.push(identity.patientId);
    await db()
      .update(schema.patients)
      .set({
        insuranceStatus: "active",
        isHmo: false,
        isMedicare: true,
        referralOnFile: true,
        email: "c@test.invalid",
        address: "3 Test St",
        insurancePayer: "Medicare",
      })
      .where(eq(schema.patients.id, identity.patientId));
    await recordExecution(cid, "identify_patient", { ...identity, missingDemographics: [] });
    await recordExecution(cid, "check_insurance", await handlers.check_insurance({ patientId: identity.patientId }, cid));
    await recordExecution(
      cid,
      "verify_study_auth",
      await handlers.verify_study_auth({ patientId: identity.patientId, studyType: "psg" }, cid),
    );

    // Fill Sunday NV to capacity (3) directly.
    const sunday = nextSunday();
    const at = (hhmm: string) => new Date(`${sunday.toISOString().slice(0, 10)}T${hhmm}:00Z`);
    for (const t of ["20:30", "21:00", "21:30"]) {
      await db().insert(schema.appointments).values({
        patientId: identity.patientId,
        type: "psg",
        location: "NV",
        startsAt: at(t),
        endsAt: new Date(at(t).getTime() + 30 * 60_000),
      });
    }

    const result = await handlers.book_appointment(
      { patientId: identity.patientId, slotId: `psg|NV|${at("21:00").toISOString()}` },
      cid,
    );
    expect(result.booked).toBe(false);
    expect(result.reason).toMatch(/capacity/i);
  });
});
