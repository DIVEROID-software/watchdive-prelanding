import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";

import {
  assertLaunchOsPiiFree,
  authorizeLaunchOsBrowserRelayRequest,
  bindLaunchOsMeasurementContext,
  createLaunchOsConsentCookie,
  LAUNCHOS_REPLAY_CONTRACT_VERSION,
  launchOsConsentAuthorityReferenceHash,
  launchOsHmacCanonicalString,
  openLaunchOsReplayMetadata,
  relayLaunchOsVerificationOutcome,
  relayLaunchOsWebEventFromBrowser,
  relayLaunchOsWebEvent,
  relayStoredWaitlistLead,
  resolveLaunchOsConsentAuthorityBinding,
  sealLaunchOsReplayMetadata,
  verifyLaunchOsConsentCookie,
} from "../src/lib/api/launchOsRelay.server.ts";
import type {
  LaunchOsAuthorizedMeasurementContext,
  LaunchOsMeasurementContext,
} from "../src/lib/verification/contracts.ts";

const NOW = Date.parse("2026-08-02T09:00:00.000Z");
const CONTEXT: LaunchOsMeasurementContext = {
  funnelInstanceId: `fi_v1_${"A".repeat(32)}`,
  attribution: {
    campaignId: "1001",
    adsetId: "2002",
    targetId: "2002",
    adId: "3003",
    contentId: "3003",
  },
  measurementConsent: {
    purpose: "advertising_measurement",
    state: "granted",
    version: "WD-AD-MEASUREMENT-CONSENT-V1",
  },
  placement: "hero",
};
const AUTHORITY_REFERENCE_HASH = "e".repeat(64);
const AUTHORIZED_CONTEXT: LaunchOsAuthorizedMeasurementContext = {
  ...CONTEXT,
  authorityReferenceHash: AUTHORITY_REFERENCE_HASH,
  attributionAuthority: "approved_meta_identity_snapshot_v1",
};

const REPLAY_SEED = {
  canonicalEmail: "diver@example.com",
  suspect: false,
  signedUpAt: "2026-08-02T09:00:00.000Z",
  context: AUTHORIZED_CONTEXT,
} as const;

const ENV = {
  LAUNCHOS_MEASUREMENT_ENABLED: "true",
  LAUNCHOS_BASE_URL: "http://localhost:4178",
  LAUNCHOS_PROJECT_ID: "watchdive-prelanding",
  LAUNCHOS_FUNNEL_VERSION: "wd-prelaunch-v1",
  LAUNCHOS_ENVIRONMENT: "development",
  LAUNCHOS_WEB_EVENTS_INGRESS_KEY_ID: "watchdive.web.v1",
  LAUNCHOS_WEB_EVENTS_INGRESS_SECRET: "web-events-secret-32-bytes-minimum-01",
  LAUNCHOS_LEAD_STORE_INGRESS_KEY_ID: "watchdive.lead.v1",
  LAUNCHOS_LEAD_STORE_INGRESS_SECRET: "lead-store-secret-32-bytes-minimum-02",
  LAUNCHOS_VERIFICATION_INGRESS_KEY_ID: "watchdive.verify.v1",
  LAUNCHOS_VERIFICATION_INGRESS_SECRET: "verification-secret-32-bytes-min-03",
  LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET: "canonical-lead-secret-32-bytes-min-04",
  WAITLIST_REPLAY_HMAC_SECRET: "replay-envelope-secret-32-bytes-min-05",
  LAUNCHOS_QUALITY_RULE_VERSION: "wd-suspect-v1",
  LAUNCHOS_VERIFICATION_POLICY_VERSION: "wd-email-double-opt-in-v1",
  LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: JSON.stringify([
    { campaignId: "1001", adsetId: "2002", adId: "3003" },
  ]),
} satisfies NodeJS.ProcessEnv;

const sourceMeasurementNotRevoked = async () => false;

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("HMAC covers the exact version, key, time, nonce, method, path and body hash", () => {
  const body = JSON.stringify({ ok: true });
  const actual = launchOsHmacCanonicalString(
    "key.v1",
    "1785654000",
    "n_1234567890123456",
    "/api/events",
    body,
  );
  assert.equal(
    actual,
    [
      "launchos-ingress-v2",
      "key.v1",
      "1785654000",
      "n_1234567890123456",
      "POST",
      "/api/events",
      createHash("sha256").update(body).digest("hex"),
    ].join("\n"),
  );
});

