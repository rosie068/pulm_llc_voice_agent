import { describe, expect, it } from "vitest";
import { ASSISTANT_SPECS, buildAssistantPayload } from "@/vapi/assistants";
import { frontDeskSystemPrompt } from "@/vapi/prompts/frontdesk.system";
import { inboundSystemPrompt } from "@/vapi/prompts/inbound.system";
import { schedulerSystemPrompt } from "@/vapi/prompts/scheduler.system";
import { outboundReferralSystemPrompt } from "@/vapi/prompts/outbound-referral.system";
import { outboundSleepSystemPrompt } from "@/vapi/prompts/outbound-sleep.system";
import { buildInboundSquadPayload } from "@/vapi/squads";
import { renderKnowledge } from "@/vapi/knowledge";
import { TOOL_DEFINITIONS } from "@/vapi/tools/definitions";

const SERVER_URL = "https://example.test/api/vapi/webhook";
const SECRET = "test-secret";

function spec(key: (typeof ASSISTANT_SPECS)[number]["key"]) {
  const found = ASSISTANT_SPECS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Missing assistant spec: ${key}`);
  return found;
}

describe("inbound opening and memory configuration", () => {
  it.each(["inbound", "front-desk"] as const)(
    "%s lets the caller interrupt its one-time opening",
    (key) => {
      const payload = buildAssistantPayload(spec(key), SERVER_URL, SECRET);
      expect(payload.firstMessageMode).toBe("assistant-speaks-first");
      expect(payload.firstMessageInterruptionsEnabled).toBe(true);
      expect(payload.firstMessage.match(/recorded for quality assurance purposes/gi)).toHaveLength(1);
      expect(payload.artifactPlan.fullMessageHistoryEnabled).toBe(true);
    },
  );

  it("keeps outbound assistants interruptible", () => {
    const payload = buildAssistantPayload(spec("outbound-sleep"), SERVER_URL, SECRET);
    expect(payload.firstMessageInterruptionsEnabled).toBe(true);
  });

  it("does not ask the model to guess whether the disclosure was interrupted", () => {
    for (const prompt of [inboundSystemPrompt(), frontDeskSystemPrompt()]) {
      expect(prompt).toContain("whether the caller waits for it or interrupts it");
      expect(prompt).toContain("never restart, repeat, or paraphrase any part of it");
      expect(prompt).toContain("Use the entire conversation history as call memory");
      expect(prompt).toContain('respond exactly: "Hi. How can I help you today?"');
      expect(prompt).not.toContain("Just so you know, this call may be recorded");
      expect(prompt).not.toContain("ALREADY been spoken in full");
    }
  });

  it("requires a transcribed word to barge in so noise cannot cause dead air", () => {
    const payload = buildAssistantPayload(spec("front-desk"), SERVER_URL, SECRET);
    expect(payload.stopSpeakingPlan).toEqual({
      numWords: 1,
      voiceSeconds: 0.2,
      backoffSeconds: 0.5,
    });
  });

  it("re-engages a silent caller at a human pace after an interruption", () => {
    const payload = buildAssistantPayload(spec("front-desk"), SERVER_URL, SECRET);
    expect(payload.messagePlan).toEqual({
      idleMessages: ["I'm here — go ahead whenever you're ready.", "Are you still there?"],
      idleTimeoutSeconds: 10,
      idleMessageMaxSpokenCount: 2,
    });
  });

  it("continues from an interrupted fragment instead of going silent or restarting", () => {
    for (const prompt of [inboundSystemPrompt(), frontDeskSystemPrompt()]) {
      expect(prompt).toContain("INTERRUPTED FRAGMENT");
      expect(prompt).toContain("never sit in silence and never restart the opening");
      expect(prompt).toContain("Keep the fragment in memory");
      expect(prompt).toContain("You mentioned a cough — tell me a bit more.");
    }
  });
});

describe("inbound squad handoffs", () => {
  it("continues from full history without replaying a saved first message", () => {
    const squad = buildInboundSquadPayload("front-desk-id", "scheduler-id");

    for (const member of squad.members) {
      const destination = member.assistantDestinations[0];
      expect(destination.contextEngineeringPlan).toEqual({ type: "all" });
      expect(destination.assistantOverrides).toEqual({
        firstMessage: "",
        firstMessageMode: "assistant-speaks-first-with-model-generated-message",
      });
    }
  });

  it("speaks one exact bridge line per handoff so transitions feel human", () => {
    // Vapi rejects a `message` property on assistantDestinations, so the
    // bridge line is model-spoken with wording pinned in the prompts.
    const squad = buildInboundSquadPayload("front-desk-id", "scheduler-id");
    for (const member of squad.members) {
      expect(member.assistantDestinations[0]).not.toHaveProperty("message");
    }
    expect(frontDeskSystemPrompt()).toContain(
      '"Let me get you over to Linda, our scheduler — one moment."',
    );
    expect(frontDeskSystemPrompt()).toContain("say EXACTLY this one bridge line and nothing more");
    expect(schedulerSystemPrompt()).toContain(
      '"Let me get you back to Mark at the front desk — one moment."',
    );
    expect(schedulerSystemPrompt()).toContain("say EXACTLY this one bridge line and nothing more");
  });
});

describe("clinical human handoff prompt", () => {
  it.each([inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()])(
    "offers an appointment first for non-emergency symptoms and reserves 911 for warning signs",
    (prompt) => {
      expect(prompt).toContain('specialistLabel "next available clinical staff member"');
      expect(prompt).toContain("A sore or uncomfortable throat");
      expect(prompt).toContain("is NOT an emergency by itself");
      expect(prompt).toContain("Direct the caller to 911/ER ONLY");
      expect(prompt).toContain("offer an appointment FIRST");
      expect(prompt).toContain("I can book you an appointment with one of our providers.");
      expect(prompt).toContain("Just to be safe — are you having any trouble breathing");
      expect(prompt).toContain("Never read out multiple routing options in one breath");
      expect(prompt).toContain("Say nothing about the transfer yourself");
      expect(prompt).toContain("Ask ONLY for the first name first");
      expect(prompt).not.toContain("consult a healthcare professional");
      expect(prompt).not.toContain("I can help get you to the right clinical person");
    },
  );

  it.each([inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()])(
    "sends mild-symptom callers to booking in one turn with no dead air",
    (prompt) => {
      expect(prompt).toContain(
        "Let me get you over to Linda, our scheduler — she can book you an appointment with one of our providers. One moment.",
      );
      expect(prompt).toContain("trigger the handoff to \"pulm-scheduler\" in that SAME turn");
      expect(prompt).toContain("ending your turn after the line without triggering the handoff is an error");
      expect(prompt).toContain("Never mash the offer and a handoff announcement into one broken sentence");
    },
  );

  it.each([inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()])(
    "treats acute injury as ER/urgent-care direction, not the 911 script or clinical routing",
    (prompt) => {
      expect(prompt).toContain("An acute injury — a possible broken bone, a fall, a cut, a burn — is NOT on the warning-sign list");
      expect(prompt).toContain("**Acute injury, no warning sign**");
      expect(prompt).toContain("Please go to the nearest emergency room or urgent care.");
      expect(prompt).toContain("If you can't move, are bleeding heavily, or feel faint, hang up and call nine-one-one.");
    },
  );

  it.each([
    inboundSystemPrompt(),
    frontDeskSystemPrompt(),
    schedulerSystemPrompt(),
    outboundReferralSystemPrompt(),
    outboundSleepSystemPrompt(),
  ])("always speaks the emergency number as nine-one-one, never digits", (prompt) => {
    expect(prompt).toContain('say "nine-one-one" — never the digits "911"');
    // No scripted spoken directive may tell the caller to dial the digits.
    expect(prompt).not.toContain("call 911");
    expect(prompt).not.toContain("dial 911");
  });
});

describe("three-try audio recovery", () => {
  const prompts = [inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()];

  it.each(prompts)("asks twice, transfers on the third unclear turn, and resets after recovery", (prompt) => {
    expect(prompt).toContain("Count consecutive unclear caller turns about the SAME information");
    expect(prompt).toContain("On unclear turn 1 and unclear turn 2");
    expect(prompt).toContain(
      "I'm having a hard time hearing and understanding. Can you please repeat that a little more slowly?",
    );
    expect(prompt).toContain("If unclear turn 3 is still not understandable");
    expect(prompt).toContain("immediately call transfer_audio_failure_to_staff");
    expect(prompt).toContain("Reset the count to zero as soon as the caller is understood");
    expect(prompt).toContain("Ordinary silence");
  });

  it.each(prompts)("spells back email and address like the name before any tool call", (prompt) => {
    expect(prompt).toContain("EMAIL READBACK");
    expect(prompt).toContain("spell the part before the @ back letter-by-letter");
    expect(prompt).toContain("J-O-H-N-D-O-E, at gmail dot com");
    expect(prompt).toContain("ADDRESS READBACK");
    expect(prompt).toContain("street number digit-by-digit");
    expect(prompt).toContain("ZIP digit-by-digit");
  });

  it.each(prompts)("keeps English output stable and does not mistake one bad transcript for Spanish", (prompt) => {
    expect(prompt).toContain("ENGLISH OUTPUT HARD RULE");
    expect(prompt).toContain("always speak to the caller in English");
    expect(prompt).toContain("One isolated Spanish-looking transcript");
    expect(prompt).toContain("do not speak Spanish yourself");
    expect(prompt).not.toContain('"un momento, por favor"');
  });

  it("speaks the required apology once through a dedicated transfer tool", () => {
    const tool = TOOL_DEFINITIONS.find(
      (candidate) => candidate.name === "transfer_audio_failure_to_staff",
    );
    expect(tool?.requestStartMessage).toBe(
      "I'm terribly sorry, I can't hear you. Let me transfer you to our staff.",
    );
    expect(tool?.description).toContain("three consecutive attempts");
    expect(tool?.description).toContain("Any possible emergency warning sign");
  });

  it.each(["front-desk", "scheduler", "outbound-sleep", "outbound-referral"] as const)(
    "makes the dedicated transfer tool available to %s",
    (key) => {
      expect(spec(key).toolNames).toContain("transfer_audio_failure_to_staff");
    },
  );
});

describe("practice-hours truthfulness", () => {
  it("distinguishes 24/7 call answering from unverified physical office hours", () => {
    const knowledge = renderKnowledge();
    expect(knowledge).toContain("That does NOT mean the physical clinics are open 24/7");
    expect(knowledge).toContain("Physical office hours have not been verified");
  });
});

describe("new-patient identification flow", () => {
  it("plays a neutral repeatable filler on identify_patient (it runs twice for new patients)", () => {
    // "One moment." covers the LLM+tool+TTS dead air on every lookup and can
    // repeat naturally, unlike "Let me pull up your record" twice in a row.
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "identify_patient");
    expect(tool).toBeDefined();
    expect(tool?.requestStartMessage).toBe("One moment.");
  });

  it.each([schedulerSystemPrompt(), inboundSystemPrompt()])(
    "never announces lookups and welcomes a confirmed new patient by name",
    (prompt) => {
      expect(prompt).not.toContain('"Let me pull up your record."');
      expect(prompt).toContain("say NOTHING yourself before");
      expect(prompt).toContain(
        "Looks like you're new with us. Welcome, {first name}! I'll just need a few quick details.",
      );
    },
  );
});

describe("identity collection sequence", () => {
  const prompts = [inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()];

  it.each(prompts)("asks one identity field per question in fixed order", (prompt) => {
    expect(prompt).toContain("IDENTITY SEQUENCE — ONE FIELD PER QUESTION");
    expect(prompt).toContain('"Could I have your full name and date of birth?" is forbidden');
  });

  it.each(prompts)("asks dates naturally and never speaks a format", (prompt) => {
    expect(prompt).toContain("DATES SPOKEN NATURALLY");
    expect(prompt).toContain("NEVER mention a format to the caller");
    expect(prompt).toContain("Convert what they said to YYYY-MM-DD yourself for tool calls, silently");
    expect(prompt).toContain("January first, nineteen ninety-nine — is that right?");
  });

  it("scheduler opens identity verification with the first name only", () => {
    expect(schedulerSystemPrompt()).toContain('"Could I have your first name, please?"');
  });

  it("keeps the internal dob format in the tool schema but marks it unspoken", () => {
    const tool = TOOL_DEFINITIONS.find((t) => t.name === "identify_patient");
    const dob = (tool?.parameters.properties as Record<string, { description?: string }>).dob;
    expect(dob?.description).toContain("YYYY-MM-DD");
    expect(dob?.description).toContain("NEVER say");
  });
});

describe("slot offering and selection", () => {
  const prompts = [
    inboundSystemPrompt(),
    schedulerSystemPrompt(),
    outboundSleepSystemPrompt(),
    outboundReferralSystemPrompt(),
  ];

  it.each(prompts)("groups slots by day and speaks dates in words", (prompt) => {
    expect(prompt).toContain("OFFERING TIMES LIKE A HUMAN");
    expect(prompt).toContain("group them by day and say each day ONCE");
    expect(prompt).toContain("Thursday, July sixteenth, I have nine, ten, or eleven in the morning");
    expect(prompt).toContain('"07/16/2026" is forbidden');
  });

  it.each(prompts)("books only an unambiguous day-and-time match", (prompt) => {
    expect(prompt).toContain("PICKING A TIME");
    expect(prompt).toContain("unambiguously matches exactly ONE offered slot");
    expect(prompt).toContain("Which time on Thursday");
    expect(prompt).toContain("Never let book_appointment fire on a partial or mismatched answer");
  });
});
