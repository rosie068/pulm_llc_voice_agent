// EHRPort — Tebra later. Today the DB stub reads/writes our own Postgres,
// which stays the system of record either way.

export interface EhrNote {
  patientId: string;
  vapiCallId: string | null;
  body: string;
  agentTag: string;
}

export interface StudyAuthResult {
  authorized: boolean;
  source: "medicare_exempt" | "on_file" | "unknown";
  detail?: string;
}

export interface EHRPort {
  /** Push a memo-to-record note (spec §3.1/§4.6). Stub: writes `notes` only. */
  pushNote(note: EhrNote): Promise<{ synced: boolean }>;
  /** Check active study auth (spec §3.4.4). Medicare = exempt. */
  checkStudyAuth(patientId: string, studyType: string): Promise<StudyAuthResult>;
}
