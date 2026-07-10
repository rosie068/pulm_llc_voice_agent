# Phone Agent Spec \- Pulmonology Group LLC 

---

## 1\. Knowledge base (agent Q\&A source \+ engineer load)

**Practice:** The Pulmonology Group LLC  
Main 702-780-0300 · Fax 702-608-4977 · Fax-back 725-780-4451 · NPI 1245984673

**Providers** | Provider | Role | Locations | |---|---|---| | Vikas Sayal | MD | NV / SM | | Samantha Przybylski ("Sam") | NP | NV & SM | | Arlene Roberts | NP | NV & SM | | Omar Gabriel | NP | BHC | | Colleen Rose | NP | BHC | | John Joseph De Guzman | NP | SM (works out of hospital) | | Steven Harker | NP | SM |

**Locations** (codes used throughout the SOP/sheets) | Code | Site | Address | Phone / Fax |   
| **NV** | Henderson | 2970 West Horizon Ridge Pkwy, Henderson, NV 89052 | main line |   
| **SM** | Summerlin | 2501 Fire Mesa St, Suite 150, Las Vegas, NV 89128 | main line | 

**Self-pay pricing** (agent quotes to self-pay callers only)   
| Service | Cash price | |---|---|   
| New patient | $350 |   
| Follow-up | $200 |   
| 6-minute walk test (6MWT) | $150 |   
| PFT | $200 |   
| Allergy test | $400 |   
| Sleep study — in lab | $1,000 |   
| Sleep study — at home (HST) | $600 |

---

## 2\. Routing directory (extensions)

The agent routes to the offshore owner by topic.

| Ext | Person | Owns |
| :---- | :---- | :---- |
| 419 | Ryan | Confirmations & rescheduling |
| 430 | Anita | BHC scheduling |
| 431 | Bharani | Incoming calls & 501 VMs |
| 432 | Kedareshari | Incoming calls & NV–SM scheduling |
| 434 | Sakshi | Incoming calls & DME |
| 435 | Kevin | Incoming calls |
| 436 | Sneha | NP calls — Intermountain & Echo-Doppler |
| 438 | Prinsu | NP calls — all other PCP & SS-Allergy |

---

## 3\. Inbound agent

### 3.1 Incoming-call protocol

- Agent answers **live, 24/7**; concurrency handled natively. Because every call is picked up, there are effectively **no missed inbound calls and no inbound voicemail queue**  
- **Never transfer before hearing the caller's concern**  
- After every resolved call: write a **memo-to-record note in Tebra and mark Complete**

### 3.2 Call types → agent action

| Call type | Agent does | Human takes over when… |
| :---- | :---- | :---- |
| **General Q\&A** (hours, location, services, prep, self-pay price) | Answers from §1 knowledge base | Clinical / medical-advice question |
| **New appointment** | Verify insurance active \+ not HMO, confirm referral on file if required, obtain any missing demographics, book per §5 matrix, assign provider/location | Missing info the caller can't supply → note \+ route; insurance issue it can't clear |
| **Reschedule** | Locate appt, rebook, update Tebra | — |
| **Cancel** | Cancel in Tebra \+ memo note; log \~1-week follow-up (feeds outbound) | — |
| **Confirmation callback** (patient returning an outbound reminder call) | Update status Confirmed/Rescheduled/Cancelled, complete note | — |
| **Medication refill** | Capture drug \+ pharmacy, route to owner (Cover My Meds → Angela) | Always — agent does **not** run PA or obtain signature |
| **Copay / eligibility** | Check via eligibility partner; may quote copay / unmet deductible | Complex coverage dispute → route |
| **Complaint / billing** | Capture details, share available info, then act or route to overseas team | Anything requiring account changes / clinical resolution |
| **Anything else / low confidence** | Capture and hand off per §3.3 (live route in-hours, UI flag off-hours) | Always |

### 3.3 Handoff & staff flagging — availability-aware (replaces VM handling)

The "route to human" boundary is unchanged (signatures, clinical judgment, auth creation, low confidence, complaints/billing). What changes is the **mechanism**, which depends on whether a human is reachable:

