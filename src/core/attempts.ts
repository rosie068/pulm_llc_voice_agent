// Attempt-cap logic (spec §4.2/§4.3/§4.4): 10 for referrals, 7 for studies.
// Counts continue — they never reset (spec §4.2).

export type Workstream =
  | "referral"
  | "sleep_study"
  | "echo_doppler"
  | "allergy"
  | "confirmation"
  | "missed_appt"
  | "follow_up";

export const ATTEMPT_CAPS: Record<Workstream, number> = {
  referral: 10, // SOP §4.6 (Dr. Sayal said "minimum 7" — using 10 pending confirmation, spec §7.2)
  sleep_study: 7,
  echo_doppler: 7,
  allergy: 7,
  confirmation: 3,
  missed_appt: 7,
  follow_up: 7,
};

export const ACTIVE_OUTBOUND_WORKSTREAMS = ["referral", "sleep_study"] as const;
export type ActiveOutboundWorkstream = (typeof ACTIVE_OUTBOUND_WORKSTREAMS)[number];

export function isActiveOutboundWorkstream(value: string): value is ActiveOutboundWorkstream {
  return (ACTIVE_OUTBOUND_WORKSTREAMS as readonly string[]).includes(value);
}

export function attemptCapFor(workstream: Workstream): number {
  return ATTEMPT_CAPS[workstream];
}

export function canDial(attemptCount: number, attemptCap: number): boolean {
  return attemptCount < attemptCap;
}

/** Next business-day retry time (skips Sat/Sun), 10:00 clinic-local ≈ 17:00 UTC. */
export function nextBusinessDayRetry(now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  while ([0, 6].includes(next.getUTCDay())) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(17, 0, 0, 0);
  return next;
}
