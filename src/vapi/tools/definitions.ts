// Vapi function-tool definitions (config as code, synced via scripts/vapi-sync.ts).
// Handler behavior lives in ./handlers.ts; spec references in the guide Phase 6 table.

interface FunctionToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Speak while the tool runs / if it's slow. */
  requestStartMessage?: string;
}

export const TOOL_DEFINITIONS: FunctionToolDef[] = [
  {
    name: "identify_patient",
    description:
      "Verify the caller's identity and look up their patient record. MUST be called before any patient-specific action. Returns patientId, whether they're a known (returning) patient, and any missing demographics. If no record matches, it does NOT create one until you confirm with the caller that they are new and retry with confirmedNewPatient: true.",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string", description: "Caller's first name" },
        lastName: { type: "string", description: "Caller's last name" },
        dob: { type: "string", description: "Date of birth, YYYY-MM-DD" },
        callbackNumber: { type: "string", description: "Best callback phone number" },
        confirmedNewPatient: {
          type: "boolean",
          description:
            "Set true ONLY after the caller confirmed they are new to the practice AND you re-confirmed name spelling + DOB. Creates their patient record.",
        },
      },
      required: ["firstName", "lastName", "dob"],
    },
    requestStartMessage: "Let me pull up your record.",
  },
  {
    name: "update_demographics",
    description:
      "Save demographics the caller supplies on this call (email, phone, address, insurance payer) to their patient record. Use immediately after identify_patient reports missing demographics — booking stays blocked until the record is complete. Returns what is still missing.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "Patient id from identify_patient" },
        email: { type: "string", description: "Email address, as confirmed with the caller" },
        phone: { type: "string", description: "Best phone number" },
        address: { type: "string", description: "Full mailing address" },
        insurancePayer: {
          type: "string",
          description: "Insurance company / plan name as stated by the caller",
        },
      },
      required: ["patientId"],
    },
    requestStartMessage: "Let me get that on your record.",
  },
  {
    name: "check_insurance",
    description:
      "Check the patient's insurance: active status, HMO flag, Medicare flag, referral requirement. Required before booking.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string", description: "Patient id from identify_patient" },
      },
      required: ["patientId"],
    },
    requestStartMessage: "One moment while I check your insurance.",
  },
  {
    name: "verify_study_auth",
    description:
      "Verify an active prior authorization for a study (sleep study, allergy, echo). Medicare patients are exempt. Required before booking any study.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        studyType: {
          type: "string",
          enum: ["hst", "psg", "titration_split", "echo_doppler", "allergy"],
        },
      },
      required: ["patientId", "studyType"],
    },
    requestStartMessage: "Checking the authorization on file.",
  },
  {
    name: "find_slots",
    description:
      "Find up to 3 bookable appointment slots. NEVER offer times that did not come from this tool.",
    parameters: {
      type: "object",
      properties: {
        appointmentType: {
          type: "string",
          enum: [
            "new_patient",
            "follow_up",
            "hst",
            "psg",
            "titration_split",
            "pft",
            "sixmwt",
          ],
        },
        location: { type: "string", enum: ["NV", "SM"], description: "Preferred location, if the caller has one" },
        fromDate: { type: "string", description: "Earliest acceptable date, YYYY-MM-DD. Defaults to tomorrow." },
      },
      required: ["appointmentType"],
    },
    requestStartMessage: "Let me look at the schedule.",
  },
  {
    name: "book_appointment",
    description:
      "Book a slot returned by find_slots. Enforces the verification checklist and refuses with the missing steps if incomplete. Returns confirmation plus preparation instructions to read to the caller.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        slotId: { type: "string", description: "slotId exactly as returned by find_slots" },
      },
      required: ["patientId", "slotId"],
    },
    requestStartMessage: "Booking that for you now.",
  },
  {
    name: "reschedule_appointment",
    description:
      "Move the patient's existing appointment to a new slot from find_slots.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        appointmentId: { type: "string", description: "If known; otherwise the patient's next upcoming appointment is used" },
        newSlotId: { type: "string" },
      },
      required: ["patientId", "newSlotId"],
    },
  },
  {
    name: "cancel_appointment",
    description:
      "Cancel the patient's appointment and log a follow-up for about one week out.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        appointmentId: { type: "string", description: "If known; otherwise next upcoming" },
        reason: { type: "string" },
      },
      required: ["patientId"],
    },
  },
  {
    name: "confirm_appointment",
    description:
      "Record the patient's response to an appointment reminder: confirmed, rescheduled, or cancelled.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        appointmentId: { type: "string" },
        status: { type: "string", enum: ["confirmed", "rescheduled", "cancelled"] },
      },
      required: ["patientId", "status"],
    },
  },
  {
    name: "capture_refill",
    description:
      "Capture a medication refill request for the clinical team. Does NOT approve or promise the refill.",
    parameters: {
      type: "object",
      properties: {
        patientId: { type: "string" },
        drug: { type: "string", description: "Exact medication name and strength if given" },
        pharmacy: { type: "string", description: "Pharmacy name and location" },
      },
      required: ["patientId", "drug", "pharmacy"],
    },
  },
  {
    name: "quote_copay",
    description:
      "Attempt to quote the patient's copay / unmet deductible. If unavailable, says so — never guess amounts.",
    parameters: {
      type: "object",
      properties: { patientId: { type: "string" } },
      required: ["patientId"],
    },
  },
  {
    name: "classify_and_route",
    description:
      "Classify the caller's topic to the staff owner who handles it. Use before any transfer.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "confirmations_rescheduling",
            "bhc_scheduling",
            "incoming_501_vms",
            "nv_sm_scheduling",
            "dme",
            "incoming_general",
            "np_intermountain_echo_doppler",
            "np_other_pcp_ss_allergy",
          ],
        },
        details: { type: "string", description: "One-sentence summary of the concern" },
      },
      required: ["topic", "details"],
    },
  },
  {
    name: "escalate_to_staff",
    description:
      "Hand off to staff with complete intake. Use for refills, signatures, auth, billing/complaints, callbacks, or anything you cannot confidently resolve. Capture EVERYTHING so staff never re-call the patient for basics.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "refill",
            "signature",
            "clinical",
            "auth",
            "billing_complaint",
            "low_confidence",
            "callback",
          ],
        },
        patientId: { type: "string", description: "If identified" },
        intake: {
          type: "object",
          description: "Complete intake for staff",
          properties: {
            name: { type: "string" },
            dob: { type: "string" },
            phone: { type: "string" },
            reason: { type: "string", description: "Full description of the concern" },
            actionsTaken: { type: "string", description: "What you already did on this call" },
          },
          required: ["name", "phone", "reason", "actionsTaken"],
        },
        routeTopic: { type: "string", description: "Topic from classify_and_route, if known" },
      },
      required: ["reason", "intake"],
    },
  },
  {
    name: "transfer_to_staff",
    description:
      "Transfer the caller to the staff member who owns their topic. ONLY during business hours and ONLY after hearing and classifying the caller's concern. If the result says no one is available, do NOT retry: capture full intake and use escalate_to_staff.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "confirmations_rescheduling",
            "bhc_scheduling",
            "incoming_501_vms",
            "nv_sm_scheduling",
            "dme",
            "incoming_general",
            "np_intermountain_echo_doppler",
            "np_other_pcp_ss_allergy",
          ],
          description: "The caller's classified topic",
        },
        summary: { type: "string", description: "One-sentence summary of the concern" },
        specialistLabel: {
          type: "string",
          description:
            'Caller-facing role to announce, matching what they asked for: e.g. "medication refill specialist", "prior authorization specialist", "billing specialist", "next available staff member" (use that when the caller just wants a human). Omit to announce the staff owner by name.',
        },
      },
      required: ["topic"],
    },
    requestStartMessage: "Let me see who's available for that.",
  },
  {
    name: "flag_emergency",
    description:
      "EMERGENCY ONLY: caller described urgent/life-threatening symptoms. Pages a live human immediately, even off-hours. Also direct the caller to 911/ER yourself.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "What the caller reported, verbatim as possible" },
        callbackNumber: { type: "string" },
        callerName: { type: "string" },
      },
      required: ["description"],
    },
  },
];
