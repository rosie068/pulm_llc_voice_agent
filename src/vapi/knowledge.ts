// Knowledge base — Voice_Agent_SPEC.md §1, §2, §5 as typed constants.
// Single source of truth: rendered into system prompts by renderKnowledge().

export const PRACTICE = {
  name: "The Pulmonology Group LLC",
  mainPhone: "702-780-0300",
  fax: "702-608-4977",
  faxBack: "725-780-4451",
  npi: "1245984673",
} as const;

export const PROVIDERS = [
  { name: "Vikas Sayal", role: "MD", locations: ["NV", "SM"] },
  { name: 'Samantha Przybylski ("Sam")', role: "NP", locations: ["NV", "SM"] },
  { name: "Arlene Roberts", role: "NP", locations: ["NV", "SM"] },
  { name: "Omar Gabriel", role: "NP", locations: ["BHC"] },
  { name: "Colleen Rose", role: "NP", locations: ["BHC"] },
  { name: "John Joseph De Guzman", role: "NP", locations: ["SM"], note: "works out of hospital" },
  { name: "Steven Harker", role: "NP", locations: ["SM"] },
] as const;

export const LOCATIONS = [
  {
    code: "NV",
    site: "Henderson",
    address: "2970 West Horizon Ridge Pkwy, Henderson, NV 89052",
    phone: "main line",
  },
  {
    code: "SM",
    site: "Summerlin",
    address: "2501 Fire Mesa St, Suite 150, Las Vegas, NV 89128",
    phone: "main line",
  },
] as const;

// Quote to SELF-PAY callers only (spec §1).
export const SELF_PAY_PRICES = [
  { service: "New patient visit", price: "$350" },
  { service: "Follow-up visit", price: "$200" },
  { service: "6-minute walk test (6MWT)", price: "$150" },
  { service: "PFT (pulmonary function test)", price: "$200" },
  { service: "Allergy test", price: "$400" },
  { service: "Sleep study — in lab", price: "$1,000" },
  { service: "Sleep study — at home (HST)", price: "$600" },
] as const;

export function renderKnowledge(): string {
  const providers = PROVIDERS.map(
    (p) => `- ${p.name} (${p.role}) — ${p.locations.join(" & ")}${"note" in p && p.note ? ` (${p.note})` : ""}`,
  ).join("\n");
  const locations = LOCATIONS.map(
    (l) => `- ${l.code} (${l.site}): ${l.address} — phone: ${l.phone}`,
  ).join("\n");
  const prices = SELF_PAY_PRICES.map((s) => `- ${s.service}: ${s.price}`).join("\n");

  return `## Practice
${PRACTICE.name}
Main phone: ${PRACTICE.mainPhone} · Fax: ${PRACTICE.fax} · Fax-back: ${PRACTICE.faxBack} · NPI: ${PRACTICE.npi}

## Providers
${providers}

## Locations
${locations}

How to talk about locations: when a caller asks where the clinic is, answer with city/area only, conversationally — "We have two offices: one in Henderson and one in Summerlin, in the Las Vegas area. Is one of those closer to you?" Do NOT read out full street addresses unprompted — it sounds robotic and is too much to absorb by ear. Give the full street address ONLY when the caller asks for it ("what's the exact address?", "where do I go?", directions), or when confirming a booked appointment's location at the end of the call.

## Self-pay pricing (quote ONLY to self-pay callers — never to insured patients)
${prices}`;
}
