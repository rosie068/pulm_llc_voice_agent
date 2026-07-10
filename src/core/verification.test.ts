import { describe, expect, it } from "vitest";
import { canBook, type ToolExecutionRecord } from "./verification";

function exec(toolName: string, result: Record<string, unknown>): ToolExecutionRecord {
  return { toolName, result, status: "ok" };
}

const identityOk = exec("identify_patient", { patientId: "p1", missingDemographics: [] });
const insuranceOk = exec("check_insurance", {
  active: true,
  isHmo: false,
  referralRequired: false,
  verified: true,
});
const authOk = exec("verify_study_auth", { authorized: true });

describe("canBook (spec §3.4 checklist enforcement)", () => {
  it("refuses with nothing verified", () => {
    const gate = canBook("follow_up", []);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.missingSteps.length).toBeGreaterThan(0);
  });

  it("allows office visit with identity + insurance verified", () => {
    expect(canBook("follow_up", [identityOk, insuranceOk]).allowed).toBe(true);
  });

  it("blocks HMO plans", () => {
    const hmo = exec("check_insurance", { active: true, isHmo: true, verified: true });
    const gate = canBook("follow_up", [identityOk, hmo]);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.missingSteps.join(" ")).toMatch(/HMO/);
  });

  it("blocks studies without auth, allows with auth", () => {
    expect(canBook("psg", [identityOk, insuranceOk]).allowed).toBe(false);
    expect(canBook("psg", [identityOk, insuranceOk, authOk]).allowed).toBe(true);
  });

  it("blocks when demographics are missing (spec §3.4.5)", () => {
    const identityMissing = exec("identify_patient", {
      patientId: "p1",
      missingDemographics: ["email", "insurance"],
    });
    const gate = canBook("follow_up", [identityMissing, insuranceOk]);
    expect(gate.allowed).toBe(false);
  });

  it("unblocks after update_demographics fills the gaps (spec §3.2 collect missing demographics)", () => {
    const identityMissing = exec("identify_patient", {
      patientId: "p1",
      missingDemographics: ["email", "address"],
    });
    const demographicsFilled = exec("update_demographics", {
      updated: true,
      missingDemographics: [],
    });
    expect(canBook("follow_up", [identityMissing, insuranceOk]).allowed).toBe(false);
    expect(
      canBook("follow_up", [identityMissing, insuranceOk, demographicsFilled]).allowed,
    ).toBe(true);
  });

  it("stays blocked while update_demographics still reports gaps", () => {
    const identityMissing = exec("identify_patient", {
      patientId: "p1",
      missingDemographics: ["email", "address", "insurance"],
    });
    const partial = exec("update_demographics", {
      updated: true,
      missingDemographics: ["insurance"],
    });
    const gate = canBook("follow_up", [identityMissing, insuranceOk, partial]);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.missingSteps.join(" ")).toMatch(/insurance/);
  });

  it("re-running identify_patient after update_demographics wins (latest execution)", () => {
    const filled = exec("update_demographics", { updated: true, missingDemographics: [] });
    const identityStillMissing = exec("identify_patient", {
      patientId: "p1",
      missingDemographics: ["email"],
    });
    expect(
      canBook("follow_up", [insuranceOk, filled, identityStillMissing]).allowed,
    ).toBe(false);
  });

  it("blocks when referral required but not on file", () => {
    const needsReferral = exec("check_insurance", {
      active: true,
      isHmo: false,
      referralRequired: true,
      referralOnFile: false,
      verified: true,
    });
    expect(canBook("follow_up", [identityOk, needsReferral]).allowed).toBe(false);
  });

  it("latest successful execution wins (patient corrected info)", () => {
    const badInsurance = exec("check_insurance", { active: false, isHmo: false, verified: true });
    const gate = canBook("follow_up", [identityOk, badInsurance, insuranceOk]);
    expect(gate.allowed).toBe(true);
  });
});
