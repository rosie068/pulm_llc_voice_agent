// Scheduling rules from Voice_Agent_SPEC.md §5, expressed as data.
// These mirror the seeded `availability_rules` rows; the engine consumes this
// shape whether rules come from here (tests/seed) or from the DB (runtime).

export type AppointmentType =
  | "new_patient"
  | "follow_up"
  | "hst"
  | "psg"
  | "titration_split"
  | "echo_doppler"
  | "allergy"
  | "pft"
  | "sixmwt";

export type LocationCode = "NV" | "SM" | "BHC" | "home";

export interface AvailabilityRule {
  appointmentType: AppointmentType;
  location: LocationCode;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  /** "HH:MM" 24h, local clinic time */
  windowStart: string;
  windowEnd: string;
  capacityPerDay: number;
  slotMinutes: number;
  active: boolean;
}

const psgNv: AvailabilityRule[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  appointmentType: "psg" as const,
  location: "NV" as const,
  dayOfWeek: dow,
  // PSG arrival window 8:30–9:30 PM (spec §5)
  windowStart: "20:30",
  windowEnd: "21:30",
  // Sun/Mon 3 per night; Tue–Sat double-book 6 (spec §5)
  capacityPerDay: dow === 0 || dow === 1 ? 3 : 6,
  slotMinutes: 30,
  active: true,
}));

const psgSm: AvailabilityRule[] = [5, 6, 0].map((dow) => ({
  appointmentType: "psg" as const,
  location: "SM" as const,
  dayOfWeek: dow,
  windowStart: "20:30",
  windowEnd: "21:30",
  capacityPerDay: 3, // SM: Fri/Sat/Sun, 3/night (spec §5)
  slotMinutes: 30,
  active: true,
}));

// Titration/Split inherits all PSG rules (spec §5)
const titration: AvailabilityRule[] = [...psgNv, ...psgSm].map((r) => ({
  ...r,
  appointmentType: "titration_split" as const,
}));

// HST: daytime device pickup, max 7 schedulings/day (spec §5)
const hst: AvailabilityRule[] = [1, 2, 3, 4, 5].flatMap((dow) =>
  (["NV", "SM"] as const).map((location) => ({
    appointmentType: "hst" as const,
    location,
    dayOfWeek: dow,
    windowStart: "09:00",
    windowEnd: "16:00",
    capacityPerDay: 7,
    slotMinutes: 30,
    active: true,
  })),
);

// Provisional office-visit grid for referral/new-patient scheduling. The spec
// called this out as an open clinic input (§7.1); keep these as ordinary DB
// rules so ops can replace them without changing the scheduling engine.
const newPatient: AvailabilityRule[] = [1, 2, 3, 4, 5].flatMap((dow) =>
  (["NV", "SM"] as const).map((location) => ({
    appointmentType: "new_patient" as const,
    location,
    dayOfWeek: dow,
    windowStart: "09:00",
    windowEnd: "15:00",
    capacityPerDay: 6,
    slotMinutes: 60,
    active: true,
  })),
);

// Provisional office grids for follow-up visits and daytime in-office tests
// (PFT / 6MWT, spec §5 "Daytime, in office"). Same open clinic input as the
// new-patient grid (§7.1) — plain DB rules ops can replace. Without these,
// any reschedule or follow-up booking dead-ends at "no availability
// configured" even though the visit type is in scope for inbound self-service.
const followUp: AvailabilityRule[] = [1, 2, 3, 4, 5].flatMap((dow) =>
  (["NV", "SM"] as const).map((location) => ({
    appointmentType: "follow_up" as const,
    location,
    dayOfWeek: dow,
    windowStart: "09:00",
    windowEnd: "15:00",
    capacityPerDay: 8,
    slotMinutes: 30,
    active: true,
  })),
);

const officeTests: AvailabilityRule[] = (["pft", "sixmwt"] as const).flatMap((type) =>
  [1, 2, 3, 4, 5].flatMap((dow) =>
    (["NV", "SM"] as const).map((location) => ({
      appointmentType: type,
      location,
      dayOfWeek: dow,
      windowStart: "09:00",
      windowEnd: "16:00",
      capacityPerDay: 4,
      slotMinutes: 30,
      active: true,
    })),
  ),
);

export const DEFAULT_RULES: AvailabilityRule[] = [
  ...newPatient,
  ...followUp,
  ...officeTests,
  ...psgNv,
  ...psgSm,
  ...titration,
  ...hst,
];

// PSG and Titration/Split share the same physical beds per night (spec §5:
// "as PSG"), so capacity is enforced across the group, not per type.
const SHARED_CAPACITY_GROUPS: AppointmentType[][] = [["psg", "titration_split"]];

export function capacityGroupFor(type: AppointmentType): AppointmentType[] {
  return SHARED_CAPACITY_GROUPS.find((g) => g.includes(type)) ?? [type];
}

const PREP_SCRIPTS: Partial<Record<AppointmentType, string>> = {
  hst: "This is a home sleep test. You will pick up the device and return it — for example a Friday pickup returns Monday. We will confirm your return date and time; someone may also drop the device off to you.",
  psg: "For your in-lab sleep study: please shower beforehand and do not wear lotion, perfume, or cologne. Wear comfortable clothes — no silk or satin. Take your nighttime medications as usual, and bring your sleep aid or melatonin if you use one. You are welcome to bring your own pillow or blanket. Arrival is between 8:30 and 9:30 PM and the study ends around 5 AM.",
  titration_split:
    "For your in-lab sleep study: please shower beforehand and do not wear lotion, perfume, or cologne. Wear comfortable clothes — no silk or satin. Take your nighttime medications as usual, and bring your sleep aid or melatonin if you use one. You are welcome to bring your own pillow or blanket. Arrival is between 8:30 and 9:30 PM and the study ends around 5 AM.",
  allergy:
    "You must be off all allergy medications for one week before the test. Allergens are applied on your back and you will stay in the room for the duration of the appointment.",
};

export function getPrepScript(type: AppointmentType): string | null {
  return PREP_SCRIPTS[type] ?? null;
}

/** Study types require prior authorization before scheduling (spec §3.4). */
export function requiresAuth(type: AppointmentType): boolean {
  return ["hst", "psg", "titration_split", "echo_doppler", "allergy"].includes(
    type,
  );
}
