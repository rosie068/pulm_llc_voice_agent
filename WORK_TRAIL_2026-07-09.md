# Work Trail — 2026-07-09

> Delta since `WORK_TRAIL_2026-07-07.md`: what was implemented today, how it is verified, and what remains. Same system of record — specs: `Voice_Agent_SPEC.md` (§3.1/§3.2 updated today to match implemented behavior) · staff test script: `docs/UAT_Test_Scenarios.md` (new today) · ops: `docs/runbook.md`.

## System (unchanged core)

**Live number:** +1 940-286-2029 → `pulm-inbound-squad` (front desk ⇄ scheduler). Monolith `pulm-inbound` kept in sync as A/B fallback. Outbound: `pulm-outbound-referral` / `pulm-outbound-sleep` via queue + cron tick.

## Implemented Today

### Booking flow — the demographics deadlock is gone

| Change | Detail |
|---|---|
| **`update_demographics` tool** | New patients' missing email/phone/address/insurance can now be SAVED mid-call. Previously the agent collected them verbally with no way to persist → booking gate stayed blocked forever (root cause of every "spoke, no appt" new-patient call). Booking gate (`canBook`) takes the latest of `identify_patient` / `update_demographics`. |
| **One-at-a-time collection** | Announce the list once, then email → phone → address → insurance, one question each, confirmed back, **saved immediately per item** (hang-up-resilient). Tool results steer the model each turn ("Saved. Still missing: … ask for the NEXT item: phone"). |
| **Provider assignment (spec §3.2)** | `book_appointment` assigns the least-loaded provider covering the booked location; stored on the appointment, spoken to the caller, written into the chart note. Reschedule re-assigns on location change. Provisional until the clinic's provider-level grid exists (§7.1). |
| **Availability grids** | Provisional office grids added for `follow_up` (Mon–Fri 9–3, 8/day) and `pft`/`sixmwt` (Mon–Fri 9–4, 4/day) — reschedules and follow-up bookings no longer dead-end at "no availability configured". 70 rules seeded (was 40). |
| **Stub eligibility verifies stated payer** | New-patient records are born `insuranceStatus: unknown`, so verification could never pass → no new patient could ever book. The stub now simulates verification from the payer the caller states; payer names containing "HMO"/"Medicare" still exercise the HMO-block and Medicare-auth-exempt policy paths. Replaced wholesale by the eligibility-partner integration at the existing adapter seam. |

### New vs returning patients

- `identify_patient` no longer silently creates a record on no-match (the duplicate-chart bug). It returns `needsConfirmation`; the agent re-confirms spelling + DOB, asks "are you a new patient with us?", and only then retries with `confirmedNewPatient: true`.
- Returning → "Welcome back", default follow-up visit. New → "Looks like you're new with us — welcome!", default new-patient visit, full demographics expected.
- Outbound agents can never create records: DOB mismatch → escalate, never "are you new?".

### Squad conversation UX

- **Personas:** front desk = **Mark**, scheduling = **Linda** (Clara voice on all three scheduling-persona assistants). Both answer to their names, never "phone agent"/"AI".
- **Greeting:** "Welcome to The Pulmonology Group — I'm Mark. This call may be recorded for quality assurance purposes. If this is a medical emergency, please hang up and dial nine-one-one immediately…"
- **Recording disclosure hardening (legal):** greeting is interruptible (`firstMessageInterruptionsEnabled: true` — was impossible to barge into before), but the disclosure must be spoken once on every call: if cut off, it is delivered in the next turn, and when the next action is a handoff it is the LAST thing said (silent handoff after — no stacked announcements).
- **Instant handoff:** the moment scheduling intent is heard, Mark hands to Linda in the same turn — permission questions ("shall I transfer you?") are forbidden at both the prompt and the squad-destination-description level. Linda's first message greets AND asks (name + DOB) so the call never stalls after transfer.
- **Barge-in tuning:** `stopSpeakingPlan` numWords 2→1, backoff 1→0.5 s — a single word interrupts and the agent yields faster.
- **"I want a human" at Linda** no longer bounces back through Mark's full re-greeting: Linda carries `transfer_to_staff` and routes directly after one friendly retention attempt. (Residual known limitation: genuine topic-change hand-backs still replay the receiving assistant's greeting — Vapi squad behavior.)

### Demo transfer mode (staff DIDs don't exist yet)

`DEMO_TRANSFER_MODE=true`: an in-hours successful routing **announces the named owner** ("I'm transferring you to Sakshi, who handles that — one moment, please") or a caller-matched role via `specialistLabel` ("medication refill specialist", "prior authorization specialist", "billing specialist", verbatim "I understand. Please hold on while I transfer you to the next available staff member."), then **ends the call as a simulated handoff** (`say` + `endCallAfterSpoken`). Routing outcome still lands in the backend (flag routed to the correct §2 extension + chart note) for the demo dashboard. Off-hours keeps the intake+flag path. Flag off → previous behavior; real DIDs later use the already-built live-transfer leg.

