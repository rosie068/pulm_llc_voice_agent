// LogSheetPort — Google Sheets later. Sheet-color semantics live in
// outbound_queue.status; the future adapter imports/exports rows.

export interface QueueImportRow {
  workstream: "referral" | "sleep_study";
  patientName: string;
  phone: string;
  studySubtype?: "hst" | "psg" | "titration_split";
  authVerified: boolean;
  sourceRef?: string;
}

export interface LogSheetPort {
  /** Pull ready-to-call rows (future: yellow/orange sheet rows). */
  importReadyRows(): Promise<QueueImportRow[]>;
  /** Write back a status change (future: recolor sheet row by EOD). */
  writeBackStatus(sourceRef: string, status: string): Promise<void>;
}
