import { describe, expect, it } from "vitest";
import { queueTransitionFor } from "./outcomes";

describe("queueTransitionFor (spec §4.2/§4.4)", () => {
  it("scheduled → scheduled", () => {
    expect(queueTransitionFor("scheduled", 1, 10)).toEqual({ status: "scheduled" });
  });

  it("declined family → closed with reason", () => {
    expect(queueTransitionFor("deceased", 2, 10)).toEqual({
      status: "closed",
      closedReason: "deceased",
    });
    expect(queueTransitionFor("dnd", 2, 10)).toEqual({ status: "closed", closedReason: "dnd" });
  });

  it("unreachable → unreachable + alternate-PCP flag", () => {
    const t = queueTransitionFor("out_of_service", 3, 10);
    expect(t.status).toBe("unreachable");
    expect("flagForAlternatePcp" in t && t.flagForAlternatePcp).toBe(true);
  });

  it("no_answer under cap → retry next business day", () => {
    const t = queueTransitionFor("no_answer", 5, 10);
    expect(t.status).toBe("ready");
  });

  it("vm_left at cap → cap_reached (10 referrals)", () => {
    expect(queueTransitionFor("vm_left", 10, 10)).toEqual({ status: "cap_reached" });
  });

  it("vm_left at cap → cap_reached (7 studies)", () => {
    expect(queueTransitionFor("no_answer", 7, 7)).toEqual({ status: "cap_reached" });
  });
});
