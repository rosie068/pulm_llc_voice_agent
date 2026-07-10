// Topic → owner classification (spec §2). The agent's job is correct
// classification; actual transfer plumbing (RingCentral DIDs) is
// integration-phase — numbers here are placeholders until then.

export interface RoutingOwner {
  ext: string;
  ownerName: string;
  owns: string;
}

export type RoutingTopic =
  | "confirmations_rescheduling"
  | "bhc_scheduling"
  | "incoming_501_vms"
  | "nv_sm_scheduling"
  | "dme"
  | "incoming_general"
  | "np_intermountain_echo_doppler"
  | "np_other_pcp_ss_allergy";

export const ROUTING_DIRECTORY: Record<RoutingTopic, RoutingOwner> = {
  confirmations_rescheduling: {
    ext: "419",
    ownerName: "Ryan",
    owns: "Confirmations & rescheduling",
  },
  bhc_scheduling: { ext: "430", ownerName: "Anita", owns: "BHC scheduling" },
  incoming_501_vms: {
    ext: "431",
    ownerName: "Bharani",
    owns: "Incoming calls & 501 VMs",
  },
  nv_sm_scheduling: {
    ext: "432",
    ownerName: "Kedareshari",
    owns: "Incoming calls & NV–SM scheduling",
  },
  dme: { ext: "434", ownerName: "Sakshi", owns: "Incoming calls & DME" },
  incoming_general: { ext: "435", ownerName: "Kevin", owns: "Incoming calls" },
  np_intermountain_echo_doppler: {
    ext: "436",
    ownerName: "Sneha",
    owns: "NP calls — Intermountain & Echo-Doppler",
  },
  np_other_pcp_ss_allergy: {
    ext: "438",
    ownerName: "Prinsu",
    owns: "NP calls — all other PCP & SS-Allergy",
  },
};

export function routeTopic(topic: string): RoutingOwner {
  const key = topic as RoutingTopic;
  return ROUTING_DIRECTORY[key] ?? ROUTING_DIRECTORY.incoming_general;
}
