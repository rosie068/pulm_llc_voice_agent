import { describe, expect, it } from "vitest";
import { attemptCapFor, canDial, nextBusinessDayRetry } from "./attempts";

describe("attempt caps (spec §4.2/§4.3)", () => {
  it("referral cap is 10, sleep cap is 7", () => {
    expect(attemptCapFor("referral")).toBe(10);
    expect(attemptCapFor("sleep_study")).toBe(7);
  });

  it("canDial boundary", () => {
    expect(canDial(9, 10)).toBe(true);
    expect(canDial(10, 10)).toBe(false);
    expect(canDial(6, 7)).toBe(true);
    expect(canDial(7, 7)).toBe(false);
  });
});

describe("nextBusinessDayRetry", () => {
  it("Friday → Monday", () => {
    // 2026-07-17 is a Friday.
    const next = nextBusinessDayRetry(new Date("2026-07-17T20:00:00Z"));
    expect(next.getUTCDay()).toBe(1); // Monday
  });
  it("Wednesday → Thursday", () => {
    const next = nextBusinessDayRetry(new Date("2026-07-15T20:00:00Z"));
    expect(next.getUTCDay()).toBe(4);
  });
});
