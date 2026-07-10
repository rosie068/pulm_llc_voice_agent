// EligibilityPort — eligibility partner later. Stub answers honestly from our
// patient record; "unknown" means the agent flags instead of guessing.

export interface EligibilityResult {
  active: boolean;
  isHmo: boolean | null;
  isMedicare: boolean | null;
  referralRequired: boolean | null;
  referralOnFile: boolean | null;
  verified: boolean; // false = source couldn't verify; agent must not guess
}

export interface CopayQuote {
  available: boolean;
  copayCents?: number;
  unmetDeductibleCents?: number;
  message: string;
}

export interface EligibilityPort {
  checkInsurance(patientId: string): Promise<EligibilityResult>;
  quoteCopay(patientId: string): Promise<CopayQuote>;
}
