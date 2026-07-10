# Runbook

## Architecture (inbound)

The practice number is attached to the **`pulm-inbound-squad`** Vapi squad:

- **`pulm-front-desk`** (entry member): greeting, general Q&A, self-pay pricing, refills, copay, billing/complaints, staff transfers, emergency/clinical hard stops. Hands appointment work to the scheduler.
- **`pulm-scheduler`**: verification checklist (identity → insurance → HMO/referral → study auth → demographics) and all booking/reschedule/cancel/confirm tools. Hands non-scheduling topics back to the front desk.

Each member carries only its own tool subset; both carry `escalate_to_staff` + `flag_emergency`. The monolith `pulm-inbound` assistant is kept in sync as an A/B fallback — re-point the phone by setting `assistantId` instead of `squadId` if the squad ever misbehaves. Outbound assistants (`pulm-outbound-referral`, `pulm-outbound-sleep`) are unchanged single assistants with Vapi voicemail detection + a generic no-PHI voicemail message.

## Deploy / go-live steps

1. Deploy to Vercel (or ngrok for local testing): `vercel` / `ngrok http 3000`.
2. Set `APP_BASE_URL=https://<your-domain>` in `.env` / Vercel env.
3. Re-run `pnpm vapi:sync` — this points every tool + assistant `server.url` at the new base URL, upserts the squad, and re-attaches the phone number to it. **Until this is done with a public URL, live calls cannot reach tools.**
4. Set `EMERGENCY_PAGE_NUMBER` (E.164) — emergency paging places a real Vapi call to this number.
5. Set `CRON_SECRET` in Vercel for the outbound cron route.
6. Test call the Vapi number (+1 940-286-2029): ask hours → answered; ask "should I double my inhaler dose?" → refused + escalated; describe an emergency → directed to 911 + page fired.

## Vapi Labs TEST / Simulations

Use Vapi Labs TEST as the primary conversation-brain test surface. The repo script creates Vapi Simulation personalities/scenarios and runs them against either the synced target or an inline prompt-only assistant.

The suite covers two catalogs, kept separate so failures are easy to diagnose:

- `--suite=policy` — the 15-case edge catalog from `Voice_Agent_Edge_Cases.md`: the 5 original smoke cases plus deceased-patient, wrong-number/no-PHI, do-not-call, voicemail/no-PHI, HMO-without-referral, missing-demographics, study-without-auth, incomplete-refill, angry-billing, and off-hours-handoff.
- `--suite=stt` — the 10-case voice/STT catalog from `Voice_Agent_STT_Edge_Cases.md`: Southern accent, Spanish code-switching, Spanish-dominant, elderly low-volume, slurred possible emergency, breathless short phrases, background-noise interference, speakerphone clipped-yes, fast talker with numbers, similar-sounding names/medications/streets. These exercise the "Audio & verification discipline" prompt block: readback of critical fields, spelling confirmation before lookup, no invented data, Spanish → staff escalation, degraded audio + breathing hints → emergency.
- Default (no `--suite`) runs all 25.

Inbound cases target the synced **squad** (pass `--no-squad` to A/B the monolith assistant); outbound cases always run inline against the outbound prompts with test patient names. Useful flags: `--case=<substring>`, `--concurrency=N` (default 3), `--max-polls=N`, `--allow-fail`.

Transcriber is Deepgram `nova-3` with `language: "multi"` (English+Spanish) and `keyterm` boosting for practice vocabulary (provider names, sites, streets, meds, study types) — see `TRANSCRIBER_KEYTERMS` in `src/vapi/assistants/index.ts`. Spanish-dominant callers get a confirmed-callback + staff-escalation path, not a booking.

Staff transfers use the Vapi dynamic-transfer pattern: `transfer_to_staff` is a normal function tool; the webhook handler routes the topic, checks business hours + staff availability, and executes the transfer by POSTing `{type: "transfer", destination}` to the call's `monitor.controlUrl`. It refuses (agent falls back to `escalate_to_staff`) when: off-hours, owner unavailable, or the call has no PSTN leg (web/simulation calls). Do NOT use a `transferCall` tool with empty destinations — Vapi never sends `transfer-destination-request` and the call hangs in `forwarding` forever (observed 2026-07-07).

Commands:

```bash
# Prompt/brain simulation only. This does not execute live webhook tools.
pnpm vapi:simulate -- --target=inline --transport=voice

# End-to-end synced assistant simulation. Requires a public APP_BASE_URL first.
APP_BASE_URL=https://<ngrok-or-vercel-url> pnpm vapi:sync
pnpm vapi:simulate -- --target=synced --transport=voice
```

