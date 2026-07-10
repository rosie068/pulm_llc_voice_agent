# Compliance checklist — status

> Track before ANY real patient call. This app handles PHI.

- [ ] **Vapi BAA signed** — REQUIRED before real patient calls. Request via Vapi dashboard/support.
- [ ] HIPAA enabled org-wide in Vapi dashboard.
- [x] `compliancePlan.hipaaEnabled: true` on every assistant (set in `src/vapi/assistants/index.ts`, synced).
- [x] Model/voice/transcriber on the BAA-approved list (OpenAI gpt-4o / Vapi voice / Deepgram nova-3).
- [ ] Neon plan with BAA (Business/Enterprise) before storing real PHI.
- [ ] Clerk plan/BAA confirmed (staff dashboard displays PHI).
- [ ] Vercel BAA (Enterprise) or alternate host (Railway/Fly/AWS) decided for production.
- [x] Recording disclosure in `firstMessage`.
- [x] No PHI in voicemails (prompt-enforced: name + callback number only).
- [x] `audit_log` writes on dashboard PHI access (`src/lib/audit.ts`).
- [ ] Data retention policy written (transcripts/recordings retained N years per practice policy).
- [ ] `EMERGENCY_PAGE_NUMBER` set in production env — production env validation now fails without it, and emergency calls cannot page a live human until it is a real E.164 on-call number.