test("recursive PII keys are rejected before a payload can leave", () => {
  assert.throws(() => assertLaunchOsPiiFree({ events: [{ email: "hidden" }] }), /forbidden PII/);
  assert.throws(
    () => assertLaunchOsPiiFree({ nested: { client_user_agent: "hidden" } }),
    /forbidden PII/,
  );
  assert.doesNotThrow(() =>
    assertLaunchOsPiiFree({ canonicalLeadId: `lead_hmacv1_${"a".repeat(64)}` }),
  );
});

test("website relay signs one PII-free source-scoped canonical event", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const result = await relayLaunchOsWebEvent(
    {
      ...CONTEXT,
      placement: "hero",
      eventName: "form_started",
      eventId: `loe_v1_${"B".repeat(32)}`,
      occurredAt: "2026-08-02T09:00:00.000Z",
    },
    AUTHORITY_REFERENCE_HASH,
    {
      env: ENV,
      nowImpl: () => NOW,
      nonceFactory: () => "n_1234567890123456",
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init: init ?? {} };
        return ok();
      },
    },
  );
  assert.equal(result.status, "accepted");
  assert.equal(captured?.url, "http://localhost:4178/api/events");
  const body = String(captured?.init.body);
  const payload = JSON.parse(body) as Record<string, unknown>;
  assert.equal(payload.source, "watchdive_landing");
  assert.equal(payload.events[0].placement, undefined);
  assert.equal(payload.events[0].statusReasonCode, undefined);
  assert.equal(payload.events[0].authorityReferenceHash, AUTHORITY_REFERENCE_HASH);
  assert.ok(!body.includes("@"));
  assert.ok(!body.toLowerCase().includes("phone"));
  const headers = captured?.init.headers as Record<string, string>;
  const canonical = launchOsHmacCanonicalString(
    "watchdive.web.v1",
    String(Math.floor(NOW / 1000)),
    "n_1234567890123456",
    "/api/events",
    body,
  );
  assert.equal(
    headers["X-LaunchOS-Signature"],
    createHmac("sha256", ENV.LAUNCHOS_WEB_EVENTS_INGRESS_SECRET).update(canonical).digest("hex"),
  );
});

test("browser relay requires GPC parity and a fresh signed consent authority", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  assert.equal(verifyLaunchOsConsentCookie(cookie, ENV, NOW), true);
  assert.equal(verifyLaunchOsConsentCookie(`${cookie}x`, ENV, NOW), false);
  assert.equal(
    launchOsConsentAuthorityReferenceHash(cookie, ENV, NOW),
    createHash("sha256").update(cookie).digest("hex"),
  );
  const facts = {
    requestUrl: "https://watchdive.example/",
    origin: "https://watchdive.example",
    secFetchSite: "same-origin",
    secGpc: null,
    serverFnHeader: "true",
    consentCookie: cookie,
    configuredPublicOrigin: "https://watchdive.example",
    nodeEnv: "production",
  };
  assert.equal(authorizeLaunchOsBrowserRelayRequest(facts).allowed, true);

  let calls = 0;
  const input = {
    ...CONTEXT,
    placement: "page" as const,
    eventName: "landing_viewed" as const,
    eventId: `loe_v1_${"Z".repeat(32)}`,
    occurredAt: "2026-08-02T09:00:00.000Z",
  };
  const accepted = await relayLaunchOsWebEventFromBrowser(input, facts, {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => "n_1234567890123456",
    fetchImpl: async () => {
      calls += 1;
      return ok();
    },
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.coveragePublished, false);
  assert.equal(accepted.decisionReady, false);

  const missingCookie = await relayLaunchOsWebEventFromBrowser(
    input,
    { ...facts, consentCookie: null },
    { env: ENV, nowImpl: () => NOW, fetchImpl: async () => ok() },
  );
  assert.equal(missingCookie.code, "SIGNED_CONSENT_AUTHORITY_REQUIRED");

  const gpc = await relayLaunchOsWebEventFromBrowser(
    input,
    { ...facts, secGpc: "1" },
    { env: ENV, nowImpl: () => NOW, fetchImpl: async () => ok() },
  );
  assert.equal(gpc.code, "GLOBAL_PRIVACY_CONTROL_REJECTED");

  const disabled = await relayLaunchOsWebEventFromBrowser(input, facts, {
    env: { ...ENV, LAUNCHOS_MEASUREMENT_ENABLED: "false" },
    nowImpl: () => NOW,
    fetchImpl: async () => ok(),
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.code, "MEASUREMENT_DISABLED");
  assert.equal(calls, 1);
});

test("browser attribution is approved once before it becomes a sealed snapshot", () => {
  const approved = bindLaunchOsMeasurementContext(CONTEXT, AUTHORITY_REFERENCE_HASH, ENV);
  assert.deepEqual(approved, AUTHORIZED_CONTEXT);

  const unapproved = bindLaunchOsMeasurementContext(CONTEXT, AUTHORITY_REFERENCE_HASH, {
    ...ENV,
    LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]",
  });
  assert.deepEqual(unapproved?.attribution, {});
  assert.equal(unapproved?.attributionAuthority, "approved_meta_identity_snapshot_v1");
  assert.equal(
    bindLaunchOsMeasurementContext(
      { ...CONTEXT, authorityReferenceHash: "f".repeat(64) } as LaunchOsMeasurementContext,
      AUTHORITY_REFERENCE_HASH,
      ENV,
    ),
    undefined,
    "a browser-supplied authority reference was accepted",
  );
});

