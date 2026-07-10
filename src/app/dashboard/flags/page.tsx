import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const REASONS = [
  "refill",
  "signature",
  "clinical",
  "auth",
  "billing_complaint",
  "low_confidence",
  "callback",
  "emergency_followup",
] as const;

async function assignToMe(formData: FormData) {
  "use server";
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  await db()
    .update(schema.flags)
    .set({ status: "in_progress", assignedTo: userId })
    .where(eq(schema.flags.id, id));
  await audit({ actor: userId, action: "flag.assign", entity: "flag", entityId: id });
  revalidatePath("/dashboard/flags");
}

async function resolveFlag(formData: FormData) {
  "use server";
  const { userId } = await auth.protect();
  const id = String(formData.get("id"));
  await db()
    .update(schema.flags)
    .set({ status: "done", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(schema.flags.id, id));
  await audit({ actor: userId, action: "flag.resolve", entity: "flag", entityId: id });
  revalidatePath("/dashboard/flags");
}

function FlagCard({
  f,
  userId,
}: {
  f: typeof schema.flags.$inferSelect;
  userId: string;
}) {
  const isEmergency = f.reason === "emergency_followup";
  return (
    <div
      className={`rounded-lg border p-4 ${
        isEmergency ? "border-red-400 bg-white shadow-sm" : "border-line bg-white shadow-sm"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            isEmergency ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {f.reason}
        </span>
        <span className="text-xs text-ink/60">
          {f.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          {f.routedToExt ? ` · ext ${f.routedToExt}` : ""}
          {f.assignedTo ? ` · assigned${f.assignedTo === userId ? " to you" : ""}` : ""}
        </span>
      </div>
      {/* Complete-intake rule (spec §3.3): render every field; gaps are visible. */}
      <pre className="mb-3 overflow-x-auto rounded-md bg-mint p-2 text-xs">
        {JSON.stringify(f.intake, null, 2)}
      </pre>
      <div className="flex gap-2">
        {f.status === "open" && (
          <form action={assignToMe}>
            <input type="hidden" name="id" value={f.id} />
            <button className="rounded-md bg-brand px-3 py-1 text-sm text-white hover:bg-brand-dark">
              Assign to me
            </button>
          </form>
        )}
        <form action={resolveFlag}>
          <input type="hidden" name="id" value={f.id} />
          <button className="rounded-md bg-coral px-3 py-1 text-sm font-medium text-brand-dark hover:bg-coral-light active:bg-coral-active">
            Mark done
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function FlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; status?: string }>;
}) {
  const { userId } = await auth.protect();
  const { reason, status } = await searchParams;

  const statusFilter = (
    ["open", "in_progress", "done"].includes(status ?? "") ? status : undefined
  ) as "open" | "in_progress" | "done" | undefined;
  const reasonFilter = (REASONS as readonly string[]).includes(reason ?? "")
    ? (reason as (typeof REASONS)[number])
    : undefined;

  const conditions = [];
  if (statusFilter) conditions.push(eq(schema.flags.status, statusFilter));
  else conditions.push(eq(schema.flags.status, "open"));
  if (reasonFilter) conditions.push(eq(schema.flags.reason, reasonFilter));

  const flags = await db()
    .select()
    .from(schema.flags)
    .where(and(...conditions))
    .orderBy(
      statusFilter === "done" ? desc(schema.flags.createdAt) : asc(schema.flags.createdAt),
    );

  await audit({ actor: userId, action: "flags.list", entity: "flags" });

  const activeStatus = statusFilter ?? "open";

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-brand">
        Flags — {activeStatus.replace("_", " ")} ({flags.length})
      </h1>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {(["open", "in_progress", "done"] as const).map((s) => (
          <Link
            key={s}
            href={`/dashboard/flags?status=${s}${reasonFilter ? `&reason=${reasonFilter}` : ""}`}
            className={`rounded px-2 py-1 ${
              activeStatus === s ? "bg-brand text-white" : "bg-mint text-ink/70 hover:bg-line-soft"
            }`}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
        <span className="mx-2 text-line">|</span>
        <Link
          href={`/dashboard/flags?status=${activeStatus}`}
          className={`rounded px-2 py-1 ${!reasonFilter ? "bg-brand text-white" : "bg-mint text-ink/70 hover:bg-line-soft"}`}
        >
          all reasons
        </Link>
        {REASONS.map((r) => (
          <Link
            key={r}
            href={`/dashboard/flags?status=${activeStatus}&reason=${r}`}
            className={`rounded px-2 py-1 ${
              reasonFilter === r ? "bg-brand text-white" : "bg-mint text-ink/70 hover:bg-line-soft"
            }`}
          >
            {r.replace(/_/g, " ")}
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {flags.map((f) => (
          <FlagCard key={f.id} f={f} userId={userId} />
        ))}
        {flags.length === 0 && <p className="text-ink/60">Nothing here.</p>}
      </div>
    </div>
  );
}
