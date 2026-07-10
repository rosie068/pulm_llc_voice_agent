import { z } from "zod";

// Lenient schemas: we validate what we rely on and passthrough the rest —
// Vapi adds fields over time and unknown keys must never 500 the webhook.

export const toolCallSchema = z
  .object({
    id: z.string(),
    // Vapi (OpenAI-style) shape: { id, type, function: { name, arguments } }
    function: z
      .object({
        name: z.string(),
        arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
      })
      .optional(),
    // Some payload variants flatten these:
    name: z.string().optional(),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  })
  .loose();

export const serverMessageSchema = z
  .object({
    message: z
      .object({
        type: z.string(),
        call: z
          .object({
            id: z.string().optional(),
            customer: z.object({ number: z.string().optional() }).loose().optional(),
          })
          .loose()
          .optional(),
        toolCallList: z.array(toolCallSchema).optional(),
        status: z.string().optional(),
        endedReason: z.string().optional(),
        startedAt: z.string().optional(),
        endedAt: z.string().optional(),
        durationSeconds: z.number().optional(),
        cost: z.number().optional(),
        artifact: z
          .object({
            transcript: z.string().optional(),
            recording: z.record(z.string(), z.unknown()).optional(),
            recordingUrl: z.string().optional(),
          })
          .loose()
          .optional(),
        analysis: z
          .object({
            summary: z.string().optional(),
            structuredData: z.record(z.string(), z.unknown()).optional(),
            successEvaluation: z.unknown().optional(),
          })
          .loose()
          .optional(),
        transcript: z.string().optional(),
        functionCall: z.record(z.string(), z.unknown()).optional(),
      })
      .loose(),
  })
  .loose();

export type ServerMessage = z.infer<typeof serverMessageSchema>["message"];

export function parseToolArguments(tc: z.infer<typeof toolCallSchema>): {
  name: string;
  args: Record<string, unknown>;
} {
  const name = tc.function?.name ?? tc.name ?? "unknown";
  const raw = tc.function?.arguments ?? tc.arguments ?? {};
  if (typeof raw === "string") {
    try {
      return { name, args: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      return { name, args: {} };
    }
  }
  return { name, args: raw };
}