test("one valid grant is reused and keeps the exact event fingerprint stable", async () => {
  const first = resolveLaunchOsConsentAuthorityBinding(null, NOW, ENV);
  assert.equal(first.fresh, true);
  assert.equal(first.code, "CONSENT_AUTHORITY_BOUND_FRESH");

  const reused = resolveLaunchOsConsentAuthorityBinding(first.cookie, NOW + 60_000, ENV);
  assert.equal(reused.fresh, false);
  assert.equal(reused.code, "CONSENT_AUTHORITY_REUSED");
  assert.equal(reused.cookie, first.cookie);
  assert.equal(reused.authorityReferenceHash, first.authorityReferenceHash);

  const facts = {
    requestUrl: "https://watchdive.example/",
    origin: "https://watchdive.example",
    secFetchSite: "same-origin",
    secGpc: null,
    serverFnHeader: "true",
    consentCookie: first.cookie,
    configuredPublicOrigin: "https://watchdive.example",
    nodeEnv: "production",
  };
  const input = {
    ...CONTEXT,
    placement: "page" as const,
    eventName: "landing_viewed" as const,
    eventId: `loe_v1_${"R".repeat(32)}`,
    occurredAt: "2026-08-02T09:00:00.000Z",
  };
  const bodies: string[] = [];
  for (const nowMs of [NOW, NOW + 60_000]) {
    const result = await relayLaunchOsWebEventFromBrowser(input, facts, {
      env: ENV,
      nowImpl: () => nowMs,
      nonceFactory: () => `n_${String(nowMs).padEnd(16, "0")}`,
      fetchImpl: async (_url, init) => {
        bodies.push(String(init?.body));
        return ok();
      },
    });
    assert.equal(result.status, "accepted");
  }
  assert.equal(bodies[0], bodies[1]);
  const event = (JSON.parse(bodies[0]) as { events: Record<string, unknown>[] }).events[0];
  assert.equal(event.authorityReferenceHash, first.authorityReferenceHash);

  const freshAfterExpiry = resolveLaunchOsConsentAuthorityBinding(
    first.cookie,
    NOW + 24 * 60 * 60 * 1_000 + 1_000,
    ENV,
  );
  assert.equal(freshAfterExpiry.fresh, true);
  assert.notEqual(freshAfterExpiry.authorityReferenceHash, first.authorityReferenceHash);
});

