import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { handleLeadStatusWebhook } from "../src/lib/api/leadStatusWebhook.server.ts";

const ORIGINAL_SECRET = process.env.LEAD_STATUS_WEBHOOK_SECRET;

beforeEach(() => {
  process.env.LEAD_STATUS_WEBHOOK_SECRET = "lead-status-secret-for-test";
});

after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.LEAD_STATUS_WEBHOOK_SECRET;
  else process.env.LEAD_STATUS_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function statusRequest(
  body: Record<string, unknown>,
  token = "lead-status-secret-for-test",
): Request {
  return new Request("https://watchdive.diveroid.com/api/funnel/lead-status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function storedLeadContext() {
  return {
    leadId: "lead-123",
    acquisitionPath: "website" as const,
    source: "hero",
    notionPageId: "123456781234123412341234567890ab",
    signedUpAt: new Date().toISOString(),
    attribution: {
      metaCampaignId: "120251217895480717",
      metaAdSetId: "120251217895480718",
      metaAdId: "120251217895480719",
    },
  };
}

test("ignores unrelated routes", async () => {
  const response = await handleLeadStatusWebhook(
    new Request("https://watchdive.diveroid.com/not-this-route"),
  );
  assert.equal(response, null);
});

test("fails closed when the verification webhook secret is missing", async () => {
  delete process.env.LEAD_STATUS_WEBHOOK_SECRET;
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "lead-123", method: "email" }),
  );
  assert.equal(response?.status, 503);
});

test("rejects an invalid bearer secret", async () => {
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "lead-123", method: "email" }, "wrong"),
  );
  assert.equal(response?.status, 403);
});

test("updates measurement, CRM, and the idempotent verified event without contact PII", async () => {
  const calls: string[] = [];
  const occurredAt = new Date().toISOString();
  const response = await handleLeadStatusWebhook(
    statusRequest({
      leadId: "lead-123",
      method: "email",
      occurredAt,
      providerEventId: "provider-event-123",
    }),
    {
      readLead: async (args) => {
        calls.push(`read:${args.leadId}`);
        return { ok: true, found: true, context: storedLeadContext() };
      },
      markCrm: async (args) => {
        calls.push(`crm:${args.notionPageId}:${args.method}`);
      },
      recordEvent: async (args) => {
        calls.push(`${args.eventName}:${args.properties.verificationMethod}`);
        assert.equal(args.idempotencyKey, "lead-verification:provider-event-123:email");
        assert.deepEqual(Object.keys(args.properties), ["verificationMethod"]);
        return true;
      },
      commitLead: async (args) => {
        calls.push(`commit:${args.leadId}:${args.method}`);
        return { ok: true, found: true };
      },
    },
  );

  assert.equal(response?.status, 200);
  assert.deepEqual(calls, [
    "read:lead-123",
    "crm:123456781234123412341234567890ab:email",
    "lead_verified:email",
    "commit:lead-123:email",
  ]);
});

test("rejects payloads that try to include contact PII", async () => {
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "lead-123", method: "email", email: "hidden@example.com" }),
  );
  assert.equal(response?.status, 400);
});

test("returns 404 when the measured lead id does not exist", async () => {
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "missing-lead", method: "phone" }),
    {
      readLead: async () => ({ ok: true, found: false }),
    },
  );
  assert.equal(response?.status, 404);
});

test("returns 500 so the provider can retry when durable storage fails", async () => {
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "lead-123", method: "phone" }),
    {
      readLead: async () => ({ ok: false, found: false }),
    },
  );
  assert.equal(response?.status, 500);
});

test("does not commit the dashboard verified flag when CRM or event persistence fails", async () => {
  for (const failingStep of ["crm", "event"] as const) {
    const calls: string[] = [];
    const response = await handleLeadStatusWebhook(
      statusRequest({ leadId: "lead-123", method: "email" }),
      {
        readLead: async () => {
          calls.push("read");
          return { ok: true, found: true, context: storedLeadContext() };
        },
        markCrm: async () => {
          calls.push("crm");
          if (failingStep === "crm") throw new Error("crm unavailable");
        },
        recordEvent: async () => {
          calls.push("event");
          return failingStep !== "event";
        },
        commitLead: async () => {
          calls.push("commit");
          return { ok: true, found: true };
        },
      },
    );

    assert.equal(response?.status, 500);
    assert.equal(calls.includes("commit"), false);
    assert.deepEqual(calls, failingStep === "crm" ? ["read", "crm"] : ["read", "crm", "event"]);
  }
});

test("returns a retryable error if the final verified commit fails", async () => {
  const calls: string[] = [];
  const response = await handleLeadStatusWebhook(
    statusRequest({ leadId: "lead-123", method: "phone" }),
    {
      readLead: async () => {
        calls.push("read");
        return { ok: true, found: true, context: storedLeadContext() };
      },
      markCrm: async () => {
        calls.push("crm");
      },
      recordEvent: async () => {
        calls.push("event");
        return true;
      },
      commitLead: async () => {
        calls.push("commit");
        return { ok: false, found: false };
      },
    },
  );

  assert.equal(response?.status, 500);
  assert.deepEqual(calls, ["read", "crm", "event", "commit"]);
});
