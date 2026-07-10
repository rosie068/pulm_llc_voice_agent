// Webhook contract tests — DB-free paths only (auth rejection, malformed
// payloads, unparseable shapes). DB-touching paths are covered by the live
// curl suite in docs/runbook.md.

import { beforeAll, describe, expect, it } from "vitest";

const SECRET = "a".repeat(64);

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@fake.invalid/db";
  process.env.VAPI_API_KEY = "test-key";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.VAPI_PHONE_NUMBER_ID = "00000000-0000-0000-0000-000000000000";
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_x";
  process.env.VAPI_ALLOW_UNVERIFIED = "false";
});

async function post(body: string, secret?: string) {
  const { POST } = await import("@/app/api/vapi/webhook/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost/api/vapi/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-vapi-secret": secret } : {}),
    },
    body,
  });
  return POST(req);
}

describe("webhook contract", () => {
  it("missing secret → 401", async () => {
    const res = await post(JSON.stringify({ message: { type: "status-update" } }));
    expect(res.status).toBe(401);
  });

  it("wrong secret → 401", async () => {
    const res = await post(
      JSON.stringify({ message: { type: "status-update" } }),
      "b".repeat(64),
    );
    expect(res.status).toBe(401);
  });

  it("wrong-length secret → 401 (no timingSafeEqual crash)", async () => {
    const res = await post(JSON.stringify({ message: { type: "x" } }), "short");
    expect(res.status).toBe(401);
  });

  it("malformed JSON with valid secret → 200 {} (never 500 into Vapi retry loop)", async () => {
    const res = await post("{not json", SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("unrecognized shape with valid secret → 200 {}", async () => {
    const res = await post(JSON.stringify({ hello: "world" }), SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
