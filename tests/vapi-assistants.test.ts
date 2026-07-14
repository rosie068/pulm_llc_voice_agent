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

  it("uses voice activity for fast barge-in instead of waiting for a transcribed word", () => {
    const payload = buildAssistantPayload(spec("front-desk"), SERVER_URL, SECRET);
    expect(payload.stopSpeakingPlan).toEqual({
      numWords: 0,
      voiceSeconds: 0.2,
      backoffSeconds: 0.5,
    });
  });

  it("uses one delayed, non-repetitive idle reminder", () => {
    const payload = buildAssistantPayload(spec("front-desk"), SERVER_URL, SECRET);
    expect(payload.messagePlan).toEqual({
      idleMessages: ["Take your time — I'm listening."],
      idleTimeoutSeconds: 25,
      idleMessageMaxSpokenCount: 1,
    });
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
      expect(destination).not.toHaveProperty("message");
    }
  });
});

describe("clinical human handoff prompt", () => {
  it.each([inboundSystemPrompt(), frontDeskSystemPrompt(), schedulerSystemPrompt()])(
    "routes non-emergency symptoms to clinical staff and reserves 911 for warning signs",
    (prompt) => {
      expect(prompt).toContain('specialistLabel "next available clinical staff member"');
      expect(prompt).toContain("A sore or uncomfortable throat");
      expect(prompt).toContain("is NOT an emergency by itself");
      expect(prompt).toContain("Direct the caller to 911/ER ONLY");
      expect(prompt).toContain("I can help get you to the right clinical person");
      expect(prompt).toContain("Ask ONLY for the full name first");
      expect(prompt).not.toContain("consult a healthcare professional");
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
