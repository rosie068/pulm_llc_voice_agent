# Voice Agent Spec — Pulmonology Group LLC

> Distilled from `Pulm_LLC_Phone_SPEC.md`. **Scope: voice-agent behavior only** — what the agent says, asks, decides, and escalates on a call. All system integrations (Tebra, Google Sheets, Teams, TriFetch UI, eligibility partner, logins) are out of scope here; where the agent would touch a system, this doc records the *decision/output* the agent must produce, not the mechanism.

---

## 1. Knowledge base (agent answers from this)

**Practice:** The Pulmonology Group LLC
Main 702-780-0300 · Fax 702-608-4977 · Fax-back 725-780-4451 · NPI 1245984673

### Providers

| Provider | Role | Locations |
|---|---|---|
| Vikas Sayal | MD | NV / SM |
| Samantha Przybylski ("Sam") | NP | NV & SM |
| Arlene Roberts | NP | NV & SM |
| Omar Gabriel | NP | BHC |
| Colleen Rose | NP | BHC |
| John Joseph De Guzman | NP | SM (works out of hospital) |
| Steven Harker | NP | SM |

### Locations

| Code | Site | Address | Phone |
|---|---|---|---|
| NV | Henderson | 2970 West Horizon Ridge Pkwy, Henderson, NV 89052 | main line |
| SM | Summerlin | 2501 Fire Mesa St, Suite 150, Las Vegas, NV 89128 | main line |

### Self-pay pricing (quote to self-pay callers only)

| Service | Cash price |
|---|---|
| New patient | $350 |
| Follow-up | $200 |
| 6-minute walk test (6MWT) | $150 |
| PFT | $200 |
| Allergy test | $400 |
| Sleep study — in lab | $1,000 |
| Sleep study — at home (HST) | $600 |

---

## 2. Routing topics (who owns what)

Agent must classify the caller's topic to the right owner. (Actual transfer mechanics = integration; the agent's job is correct classification.)

| Topic | Owner (ext) |
|---|---|
| Confirmations & rescheduling | Ryan (419) |
| BHC scheduling | Anita (430) |
| Incoming calls & 501 VMs | Bharani (431) |
| Incoming calls & NV–SM scheduling | Kedareshari (432) |
| Incoming calls & DME | Sakshi (434) |
| Incoming calls | Kevin (435) |
| NP calls — Intermountain & Echo-Doppler | Sneha (436) |
| NP calls — all other PCP & SS-Allergy | Prinsu (438) |

---

## 3. Inbound agent

### 3.1 Core conversational rules

