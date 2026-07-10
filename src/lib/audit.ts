import { db, schema } from "@/db";

/**
 * Audit-log writer — call from every dashboard server action / adapter that
 * reads or changes PHI. Cheap by design so compliance stays easy.
 */
export async function audit(entry: {
  actor: string; // Clerk userId or "agent"
  action: string; // e.g. "flag.resolve", "patient.view"
  entity: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await db().insert(schema.auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? null,
  });
}
