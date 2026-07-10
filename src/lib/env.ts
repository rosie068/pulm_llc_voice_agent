import { z } from "zod";

const optionalE164 = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().regex(/^\+[1-9]\d{9,14}$/, "must be E.164, e.g. +17025551234").optional(),
);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    VAPI_API_KEY: z.string().min(1),
    VAPI_WEBHOOK_SECRET: z.string().min(32),
    VAPI_PHONE_NUMBER_ID: z.string().min(1),
    CLERK_SECRET_KEY: z.string().min(1),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    EHR_ADAPTER: z.enum(["stub", "tebra"]).default("stub"),
    NOTIFY_ADAPTER: z.enum(["stub", "teams"]).default("stub"),
    ELIGIBILITY_ADAPTER: z.enum(["stub", "partner"]).default("stub"),
    EMERGENCY_PAGE_NUMBER: optionalE164,
    VAPI_ALLOW_UNVERIFIED: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // Demo mode: staff DIDs don't exist yet, so a successful in-hours routing
    // announces the named owner and ends the call as a simulated handoff.
    // Remove (or set false) once real RingCentral extensions are configured.
    DEMO_TRANSFER_MODE: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    CRON_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const productionLike =
      process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
    if (productionLike && !env.EMERGENCY_PAGE_NUMBER) {
      ctx.addIssue({
        code: "custom",
        path: ["EMERGENCY_PAGE_NUMBER"],
        message: "required in production so emergency calls can page a live human",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validated server-side environment. Fails fast with a readable error listing
 * every missing/invalid variable. Never import from client components.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
