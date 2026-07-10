// Pure slot-generation and validation engine (spec §5). No I/O: callers pass
// availability rules and already-booked appointments in.

import {
  type AppointmentType,
  type AvailabilityRule,
  type LocationCode,
  capacityGroupFor,
} from "./rules";

export interface BookedAppointment {
  type: AppointmentType;
  location: LocationCode;
  startsAt: Date;
}

export interface Slot {
  /** Deterministic id the tool layer can echo back to book: type|location|ISO */
  slotId: string;
  appointmentType: AppointmentType;
  location: LocationCode;
  startsAt: Date;
  endsAt: Date;
}

export interface FindSlotsInput {
  type: AppointmentType;
  location?: LocationCode;
  /** Inclusive search range, clinic-local dates. */
  from: Date;
  to: Date;
  rules: AvailabilityRule[];
  booked: BookedAppointment[];
  limit?: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseTime(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

export function makeSlotId(
  type: AppointmentType,
  location: LocationCode,
  startsAt: Date,
): string {
  return `${type}|${location}|${startsAt.toISOString()}`;
}

export function parseSlotId(slotId: string): {
  type: AppointmentType;
  location: LocationCode;
  startsAt: Date;
} | null {
  const parts = slotId.split("|");
  if (parts.length !== 3) return null;
  const startsAt = new Date(parts[2]);
  if (Number.isNaN(startsAt.getTime())) return null;
  return {
    type: parts[0] as AppointmentType,
    location: parts[1] as LocationCode,
    startsAt,
  };
}

/** Bookings that consume the same daily capacity pool as `type`. */
function bookedInGroupOnDay(
  booked: BookedAppointment[],
  type: AppointmentType,
  location: LocationCode,
  day: string,
): number {
  const group = capacityGroupFor(type);
  return booked.filter(
    (b) =>
      group.includes(b.type) &&
      b.location === location &&
      dayKey(b.startsAt) === day,
  ).length;
}

export function findSlots(input: FindSlotsInput): Slot[] {
  const { type, location, from, to, rules, booked, limit = 3 } = input;
  const active = rules.filter(
    (r) =>
      r.active &&
      r.appointmentType === type &&
      (location ? r.location === location : true),
  );
  if (active.length === 0) return [];

  const slots: Slot[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );

  while (cursor <= end && slots.length < limit) {
    const dow = cursor.getUTCDay();
    const day = dayKey(cursor);

    for (const rule of active) {
      if (rule.dayOfWeek !== dow) continue;

      const used = bookedInGroupOnDay(booked, type, rule.location, day);
      let remaining = rule.capacityPerDay - used;
      if (remaining <= 0) continue;

      const start = parseTime(rule.windowStart);
      const endT = parseTime(rule.windowEnd);
      const windowStart = new Date(cursor);
      windowStart.setUTCHours(start.h, start.m, 0, 0);
      const windowEnd = new Date(cursor);
      windowEnd.setUTCHours(endT.h, endT.m, 0, 0);

      // Same start time may be offered/booked more than once ("double-book"
      // per spec §5) — daily capacity is the real constraint, enforced above
      // and again at booking time.
      for (
        let t = windowStart.getTime();
        t <= windowEnd.getTime();
        t += rule.slotMinutes * 60_000
      ) {
        if (remaining <= 0 || slots.length >= limit) break;
        const startsAt = new Date(t);
        if (startsAt < from) continue;
        const endsAt = new Date(t + rule.slotMinutes * 60_000);
        slots.push({
          slotId: makeSlotId(type, rule.location, startsAt),
          appointmentType: type,
          location: rule.location,
          startsAt,
          endsAt,
        });
        remaining -= 1;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

export type BookingValidation =
  | { ok: true }
  | { ok: false; violation: string };

export function validateBooking(
  slot: { type: AppointmentType; location: LocationCode; startsAt: Date },
  rules: AvailabilityRule[],
  booked: BookedAppointment[],
): BookingValidation {
  const dow = slot.startsAt.getUTCDay();
  const rule = rules.find(
    (r) =>
      r.active &&
      r.appointmentType === slot.type &&
      r.location === slot.location &&
      r.dayOfWeek === dow,
  );
  if (!rule) {
    return {
      ok: false,
      violation: `No availability rule for ${slot.type} at ${slot.location} on that day`,
    };
  }

  const start = parseTime(rule.windowStart);
  const end = parseTime(rule.windowEnd);
  const mins = slot.startsAt.getUTCHours() * 60 + slot.startsAt.getUTCMinutes();
  if (mins < start.h * 60 + start.m || mins > end.h * 60 + end.m) {
    return { ok: false, violation: "Requested time is outside the booking window" };
  }

  const day = dayKey(slot.startsAt);
  const used = bookedInGroupOnDay(booked, slot.type, slot.location, day);
  if (used >= rule.capacityPerDay) {
    return { ok: false, violation: "Daily capacity reached for that date" };
  }

  return { ok: true };
}
