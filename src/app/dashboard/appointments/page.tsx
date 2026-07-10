import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { capacityGroupFor, type AppointmentType } from "@/core/scheduling/rules";

export const dynamic = "force-dynamic";

/** Tonight's sleep capacity per location: booked-in-group vs rule capacity. */
async function sleepCapacityToday() {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const dow = dayStart.getUTCDay();

  const group = capacityGroupFor("psg" as AppointmentType);
  const rules = await db()
    .select()
    .from(schema.availabilityRules)
    .where(
      and(
        eq(schema.availabilityRules.appointmentType, "psg"),
        eq(schema.availabilityRules.dayOfWeek, dow),
        eq(schema.availabilityRules.active, true),
      ),
    );

  const out: { location: string; booked: number; capacity: number }[] = [];
  for (const rule of rules) {
    const booked = await db()
      .select({ id: schema.appointments.id })
      .from(schema.appointments)
      .where(
        and(
          inArray(schema.appointments.type, group),
          eq(schema.appointments.location, rule.location),
          gte(schema.appointments.startsAt, dayStart),
          lt(schema.appointments.startsAt, dayEnd),
          inArray(schema.appointments.status, ["booked", "confirmed", "rescheduled"]),
        ),
      );
    out.push({ location: rule.location, booked: booked.length, capacity: rule.capacityPerDay });
  }
  return out;
}

export default async function AppointmentsPage() {
  const { userId } = await auth.protect();
  const [rows, capacity] = await Promise.all([
    db()
      .select({ appt: schema.appointments, patient: schema.patients })
      .from(schema.appointments)
      .leftJoin(schema.patients, eq(schema.appointments.patientId, schema.patients.id))
      .orderBy(desc(schema.appointments.startsAt))
      .limit(200),
    sleepCapacityToday(),
  ]);
  await audit({ actor: userId, action: "appointments.list", entity: "appointments" });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-brand">Appointments</h1>

      <div className="mb-6 flex gap-4">
        {capacity.map((c) => (
          <div key={c.location} className="rounded-xl border border-line bg-white p-4 shadow-sm">
            <div className="text-2xl font-semibold text-brand-dark">
              {c.booked}/{c.capacity}
            </div>
            <div className="text-sm text-ink/60">PSG {c.location} tonight</div>
          </div>
        ))}
        {capacity.length === 0 && (
          <p className="text-sm text-ink/60">No overnight sleep capacity configured for tonight.</p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-mint-light">
            <tr className="border-b border-line text-left text-brand">
              <th className="p-2">Starts</th>
              <th className="p-2">Type</th>
              <th className="p-2">Location</th>
              <th className="p-2">Patient</th>
              <th className="p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ appt: a, patient: p }) => (
              <tr key={a.id} className="border-b border-line-soft hover:bg-mint-light">
                <td className="p-2 whitespace-nowrap">
                  {a.startsAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="p-2">{a.type}</td>
                <td className="p-2">{a.location}</td>
                <td className="p-2">{p ? `${p.firstName} ${p.lastName}` : "—"}</td>
                <td className="p-2">{a.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-4 text-ink/60" colSpan={5}>
                  No appointments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