test("unconfigured relay is disabled and never calls fetch", async () => {
  let calls = 0;
  const result = await relayLaunchOsWebEvent(
    {
      ...CONTEXT,
      placement: "page",
      eventName: "landing_viewed",
      eventId: `loe_v1_${"C".repeat(32)}`,
      occurredAt: "2026-08-02T09:00:00.000Z",
    },
    AUTHORITY_REFERENCE_HASH,
    {
      env: {},
      nowImpl: () => NOW,
      fetchImpl: async () => {
        calls += 1;
        return ok();
      },
    },
  );
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("unapproved Meta identifiers degrade to attribution_unknown instead of polluting dimensions", async () => {
  let body = "";
  await relayLaunchOsWebEvent(
    {
      ...CONTEXT,
      placement: "page",
      eventName: "landing_viewed",
      eventId: `loe_v1_${"D".repeat(32)}`,
      occurredAt: "2026-08-02T09:00:00.000Z",
    },
    AUTHORITY_REFERENCE_HASH,
    {
      env: { ...ENV, LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]" },
      nowImpl: () => NOW,
      nonceFactory: () => "n_1234567890123456",
      fetchImpl: async (_url, init) => {
        body = String(init?.body);
        return ok();
      },
    },
  );
  const event = (JSON.parse(body) as { events: Record<string, unknown>[] }).events[0];
  assert.equal(event.channel, "attribution_unknown");
  assert.equal(event.campaignId, undefined);
  assert.equal(event.adsetId, undefined);
  assert.equal(event.adId, undefined);
});

test("signup relay separates web success from canonical lead and quality events", async () => {
  const payloads: { source: string; events: { eventName: string; canonicalLeadId?: string }[] }[] =
    [];
  const result = await relayStoredWaitlistLead({
    replayMetadata: sealLaunchOsReplayMetadata(REPLAY_SEED, ENV),
    dependencies: {
      env: ENV,
      sourceMeasurementRevoked: sourceMeasurementNotRevoked,
      nowImpl: () => NOW,
      nonceFactory: () => "n_1234567890123456",
      fetchImpl: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return ok();
      },
    },
  });
  assert.equal(result.webEvents.status, "accepted");
  assert.equal(result.leadStore.status, "accepted");
  assert.deepEqual(
    payloads.map((payload) => payload.source),
    ["watchdive_landing", "watchdive_lead_store"],
  );
  assert.deepEqual(
    payloads[0].events.map((event) => event.eventName),
    ["submit_succeeded"],
  );
  assert.deepEqual(
    payloads[1].events.map((event) => event.eventName),
    ["lead_created", "lead_validated"],
  );
  assert.match(payloads[1].events[0].canonicalLeadId ?? "", /^lead_hmacv1_[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(payloads).includes("diver@example.com"));
});

test("the sealed suspect outcome and quality rule survive replay", async () => {
  const payloads: { source: string; events: Record<string, unknown>[] }[] = [];
  await relayStoredWaitlistLead({
    replayMetadata: sealLaunchOsReplayMetadata({ ...REPLAY_SEED, suspect: true }, ENV),
    dependencies: {
      env: { ...ENV, LAUNCHOS_QUALITY_RULE_VERSION: "current-rule-drift" },
      sourceMeasurementRevoked: sourceMeasurementNotRevoked,
      nowImpl: () => NOW,
      nonceFactory: () => "n_1234567890123456",
      fetchImpl: async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return ok();
      },
    },
  });
  const validation = payloads
    .flatMap((payload) => payload.events)
    .find((event) => event.eventName === "lead_validation_failed");
  assert.ok(validation);
  assert.equal(validation.qualityRuleVersion, ENV.LAUNCHOS_QUALITY_RULE_VERSION);
  assert.equal(validation.statusReasonCode, "suspect_yes");
});

test("a resend replays the complete stored acquisition under current configuration drift", async () => {
  const envelope = sealLaunchOsReplayMetadata(REPLAY_SEED, ENV);
  const bodies: string[][] = [];
  for (const env of [
    ENV,
    {
      ...ENV,
      LAUNCHOS_PROJECT_ID: "a-different-current-project",
      LAUNCHOS_FUNNEL_VERSION: "a-different-current-funnel",
      LAUNCHOS_ENVIRONMENT: "preview",
      LAUNCHOS_QUALITY_RULE_VERSION: "a-different-current-rule",
      LAUNCHOS_VERIFICATION_POLICY_VERSION: "a-different-current-policy",
      LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET: "rotated-canonical-secret-32-bytes-min-06",
      LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]",
    },
  ]) {
    const payloads: string[] = [];
    await relayStoredWaitlistLead({
      replayMetadata: envelope,
      dependencies: {
        env,
        sourceMeasurementRevoked: sourceMeasurementNotRevoked,
        nowImpl: () => NOW + 120_000,
        nonceFactory: () => "n_1234567890123456",
        fetchImpl: async (_url, init) => {
          payloads.push(String(init?.body));
          return ok();
        },
      },
    });
    bodies.push(payloads);
  }
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(
    bodies[0].flatMap((body) =>
      (JSON.parse(body) as { events: { eventName: string }[] }).events.map(
        (event) => event.eventName,
      ),
    ),
    ["submit_succeeded", "lead_created", "lead_validated"],
  );
});

