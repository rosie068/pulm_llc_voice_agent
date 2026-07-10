import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { CopyNoteButton } from "./copy-note-button";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth.protect();
  const { id } = await params;

  const [call] = await db().select().from(schema.calls).where(eq(schema.calls.id, id)).limit(1);
  if (!call) notFound();

  const [patient] = call.patientId
    ? await db().select().from(schema.patients).where(eq(schema.patients.id, call.patientId)).limit(1)
    : [null];

  const [tools, callFlags, callNotes, bookedAppts] = await Promise.all([
    db()
      .select()
      .from(schema.toolExecutions)
      .where(eq(schema.toolExecutions.vapiCallId, call.vapiCallId))
      .orderBy(asc(schema.toolExecutions.createdAt)),
    db().select().from(schema.flags).where(eq(schema.flags.vapiCallId, call.vapiCallId)),
    db().select().from(schema.notes).where(eq(schema.notes.vapiCallId, call.vapiCallId)),
    db()
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.bookedByVapiCallId, call.vapiCallId)),
  ]);

  await audit({ actor: userId, action: "call.view", entity: "call", entityId: call.id });

  // Memo-to-record block (spec §4.6: date, time, agent tag).
  const when = call.startedAt ?? call.createdAt;
  const memoNote = [
    `[${when.toISOString().slice(0, 10)} ${when.toISOString().slice(11, 16)} UTC — voice-agent]`,
    patient ? `Patient: ${patient.firstName} ${patient.lastName}${patient.dob ? ` (DOB ${patient.dob})` : ""}` : `Caller: ${call.callerNumber ?? "unknown"}`,
    call.summary ?? "(no summary)",
    ...callNotes.map((n) => `- ${n.body}`),
  ].join("\n");

  async function markSynced() {
    "use server";
    const { userId } = await auth.protect();
    await db()
      .update(schema.notes)
      .set({ syncedToEhrAt: new Date() })
      .where(eq(schema.notes.vapiCallId, call.vapiCallId));
    await audit({ actor: userId, action: "notes.mark_synced", entity: "call", entityId: call.id });
  }

  const unsynced = callNotes.filter((n) => !n.syncedToEhrAt).length;

  return (
    <div className="max-w-4xl">
      <Link href="/dashboard/calls" className="text-sm text-brand underline">
        ← calls
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold text-brand">
        {call.direction} call · {when.toISOString().slice(0, 16).replace("T", " ")}
      </h1>
      <p className="mb-6 text-sm text-ink/60">
        {call.callerNumber ?? "unknown number"} · {call.outcome ?? "no outcome"} ·{" "}
        {call.durationSeconds != null ? `${call.durationSeconds}s` : "—"} ·{" "}
        {call.endedReason ?? ""} · vapi id {call.vapiCallId}
      </p>

      <Section title="Memo note (copy into Tebra)">
        <pre className="mb-2 overflow-x-auto rounded bg-mint p-3 text-xs">{memoNote}</pre>
        <div className="flex items-center gap-3">
          <CopyNoteButton text={memoNote} onCopied={markSynced} />
          <span className="text-xs text-ink/60">
            {callNotes.length === 0
              ? "no note rows"
              : unsynced === 0
                ? "all notes marked synced to EHR"
                : `${unsynced} note(s) not yet copied to EHR`}
          </span>
        </div>
      </Section>

      {call.summary && (
        <Section title="Summary">
          <p className="text-sm">{call.summary}</p>
        </Section>
      )}

      {call.recordingUrl && (
        <Section title="Recording">
          <audio controls src={call.recordingUrl} className="w-full" />
        </Section>
      )}

      <Section title="Structured data">
        <pre className="overflow-x-auto rounded bg-mint p-3 text-xs">
          {JSON.stringify(call.structuredData ?? {}, null, 2)}
        </pre>
      </Section>

      <Section title={`Tool timeline (${tools.length})`}>
        <div className="flex flex-col gap-2">
          {tools.map((t) => (
            <details key={t.id} className="rounded-md border border-line bg-white p-2 text-sm shadow-sm">
              <summary className="cursor-pointer">
                <span className={t.status === "error" ? "text-red-600" : ""}>{t.toolName}</span>
                <span className="ml-2 text-xs text-ink/60">
                  {t.createdAt.toISOString().slice(11, 19)} · {t.latencyMs ?? "?"}ms · {t.status}
                </span>
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-mint p-2 text-xs">
                {JSON.stringify({ arguments: t.arguments, result: t.result }, null, 2)}
              </pre>
            </details>
          ))}
          {tools.length === 0 && <p className="text-sm text-ink/60">No tool calls.</p>}
        </div>
      </Section>

      {(bookedAppts.length > 0 || callFlags.length > 0) && (
        <Section title="Linked records">
          <ul className="list-disc pl-5 text-sm">
            {bookedAppts.map((a) => (
              <li key={a.id}>
                Appointment: {a.type} at {a.location},{" "}
                {a.startsAt.toISOString().slice(0, 16).replace("T", " ")} ({a.status})
              </li>
            ))}
            {callFlags.map((f) => (
              <li key={f.id}>
                Flag: {f.reason} ({f.status}) —{" "}
                <Link href="/dashboard/flags" className="text-brand underline">
                  flags queue
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Transcript">
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-mint p-3 text-xs">
          {call.transcript ?? "(no transcript stored)"}
        </pre>
      </Section>
    </div>
  );
}
