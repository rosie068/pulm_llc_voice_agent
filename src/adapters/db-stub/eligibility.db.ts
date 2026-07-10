import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CopayQuote, EligibilityPort, EligibilityResult } from "@/ports/eligibility";

export class DbStubEligibilityAdapter implements EligibilityPort {
  async checkInsurance(patientId: string): Promise<EligibilityResult> {
    const [p] = await db()
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.id, patientId))
      .limit(1);
    if (!p) {
      return {
        active: false,
        isHmo: null,
        isMedicare: null,
        referralRequired: null,
        referralOnFile: null,
        verified: false,
      };
    }
    const known = p.insuranceStatus !== "unknown" && p.isHmo !== null;
    if (known) {
      return {
        active: p.insuranceStatus === "active",
        isHmo: p.isHmo,
        isMedicare: p.isMedicare,
        // Stub heuristic: if a referral flag exists on the record, the plan
        // requires one. The eligibility partner will answer this properly.
        referralRequired: p.referralOnFile !== null ? true : null,
        referralOnFile: p.referralOnFile,
        verified: known,
      };
    }

    // Record has no verified status yet (typically a brand-new patient). Real
    // verification is the eligibility partner's job; until that integration,
    // this stub simulates it from the payer the caller stated so the demo
    // booking flow can complete end-to-end. Payer names containing "HMO" /
    // "Medicare" still exercise those policy paths.
    if (p.insurancePayer) {
      const payer = p.insurancePayer.toLowerCase();
      return {
        active: true,
        isHmo: payer.includes("hmo"),
        isMedicare: payer.includes("medicare"),
        referralRequired: null,
        referralOnFile: p.referralOnFile,
        verified: true,
      };
    }

    return {
      active: false,
      isHmo: null,
      isMedicare: null,
      referralRequired: null,
      referralOnFile: p.referralOnFile,
      verified: false,
    };
  }

  async quoteCopay(): Promise<CopayQuote> {
    // Real quotes arrive with the eligibility-partner integration. The agent
    // must not guess dollar amounts.
    return {
      available: false,
      message:
        "Copay information needs staff verification. Capture the request and escalate.",
    };
  }
}