- Answers **live, 24/7** — every call picked up, no voicemail queue.
- Greeting includes the **recording disclosure** ("this call may be recorded for quality assurance purposes") and the 911 emergency notice. The greeting is interruptible, but the disclosure is **legally required on every call**: if the caller cuts it off, the agent delivers it in its next turn before anything else continues (exception: active emergency → 911 first).
- **Never transfer before hearing the caller's concern.** Once the concern is clear, scheduling handoffs happen immediately — no "shall I transfer you?" permission questions.
- Always tell the caller honestly what happens next ("someone from the team will follow up" — never promise a fixed "within 24 hrs" the agent can't guarantee off-hours).
- End of every resolved call: agent produces a **call summary note** (memo-to-record content — date, time, action taken). *(Writing it into Tebra = integration.)*

### 3.2 Call types → agent behavior

| Call type | Agent does *(as implemented)* | Escalate when… |
|---|---|---|
| **General Q&A** (hours, location, services, prep, self-pay price) | Answer from §1. Locations: city/area first ("Henderson and Summerlin"), full street address only when asked. Self-pay prices quoted ONLY to callers who say they're uninsured / ask cash price | Clinical / medical-advice question |
| **New appointment** | Front desk (Mark) hands to scheduler (Linda) instantly — no permission question. Linda: spell back full name letter-by-letter; detect **new vs returning** (returning → "Welcome back", default follow-up; no record → confirm "are you a new patient?" before creating one, then default new-patient visit). Run §3.4 checklist (enforced in code by book_appointment); collect missing demographics ONE at a time (email → phone → address → insurance), saving each immediately; book per §5; **assign provider + location**; read prep script in full | Missing info caller can't supply; insurance issue agent can't clear |
| **Reschedule** | Identify (name + DOB spell-back), locate appt, offer new slots from find_slots only, rebook; provider re-assigned if location changes | — |
| **Cancel** | Cancel + note; ~1-week follow-up queued automatically (feeds outbound) | — |
| **Confirmation callback** (patient returning outbound reminder) | Update status Confirmed / Rescheduled / Cancelled | — |
| **Medication refill** | Verify identity, capture exact drug + pharmacy (capture_refill), then route to "medication refill specialist" (demo: simulated transfer + hang-up; prod: staff transfer). Never promises the refill, never medication advice | Always — agent never runs PA or obtains signatures |
| **Prior-auth question / status check** | Never answers PA status. Capture who + what, route to "prior authorization specialist" (demo: simulated transfer) | Always — PA work is staff-only |
| **Copay / eligibility** | quote_copay; if unverifiable, warm escalate — never guesses dollar amounts | Complex coverage dispute |
| **Complaint / billing** | Listen fully, capture details (name, DOB, callback, what happened, what they want), escalate to billing. No promised refunds/write-offs/timeframes | Anything requiring account changes / clinical resolution |
| **Caller insists on a human** | One brief attempt to learn the reason, then no arguing: "I understand. Please hold on while I transfer you to the next available staff member." (demo: simulated transfer) | — |
| **Anything else / low confidence** | Capture full intake, hand off per §3.3; failed/off-hours transfers auto-create a flag immediately (survives hang-ups), stamped off-hours + clinic-local time | Always |

### 3.3 Handoff logic (availability-aware)

Route-to-human boundary: **signatures, clinical judgment, auth creation, low confidence, complaints/billing.**

| Situation | Agent behavior |
|---|---|
| Business hours, owner available | Hand off to correct topic owner (§2) |
| Off-hours, or handoff unanswered | Do **not** dump to voicemail; do **not** promise a transfer that can't happen. Resolve what it can on the call, capture full intake (name, DOB, phone, reason, action taken), flag for staff to action next business period |

Every flag must carry complete intake so staff never re-call the patient for basics.

### 3.4 Verification checklist (before booking any appointment)

1. Insurance **active and current**.
2. **Not HMO** — HMO requires insurer/PCP referral first.
3. If plan requires referral → confirm one on file.
4. Studies: confirm **active auth** before scheduling. Exception: **Medicare = no auth needed**.
5. Missing email / phone / address / insurance → **do not schedule**; note it, ask caller to obtain it first.

### 3.5 Call outcome classification

Agent classifies every inbound call's outcome (drives downstream logging):

| Outcome | Meaning |
|---|---|
| Resolved/Scheduled | Scheduled or concern resolved |
| Denied/Closed | Denied / DND / passed away / cancellation |
| VM left | Left voicemail |
| Spoke, no appt | Spoke with patient/caller but no appointment scheduled |

### 3.6 Hard stops (agent must NOT self-serve)

- **Clinical or triage question** (e.g., shortness of breath) → escalate; if urgent, direct to ER and flag staff. **True emergencies must page a live human even off-hours — never defer an emergency to a flag.**
- Provider signature, or decision on abnormal labs/imaging → capture + hand off.
- Auth creation/appeal → hand off (prior-auth = separate phase).

---

## 4. Outbound agent

### 4.1 Workstreams (this week)

1. **Referral backlog** — patients already left ≥1 voicemail; call as follow-up.
2. **Sleep study backlog** — patients ready to be scheduled (active auth confirmed).

Agent calls **only rows marked ready** for its workstream — never anything pending insurance/auth. *(Row selection by sheet color = integration; the rule the agent embodies: only call ready-to-schedule patients with verified auth.)*

Later phases (out of scope now): Echo & Doppler, Allergy scheduling, appointment-confirmation reminders, missed-appointment recovery, follow-up scheduling.

### 4.2 Referral follow-up call flow

- Frame as follow-up: *"calling you back to get you scheduled."*
- Attempt count continues toward **cap of 10** (does not reset).
- Outcomes the agent must classify:
  - **Scheduled** → success
  - **Declined / DND / went to other pulm / passed away / not interested** → closed + note
  - **Unreachable / out-of-service number** → note + flag for alternate-PCP outreach
- Every attempt produces a note (date/time/agent tag).

### 4.3 Sleep study call flow

- Attempt cap: **7**.
- Sub-type (HST / PSG / Titration-Split) determines scheduling rules and prep script (§5).
- Only call patients with **active auth verified** (Medicare exempt).

### 4.4 Duty boundaries

- **Starts:** only against patients marked ready-to-schedule with active auth verified.
- **Ends:** appointment booked (and outcome recorded), or attempt cap reached (10 referrals / 7 studies).
- Agent does **not** create auth, resolve eligibility, or make clinical decisions.

---

## 5. Scheduling rules & prep scripts (agent reads on call)

*This week: only Sleep rows in scope. Others = reference for later phases.*

| Study | When | Location rule | Capacity | Prep script to read to patient |
|---|---|---|---|---|
| **Sleep — HST** (home) | Daytime | — | Max 7 schedulings/day | Device pickup/return (e.g., Fri→Mon); confirm return date & time; someone may drop off device |
| **Sleep — PSG** (in-lab, overnight) | Arrive 8:30–9:30 PM, ends ~5 AM | **NV:** Mon–Sun (Sun/Mon 3/night; Tue–Sat double-book 6). **SM:** Fri/Sat/Sun, 3/night | As per location rule | Shower before; no lotion/perfume/cologne; comfy clothes, no silk/satin; take nighttime meds as usual; bring sleep aid/melatonin if used; may bring own pillow/blanket |
| **Sleep — Titration / Split** (in-lab) | Overnight | Same as PSG | Same as PSG | Same as PSG |
| **Echo & Doppler** *(later)* | Alternate Wed from 06/17/2026, 8:30 AM–2:00 PM | — | — | Schedule follow-up ≥4 wks after test, ideally same call |
| **Allergy test** *(later)* | Any day under Dr. Sayal; SM: Dr./Arlene Tue & Thu only, 9 AM–4 PM; never post-hours | — | 4–5/day; 45-min appt | **Off all allergy meds 1 week prior**; allergens rubbed on back, patient stays in room for duration; may split environmental + food across visits per insurance |
| **PFT / 6MWT** | Daytime | In office | — | No auth needed; usually inbound reschedule/cancel |

---

## 6. Duty distinction — explicit start / end

**Inbound agent** — starts when call picked up (live, 24/7); ends at (a) completed self-service action (booked / rescheduled / canceled / confirmed / question answered / copay quoted), or (b) clean handoff for anything needing **signature, clinical judgment, auth creation, or low confidence**. Emergencies page a live human regardless of hour.

**Outbound agent** — starts only against ready-to-schedule patients with active auth verified; ends when appointment booked and outcome recorded, or attempt cap reached (10 referrals / 7 studies). Never creates auth, resolves eligibility, or makes clinical decisions.

**Always human, never the agent:** provider signatures; clinical decisions on abnormal results; prior-auth submission/appeal; any flagged edge case.

---

## 7. Open items affecting voice behavior

1. **Booking-availability schedule (blocking for referral outbound):** need grid of appointment type × day/time × location × provider × duration. Sleep side mostly covered above (confirm); office-visit/referral availability does not exist yet.
2. **Attempt limit for referrals:** SOP says 10; Dr. Sayal said "minimum 7" on visit. Using 10 pending confirmation.
3. **First-touch owner for never-contacted referrals:** this week targets already-VM'd patients only; confirm who handles first-touch.

---

## Out of scope (integration — tracked in `Pulm_LLC_Phone_SPEC.md`)

- Tebra: memo-to-record writes, Complete / Save & Close, booking writes, status updates
- Google Sheets: referral & sleep logs, color-coding updates, attempt columns, sheet inventory / write access / study-type column check
- Teams tagging & messages; TriFetch UI flag queue mechanics
- Phone transfer plumbing (RingCentral extensions)
- Eligibility-partner copay lookup integration
- Login / verification-code forwarding for Tebra/RingCentral/portals
- Upstream referral/fax chart creation
- Deferred phases: Echo/Doppler, Allergy, confirmations, missed-appt recovery, follow-up scheduling; prior-auth phase