test("signup web and lead-store batches start in parallel under one bounded budget", async () => {
  const releases: (() => void)[] = [];
  let calls = 0;
  const pending = relayStoredWaitlistLead({
    replayMetadata: sealLaunchOsReplayMetadata(REPLAY_SEED, ENV),
    dependencies: {
      env: ENV,
      sourceMeasurementRevoked: sourceMeasurementNotRevoked,
      nowImpl: () => NOW,
      nonceFactory: () => `n_123456789012345${calls}`,
      fetchImpl: async () => {
        calls += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        return ok();
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, "one stream waited for the other instead of starting in parallel");
  releases.forEach((release) => release());
  await pending;
});

test("replay envelope is PII-free, tamper evident, and verification event id is deterministic", async () => {
  const envelope = sealLaunchOsReplayMetadata(REPLAY_SEED, ENV);
  assert.ok(!envelope.includes("@"));
  const snapshot = openLaunchOsReplayMetadata(envelope, ENV);
  assert.ok(snapshot);
  assert.equal(snapshot.contractVersion, LAUNCHOS_REPLAY_CONTRACT_VERSION);
  assert.equal(snapshot.projectId, ENV.LAUNCHOS_PROJECT_ID);
  assert.equal(snapshot.funnelVersion, ENV.LAUNCHOS_FUNNEL_VERSION);
  assert.equal(snapshot.environment, ENV.LAUNCHOS_ENVIRONMENT);
  assert.equal(snapshot.path, "website");
  assert.equal(snapshot.signedUpAt, REPLAY_SEED.signedUpAt);
  assert.equal(snapshot.suspect, false);
  assert.equal(snapshot.qualityRuleVersion, ENV.LAUNCHOS_QUALITY_RULE_VERSION);
  assert.equal(snapshot.verificationPolicyVersion, ENV.LAUNCHOS_VERIFICATION_POLICY_VERSION);
  assert.match(snapshot.canonicalLeadId, /^lead_hmacv1_[a-f0-9]{64}$/);
  assert.equal(snapshot.identityReasonCode, "canonical_email_hmac_v1");
  assert.equal(snapshot.attributionIdentityReasonCode, "approved_meta_identity_registry_match_v1");
  assert.equal(snapshot.authorityReferenceHash, AUTHORITY_REFERENCE_HASH);
  const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("0") ? "1" : "0"}`;
  assert.equal(openLaunchOsReplayMetadata(tampered, ENV), undefined);

  const events: { eventId: string; eventName: string }[] = [];
  const bodies: string[] = [];
  const send = (env: NodeJS.ProcessEnv) =>
    relayLaunchOsVerificationOutcome({
      replayMetadata: envelope,
      outcome: "verified",
      occurredAt: "2026-08-02T09:00:00.000Z",
      dependencies: {
        env,
        sourceMeasurementRevoked: sourceMeasurementNotRevoked,
        nowImpl: () => NOW,
        nonceFactory: () => "n_1234567890123456",
        fetchImpl: async (_url, init) => {
          const payload = JSON.parse(String(init?.body)) as {
            source: string;
            events: { eventId: string; eventName: string }[];
          };
          assert.equal(payload.source, "watchdive_verification");
          events.push(payload.events[0]);
          bodies.push(String(init?.body));
          assert.ok(!String(init?.body).includes("diver@example.com"));
          return ok();
        },
      },
    });
  assert.equal((await send(ENV)).status, "accepted");
  assert.equal(
    (
      await send({
        ...ENV,
        LAUNCHOS_PROJECT_ID: "a-different-current-project",
        LAUNCHOS_FUNNEL_VERSION: "a-different-current-funnel",
        LAUNCHOS_ENVIRONMENT: "preview",
        LAUNCHOS_QUALITY_RULE_VERSION: "a-different-current-rule",
        LAUNCHOS_VERIFICATION_POLICY_VERSION: "a-different-current-policy",
        LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET: "rotated-canonical-secret-32-bytes-min-06",
        LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]",
      })
    ).status,
    "accepted",
  );
  assert.equal(events[0].eventName, "lead_verified");
  assert.equal(events[0].eventId, events[1].eventId);
  assert.equal(bodies[0], bodies[1], "registry drift mutated an HMAC-sealed replay payload");
});

test("tampered and correctly signed malformed replay metadata fail closed before fetch", async () => {
  const valid = sealLaunchOsReplayMetadata(REPLAY_SEED, ENV);
  const tampered = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
  const encoded = Buffer.from(
    JSON.stringify({ contractVersion: LAUNCHOS_REPLAY_CONTRACT_VERSION }),
    "utf8",
  ).toString("base64url");
  const malformedMac = createHmac("sha256", ENV.WAITLIST_REPLAY_HMAC_SECRET)
    .update(`watchdive-launchos-replay-v3\n${encoded}`)
    .digest("hex");
  const malformed = `lorm_v3.${encoded}.${malformedMac}`;
  let calls = 0;

  for (const replayMetadata of [tampered, malformed, "lorm_v2.legacy.payload"]) {
    const result = await relayStoredWaitlistLead({
      replayMetadata,
      dependencies: {
        env: ENV,
        sourceMeasurementRevoked: sourceMeasurementNotRevoked,
        nowImpl: () => NOW,
        fetchImpl: async () => {
          calls += 1;
          return ok();
        },
      },
    });
    assert.equal(result.webEvents.status, "invalid");
    assert.equal(result.leadStore.status, "invalid");
  }
  assert.equal(calls, 0);
});

test("stored and verification replays fail closed when source revocation proof is absent or unavailable", async () => {
  const envelope = sealLaunchOsReplayMetadata(REPLAY_SEED, ENV);
  let calls = 0;
  for (const sourceMeasurementRevoked of [
    undefined,
    async () => true,
    async () => {
      throw new Error("source unavailable");
    },
  ]) {
    const dependencies = {
      env: ENV,
      nowImpl: () => NOW,
      ...(sourceMeasurementRevoked ? { sourceMeasurementRevoked } : {}),
      fetchImpl: async () => {
        calls += 1;
        return ok();
      },
    };
    const lead = await relayStoredWaitlistLead({ replayMetadata: envelope, dependencies });
    const verification = await relayLaunchOsVerificationOutcome({
      replayMetadata: envelope,
      outcome: "verified",
      occurredAt: "2026-08-02T09:00:00.000Z",
      dependencies,
    });
    assert.equal(lead.webEvents.status, "disabled");
    assert.equal(lead.leadStore.status, "disabled");
    assert.equal(verification.status, "disabled");
  }
  assert.equal(calls, 0);
});

test("verification event identity binds occurredAt and closes concurrent timestamp conflicts", async () => {
  const envelope = sealLaunchOsReplayMetadata(REPLAY_SEED, ENV);
  const send = async (occurredAt: string) => {
    let rawBody = "";
    const result = await relayLaunchOsVerificationOutcome({
      replayMetadata: envelope,
      outcome: "verified",
      occurredAt,
      dependencies: {
        env: ENV,
        sourceMeasurementRevoked: sourceMeasurementNotRevoked,
        nowImpl: () => NOW + 5 * 60_000,
        nonceFactory: () => "n_1234567890123456",
        fetchImpl: async (_url, init) => {
          rawBody = String(init?.body);
          return ok();
        },
      },
    });
    assert.equal(result.status, "accepted");
    return {
      rawBody,
      event: (JSON.parse(rawBody) as { events: { eventId: string; occurredAt: string }[] })
        .events[0],
    };
  };

  const first = await send("2026-08-02T09:02:00.000Z");
  const exactRetry = await send("2026-08-02T09:02:00.000Z");
  const racingWriter = await send("2026-08-02T09:02:00.001Z");
  assert.equal(first.rawBody, exactRetry.rawBody);
  assert.equal(first.event.eventId, exactRetry.event.eventId);
  assert.notEqual(first.event.eventId, racingWriter.event.eventId);
  assert.notEqual(first.event.occurredAt, racingWriter.event.occurredAt);
});
