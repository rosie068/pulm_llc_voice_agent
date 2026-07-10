CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('new_patient', 'follow_up', 'hst', 'psg', 'titration_split', 'echo_doppler', 'allergy', 'pft', 'sixmwt');--> statement-breakpoint
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('resolved_scheduled', 'denied_closed', 'vm_left', 'spoke_no_appt');--> statement-breakpoint
CREATE TYPE "public"."flag_reason" AS ENUM('refill', 'signature', 'clinical', 'auth', 'billing_complaint', 'low_confidence', 'callback', 'emergency_followup');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."insurance_status" AS ENUM('active', 'inactive', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."location_code" AS ENUM('NV', 'SM', 'BHC', 'home');--> statement-breakpoint
CREATE TYPE "public"."queue_closed_reason" AS ENUM('declined', 'dnd', 'other_pulm', 'deceased', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('ready', 'in_progress', 'scheduled', 'closed', 'unreachable', 'cap_reached');--> statement-breakpoint
CREATE TYPE "public"."study_subtype" AS ENUM('hst', 'psg', 'titration_split');--> statement-breakpoint
CREATE TYPE "public"."tool_execution_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."workstream" AS ENUM('referral', 'sleep_study', 'echo_doppler', 'allergy', 'confirmation', 'missed_appt', 'follow_up');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" "appointment_type" NOT NULL,
	"location" "location_code" NOT NULL,
	"provider_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"booked_by_vapi_call_id" text,
	"synced_to_ehr_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_type" "appointment_type" NOT NULL,
	"location" "location_code" NOT NULL,
	"day_of_week" integer NOT NULL,
	"window_start" time NOT NULL,
	"window_end" time NOT NULL,
	"capacity_per_day" integer NOT NULL,
	"slot_minutes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"vapi_call_id" text,
	"attempt_number" integer NOT NULL,
	"outcome" text,
	"noted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vapi_call_id" text NOT NULL,
	"type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vapi_call_id" text NOT NULL,
	"direction" "call_direction" NOT NULL,
	"patient_id" uuid,
	"caller_number" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"duration_seconds" integer,
	"transcript" text,
	"recording_url" text,
	"summary" text,
	"structured_data" jsonb,
	"outcome" "call_outcome",
	"cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vapi_call_id" text,
	"patient_id" uuid,
	"reason" "flag_reason" NOT NULL,
	"intake" jsonb NOT NULL,
	"routed_to_ext" text,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid,
	"vapi_call_id" text,
	"body" text NOT NULL,
	"agent_tag" text DEFAULT 'voice-agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_to_ehr_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbound_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workstream" "workstream" NOT NULL,
	"patient_id" uuid NOT NULL,
	"study_subtype" "study_subtype",
	"auth_verified" boolean DEFAULT false NOT NULL,
	"status" "queue_status" DEFAULT 'ready' NOT NULL,
	"closed_reason" "queue_closed_reason",
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"attempt_cap" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob" date,
	"phone" text,
	"email" text,
	"address" text,
	"insurance_payer" text,
	"insurance_status" "insurance_status" DEFAULT 'unknown' NOT NULL,
	"is_hmo" boolean,
	"is_medicare" boolean,
	"referral_on_file" boolean,
	"study_auth_active" boolean,
	"tebra_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"locations" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ext" text NOT NULL,
	"owner_name" text NOT NULL,
	"phone_number" text,
	"available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vapi_call_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb,
	"result" jsonb,
	"status" "tool_execution_status" DEFAULT 'ok' NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_queue_id_outbound_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."outbound_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_queue" ADD CONSTRAINT "outbound_queue_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_starts_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appointments_type_loc_idx" ON "appointments" USING btree ("type","location");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "call_attempts_queue_idx" ON "call_attempts" USING btree ("queue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_events_dedupe_uq" ON "call_events" USING btree ("vapi_call_id","type","dedupe_key");--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("vapi_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_vapi_call_id_uq" ON "calls" USING btree ("vapi_call_id");--> statement-breakpoint
CREATE INDEX "flags_status_idx" ON "flags" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notes_patient_idx" ON "notes" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "outbound_queue_status_idx" ON "outbound_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_executions_tool_call_id_uq" ON "tool_executions" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_executions_call_idx" ON "tool_executions" USING btree ("vapi_call_id");