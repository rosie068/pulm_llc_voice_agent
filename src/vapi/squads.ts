// Squad configuration kept separate from the sync side effects so its
// conversation-history behavior can be unit tested.

const CONTINUE_FROM_CALL_HISTORY = {
  firstMessage: "",
  firstMessageMode: "assistant-speaks-first-with-model-generated-message",
} as const;

export function buildInboundSquadPayload(frontDeskId: string, schedulerId: string) {
  return {
    name: "pulm-inbound-squad",
    members: [
      {
        assistantId: frontDeskId,
        assistantDestinations: [
          {
            type: "assistant",
            assistantName: "pulm-scheduler",
            assistantOverrides: CONTINUE_FROM_CALL_HISTORY,
            contextEngineeringPlan: { type: "all" },
            // NOTE: Vapi rejects a `message` property on assistantDestinations
            // (400). The bridge line is spoken by the model instead — the
            // prompts pin its exact wording.
            description:
              "Use IMMEDIATELY, without asking the caller for permission or confirmation, the moment the caller mentions booking, scheduling, rescheduling, canceling, or confirming an appointment. Do not wait for the caller to agree to a handoff.",
          },
        ],
      },
      {
        assistantId: schedulerId,
        assistantDestinations: [
          {
            type: "assistant",
            assistantName: "pulm-front-desk",
            assistantOverrides: CONTINUE_FROM_CALL_HISTORY,
            contextEngineeringPlan: { type: "all" },
            description:
              "Use IMMEDIATELY, without asking the caller for permission, when the caller needs something other than scheduling: billing, refills, general questions, or complaints.",
          },
        ],
      },
    ],
  } as const;
}