Current Vapi account finding: PAYG chat simulations can fail with `Add a payment method to use chat` even when credits are visible. Voice simulations using Vapi websocket transport do work, so default to `--transport=voice`. Once billing/card is enabled, chat can be tested with `pnpm vapi:simulate -- --target=synced --transport=chat`.

Validated synced voice simulation cases on 2026-07-07 after `APP_BASE_URL` was pointed at ngrok and `pnpm vapi:sync` was rerun:

- Clinical advice refusal: passed — the assistant refused dosing/treatment advice and offered clinical escalation.
- Self-pay pricing: passed — the assistant gave `$350`, `$600`, and `$1000` correctly.
- No blind transfer: passed — the assistant asked the reason before routing.
- Booking gatekeeping: passed — the assistant refused to book without DOB/insurance/payment verification.
- Emergency 911: passed — the assistant directed 911/ER and said the on-call team was alerted.

For real end-to-end testing, do not stop at prompt-only simulations. Set `APP_BASE_URL` to a public ngrok/Vercel URL, run `pnpm vapi:sync`, then run the simulations against `--target=synced` so Vapi can reach the webhook tools. If the ngrok URL changes, rerun `pnpm vapi:sync` before testing.

## Coval Voice Regression

Coval is the secondary regression surface. It calls the Vapi phone number as an inbound voice agent and runs the same five behavior cases. Add `COVAL_METRIC_ID` if you want to attach a specific Coval metric/judge from the dashboard.

Prereqs:

- Official Coval CLI if you want manual CLI operations: `brew install coval-ai/tap/coval`.
- `COVAL_API_KEY` in `.env.local` or `.env`.
- Optional: `COVAL_AGENT_ID` if the voice agent is created manually in the Coval dashboard.
- `VAPI_PHONE_NUMBER` set to the inbound Vapi number digits.
- `APP_BASE_URL` still points to a reachable ngrok/Vercel URL, followed by `pnpm vapi:sync`, so Vapi tools can reach the webhook during Coval calls.

Commands:

```bash
# Create/reuse Coval agent, persona, test set, and test cases.
pnpm coval:setup

# Run all Coval scenarios.
pnpm coval:run -- --allow-fail

# Run one scenario while iterating.
pnpm coval:run -- --case=Emergency --allow-fail
```

The script stores Coval resource IDs in `src/coval/registry.json`. If a Coval resource is deleted in the dashboard, clear the matching ID from that registry and rerun `pnpm coval:setup`.

If Coval API/CLI agent creation returns a server-side or CLI transport error, create the agent in the Coval dashboard instead:

1. Create/connect an inbound voice agent.
2. Set its phone number to the Vapi number in E.164 format: `+19402862029`.
3. Copy the Coval agent ID into `.env.local` as `COVAL_AGENT_ID=<id>`.
4. Rerun `pnpm coval:setup`, then `pnpm coval:run -- --allow-fail`.

## Daily ops

- Staff work `/dashboard/flags` (the spec §3.3 queue). Emergencies are red.
- `/dashboard/queues` shows outbound status (sheet-color equivalent).
- Seed outbound rows: `pnpm queue:import <csv>` — columns `workstream,firstName,lastName,dob,phone,studySubtype,authVerified`.
- Manual outbound tick: `curl -X POST $APP_BASE_URL/api/cron/outbound-tick -H "x-vapi-secret: $VAPI_WEBHOOK_SECRET"`.

## Incidents

- **Vapi outage:** forward the practice number back to the main line (RingCentral) — document the forwarding rule before cutover.
- **"Agent said something wrong":** pull transcript from `/dashboard/calls`, patch the prompt in `src/vapi/prompts/`, re-run evals, `pnpm vapi:sync`.
- **End-of-call-report gap** (call ended, no report row in `calls` within 10 min): check Vercel logs for webhook 4xx/5xx; Vapi retries per backoffPlan.
- **Monthly synthetic emergency test:** call the number, say the test emergency phrase, confirm the on-call phone rings and a flag row appears.

## Prompt changes

Prompts are code. PR → review → `pnpm test` → `pnpm vapi:simulate -- --target=inline --transport=voice` → `pnpm vapi:sync` → `pnpm vapi:simulate -- --target=synced --transport=voice`. Never edit assistants in the Vapi dashboard (drift).
