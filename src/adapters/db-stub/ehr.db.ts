import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EHRPort, EhrNote, StudyAuthResult } from "@/ports/ehr";

export class DbStubEhrAdapter implements EHRPort {
  async pushNote(note: EhrNote): Promise<{ synced: boolean }> {
    await db().insert(schema.notes).values({
      patientId: note.patientId,
      vapiCallId: note.vapiCallId,
      body: note.body,
      agentTag: note.agentTag,
    });
    // Stub never syncs to a real EHR; TebraAdapter will set syncedToEhrAt.
    return { synced: false };
  }

  async checkStudyAuth(patientId: string): Promise<StudyAuthResult> {
    const [patient] = await db()
      .select()
      .from(schema.patients)
      .where(eq(schema.patients.id, patientId))
      .limit(1);
    if (!patient) return { authorized: false, source: "unknown", detail: "patient not found" };
    if (patient.isMedicare === true) {
      return { authorized: true, source: "medicare_exempt" };
    }
    if (patient.studyAuthActive === true) {
      return { authorized: true, source: "on_file" };
    }
    return {
      authorized: false,
      source: "unknown",
      detail:
        "No active authorization on file. Staff must confirm auth before this study can be scheduled.",
    };
  }
}
