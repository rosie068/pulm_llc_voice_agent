import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const callDirection = pgEnum("call_direction", ["inbound", "outbound"]);

export const insuranceStatus = pgEnum("insurance_status", [
  "active",
  "inactive",
  "unknown",
]);

// Spec §3.5 inbound outcome classification
export const callOutcome = pgEnum("call_outcome", [
  "resolved_scheduled",
  "denied_closed",
  "vm_left",
  "spoke_no_appt",
]);

export const appointmentType = pgEnum("appointment_type", [
  "new_patient",
  "follow_up",
  "hst",
  "psg",
  "titration_split",
  "echo_doppler",
  "allergy",
  "pft",
  "sixmwt",
]);

export const locationCode = pgEnum("location_code", ["NV", "SM", "BHC", "home"]);

export const appointmentStatus = pgEnum("appointment_status", [
  "booked",
  "confirmed",
  "rescheduled",
  "cancelled",
  "no_show",
  "completed",
]);

export const workstream = pgEnum("workstream", [
  "referral",
  "sleep_study",
  "echo_doppler",
  "allergy",
  "confirmation",
  "missed_appt",
  "follow_up",
]);

export const studySubtype = pgEnum("study_subtype", [
  "hst",
  "psg",
  "titration_split",
]);

export const queueStatus = pgEnum("queue_status", [
  "ready",
  "in_progress",
  "scheduled",
  "closed",
  "unreachable",
  "cap_reached",
]);

export const queueClosedReason = pgEnum("queue_closed_reason", [
  "declined",
  "dnd",
  "other_pulm",
  "deceased",
  "not_interested",
]);

export const flagReason = pgEnum("flag_reason", [
  "refill",
  "signature",
  "clinical",
  "auth",
  "billing_complaint",
  "low_confidence",
  "callback",
  "emergency_followup",
]);

export const flagStatus = pgEnum("flag_status", ["open", "in_progress", "done"]);

export const toolExecutionStatus = pgEnum("tool_execution_status", [
  "ok",
  "error",
]);

// ── Tables ───────────────────────────────────────────────────────────────────

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dob: date("dob"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    insurancePayer: text("insurance_payer"),
    insuranceStatus: insuranceStatus("insurance_status")
      .notNull()
      .default("unknown"),
    isHmo: boolean("is_hmo"),
    isMedicare: boolean("is_medicare"),
    referralOnFile: boolean("referral_on_file"),
    studyAuthActive: boolean("study_auth_active"),
    tebraId: text("tebra_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("patients_phone_idx").on(t.phone)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vapiCallId: text("vapi_call_id").notNull(),
    direction: callDirection("direction").notNull(),
    patientId: uuid("patient_id").references(() => patients.id),
    callerNumber: text("caller_number"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    durationSeconds: integer("duration_seconds"),
    transcript: text("transcript"),
    recordingUrl: text("recording_url"),
    summary: text("summary"),
    structuredData: jsonb("structured_data"),
    outcome: callOutcome("outcome"),
    costCents: integer("cost_cents"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("calls_vapi_call_id_uq").on(t.vapiCallId)],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vapiCallId: text("vapi_call_id").notNull(),
    type: text("type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("call_events_dedupe_uq").on(t.vapiCallId, t.type, t.dedupeKey),
    index("call_events_call_idx").on(t.vapiCallId),
  ],
);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vapiCallId: text("vapi_call_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments"),
    result: jsonb("result"),
    status: toolExecutionStatus("status").notNull().default("ok"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tool_executions_tool_call_id_uq").on(t.toolCallId),
    index("tool_executions_call_idx").on(t.vapiCallId),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id").references(() => patients.id),
    vapiCallId: text("vapi_call_id"),
    body: text("body").notNull(),
    agentTag: text("agent_tag").notNull().default("voice-agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    syncedToEhrAt: timestamp("synced_to_ehr_at", { withTimezone: true }),
  },
  (t) => [index("notes_patient_idx").on(t.patientId)],
);

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  locations: text("locations").array().notNull(),
});

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    type: appointmentType("type").notNull(),
    location: locationCode("location").notNull(),
    providerId: uuid("provider_id").references(() => providers.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    bookedByVapiCallId: text("booked_by_vapi_call_id"),
    syncedToEhrAt: timestamp("synced_to_ehr_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appointments_starts_idx").on(t.startsAt),
    index("appointments_type_loc_idx").on(t.type, t.location),
  ],
);

export const availabilityRules = pgTable("availability_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentType: appointmentType("appointment_type").notNull(),
  location: locationCode("location").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday … 6 = Saturday
  windowStart: time("window_start").notNull(),
  windowEnd: time("window_end").notNull(),
  capacityPerDay: integer("capacity_per_day").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  active: boolean("active").notNull().default(true),
});

export const outboundQueue = pgTable(
  "outbound_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workstream: workstream("workstream").notNull(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    studySubtype: studySubtype("study_subtype"),
    authVerified: boolean("auth_verified").notNull().default(false),
    status: queueStatus("status").notNull().default("ready"),
    closedReason: queueClosedReason("closed_reason"),
    attemptCount: integer("attempt_count").notNull().default(0),
    attemptCap: integer("attempt_cap").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("outbound_queue_status_idx").on(t.status, t.nextAttemptAt)],
);

export const callAttempts = pgTable(
  "call_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => outboundQueue.id),
    vapiCallId: text("vapi_call_id"),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome"),
    notedAt: timestamp("noted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("call_attempts_queue_idx").on(t.queueId)],
);

export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vapiCallId: text("vapi_call_id"),
    patientId: uuid("patient_id").references(() => patients.id),
    reason: flagReason("reason").notNull(),
    intake: jsonb("intake").notNull(),
    routedToExt: text("routed_to_ext"),
    status: flagStatus("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("flags_status_idx").on(t.status)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    detail: jsonb("detail"),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

export const staffAvailability = pgTable("staff_availability", {
  id: uuid("id").primaryKey().defaultRandom(),
  ext: text("ext").notNull(),
  ownerName: text("owner_name").notNull(),
  phoneNumber: text("phone_number"),
  available: boolean("available").notNull().default(true),
});
