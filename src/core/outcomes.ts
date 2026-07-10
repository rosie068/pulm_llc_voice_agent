// Call outcome classification (spec §3.5 inbound, §4.2 outbound).

export const INBOUND_OUTCOMES = [
  "resolved_scheduled",
  "denied_closed",
  "vm_left",
  "spoke_no_appt",
] as const;
export type InboundOutcome = (typeof INBOUND_OUTCOMES)[number];

export const OUTBOUND_OUTCOMES = [
  "scheduled",
  "callback_requested",
  "declined",
  "dnd",
  "other_pulm",
  "deceased",
  "not_interested",
  "unreachable",
  "out_of_service",
  "no_answer",
  "vm_left",
] as const;
export type OutboundOutcome = (typeof OUTBOUND_OUTCOMES)[number];

export type QueueTransition =
  | { status: "scheduled" }
  | {
      status: "closed";
      closedReason: "declined" | "dnd" | "other_pulm" | "deceased" | "not_interested";
    }
  | { status: "unreachable"; flagForAlternatePcp: true }
  | { status: "ready"; retryNextBusinessDay: true }
  | { status: "cap_reached" };

/** Map an outbound call outcome to the queue-row transition (spec §4.2/§4.4). */
export function queueTransitionFor(
  outcome: OutboundOutcome,
  attemptCount: number,
  attemptCap: number,
): QueueTransition {
  switch (outcome) {
    case "scheduled":
      return { status: "scheduled" };
    case "callback_requested":
      // Patient reached; staff owns the follow-up (flag carries preferences).
      // Row stays open with a next-business-day recheck so it can't silently
      // fall through if the staff callback never happens.
      if (attemptCount >= attemptCap) return { status: "cap_reached" };
      return { status: "ready", retryNextBusinessDay: true };
    case "declined":
    case "dnd":
    case "other_pulm":
    case "deceased":
    case "not_interested":
      return { status: "closed", closedReason: outcome };
    case "unreachable":
    case "out_of_service":
      return { status: "unreachable", flagForAlternatePcp: true };
    case "no_answer":
    case "vm_left":
      if (attemptCount >= attemptCap) return { status: "cap_reached" };
      return { status: "ready", retryNextBusinessDay: true };
  }
}
