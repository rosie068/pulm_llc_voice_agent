import { describe, expect, it } from "vitest";
import { findSlots, makeSlotId, parseSlotId, validateBooking } from "./engine";
import { DEFAULT_RULES } from "./rules";

// 2026-07-12 is a Sunday.
const SUNDAY = new Date("2026-07-12T00:00:00Z");
const WEDNESDAY = new Date("2026-07-15T00:00:00Z");

function psgBooking(location: "NV" | "SM", iso: string) {
  return { type: "psg" as const, location, startsAt: new Date(iso) };
}

describe("findSlots", () => {
  it("offers PSG slots at NV on Sunday within the 8:30–9:30 PM window", () => {
    const slots = findSlots({
      type: "psg",
      location: "NV",
      from: SUNDAY,
      to: SUNDAY,
      rules: DEFAULT_RULES,
      booked: [],
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const h = s.startsAt.getUTCHours();
      const m = s.startsAt.getUTCMinutes();
      expect(h * 60 + m).toBeGreaterThanOrEqual(20 * 60 + 30);
      expect(h * 60 + m).toBeLessThanOrEqual(21 * 60 + 30);
    }
  });

  it("returns no PSG slots at SM on a Wednesday (Fri/Sat/Sun only)", () => {
    const slots = findSlots({
      type: "psg",
      location: "SM",
      from: WEDNESDAY,
      to: WEDNESDAY,
      rules: DEFAULT_RULES,
      booked: [],
    });
    expect(slots).toEqual([]);
  });

  it("stops offering NV Sunday PSG once 3 are booked (capacity 3)", () => {
    const booked = [
      psgBooking("NV", "2026-07-12T20:30:00Z"),
      psgBooking("NV", "2026-07-12T21:00:00Z"),
      psgBooking("NV", "2026-07-12T21:30:00Z"),
    ];
    const slots = findSlots({
      type: "psg",
      location: "NV",
      from: SUNDAY,
      to: SUNDAY,
      rules: DEFAULT_RULES,
      booked,
    });
    expect(slots).toEqual([]);
  });

  it("titration shares PSG capacity (same beds)", () => {
    const booked = [
      psgBooking("NV", "2026-07-12T20:30:00Z"),
      psgBooking("NV", "2026-07-12T21:00:00Z"),
      { type: "titration_split" as const, location: "NV" as const, startsAt: new Date("2026-07-12T21:30:00Z") },
    ];
    const slots = findSlots({
      type: "titration_split",
      location: "NV",
      from: SUNDAY,
      to: SUNDAY,
      rules: DEFAULT_RULES,
      booked,
    });
    expect(slots).toEqual([]);
  });

  it("offers new-patient referral slots on the provisional office grid", () => {
    const slots = findSlots({
      type: "new_patient",
      from: SUNDAY,
      to: new Date("2026-08-12T00:00:00Z"),
      rules: DEFAULT_RULES,
      booked: [],
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].appointmentType).toBe("new_patient");
    expect(slots[0].startsAt.getUTCDay()).toBe(1);
  });

  it("does not offer new-patient slots on weekends", () => {
    const slots = findSlots({
      type: "new_patient",
      from: SUNDAY,
      to: SUNDAY,
      rules: DEFAULT_RULES,
      booked: [],
    });
    expect(slots).toEqual([]);
  });
});

describe("validateBooking", () => {
  it("accepts the 3rd PSG on NV Sunday, rejects the 4th", () => {
    const slot = {
      type: "psg" as const,
      location: "NV" as const,
      startsAt: new Date("2026-07-12T21:00:00Z"),
    };
    const twoBooked = [
      psgBooking("NV", "2026-07-12T20:30:00Z"),
      psgBooking("NV", "2026-07-12T21:00:00Z"),
    ];
    expect(validateBooking(slot, DEFAULT_RULES, twoBooked).ok).toBe(true);

    const threeBooked = [...twoBooked, psgBooking("NV", "2026-07-12T21:30:00Z")];
    const result = validateBooking(slot, DEFAULT_RULES, threeBooked);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/capacity/i);
  });

  it("allows double-booking the same start time under capacity (Tue–Sat 6)", () => {
    // 2026-07-14 is a Tuesday: capacity 6.
    const slot = {
      type: "psg" as const,
      location: "NV" as const,
      startsAt: new Date("2026-07-14T20:30:00Z"),
    };
    const booked = [psgBooking("NV", "2026-07-14T20:30:00Z")];
    expect(validateBooking(slot, DEFAULT_RULES, booked).ok).toBe(true);
  });

  it("rejects times outside the window", () => {
    const slot = {
      type: "psg" as const,
      location: "NV" as const,
      startsAt: new Date("2026-07-12T18:00:00Z"),
    };
    const result = validateBooking(slot, DEFAULT_RULES, []);
    expect(result.ok).toBe(false);
  });

  it("HST caps at 7 per day", () => {
    // 2026-07-13 is a Monday.
    const booked = Array.from({ length: 7 }, (_, i) => {
      const hour = String(9 + Math.floor(i / 2)).padStart(2, "0");
      return {
        type: "hst" as const,
        location: "NV" as const,
        startsAt: new Date(`2026-07-13T${hour}:${i % 2 === 0 ? "00" : "30"}:00Z`),
      };
    });
    const slot = {
      type: "hst" as const,
      location: "NV" as const,
      startsAt: new Date("2026-07-13T14:00:00Z"),
    };
    const result = validateBooking(slot, DEFAULT_RULES, booked);
    expect(result.ok).toBe(false);
  });
});

describe("slot ids", () => {
  it("round-trips", () => {
    const startsAt = new Date("2026-07-12T20:30:00Z");
    const id = makeSlotId("psg", "NV", startsAt);
    const parsed = parseSlotId(id);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("psg");
    expect(parsed?.location).toBe("NV");
    expect(parsed?.startsAt.getTime()).toBe(startsAt.getTime());
  });

  it("rejects garbage", () => {
    expect(parseSlotId("nonsense")).toBeNull();
    expect(parseSlotId("a|b|not-a-date")).toBeNull();
  });
});
