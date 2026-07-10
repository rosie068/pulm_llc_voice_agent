// The ONLY place adapters are chosen. Business logic imports getPorts(), never
// an adapter class. Adding Tebra/Sheets/Teams later = new adapter + env flag.

import { DbStubEhrAdapter } from "@/adapters/db-stub/ehr.db";
import { DbStubEligibilityAdapter } from "@/adapters/db-stub/eligibility.db";
import { DbStubLogSheetAdapter } from "@/adapters/db-stub/logsheet.db";
import { DbStubNotifyAdapter } from "@/adapters/db-stub/notify.db";
import { getEnv } from "@/lib/env";
import type { EHRPort } from "./ehr";
import type { EligibilityPort } from "./eligibility";
import type { LogSheetPort } from "./logsheet";
import type { NotifyPort } from "./notify";

export interface Ports {
  ehr: EHRPort;
  logsheet: LogSheetPort;
  notify: NotifyPort;
  eligibility: EligibilityPort;
}

let cached: Ports | null = null;

export function getPorts(): Ports {
  if (cached) return cached;
  const env = getEnv();

  const ehr: EHRPort = env.EHR_ADAPTER === "stub" ? new DbStubEhrAdapter() : new DbStubEhrAdapter(); // TebraAdapter slots in here
  const notify: NotifyPort =
    env.NOTIFY_ADAPTER === "stub" ? new DbStubNotifyAdapter() : new DbStubNotifyAdapter(); // TeamsAdapter slots in here
  const eligibility: EligibilityPort =
    env.ELIGIBILITY_ADAPTER === "stub"
      ? new DbStubEligibilityAdapter()
      : new DbStubEligibilityAdapter(); // partner adapter slots in here

  cached = {
    ehr,
    logsheet: new DbStubLogSheetAdapter(),
    notify,
    eligibility,
  };
  return cached;
}
