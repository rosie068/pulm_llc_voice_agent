// pnpm queue:import <csv> — seed active outbound_queue rows until the
// SheetsAdapter exists. Active workstreams today: referral and sleep_study.
// CSV columns: workstream,firstName,lastName,dob,phone,studySubtype,authVerified
// Example row: sleep_study,Jane,Doe,1960-01-15,+17025551234,psg,true

import "dotenv/config";
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { attemptCapFor, isActiveOutboundWorkstream } from "../src/core/attempts";

const STUDY_SUBTYPES = ["hst", "psg", "titration_split"] as const;

function isStudySubtype(value: string): value is (typeof STUDY_SUBTYPES)[number] {
  return (STUDY_SUBTYPES as readonly string[]).includes(value);
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: pnpm queue:import <csv>");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("workstream,")); // header

  for (const line of lines) {
    const [workstream, firstName, lastName, dob, phone, studySubtype, authVerified] =
      line.split(",").map((s) => s.trim());
    if (!isActiveOutboundWorkstream(workstream)) {
      throw new Error(`Unsupported active outbound workstream "${workstream}". Use referral or sleep_study.`);
    }
    if (workstream === "sleep_study" && !isStudySubtype(studySubtype)) {
      throw new Error(`sleep_study row for ${firstName} ${lastName} must include hst, psg, or titration_split`);
    }
    const queuedStudySubtype: (typeof STUDY_SUBTYPES)[number] | null =
      workstream === "sleep_study" ? (studySubtype as (typeof STUDY_SUBTYPES)[number]) : null;

    const existing = await db
      .select()
      .from(schema.patients)
      .where(and(eq(schema.patients.firstName, firstName), eq(schema.patients.lastName, lastName)));
    const patient =
      existing[0] ??
      (
        await db
          .insert(schema.patients)
          .values({ firstName, lastName, dob: dob || null, phone: phone || null })
          .returning()
      )[0];

    await db.insert(schema.outboundQueue).values({
      workstream,
      patientId: patient.id,
      studySubtype: queuedStudySubtype,
      authVerified: authVerified === "true",
      attemptCap: attemptCapFor(workstream),
      sourceRef: `csv:${file}`,
    });
    console.log(`✓ queued ${workstream}: ${firstName} ${lastName}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
