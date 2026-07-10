import { auth } from "@clerk/nextjs/server";
import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ACTIVE_OUTBOUND_WORKSTREAMS } from "@/core/attempts";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  await auth.protect();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [
    [callsToday],
    [callsResolvedToday],
    [openFlags],
    [readyQueue],
    outboundTerminal,
    [toolLatency],
  ] = await Promise.all([
    db()
      .select({ n: count() })
      .from(schema.calls)
      .where(gte(schema.calls.createdAt, todayStart)),
    db()
      .select({ n: count() })
      .from(schema.calls)
      .where(
        and(
          gte(schema.calls.createdAt, todayStart),
          eq(schema.calls.outcome, "resolved_scheduled"),
        ),
      ),
    db().select({ n: count() }).from(schema.flags).where(eq(schema.flags.status, "open")),
    db()
      .select({ n: count() })
      .from(schema.outboundQueue)
      .where(
        and(
          eq(schema.outboundQueue.status, "ready"),
          inArray(schema.outboundQueue.workstream, [...ACTIVE_OUTBOUND_WORKSTREAMS]),
        ),
      ),
    db()
      .select({ status: schema.outboundQueue.status, n: count() })
      .from(schema.outboundQueue)
      .where(
        inArray(schema.outboundQueue.status, ["scheduled", "closed", "unreachable", "cap_reached"]),
      )
      .groupBy(schema.outboundQueue.status),
    db()
      .select({
        avg: sql<number | null>`avg(${schema.toolExecutions.latencyMs})`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${schema.toolExecutions.latencyMs})`,
      })
      .from(schema.toolExecutions),
  ]);

  const scheduled = outboundTerminal.find((r) => r.status === "scheduled")?.n ?? 0;
  const terminalTotal = outboundTerminal.reduce((s, r) => s + r.n, 0);
  const conversion = terminalTotal > 0 ? Math.round((scheduled / terminalTotal) * 100) : null;
  const resolutionRate =
    callsToday.n > 0 ? Math.round((callsResolvedToday.n / callsToday.n) * 100) : null;

  const stats = [
    { label: "Calls today", value: String(callsToday.n) },
    { label: "Resolution rate today", value: resolutionRate != null ? `${resolutionRate}%` : "—" },
    { label: "Open flags", value: String(openFlags.n) },
    { label: "Outbound ready", value: String(readyQueue.n) },
    { label: "Outbound conversion", value: conversion != null ? `${conversion}%` : "—" },
    {
      label: "Tool latency avg / p95",
      value: toolLatency.avg != null
        ? `${Math.round(Number(toolLatency.avg))} / ${Math.round(Number(toolLatency.p95))} ms`
        : "—",
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-brand">Operations</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-white p-4 shadow-sm">
            <div className="text-xl font-semibold text-brand-dark">{s.value}</div>
            <div className="text-sm text-ink/60">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
