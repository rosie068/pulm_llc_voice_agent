// pnpm db:seed — providers, staff availability, and sleep availability_rules
// (spec §1, §2, §5). Idempotent: clears and re-inserts reference tables only.

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { PROVIDERS } from "../vapi/knowledge";
import { ROUTING_DIRECTORY } from "../core/routing";
import { DEFAULT_RULES } from "../core/scheduling/rules";
import * as schema from "./schema";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });

  await db.delete(schema.availabilityRules);
  await db.delete(schema.staffAvailability);
  await db.delete(schema.providers);

  await db.insert(schema.providers).values(
    PROVIDERS.map((p) => ({
      name: p.name,
      role: p.role,
      locations: [...p.locations],
    })),
  );
  console.log(`✓ providers: ${PROVIDERS.length}`);

  await db.insert(schema.staffAvailability).values(
    Object.values(ROUTING_DIRECTORY).map((o) => ({
      ext: o.ext,
      ownerName: o.ownerName,
      phoneNumber: null, // real DIDs are integration-phase
      available: true,
    })),
  );
  console.log(`✓ staff availability: ${Object.keys(ROUTING_DIRECTORY).length}`);

  await db.insert(schema.availabilityRules).values(
    DEFAULT_RULES.map((r) => ({
      appointmentType: r.appointmentType,
      location: r.location,
      dayOfWeek: r.dayOfWeek,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      capacityPerDay: r.capacityPerDay,
      slotMinutes: r.slotMinutes,
      active: r.active,
    })),
  );
  console.log(`✓ availability rules: ${DEFAULT_RULES.length} (sleep + provisional new-patient office grid)`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
