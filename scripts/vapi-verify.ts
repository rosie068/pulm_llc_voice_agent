/* Verify live Vapi config matches the repo. Read-only. */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { VapiClient } from "@vapi-ai/server-sdk";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const registry = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "src", "vapi", "registry.json"), "utf8"),
);

const client = new VapiClient({ token: process.env.VAPI_API_KEY! });

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  // 1. identify_patient: neutral repeatable "One moment." filler
  const idTool: any = await (client.tools as any).get({ id: registry.tools.identify_patient });
  const startMsg = (idTool.messages ?? []).find((m: any) => m.type === "request-start");
  check(
    'identify_patient plays "One moment." while running',
    startMsg?.content === "One moment.",
    JSON.stringify(idTool.messages ?? []),
  );

  // 2. scheduler prompt: new-patient welcome + single lookup line + bridge back
  const sched: any = await (client.assistants as any).get({ id: registry.assistants.scheduler });
  const schedPrompt = sched.model.messages?.find((m: any) => m.role === "system")?.content ?? "";
  check("scheduler: welcome-by-name line", schedPrompt.includes("Looks like you're new with us. Welcome, {first name}!"));
  check("scheduler: no self-announced lookups", schedPrompt.includes("Never announce a record lookup yourself"));
  check("scheduler: handback bridge line", schedPrompt.includes("Let me get you back to Mark at the front desk — one moment."));
  check("scheduler: email readback", schedPrompt.includes("EMAIL READBACK"));
  check("scheduler: address readback", schedPrompt.includes("ADDRESS READBACK"));

  // 3. front desk: barge-in config, idle recovery, fragment rule, appointment-first, Linda bridge
  const fd: any = await (client.assistants as any).get({ id: registry.assistants["front-desk"] });
  const fdPrompt = fd.model.messages?.find((m: any) => m.role === "system")?.content ?? "";
  check("front-desk: stopSpeakingPlan numWords=1", fd.stopSpeakingPlan?.numWords === 1, JSON.stringify(fd.stopSpeakingPlan));
  check("front-desk: idle 10s ×2", fd.messagePlan?.idleTimeoutSeconds === 10 && fd.messagePlan?.idleMessageMaxSpokenCount === 2, JSON.stringify(fd.messagePlan));
  check("front-desk: INTERRUPTED FRAGMENT rule", fdPrompt.includes("INTERRUPTED FRAGMENT"));
  check("front-desk: appointment-first symptom flow", fdPrompt.includes("offer an appointment FIRST"));
  check("front-desk: Linda bridge line", fdPrompt.includes("Let me get you over to Linda, our scheduler — one moment."));
  check("front-desk: nine-one-one rule", fdPrompt.includes('say "nine-one-one" — never the digits "911"'));
  check("front-desk: acute injury branch", fdPrompt.includes("Acute injury, no warning sign"));
  check(
    "front-desk: symptom send-off line",
    fdPrompt.includes(
      "Let me get you over to Linda, our scheduler — she can book you an appointment with one of our providers. One moment.",
    ),
  );
  check(
    "front-desk: no bridge line without handoff",
    fdPrompt.includes("ending your turn after the line without triggering the handoff is an error"),
  );

  // 4. phone number → squad
  const phone: any = await (client.phoneNumbers as any).get({ id: process.env.VAPI_PHONE_NUMBER_ID });
  check("phone number attached to squad", phone.squadId === registry.squads.inbound, `squadId=${phone.squadId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
