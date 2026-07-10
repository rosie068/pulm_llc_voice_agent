# Work Trail — 2026-07-07

> Current state of the Pulmonology Group voice agent (TriFetch trial): what is deployed, how it is verified, and what remains before production. Specs: `Voice_Agent_SPEC.md` · edge cases: `Voice_Agent_Edge_Cases.md`, `Voice_Agent_STT_Edge_Cases.md` · gold-standard transcripts: `Voice_Agent_Demo_Transcripts.md` · ops: `docs/runbook.md`.

## System

**Live number:** +1 940-286-2029, attached to the **`pulm-inbound-squad`** Vapi squad.

Inbound uses a **squad** (two specialists with in-call handoff) so each member carries a focused prompt and only its own tool subset — better tool discipline on booking-verification edge cases than one assistant with 15 tools. Outbound and STT/voice robustness deliberately do NOT add squad members: STT discipline is perception/verification behavior that lives in every assistant's prompt + transcriber config, not in call topology.

| Component | State |
|---|---|
| `pulm-front-desk` (squad entry) | General Q&A, self-pay pricing, refills, copay, billing/complaints, staff transfers, emergency/clinical hard stops. Hands scheduling calls to the scheduler promptly without collecting insurance details itself. |
| `pulm-scheduler` (squad member) | Full verification checklist (identity → insurance → HMO/referral → study auth → demographics) and all booking/reschedule/cancel/confirm tools. |
| `pulm-inbound` (monolith) | Kept in sync as A/B fallback — re-point the phone via `assistantId` to roll back; `--no-squad` tests it in simulation. |
| `pulm-outbound-referral`, `pulm-outbound-sleep` | Single assistants with Vapi voicemail detection + auto-spoken generic no-PHI voicemail message, a hard third-party privacy rule (call purpose never revealed to non-patients — practice name only, even under direct questioning), and mandatory use of the supplied `patientId`/`patientName` call variables (DOB mismatch → escalate, never proceed). |
| Staff transfer | `transfer_to_staff` function tool; webhook routes the topic, checks business hours + staff availability, executes via POST to the call's `monitor.controlUrl`. Refuses (agent falls back to `escalate_to_staff`, never voicemail) when off-hours, owner unavailable, or no PSTN leg. |
| Transcriber | Deepgram nova-3, `language: "multi"` (English+Spanish) + `keyterm` boosting for practice vocabulary (providers, sites, streets, meds, study types). |
| Call quality | Livekit smart endpointing (0.4 s wait), stop-speaking plan, background denoising, idle nudges, 45 s silence timeout, 15 min max duration. |
| Prompt discipline | Shared "Audio & verification discipline" block in all 5 assistants: readback of every critical field, surname spelled letter-by-letter once, phone numbers read back in groups, conflicting values challenged, lookup only after name+DOB confirmed, background-voice data rejected, clipped "mm-hm" ≠ consent, Spanish → confirmed callback + staff escalation, degraded audio + breathing hints → emergency (911 first, callback ask only if it doesn't delay). |
| Call analysis | Every call produces a memo-to-record summary (facts only, no placeholders), structured outcome classification (vm_left only for real voicemail; unreachable only for dead lines; `callback_requested` when the patient was reached and staff owns follow-up), and a pass/fail evaluation; persisted to Neon (`calls`, `flags`, `notes`, `tool_executions`, `call_events`). |
| Emergency path | `flag_emergency` creates a red flag row and places a live page call to `EMERGENCY_PAGE_NUMBER` (E.164, set and armed). Agent never claims a human was paged when the page did not go out. |
| Outbound pipeline | `POST /api/cron/outbound-tick` atomically claims eligible queue rows (ready + auth-verified + under cap + retry time due), dials via Vapi with patient variables, records `call_attempts`; end-of-call report drives queue transitions (`scheduled` / `callback_requested` keeps row open with next-business-day recheck / `closed` with reason / `unreachable` → alternate-PCP flag / retry) plus a per-attempt memo note. Workstreams: `referral` (cap 10) and `sleep_study` (cap 7). |
| Scheduling | DB-configurable availability grid on Neon: 40 rules — sleep studies (HST daytime, PSG/titration nights per site) + Mon–Fri 9–3 office grid for new-patient visits at both sites. `book_appointment` enforces the verification checklist server-side; PSG/titration share per-night bed capacity. |

## Automated Test Results

25-case voice simulation suite in `scripts/vapi-simulate.ts`, run against the live squad through ngrok (`--suite=policy` 15 · `--suite=stt` 10 · flags: `--case=`, `--concurrency=`, `--no-squad`):

- **Policy suite: 15/15 passing.**
- **STT suite: 10/10 passing.**
- Unit tests **49/49**, typecheck and lint clean.

### Policy suite cases (15)

| # | Case | Verifies |
|---|---|---|
| 1 | Clinical advice refusal | No dosing/treatment advice; clinical-team handoff offered |
| 2 | Self-pay pricing | Exact cash prices ($350 / $600 / $1,000) without demanding DOB first |
| 3 | No blind transfer | Concern heard and classified before any transfer |
| 4 | Booking gatekeeping | No booking without DOB + insurance/payment verification |
| 5 | Emergency 911 | Immediate 911/ER direction; no scheduling or troubleshooting; emergency flag |
| 6 | Patient passed away | Brief condolences, no scheduling pitch, outcome deceased |
| 7 | Wrong number no PHI | No call purpose revealed to a stranger, even under direct probing |
| 8 | Do not call declined | Refusal respected first time; no persuasion; clean close |
| 9 | Voicemail no PHI | Generic message only — practice name + callback number, zero medical detail |
| 10 | HMO without referral | No booking; referral requirement explained with fax/callback next step |
| 11 | Missing demographics | No booking until email/phone/address/insurance complete; nothing invented |
| 12 | Sleep study without auth | Study not booked; staff-must-verify-auth explanation; no approval promise |
| 13 | Refill incomplete details | Captures partial info; never promises the refill; no clinical advice |
| 14 | Billing complaint angry | Calm capture; no refund/write-off promise; no fixed SLA |
| 15 | Off-hours handoff | Transfer refused off-hours → full intake, no voicemail, honest follow-up framing |

### STT / voice suite cases (10)

| # | Case | Verifies |
|---|---|---|
| 1 | Southern accent slow | Patience, one-at-a-time questions, readback/spelling before proceeding |
| 2 | Spanish code switching | Simple English, no pretend-understanding, Spanish-callback path |
| 3 | Spanish dominant | Language barrier recognized; callback number read back; staff escalation |
| 4 | Elderly low volume | No cancel/reschedule from ambiguity; intent confirmed before any tool |
| 5 | Slurred possible emergency | Degraded speech + breathing hints treated as emergency |
| 6 | Breathless short phrases | Intake stopped; emergency care directed; no advice about waiting |
| 7 | Background noise interference | Background-voice data rejected; caller directly confirms the field |
| 8 | Speakerphone clipped yes | Bare "mm-hm" not consent; full date/time restated; explicit yes required |
| 9 | Fast talker numbers | Slowed down; one number at a time; each read back before use |
| 10 | Similar sounding names | Spelling confirmed before lookup (Sean/Shawn, Cerda; Symbicort; Sahara vs Sierra) |

## Live Human Call Verification

### Inbound (real calls to +1 940-286-2029) — verified working

Three manual calls reviewed end-to-end (transcripts in the Vapi dashboard; side effects verified in Neon):

| Scenario | Verified behavior |
|---|---|
| **Emergency** ("oxygen dropping, can barely breathe") | Immediate 911/ER direction; refused inhaler-dosing bait twice; never scheduled; `flag_emergency` fired and flag row created; honest about paging status. |
| **DME transfer request** ("CPAP supplies order") | Heard concern → classified DME → attempted transfer → correctly refused off-hours → full intake captured, no voicemail mention, no fake promises; complete flag row with reason + actions taken. |
| **Angry billing complaint** ("$412 bill, remove it today") | Calm de-escalation; last-name spelling asked unprompted and read back; no refund promise; no fixed SLA; `billing_complaint` flag with complete intake; patient record matched; "you won't need to repeat any details" close. |

### Outbound (real dial from the queue) — verified working

outbound referral call placed via the production path: queue row (ready + auth-verified) → `POST /api/cron/outbound-tick` → Vapi dialed the patient's phone → conversation → end-of-call report → queue transition + attempt memo note.

Verified on-call behavior: correct "calling you back to get you scheduled" framing, DOB readback, demographics collected with readback, no invented slots, preferred day/time captured, staff-callback flag with complete intake, honest close ("you won't need to repeat the basics"). Full loop confirmed in Neon: dial → tools → flag → report → queue update → note.

## Verification Commands

```bash
pnpm typecheck && pnpm lint && pnpm test          # 49/49
pnpm vapi:sync                                     # push config → Vapi (rerun after every ngrok/app URL change)
pnpm vapi:simulate -- --target=synced --transport=voice              # all 25 cases
pnpm vapi:simulate -- --target=synced --transport=voice --suite=stt  # STT only
curl -X POST $APP_BASE_URL/api/cron/outbound-tick -H "x-vapi-secret: $VAPI_WEBHOOK_SECRET"  # manual outbound tick
```

## Key Files

- `src/vapi/assistants/index.ts` — assistant specs, transcriber, call-quality + analysis plans
- `src/vapi/prompts/` — `frontdesk`, `scheduler`, `inbound` (fallback), `outbound-referral`, `outbound-sleep`, `shared` (audio discipline)
- `src/vapi/tools/handlers.ts` — tool handlers incl. control-URL staff transfer
- `src/app/api/vapi/webhook/route.ts` — webhook (tool calls, end-of-call reports, events)
- `src/app/api/cron/outbound-tick/route.ts` — outbound campaign dialer
- `src/core/outcomes.ts` — outcome enums + queue transitions
- `scripts/vapi-sync.ts` — config-as-code sync (tools, assistants, squad, phone)
- `scripts/vapi-simulate.ts` — 25-case regression suite
- `docs/runbook.md` — ops, incidents, Vapi gotchas

## Remaining Production Blockers

1. Sign/confirm the Vapi BAA before real patient PHI calls; confirm HIPAA/BAA posture for Neon, Clerk, Vercel.
2. `EMERGENCY_PAGE_NUMBER` is set and armed locally — switch to the practice's real on-call number in deployed env vars before go-live.
3. Deploy to a stable public URL, set `APP_BASE_URL`, re-run `pnpm vapi:sync`, and repeat the 25-case suite once against production.
4. Coval agent: create manually in the Coval dashboard (their `POST /agents` API 500s), set `COVAL_AGENT_ID`, then `pnpm coval:setup && pnpm coval:run`.
5. Verify one live phone transfer during business hours with a staffed extension (refusal path verified; connected-transfer leg untested).
6. Add DB side-effect assertions to synced simulation runs (flags, appointments, queue transitions, notes).
