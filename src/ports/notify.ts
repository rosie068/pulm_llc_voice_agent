// NotifyPort — Teams later for notifyStaff. pageHuman must be REAL in every
// environment (spec §3.6: emergencies always reach a live human).

export interface StaffNotification {
  reason: string;
  routedToExt: string | null;
  summary: string;
  flagId: string | null;
}

export interface NotifyPort {
  /** Non-urgent staff notification (future: Teams tag). */
  notifyStaff(n: StaffNotification): Promise<void>;
  /** Emergency page — must reach a live human even off-hours. */
  pageHuman(message: string, callbackNumber: string | null): Promise<{ paged: boolean; via: string }>;
}
