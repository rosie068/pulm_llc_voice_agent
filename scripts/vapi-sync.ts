/* eslint-disable @typescript-eslint/no-explicit-any */
// pnpm vapi:sync — upsert tools + assistants to Vapi (config as code, guide §6.4).
// Stores created IDs in src/vapi/registry.json (committed). Idempotent: re-runs
// update in place. Pass --dry to print the diff plan without writing.

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { VapiClient } from "@vapi-ai/server-sdk";
import { TOOL_DEFINITIONS } from "../src/vapi/tools/definitions";
import { ASSISTANT_SPECS, buildAssistantPayload } from "../src/vapi/assistants";
import { buildInboundSquadPayload } from "../src/vapi/squads";

loadEnv();

const REGISTRY_PATH = path.join(__dirname, "..", "src", "vapi", "registry.json");

interface Registry {
  tools: Record<string, string>; // tool name → vapi tool id
  assistants: Record<string, string>; // assistant key → vapi assistant id
  squads?: Record<string, string>; // squad key → vapi squad id
}

function loadEnv() {
  const shellEnv = { ...process.env };
  dotenv.config({ path: ".env" });
  const local = dotenv.config({ path: ".env.local", override: true });
  if (!local.parsed) return;

  for (const key of Object.keys(local.parsed)) {
    if (shellEnv[key] !== undefined) {
      process.env[key] = shellEnv[key];
    }
  }
}

function loadRegistry(): Registry {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return { tools: {}, assistants: {} };
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const apiKey = process.env.VAPI_API_KEY;
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !secret) throw new Error("VAPI_API_KEY and VAPI_WEBHOOK_SECRET required");
  if (!baseUrl || baseUrl.includes("localhost")) {
    console.warn(
      `⚠ APP_BASE_URL is "${baseUrl ?? "unset"}" — Vapi cannot reach localhost. ` +
        "Use an ngrok/Vercel URL for live calls. Continuing (config still syncs).",
    );
  }
  const serverUrl = `${baseUrl ?? "http://localhost:3000"}/api/vapi/webhook`;

  const client = new VapiClient({ token: apiKey });
  const registry = loadRegistry();

  // 1. Tools
  for (const def of TOOL_DEFINITIONS) {
    const body: any = {
      type: "function",
      async: false,
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      },
      server: {
        url: serverUrl,
        timeoutSeconds: 20,
        headers: { "x-vapi-secret": secret },
        backoffPlan: { type: "exponential", maxRetries: 3, baseDelaySeconds: 1 },
      },
      messages: def.requestStartMessage
        ? [
            { type: "request-start", content: def.requestStartMessage },
            {
              type: "request-response-delayed",
              content: "Thanks for your patience, almost there.",
              timingMilliseconds: 4000,
            },
          ]
        : undefined,
    };

    const existingId = registry.tools[def.name];
    if (dry) {
      console.log(`[dry] tool ${def.name}: ${existingId ? `update ${existingId}` : "create"}`);
      continue;
    }
    if (existingId) {
      try {
        // SDK v1.x update signature: single { id, body } request object.
        await (client.tools as any).update({ id: existingId, body });
        console.log(`✓ tool updated: ${def.name}`);
        continue;
      } catch {
        console.warn(`tool ${def.name}: update failed, recreating`);
      }
    }
    const created: any = await (client.tools as any).create(body);
    registry.tools[def.name] = created.id;
    console.log(`✓ tool created: ${def.name} → ${created.id}`);
  }

  // NOTE: transfer_to_staff is a plain function tool in TOOL_DEFINITIONS — the
  // webhook handler executes the transfer by POSTing to the call's control URL
  // (Vapi dynamic-transfer pattern). The legacy transferCall/transfer-destination-
  // request flow hangs calls in "forwarding" and is not used.

  const toolIds = TOOL_DEFINITIONS.map((d) => registry.tools[d.name]).filter(Boolean);

  // 2. Assistants
  for (const spec of ASSISTANT_SPECS) {
    const payload: any = buildAssistantPayload(spec, serverUrl, secret);
    // Each spec gets its declared tool subset (all function tools if undeclared).
    payload.model.toolIds = spec.toolNames
      ? spec.toolNames.map((n) => registry.tools[n]).filter(Boolean)
      : toolIds;
    delete payload.model.tools;

    const existingId = registry.assistants[spec.key];
    if (dry) {
      console.log(`[dry] assistant ${spec.key}: ${existingId ? `update ${existingId}` : "create"}`);
      continue;
    }
    if (existingId) {
      try {
        // assistants.update flattens: { id, ...payload } (unlike tools/phoneNumbers which take { id, body })
        await (client.assistants as any).update({ id: existingId, ...payload });
        console.log(`✓ assistant updated: ${spec.name}`);
        continue;
      } catch (e) {
        console.warn(`assistant ${spec.key}: update failed (${e}), recreating`);
      }
    }
    const created: any = await (client.assistants as any).create(payload);
    registry.assistants[spec.key] = created.id;
    console.log(`✓ assistant created: ${spec.name} → ${created.id}`);
  }

  // 3. Inbound squad: front-desk (entry) ⇄ scheduler. In-call handoffs keep
  // the conversation context; each member carries only its own tool subset.
  registry.squads ??= {};
  const frontDeskId = registry.assistants["front-desk"];
  const schedulerId = registry.assistants["scheduler"];
  if (frontDeskId && schedulerId && !dry) {
    // Handoffs use model-generated first turns from the complete call history.
    // This prevents either saved assistant's static opening from replaying when
    // the call moves between Mark and Linda.
    const squadBody: any = buildInboundSquadPayload(frontDeskId, schedulerId);
    const existingSquadId = registry.squads["inbound"];
    try {
      if (existingSquadId) {
        // squads.update flattens like assistants.update: { id, ...body }
        await (client.squads as any).update({ id: existingSquadId, ...squadBody });
        console.log(`✓ squad updated: pulm-inbound-squad (${existingSquadId})`);
      } else {
        const created: any = await (client.squads as any).create(squadBody);
        registry.squads["inbound"] = created.id;
        console.log(`✓ squad created: pulm-inbound-squad → ${created.id}`);
      }
    } catch (e) {
      if (existingSquadId) {
        try {
          const created: any = await (client.squads as any).create(squadBody);
          registry.squads["inbound"] = created.id;
          console.log(`✓ squad recreated: pulm-inbound-squad → ${created.id}`);
        } catch (e2) {
          console.warn(`squad upsert failed: ${e2}`);
        }
      } else {
        console.warn(`squad create failed: ${e}`);
      }
    }
  }

  // 4. Attach phone number → inbound squad (falls back to the monolith
  // inbound assistant if the squad is unavailable).
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const inboundId = registry.assistants["inbound"];
  const squadId = registry.squads["inbound"];
  if (phoneNumberId && (squadId || inboundId) && !dry) {
    try {
      await (client.phoneNumbers as any).update({
        id: phoneNumberId,
        body: {
          ...(squadId ? { squadId, assistantId: null } : { assistantId: inboundId }),
          server: { url: serverUrl, headers: { "x-vapi-secret": secret } },
        },
      });
      console.log(
        `✓ phone number ${phoneNumberId} → ${squadId ? `squad ${squadId}` : `inbound assistant ${inboundId}`}`,
      );
    } catch (e) {
      console.warn(`phone number attach failed: ${e}`);
    }
  }

  if (!dry) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
    console.log(`✓ registry written: ${REGISTRY_PATH}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
