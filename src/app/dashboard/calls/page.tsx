import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { userId } = await auth.protect();
  const { q } = await searchParams;

  const base = db()
    .select({ call: schema.calls, patient: schema.patients })
    .from(schema.calls)
    .leftJoin(schema.patients, eq(schema.calls.patientId, schema.patients.id));

  const rows = q
    ? await base
        .where(
          or(
            ilike(schema.calls.callerNumber, `%${q}%`),
            ilike(schema.calls.summary, `%${q}%`),
            ilike(schema.patients.firstName, `%${q}%`),
            ilike(schema.patients.lastName, `%${q}%`),
          ),
        )
        .orderBy(desc(schema.calls.createdAt))
        .limit(100)
    : await base.orderBy(desc(schema.calls.createdAt)).limit(100);

  await audit({ actor: userId, action: "calls.list", entity: "calls", detail: q ? { q } : undefined });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-brand">Calls</h1>
      <form className="mb-4">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search caller number, name, summary…"
          className="w-80 rounded-md border border-line bg-white px-3 py-1.5 text-sm placeholder:text-ink/40"
        />
        <button className="ml-2 rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark">
          Search
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-mint-light">
            <tr className="border-b border-line text-left text-brand">
              <th className="p-2">When</th>
              <th className="p-2">Direction</th>
              <th className="p-2">Caller</th>
              <th className="p-2">Patient</th>
              <th className="p-2">Outcome</th>
              <th className="p-2">Duration</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ call: c, patient: p }) => (
              <tr key={c.id} className="border-b border-line-soft hover:bg-mint-light">
                <td className="p-2 whitespace-nowrap">
                  {c.startedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
                </td>
                <td className="p-2">{c.direction}</td>
                <td className="p-2">{c.callerNumber ?? "—"}</td>
                <td className="p-2">{p ? `${p.firstName} ${p.lastName}` : "—"}</td>
                <td className="p-2">{c.outcome ?? "—"}</td>
                <td className="p-2">{c.durationSeconds != null ? `${c.durationSeconds}s` : "—"}</td>
                <td className="p-2">
                  <Link href={`/dashboard/calls/${c.id}`} className="font-medium text-brand underline">
                    detail
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-ink/60" colSpan={7}>
                  {q ? "No calls match." : "No calls recorded yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
