import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

// Neon HTTP driver: one-shot queries per request, no pool lifecycle to manage.
// Safe to share this instance across route handlers.
let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const sql = neon(getEnv().DATABASE_URL);
  return drizzle(sql, { schema });
}

export function db() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