| Situation | Agent behavior |
| :---- | :---- |
| **Business hours, owner available** | Transfer to the correct extension (§2); Teams tag the owner. |
| **Off-hours, or transfer goes unanswered** | Agent does **not** dump to voicemail and does **not** promise a transfer that can't happen. It resolves everything it can on the call, captures full details (name, DOB, phone, reason, any action taken), and **raises an in-app flag in the TriFetch UI and Teams message** for staff to action at the next business period. |

The agent always tells the caller what happens next honestly ("someone from the team will follow up," not a fixed "within 24 hrs" it can't guarantee off-hours). Every flag carries the captured intake so staff can act without re-calling the patient for basics. This UI flag is the same surface used for physician-signature and review items — one queue staff check when they're back.

### 3.4 Scheduling verification (before booking)

- Insurance **active and current**; **not HMO** (HMO needs insurer/PCP referral first).  
- If plan requires a referral, confirm one on file (referral log document).  
- Studies: confirm **active auth** before scheduling — check Tebra notes / the sheet / **Sanjay's notes** for approval; **Medicare \= no auth needed**. (SOP §5.1.9, §5.2.4–5.2.5)  
- Missing email / phone / address / insurance → **do not schedule**; note it and ask the caller to obtain it first. (SOP §3.6)

### 3.5 Incoming Call Referrals sheet — color coding (SOP §8.7)

Agent logs every inbound call here by EOD; **no row left white**. | Color | Meaning | |---|---| | Green | Scheduled or concern resolved | | Red | Denied / DND / passed away / cancellation | | Yellow | Left voicemail | | Blue | Spoke with patient/caller but no appointment scheduled |

### 3.6 Escalation / hard stops (agent must NOT self-serve)

- Any clinical or triage question (e.g., shortness of breath) → escalate; if urgent, direct to ER and flag staff. **True emergencies are the one exception that must page a live human even off-hours — do not defer an emergency to a UI flag.**  
- Provider signature or a decision on abnormal labs/imaging → capture \+ hand off per §3.3.  
- Auth creation/appeal → hand off per §3.3 (prior-auth is a separate phase).

---

## **4\. Outbound agent**

### **4.1 Workstreams** 

1. **Referral log** (NP & EPIC referral sheets) \- Yellow rows \[*voicemail already left*\]  
   1. [Google Sheet](https://docs.google.com/spreadsheets/d/1YKaLo6ZE9hWU5RsRKFpqVa47p9sAlS3ZCpN_HRyfRy4/edit?usp=sharing)  
2. **Sleep Study log** (HST / PSG / Titration-Split) \- Orange rows \[to be scheduled\]  
   1. [Henderson](https://docs.google.com/spreadsheets/d/18t1YudieaJgKigrLWTRVIe7nsBfKDEScAM2JCmHgWh8/edit?gid=0#gid=0)  
   2. [Summerlin](https://docs.google.com/spreadsheets/d/162r60tZVzyi8k_-nEM4saiLwUDLtYPD89FV770vXIp8/edit?usp=sharing)

Within each, the agent calls **only the rows in each target color** and leaves every other row untouched — nothing still pending insurance/auth, and (on the sleep sheet) never the white "no auth" rows.

**Phased — later, out of this week's scope (SOP-defined, confirm before build):** 3\. **Echo & Doppler** and **Allergy** study scheduling. 4\. **Appointment confirmation** — 24–48 hr reminders (SOP §1). 5\. **Missed-appointment recovery** — no-show/cancelled since 1 Mar 2026 (SOP §2). 6\. **Follow-up scheduling** — checked-out patients since 1 Jan 2026 (SOP §6).

### **4.1a Required input from the clinic (blocking for the referral side)**

The agent can only offer slots it knows are bookable. The clinic must provide a **booking-availability schedule: which appointment types can be booked, on which days/times, at which location, under which provider, and for how long** — plus how open slots are identified in Tebra.

* **Sleep study side** is largely covered by the SOP (nights/capacity in §4.3) — needs confirmation only.  
* **Referral side (office visits — new patient / consult)** is the real gap: no availability grid exists yet. Needed before the referral outbound agent can book. (This is the "detailed scheduling doc" staff promised on the visit.)

### **4.2 Call-target color by sheet — AUTHORITATIVE (per SOP \+ this-week scope)**

Full SOP legend below. **This week's targets: referral log \= yellow, sleep study \= orange** (highlighted). On the sleep sheet, **white \= no auth — do not touch.**

| Sheet | This week's target | Full legend |
| ----- | ----- | ----- |
| **NP & EPIC referrals** | **Yellow** (VM-left backlog; follow-up calls) | White \= never contacted (out of scope this week) · Yellow \= VM left · Green \= scheduled · Red \= declined/DND/passed · Violet \= unreachable/out-of-service · cap 10 |
| **Sleep Study** | **Orange** ("to be sxld") | White \= no auth (do not touch) · Orange \= ready → call · Pink \= scheduled · Red \= declined · cap 7 |
| **Echo & Doppler** *(later)* | — | Orange \= ready · Yellow \= auth pending · White \= no auth (skip) · Green \= done · Pink \= scheduled · Red \= declined · 7 → Teal |
| **Allergy** *(later)* | — | Brown \= ready · same combos as sleep · Pink \= scheduled |

**Sleep sub-type note (resolved):** orange is the target gate. The SOP's per-sub-type "workable" colors (HST \= stark blue, PSG \= pink, Titration/Split \= teal green) are **not** used for targeting; sub-type is read from the sheet's study-type column. Minor engineer check: confirm a study-type column exists on the sleep sheet — if not, the sub-type colors are the fallback way to tell HST/PSG/Titration apart.

*This week the agent acts only on the **NP & EPIC referrals** and **Sleep Study** rows above; Echo/Doppler and Allergy are reference for later phases.*

### **4.3 Study scheduling matrix (days / location / limits / Tebra fields)**

*This week, only the **Sleep** rows are in scope. Echo/Doppler, Allergy, and PFT/6MWT rows are reference for later phases.*

| Study | When | Location rule | Capacity | Tebra fields | Prep to read on call |
| ----- | ----- | ----- | ----- | ----- | ----- |
| **Echo & Doppler** *(later)* | Alternate Wed from 06/17/2026, 8:30 AM–2:00 PM | — | — | Staff \= **Echo tech**; Reason \= **Echo or doppler US** | Schedule F/U ≥4 wks after test, ideally same call; no-date rows OK if orange |
| **Sleep — HST** (home) | Daytime | — | **Max 7 schedulings/day** | Staff \= **MA** | Device pickup/return (e.g., Fri→Mon); write return date; ask return time; someone may drop off |
| **Sleep — PSG** (in-lab, overnight) | 8:30–9:30 PM, ends \~5 AM | **NV:** Mon–Sun (Sun/Mon 3 each; Tue–Sat double-book 6). **SM:** Fri/Sat/Sun, 3/night | as above | — | Shower; no lotion/perfume/cologne; comfy clothes, no silk/satin; take nighttime meds as usual; bring sleep aid/melatonin; may bring own pillow/blanket |
| **Sleep — Titration / Split** (in-lab) | overnight | as PSG | as PSG | — | as PSG |
| **Allergy test** *(later)* | Any day under **Dr. Sayal**; **SM: Dr./Arlene Tue & Thu only, 9 AM–4 PM**; never post-hours | — | **4–5/day**; 45-min appt | under Dr. Sayal | **Off all allergy meds 1 week prior**; allergens rubbed on back, patient sits in room for duration; may split environmental \+ food across visits by insurance |
| **PFT / 6MWT** | Daytime | in office | — | — | **No auth**; usually inbound reschedule/cancel calls |

### **4.4 Referral scheduling flow (this week: yellow backlog)**

Target **yellow** rows (patients already left ≥1 VM). Call as a **follow-up** ("calling you back to get you scheduled"), continuing the attempt count toward the **cap of 10** (does not reset). Outcomes: scheduled → **green**; declined/DND/other-pulm/passed/not-interested → **red** \+ note; unreachable/out-of-service → note \+ Teams for alternate PCP channel → **violet**. Every attempt gets a memo-to-record note (date/time/initials); sheet current by EOD. **White (never-contacted) rows are not worked this week** — confirm first-touch owner. *(Prerequisite: chart already created from the referral — upstream referral/fax workflow, not phone scope.)*

### **4.5 Confirmation / missed-appt / follow-up flows (SOP §1, §2, §6)**

* **Confirmation:** target 24–48 hr window (and confirmed patients lacking a confirmation note in last 24 hrs). Confirms → status **Confirmed**; cancel/resched → status **Cancelled/Rescheduled**; no answer → VM \+ status **Reminder Sent**. Note every outcome with date/time/initials.  
* **Missed-appt recovery:** pull cancelled/no-show (and rescheduled-but-never-actually) across BHC/NV/SM since 1 Mar 2026; call to rebook.  
* **Follow-up:** pull checked-out appts since 1 Jan 2026; call to schedule FU.

### **4.6 Tebra note discipline (all outbound)**

Every attempt/outcome → **memo-to-record note with date, time, and initials/agent tag**. Confirmation calls: **Complete** on resolution; **Save & Close** when status \= Reminder Sent (reopen and Complete if the patient calls back). Update the correct sheet's color \+ attempt columns by EOD. (SOP §1.3–1.5, §4.7)

---

## **5\. Duty distinction — explicit start / end**

**Inbound agent** — starts when a call is picked up (live, 24/7 — no voicemail queue); ends at either (a) a completed self-service action (booked / rescheduled / canceled / confirmed / question answered / copay quoted), or (b) a clean handoff for anything needing a **signature, clinical judgment, auth creation, or that it can't confidently resolve** — routed to a live human in-hours, or **raised as an in-app UI flag off-hours** (never a dead-end voicemail). Emergencies page a live human regardless of hour.

**Outbound agent** — starts only against rows the sheet marks **ready-to-schedule** (per §4.2) with **active auth verified**; ends when the appointment is **booked and Tebra \+ the sheet are updated**, or after the sheet's attempt limit (**10** referrals / **7** studies). It does **not** create auth, resolve eligibility, or make clinical decisions.

**Always human, never the agent:** provider signatures; clinical decisions on abnormal results; prior-auth submission/appeal; any edge case the agent flags.

---

## **6\. What the SOP now resolves (previously open)**

* ✅ Call-target colors (per-sheet, §4.2) — replaces the yellow/orange flag.  
* ✅ Routing owners \+ extensions (§2).  
* ✅ Scheduling days/locations/capacity by study type (§4.3).  
* ✅ Attempt limits, note discipline, sheet color updates.  
* ✅ Knowledge base: providers, locations, contacts, self-pay pricing (§1).  
* ✅ Auth-verification rule before study scheduling (Sanjay's notes / Medicare exception).

## **7\. Open items / decisions needed**

**Resolved:** this-week outbound \= referral-log **yellow** backlog \+ sleep-study **orange** backlog. Sleep color contradiction closed — **orange is the gate**. Remaining before build:

1. **Booking-availability schedule from the clinic (blocking for referrals):** required grid of appointment type × day/time × location × provider × duration, plus how open slots are read in Tebra. Sleep side is mostly covered by SOP (confirm); **office-visit / referral availability does not exist yet and is needed to book the referral backlog** (§4.1a).  
2. **First-touch owner for white referral rows:** since this week's referral target is yellow (already-VM'd), confirm who handles never-contacted **white** rows so they don't stall.  
3. **Attempt limit for referrals:** SOP §4.6 says **10**; Dr. Sayal said "minimum 7" on the visit. Confirm (using 10 referrals / 7 studies pending your word).  
4. **Sheet inventory \+ write access:** exact tabs (Henderson vs Summerlin sleep logs; EPIC vs NP referral sheets), plus whether the sleep sheet has a study-type column (§4.2 note), and agent write permissions.  
5. **Login / verification-code forwarding** for Tebra/RingCentral/portals so the agent can act on rotating browsers (infra dependency for Tebra \+ sheet writes).

*Deferred with the phased streams: Echo/Doppler hours (SOP alternate-Wed 8:30–2:00 vs transcript Wed-AM Henderson-only), confirmation/missed-appt/follow-up scope.*

