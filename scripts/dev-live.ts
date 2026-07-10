// pnpm dev:live — one command to a fully working live setup:
//   1. starts `pnpm dev` (Next.js on :3000) if not already running
//   2. starts `ngrok http 3000` if not already running
//   3. reads the tunnel's public URL from ngrok's local API (:4040)
//   4. rewrites APP_BASE_URL in .env AND .env.local (preserving inline comments)
//   5. runs `pnpm vapi:sync` so every Vapi tool/assistant points at the new URL
//
// Idempotent: safe to re-run any time (e.g. after ngrok restarts with a new
// URL). Background processes log to logs/dev.log and logs/ngrok.log.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const LOGS = path.join(ROOT, "logs");
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function startDetached(name: string, command: string, args: string[], logFile: string) {
  const log = fs.openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  console.log(`▶ started ${name} (pid ${child.pid}, log ${path.relative(ROOT, logFile)})`);
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs / 1000}s`);
}

async function ngrokPublicUrl(): Promise<string | null> {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { tunnels?: Array<{ proto: string; public_url: string }> };
    return data.tunnels?.find((t) => t.proto === "https")?.public_url ?? null;
  } catch {
    return null;
  }
}

function updateEnvFile(file: string, url: string): boolean {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return false;
  const content = fs.readFileSync(p, "utf8");
  // Replace only the value up to whitespace/# so inline comments survive.
  const next = content.replace(/^(APP_BASE_URL=)[^\s#]*/m, `$1${url}`);
  if (next === content) return false;
  fs.writeFileSync(p, next);
  return true;
}

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });

  // 1. Next.js dev server
  if (await isUp("http://localhost:3000")) {
    console.log("✓ dev server already running on :3000");
  } else {
    startDetached("pnpm dev", "pnpm", ["dev"], path.join(LOGS, "dev.log"));
    await waitFor("dev server on :3000", () => isUp("http://localhost:3000"), 90_000);
    console.log("✓ dev server up");
  }

  // 2. ngrok tunnel
  let url = await ngrokPublicUrl();
  if (url) {
    console.log(`✓ ngrok already running: ${url}`);
  } else {
    if (spawnSync("which", ["ngrok"]).status !== 0) {
      throw new Error("ngrok not found in PATH — install it (brew install ngrok) and re-run.");
    }
    startDetached("ngrok", "ngrok", ["http", "3000"], path.join(LOGS, "ngrok.log"));
    await waitFor("ngrok tunnel", async () => (url = await ngrokPublicUrl()) != null, 30_000);
    console.log(`✓ ngrok tunnel up: ${url}`);
  }
  if (!url) throw new Error("ngrok API returned no https tunnel");

  // 3. Point APP_BASE_URL at the tunnel in both env files
  const changed = [".env", ".env.local"].filter((f) => updateEnvFile(f, url!));
  console.log(
    changed.length
      ? `✓ APP_BASE_URL → ${url} (${changed.join(", ")})`
      : `✓ APP_BASE_URL already ${url}`,
  );

  // 4. Sync Vapi so tools/assistants/squad webhook URLs match.
  // Always run — cheap, idempotent, and covers config drift beyond the URL.
  console.log("▶ pnpm vapi:sync …");
  const sync = spawnSync("pnpm", ["vapi:sync"], { cwd: ROOT, stdio: "inherit" });
  if (sync.status !== 0) throw new Error("vapi:sync failed — see output above");

  console.log("\n✅ Live and synced. Call the Vapi number to test.");
  console.log("   Stop later with: pnpm dev:down");
}

main().catch((err) => {
  console.error(String(err?.message ?? err));
  process.exit(1);
});
