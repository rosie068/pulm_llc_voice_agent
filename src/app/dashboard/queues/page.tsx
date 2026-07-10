import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { attemptCapFor, isActiveOutboundWorkstream } from "@/core/attempts";

export const dynamic = "force-dynamic";

const STUDY_SUBTYPES = ["hst", "psg", "titration_split"] as const;
type StudySubtype = (typeof STUDY_SUBTYPES)[number];

function isStudySubtype(value: string): value is StudySubtype {
  return (STUDY_SUBTYPES as readonly string[]).includes(value);
}

async function addRow(formData: FormData) {
  "use server";
  const { userId } = await auth.protect();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const workstream = String(formData.get("workstream"));
  const studySubtype = String(formData.get("studySubtype") ?? "");
  const authVerified = formData.get("authVerified") === "on";
  if (!firstName || !lastName || !phone) return;
  if (!isActiveOutboundWorkstream(workstream)) return;
  if (workstream === "sleep_study" && !isStudySubtype(studySubtype)) return;
  const queuedStudySubtype: StudySubtype | null =
    workstream === "sleep_study" ? (studySubtype as StudySubtype) : null;

  const existing = await db()
    .select()
    .from(schema.patients)
    .where(
      and(eq(schema.patients.firstName, firstName), eq(schema.patients.lastName, lastName)),
    )
    .limit(1);
  const patient =
    existing[0] ??
    (await db().insert(schema.patients).values({ firstName, lastName, phone }).returning())[0];

  const [row] = await db()
    .insert(schema.outboundQueue)
    .values({
      workstream,
      patientId: patient.id,
      studySubtype: queuedStudySubtype,
      authVerified,
      attemptCap: attemptCapFor(workstream),
      sourceRef: `dashboard:${userId}`,
    })
    .returning();
  await audit({ actor: userId, action: "queue.add", entity: "outbound_queue", entityId: row.id });
  revalidatePath("/dashboard/queues");
}

async function closeRow(formData: FormData) {
  "use server";
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  await db()
    .update(schema.outboundQueue)
    .set({ status: "closed", closedReason: "not_interested", updatedAt: new Date() })
    .where(eq(schema.outboundQueue.id, id));
  await audit({ actor: userId, action: "queue.close", entity: "outbound_queue", entityId: id });
  revalidatePath("/dashboard/queues");
}

async function retryNow(formData: FormData) {
  "use server";
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  const [row] = await db()
    .select({ workstream: schema.outboundQueue.workstream })
    .from(schema.outboundQueue)
    .where(eq(schema.outboundQueue.id, id))
    .limit(1);
  if (!row || !isActiveOutboundWorkstream(row.workstream)) return;
  await db()
    .update(schema.outboundQueue)
    .set({ status: "ready", nextAttemptAt: null, updatedAt: new Date() })
    .where(eq(schema.outboundQueue.id, id));
  await audit({ actor: userId, action: "queue.retry_now", entity: "outbound_queue", entityId: id });
  revalidatePath("/dashboard/queues");
}

export default async function QueuesPage() {
  const { userId } = await auth.protect();
  const rows = await db()
    .select({ queue: schema.outboundQueue, patient: schema.patients })
    .from(schema.outboundQueue)
    .leftJoin(schema.patients, eq(schema.outboundQueue.patientId, schema.patients.id))
    .orderBy(desc(schema.outboundQueue.updatedAt))
    .limit(200);
  await audit({ actor: userId, action: "queues.list", entity: "outbound_queue" });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-brand">Outbound queues</h1>

      <form
        action={addRow}
        className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3 text-sm shadow-sm"
      >
        <div className="font-medium">Add row:</div>
        <input name="firstName" placeholder="First name" required className="w-28 rounded-md border border-line bg-white px-2 py-1" />
        <input name="lastName" placeholder="Last name" required className="w-28 rounded-md border border-line bg-white px-2 py-1" />
        <input name="phone" placeholder="+1702…" required className="w-32 rounded-md border border-line bg-white px-2 py-1" />
        <select name="workstream" className="rounded-md border border-line bg-white px-2 py-1">
          <option value="sleep_study">sleep_study</option>
          <option value="referral">referral</option>
        </select>
        <select name="studySubtype" className="rounded-md border border-line bg-white px-2 py-1">
          <option value="">subtype required for sleep</option>
          <option value="hst">hst</option>
          <option value="psg">psg</option>
          <option value="titration_split">titration_split</option>
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" name="authVerified" /> auth verified
        </label>
        <button className="rounded-md bg-coral px-3 py-1 font-medium text-brand-dark hover:bg-coral-light active:bg-coral-active">Add</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-mint-light">
            <tr className="border-b border-line text-left text-brand">
              <th className="p-2">Workstream</th>
              <th className="p-2">Patient</th>
              <th className="p-2">Subtype</th>
              <th className="p-2">Auth</th>
              <th className="p-2">Status</th>
              <th className="p-2">Attempts</th>
              <th className="p-2">Next attempt</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ queue: q, patient: p }) => {
              const activeThisPhase = isActiveOutboundWorkstream(q.workstream);
              return (
                <tr key={q.id} className="border-b border-line-soft hover:bg-mint-light">
                  <td className="p-2">{q.workstream}</td>
                  <td className="p-2">{p ? `${p.firstName} ${p.lastName}` : "—"}</td>
                  <td className="p-2">{q.studySubtype ?? "—"}</td>
                  <td className="p-2">{q.authVerified ? "✓" : "✗"}</td>
                  <td className="p-2">
                    {q.status}
                    {q.closedReason ? ` (${q.closedReason})` : ""}
                    {!activeThisPhase ? " (future phase)" : ""}
                  </td>
                  <td className="p-2">
                    {q.attemptCount}/{q.attemptCap}
                  </td>
                  <td className="p-2">
                    {q.nextAttemptAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      {(q.status === "ready" || q.status === "in_progress") && (
                        <form action={closeRow}>
                          <input type="hidden" name="id" value={q.id} />
                          <button className="rounded bg-red-600 px-2 py-0.5 text-xs text-white">close</button>
                        </form>
                      )}
                      {activeThisPhase &&
                        q.status !== "ready" &&
                        q.status !== "scheduled" &&
                        q.status !== "closed" && (
                          <form action={retryNow}>
                            <input type="hidden" name="id" value={q.id} />
                            <button className="rounded-md bg-brand px-2 py-0.5 text-xs text-white hover:bg-brand-dark">retry now</button>
                          </form>
                        )}
                      {activeThisPhase && q.status === "ready" && q.nextAttemptAt && (
                        <form action={retryNow}>
                          <input type="hidden" name="id" value={q.id} />
                          <button className="rounded-md bg-brand px-2 py-0.5 text-xs text-white hover:bg-brand-dark">retry now</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-ink/60" colSpan={8}>
                  Queue empty. Add above or `pnpm queue:import &lt;csv&gt;`.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
