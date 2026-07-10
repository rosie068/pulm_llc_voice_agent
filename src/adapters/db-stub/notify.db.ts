import { db, schema } from "@/db";
import { getEnv } from "@/lib/env";
import type { NotifyPort, StaffNotification } from "@/ports/notify";

export class DbStubNotifyAdapter implements NotifyPort {
  async notifyStaff(n: StaffNotification): Promise<void> {
    // Stub: audit-log entry surfaces in the dashboard; TeamsAdapter replaces this.
    await db().insert(schema.auditLog).values({
      actor: "agent",
      action: "notify_staff",
      entity: "flag",
      entityId: n.flagId,
      detail: { reason: n.reason, routedToExt: n.routedToExt, summary: n.summary },
    });
  }

  async pageHuman(
    message: string,
    callbackNumber: string | null,
  ): Promise<{ paged: boolean; via: string }> {
    const env = getEnv();
    // Emergency pages must be real (spec §3.6). Until a Twilio/RingCentral
    // pager integration is configured, place a Vapi outbound call to the
    // configured on-call number so a phone actually rings.
    if (!env.EMERGENCY_PAGE_NUMBER) {
      await db().insert(schema.auditLog).values({
        actor: "agent",
        action: "page_human_FAILED_no_number",
        entity: "emergency",
        detail: { message, callbackNumber },
      });
      return { paged: false, via: "not_configured" };
    }
    try {
      const { VapiClient } = await import("@vapi-ai/server-sdk");
      const client = new VapiClient({ token: env.VAPI_API_KEY });
      await client.calls.create({
        phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
        customer: { number: env.EMERGENCY_PAGE_NUMBER },
        assistant: {
          firstMessage: `Emergency page from the Pulmonology Group voice agent. ${message}. Callback number: ${callbackNumber ?? "unknown"}. Repeating: ${message}.`,
          model: {
            provider: "openai",
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content:
                  "You are an automated emergency pager. State the emergency message, repeat it once if asked, answer no other questions, then end the call.",
              },
            ],
          },
        },
      });
      return { paged: true, via: "vapi-outbound-call" };
    } catch (err) {
      await db().insert(schema.auditLog).values({
        actor: "agent",
        action: "page_human_FAILED",
        entity: "emergency",
        detail: { message, error: String(err) },
      });
      return { paged: false, via: `error: ${String(err)}` };
    }
  }
}
