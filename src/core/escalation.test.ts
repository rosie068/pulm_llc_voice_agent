import { describe, expect, it } from "vitest";
import { clinicContext, decideHandoff, isBusinessHours, isHardStop } from "./escalation";

// 18:00 UTC on a Wednesday = 11:00 AM in Las Vegas (PDT, UTC-7) — business hours.
const WED_BUSINESS = new Date("2026-07-15T18:00:00Z");
// 06:00 UTC Wednesday = 11:00 PM Tuesday in Las Vegas — off-hours.
const WED_NIGHT = new Date("2026-07-15T06:00:00Z");
// Saturday noon Vegas time.
const SATURDAY = new Date("2026-07-18T19:00:00Z");

const STAFF = [
  { ext: "419", ownerName: "Ryan", phoneNumber: "+17025550119", available: true },
  { ext: "430", ownerName: "Anita", phoneNumber: null, available: true },
  { ext: "431", ownerName: "Bharani", phoneNumber: "+17025550131", available: false },
];

describe("isBusinessHours", () => {
  it("weekday daytime Vegas → true", () => {
    expect(isBusinessHours(WED_BUSINESS)).toBe(true);
  });
  it("weekday night → false", () => {
    expect(isBusinessHours(WED_NIGHT)).toBe(false);
  });
  it("Saturday → false", () => {
    expect(isBusinessHours(SATURDAY)).toBe(false);
  });
});

describe("decideHandoff (spec §3.3)", () => {
  it("in-hours + reachable owner → transfer", () => {
    const d = decideHandoff("419", WED_BUSINESS, STAFF);
    expect(d.action).toBe("transfer");
    if (d.action === "transfer") expect(d.ownerName).toBe("Ryan");
  });

  it("off-hours → flag with honest promise, no fixed SLA", () => {
    const d = decideHandoff("419", WED_NIGHT, STAFF);
    expect(d.action).toBe("flag");
    if (d.action === "flag") {
      expect(d.promise).not.toMatch(/24\s*(hours|hrs)/i);
    }
  });

  it("owner without a phone number → flag", () => {
    expect(decideHandoff("430", WED_BUSINESS, STAFF).action).toBe("flag");
  });

  it("owner marked unavailable → flag", () => {
    expect(decideHandoff("431", WED_BUSINESS, STAFF).action).toBe("flag");
  });

  it("unknown extension → flag", () => {
    expect(decideHandoff("999", WED_BUSINESS, STAFF).action).toBe("flag");
  });
});

describe("clinicContext (flag triage stamp)", () => {
  it("business hours → offHours false, clinic-local time rendered", () => {
    const ctx = clinicContext(WED_BUSINESS);
    expect(ctx.offHours).toBe(false);
    // 18:00 UTC Wed = 11:00 AM Vegas (PDT)
    expect(ctx.clinicLocalTime).toMatch(/Wed/);
    expect(ctx.clinicLocalTime).toMatch(/11:00\sAM/);
  });

  it("weekday night → offHours true", () => {
    expect(clinicContext(WED_NIGHT).offHours).toBe(true);
  });

  it("weekend → offHours true", () => {
    expect(clinicContext(SATURDAY).offHours).toBe(true);
  });
});

describe("isHardStop (spec §3.6)", () => {
  it("clinical/signature/auth/emergency are hard stops", () => {
    expect(isHardStop("clinical")).toBe(true);
    expect(isHardStop("signature")).toBe(true);
    expect(isHardStop("auth")).toBe(true);
    expect(isHardStop("emergency_followup")).toBe(true);
  });
  it("refill/billing are routable, not hard stops", () => {
    expect(isHardStop("refill")).toBe(false);
    expect(isHardStop("billing_complaint")).toBe(false);
  });
});