### Off-hours flags — guaranteed, stamped, deduplicated

- Failed/off-hours `transfer_to_staff` **writes a minimal flag immediately** (survives instant hang-ups); a later `escalate_to_staff` on the same call **enriches that flag** instead of duplicating.
- Every flag stamped with `offHours: true/false` + clinic-local time (`America/Los_Angeles`) for morning triage.
- **Silent-hang-up net:** an off-hours inbound call ending `spoke_no_appt` with zero flags gets auto-flagged from the call analysis in the end-of-call webhook.

### STT / voice understanding upgrades

- **Keyterms 40 → 62:** insurance payers (PPO, HMO, UnitedHealthcare, Blue Cross Blue Shield, Anthem, Humana, Medicaid, Culinary Health Fund), 9 more pulm meds, equipment/procedures (BiPAP, APAP, nebulizer, oximeter, spirometry, polysomnography), admin terms, all remaining provider names, all 8 staff owner names (fixes "Sakshi" vanishing from transcripts). Driven by real-call misses ("Blue Cross **TPO**").
- **`smartFormat: true`** (digits/dates) and **Gladia `fallbackPlan`** (auto-failover if Deepgram degrades mid-call).
- **Domain-repair prompt rule:** garbled word → interpret toward clinic domain and offer a choice ("TPO → was that PPO or HMO?").
- **Cross-handoff number re-confirmation:** values rattled off before a handoff must be re-confirmed one at a time by the receiving assistant (fixes the instant-handoff × digit-discipline seam found by the fast-talker sim).

### Conversation polish

- Locations answered **city-first** ("Henderson and Summerlin — is one closer to you?"); full street address only when asked or when confirming a booking.
- **Warm callback language** everywhere a follow-up is promised: "I've noted everything down, and I'm getting this to the right person as soon as possible — they'll reach out just as soon as they can." Never a fixed SLA; robotic phrasings banned. Same text in the `FLAG_PROMISE`, `escalate_to_staff` result, and shared prompt rule.
- Full-name letter-by-letter spell-back required EVERY time a name is collected (was: last name, conditionally).

### Tooling / ops

- **`pnpm dev:live`** (new `scripts/dev-live.ts`): one command → starts `next dev` + ngrok if down, reads the tunnel URL from ngrok's API, rewrites `APP_BASE_URL` in `.env` + `.env.local`, runs `vapi:sync`. `pnpm dev:down` stops both. Kills the stale-ngrok-URL 404 failure class (which broke live tools twice today before the script existed).
- `docs/UAT_Test_Scenarios.md`: 25+ scripted break-it scenarios for Dr. Sayal's staff (basics, booking, safety rails, HIPAA probing, prompt injection, routing, experience checks) with expected behavior + "it broke if…" per case and a reporting template.
- Spec updated: §3.1 (disclosure rule, no-permission handoffs) and §3.2 (implemented behavior per call type, incl. new PA-status and insists-on-human rows).

## Verification

- **Unit/DB tests: 59/59** (was 49) — new coverage: demographics unblock chain, stated-payer HMO block, new/returning/needsConfirmation lifecycle, auto-flag → enrich chain, provider assignment, clinicContext stamps. Typecheck clean.
- **STT suite: 10/10** after upgrades (fast-talker case failed twice, root-caused to the handoff seam, fixed, single-case retry passed). Policy suite (15) last run in full on 07-07; spot-verified today via live calls.
- **Live calls verified today** (Neon side effects checked): demo CPAP call → classified DME → "transferring you to Sakshi" → simulated hang-up → flag routed ext 434; new-patient booking flow (David Miller) through demographics collection; interrupted-greeting disclosure recovery; human-request routing; outbound dial to an external number via squad.

```bash
pnpm dev:live                                        # env up + URL sync in one command
pnpm typecheck && pnpm test                          # 59/59
pnpm vapi:simulate -- --target=synced --transport=voice              # all 25 cases
pnpm vapi:simulate -- --target=synced --transport=voice --suite=stt  # 10/10 today
```

## Remaining Production Blockers

1. All items from 07-07 still stand: Vapi BAA + HIPAA posture (Neon/Clerk/Vercel), real `EMERGENCY_PAGE_NUMBER` in deployed env, **stable deploy (Vercel) + re-sync + full 25-case re-run**, Coval agent id, one live in-hours transfer with a real staffed DID, DB side-effect assertions in synced sim runs.
2. `DEMO_TRANSFER_MODE=true` must be **off in production** (real DIDs replace simulated hang-ups).
3. Stub eligibility "verify from stated payer" is demo-only — eligibility partner integration replaces it.
4. Outbound context-pack redesign (agent receives attempt history, prior notes, preferred times, gaps; verify-only DOB tool; `/dashboard/outbound` trigger UI) — designed today, not yet implemented.
5. Squad hand-back re-greeting (topic changes Linda → Mark) — known Vapi limitation, cosmetic.
6. Policy suite (15 cases) not re-run in full since 07-07 — run once before the Dr. Sayal demo.
