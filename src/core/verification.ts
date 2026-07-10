// Booking checklist state machine (spec §3.4). Enforced in code: the
// book_appointment handler derives this state from the current call's
// tool_executions and refuses to book until every required step passed.

import { type AppointmentType, requiresAuth } from "./scheduling/rules";

export interface ToolExecutionRecord {
  toolName: string;
  result: unknown;
  status: "ok" | "error";
}

export interface ChecklistState {
  identityVerified: boolean;
  insuranceActive: boolean;
  notHmo: boolean;
  referralOk: boolean;
  authOk: boolean;
  missingDemographics: string[];
}

export type BookingGate =
  | { allowed: true }
  | { allowed: false; reason: string; missingSteps: string[] };

function resultOf(
  executions: ToolExecutionRecord[],
  ...toolNames: string[]
): Record<string, unknown> | null {
  // Latest successful execution wins (patient may correct info mid-call).
  for (let i = executions.length - 1; i >= 0; i--) {
    const e = executions[i];
    if (toolNames.includes(e.toolName) && e.status === "ok") {
      return (e.result ?? null) as Record<string, unknown> | null;
    }
  }
  return null;
}

export function deriveChecklist(
  executions: ToolExecutionRecord[],
): ChecklistState {
  const identity = resultOf(executions, "identify_patient");
  const insurance = resultOf(executions, "check_insurance");
  const auth = resultOf(executions, "verify_study_auth");
  // Demographics gaps can be filled mid-call (spec §3.2 "collect missing
  // demographics") — the latest of identify_patient / update_demographics wins.
  const demographics = resultOf(executions, "identify_patient", "update_demographics");

  const missingDemographics = Array.isArray(demographics?.missingDemographics)
    ? (demographics.missingDemographics as string[])
    : [];

  return {
    identityVerified: identity?.patientId != null,
    insuranceActive: insurance?.active === true,
    notHmo: insurance != null && insurance.isHmo === false,
    referralOk:
      insurance != null &&
      (insurance.referralRequired !== true || insurance.referralOnFile === true),
    authOk: auth?.authorized === true,
    missingDemographics,
  };
}

export function canBook(
  type: AppointmentType,
  executions: ToolExecutionRecord[],
): BookingGate {
  const state = deriveChecklist(executions);
  const missing: string[] = [];

  if (!state.identityVerified) missing.push("identify_patient");
  if (!state.insuranceActive) missing.push("check_insurance (insurance not verified active)");
  if (!state.notHmo) missing.push("check_insurance (HMO requires PCP/insurer referral first)");
  if (!state.referralOk) missing.push("referral on file");
  if (requiresAuth(type) && !state.authOk) {
    missing.push("verify_study_auth (active auth required for studies)");
  }
  if (state.missingDemographics.length > 0) {
    missing.push(`missing demographics: ${state.missingDemographics.join(", ")}`);
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      reason:
        "Booking blocked: verification checklist incomplete (spec §3.4). Do not book; explain what is still needed.",
      missingSteps: missing,
    };
  }
  return { allowed: true };
}
