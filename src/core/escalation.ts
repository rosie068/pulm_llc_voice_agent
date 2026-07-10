// Availability-aware handoff decision (spec §3.3) and hard stops (§3.6).

export type HandoffReason =
  | "refill"
  | "signature"
  | "clinical"
  | "auth"
  | "billing_complaint"
  | "low_confidence"
  | "callback"
  | "emergency_followup";

export interface StaffAvailabilityEntry {
  ext: string;
  ownerName: string;
  phoneNumber: string | null;
  available: boolean;
}

export type HandoffDecision =
  | {
      action: "transfer";
      ext: string;
      ownerName: string;
      phoneNumber: string;
    }
  | {
      action: "flag";
      /** Honest next-step statement — never a fixed SLA the agent can't keep. */
      promise: string;
    };

export interface BusinessHours {
  /** 0 = Sunday … 6 = Saturday */
  days: number[];
  /** Clinic-local hours, 24h */
  openHour: number;
  closeHour: number;
  /** IANA timezone for the clinic (Las Vegas). */
  timeZone: string;
}

export const CLINIC_HOURS: BusinessHours = {
  days: [1, 2, 3, 4, 5],
  openHour: 8,
  closeHour: 17,
  timeZone: "America/Los_Angeles",
};

export function isBusinessHours(now: Date, hours: BusinessHours = CLINIC_HOURS): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timeZone,
    hour12: false,
    weekday: "short",
    hour: "numeric",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return hours.days.includes(dayIndex) && hour >= hours.openHour && hour < hours.closeHour;
}

/**
 * Triage context stamped into every flag (spec §3.3): whether the clinic was
 * closed at the time, and the clinic-local timestamp — so staff can sort
 * overnight items without converting timezones.
 */
export function clinicContext(
  now: Date,
  hours: BusinessHours = CLINIC_HOURS,
): { offHours: boolean; clinicLocalTime: string } {
  const clinicLocalTime = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  return { offHours: !isBusinessHours(now, hours), clinicLocalTime };
}

const FLAG_PROMISE =
  "I've noted everything down, and I'm getting this to the right person as soon as possible — they'll reach out to you just as soon as they can. You won't have to repeat any of it.";

export function decideHandoff(
  targetExt: string,
  now: Date,
  staff: StaffAvailabilityEntry[],
  hours: BusinessHours = CLINIC_HOURS,
): HandoffDecision {
  if (!isBusinessHours(now, hours)) {
    return { action: "flag", promise: FLAG_PROMISE };
  }
  const owner = staff.find((s) => s.ext === targetExt);
  if (!owner || !owner.available || !owner.phoneNumber) {
    return { action: "flag", promise: FLAG_PROMISE };
  }
  return {
    action: "transfer",
    ext: owner.ext,
    ownerName: owner.ownerName,
    phoneNumber: owner.phoneNumber,
  };
}

/**
 * Hard stops (spec §3.6) — topics the agent must never self-serve, regardless
 * of hour. Emergencies additionally page a live human (NotifyPort.pageHuman).
 */
export function isHardStop(reason: HandoffReason): boolean {
  return ["clinical", "signature", "auth", "emergency_followup"].includes(reason);
}
