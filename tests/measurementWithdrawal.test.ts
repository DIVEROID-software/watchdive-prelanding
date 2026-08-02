import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  launchOsMeasurementWithdrawalSchema,
  type LaunchOsMeasurementWithdrawalInput,
} from "../src/lib/api/launchOsWithdrawal.contract.ts";
import {
  openLaunchOsWithdrawalRetryCapability,
  postLaunchOsMeasurementWithdrawal,
  withdrawLaunchOsMeasurementFromBrowser,
} from "../src/lib/api/launchOsWithdrawal.server.ts";
import {
  createLaunchOsConsentCookie,
  launchOsHmacCanonicalString,
  relayLaunchOsWebEventFromBrowser,
} from "../src/lib/api/launchOsRelay.server.ts";
import {
  acknowledgePendingMeasurementWithdrawal,
  beginPendingMeasurementWithdrawal,
  MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY,
  readPendingMeasurementWithdrawal,
} from "../src/lib/measurementWithdrawal.ts";
import { runBoundedExternalMeasurementSuppression } from "../src/lib/measurementWithdrawalWorker.server.ts";

const NOW = Date.parse("2026-08-02T09:00:00.000Z");
const FUNNEL_INSTANCE_ID = `fi_v1_${"A".repeat(32)}`;
const INPUT: LaunchOsMeasurementWithdrawalInput = {
  requestId: `pwr_v1_${"B".repeat(32)}`,
  funnelInstanceId: FUNNEL_INSTANCE_ID,
  occurredAt: "2026-08-02T09:00:00.000Z",
  reason: "user_denied",
};

const ENV = {
  LAUNCHOS_MEASUREMENT_ENABLED: "true",
  LAUNCHOS_WITHDRAWAL_ENABLED: "true",
  LAUNCHOS_BASE_URL: "http://localhost:4178",
  LAUNCHOS_PROJECT_ID: "watchdive-prelanding",
  LAUNCHOS_WITHDRAWAL_INGRESS_KEY_ID: "watchdive.privacy.v1",
  LAUNCHOS_WITHDRAWAL_INGRESS_SECRET: "withdrawal-secret-32-bytes-minimum-06",
  LAUNCHOS_WEB_EVENTS_INGRESS_KEY_ID: "watchdive.web.v1",
  LAUNCHOS_WEB_EVENTS_INGRESS_SECRET: "web-events-secret-32-bytes-minimum-01",
  LAUNCHOS_LEAD_STORE_INGRESS_KEY_ID: "watchdive.lead.v1",
  LAUNCHOS_LEAD_STORE_INGRESS_SECRET: "lead-store-secret-32-bytes-minimum-02",
  LAUNCHOS_VERIFICATION_INGRESS_KEY_ID: "watchdive.verify.v1",
  LAUNCHOS_VERIFICATION_INGRESS_SECRET: "verification-secret-32-bytes-min-03",
  LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET: "canonical-lead-secret-32-bytes-min-04",
  WAITLIST_REPLAY_HMAC_SECRET: "replay-envelope-secret-32-bytes-min-05",
  LAUNCHOS_FUNNEL_VERSION: "wd-prelaunch-v1",
  LAUNCHOS_ENVIRONMENT: "development",
  LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON: "[]",
} satisfies NodeJS.ProcessEnv;

const sourceRevocationSucceeds = async () => ({ matchedRows: 1 });

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function sessionSnapshot(funnelInstanceId = FUNNEL_INSTANCE_ID) {
  return JSON.stringify({
    version: 1,
    funnelInstanceId,
    attribution: {},
    measurementConsent: {
      purpose: "advertising_measurement",
      state: "granted",
      version: "WD-AD-MEASUREMENT-CONSENT-V1",
    },
    events: {},
  });
}

function browserFacts(cookie: string, secGpc: string | null = null) {
  return {
    requestUrl: "http://localhost:3000/",
    origin: "http://localhost:3000",
    secFetchSite: "same-origin",
    secGpc,
    serverFnHeader: "true",
    consentCookie: cookie,
    nodeEnv: "development",
  };
}

test("withdrawal browser contract is exact and rejects PII and lead identifiers", () => {
  assert.equal(launchOsMeasurementWithdrawalSchema.safeParse(INPUT).success, true);
  for (const forbidden of [
    { email: "diver@example.com" },
    { phone: "+821012345678" },
    { canonicalLeadId: `lead_hmacv1_${"a".repeat(64)}` },
    { authorityReferenceHash: "a".repeat(64) },
  ]) {
    assert.equal(
      launchOsMeasurementWithdrawalSchema.safeParse({ ...INPUT, ...forbidden }).success,
      false,
    );
  }
});

test("the hydrated withdrawal shell contains neither Node crypto nor credential names", () => {
  const shell = readFileSync("src/lib/api/launchOsWithdrawal.ts", "utf8");
  assert.ok(shell.includes('await import("./launchOsWithdrawal.server.ts")'));
  for (const forbidden of [
    "node:crypto",
    "createHmac",
    "LAUNCHOS_WITHDRAWAL_INGRESS_SECRET",
    "LAUNCHOS_SITES_BEARER_TOKEN",
    "WAITLIST_REPLAY_HMAC_SECRET",
    "authorityReferenceHash",
    "canonicalLeadId",
  ]) {
    assert.ok(!shell.includes(forbidden), `${forbidden} leaked into the client shell`);
  }
});

test("one PII-free pending marker is persisted before the funnel session is cleared", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  sessionStorage.setItem("watchdive.launchos-funnel.v1", sessionSnapshot());
  const environment = {
    localStorage,
    sessionStorage,
    now: () => new Date(NOW),
    fillRandom: (bytes: Uint8Array) => bytes.fill(7),
  };

  const first = beginPendingMeasurementWithdrawal("user_denied", environment);
  assert.ok(first);
  assert.equal(first.persisted, true);
  const second = beginPendingMeasurementWithdrawal("global_privacy_control", environment);
  assert.deepEqual(second?.intent, first.intent, "retry identity changed");

  const raw = localStorage.getItem(MEASUREMENT_WITHDRAWAL_PENDING_STORAGE_KEY) ?? "";
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    "funnelInstanceId",
    "occurredAt",
    "reason",
    "requestId",
  ]);
  assert.ok(!raw.includes("@"));
  assert.ok(!/email|phone|canonical|authority|campaign|adset/i.test(raw));
  assert.equal(acknowledgePendingMeasurementWithdrawal(first.intent.requestId, environment), true);
  assert.equal(readPendingMeasurementWithdrawal(environment), null);
});

test("invalid or unconsented session snapshots cannot create a withdrawal capability", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  sessionStorage.setItem("watchdive.launchos-funnel.v1", sessionSnapshot(`fi_v1_${"short"}`));
  assert.equal(
    beginPendingMeasurementWithdrawal("user_denied", { localStorage, sessionStorage }),
    null,
  );
});

test("privacy ingress uses a dedicated HMAC key, stable body, fresh nonce, and bounded retry", async () => {
  const calls: Array<{ body: string; headers: Record<string, string> }> = [];
  let nonce = 0;
  const result = await postLaunchOsMeasurementWithdrawal(INPUT, {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => `n_${String(++nonce).padStart(16, "0")}`,
    sleepImpl: async () => {},
    fetchImpl: async (_url, init) => {
      calls.push({
        body: String(init?.body),
        headers: init?.headers as Record<string, string>,
      });
      return calls.length === 1
        ? new Response("retry", { status: 503 })
        : Response.json(
            {
              ok: true,
              duplicate: false,
              status: "pending_purge",
              linkedCanonicalLeadCount: 1,
            },
            { status: 202 },
          );
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.status, "pending_purge");
  assert.equal(result.auditState, "tombstone_recorded");
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body, "idempotent retry body drifted");
  const payload = JSON.parse(calls[0].body) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload), [
    "projectId",
    "source",
    "sourceRunId",
    "requestId",
    "funnelInstanceId",
    "occurredAt",
  ]);
  assert.equal(payload.source, "watchdive_landing");
  assert.ok(!/email|phone|canonical|authority|reason/i.test(calls[0].body));
  assert.notEqual(calls[0].headers["X-LaunchOS-Nonce"], calls[1].headers["X-LaunchOS-Nonce"]);
  for (const call of calls) {
    const canonical = launchOsHmacCanonicalString(
      ENV.LAUNCHOS_WITHDRAWAL_INGRESS_KEY_ID,
      call.headers["X-LaunchOS-Timestamp"],
      call.headers["X-LaunchOS-Nonce"],
      "/api/privacy/withdrawals",
      call.body,
    );
    assert.equal(
      call.headers["X-LaunchOS-Signature"],
      createHmac("sha256", ENV.LAUNCHOS_WITHDRAWAL_INGRESS_SECRET).update(canonical).digest("hex"),
    );
  }
});

test("accepted tombstone clears the authority and blocks a later browser relay", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  let liveCookie: string | null = cookie;
  let cleared = 0;
  const result = await withdrawLaunchOsMeasurementFromBrowser(INPUT, browserFacts(cookie), {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => "n_1234567890123456",
    clearAuthority: () => {
      liveCookie = null;
      cleared += 1;
    },
    revokeSourceMeasurement: sourceRevocationSucceeds,
    fetchImpl: async () =>
      Response.json(
        {
          ok: true,
          duplicate: false,
          status: "purged",
          linkedCanonicalLeadCount: 1,
        },
        { status: 200 },
      ),
  });
  assert.equal(result.status, "purged");
  assert.equal(result.auditState, "purge_completed");
  assert.equal(cleared, 1);

  let relayCalls = 0;
  const later = await relayLaunchOsWebEventFromBrowser(
    {
      funnelInstanceId: FUNNEL_INSTANCE_ID,
      attribution: {},
      measurementConsent: {
        purpose: "advertising_measurement",
        state: "granted",
        version: "WD-AD-MEASUREMENT-CONSENT-V1",
      },
      eventName: "landing_viewed",
      eventId: `loe_v1_${"C".repeat(32)}`,
      occurredAt: "2026-08-02T09:00:00.000Z",
      placement: "page",
    },
    { ...browserFacts(cookie), consentCookie: liveCookie },
    {
      env: ENV,
      nowImpl: () => NOW,
      fetchImpl: async () => {
        relayCalls += 1;
        return Response.json({ ok: true });
      },
    },
  );
  assert.equal(later.code, "SIGNED_CONSENT_AUTHORITY_REQUIRED");
  assert.equal(relayCalls, 0);
});

test("GPC can initiate withdrawal but cannot be forged by the browser payload", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  let calls = 0;
  const dependencies = {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => "n_1234567890123456",
    revokeSourceMeasurement: sourceRevocationSucceeds,
    fetchImpl: async () => {
      calls += 1;
      return Response.json(
        {
          ok: true,
          duplicate: false,
          status: "pending_purge",
          linkedCanonicalLeadCount: 0,
        },
        { status: 202 },
      );
    },
  };
  const accepted = await withdrawLaunchOsMeasurementFromBrowser(
    { ...INPUT, reason: "global_privacy_control" },
    browserFacts(cookie, "1"),
    dependencies,
  );
  assert.equal(accepted.accepted, true);

  const forged = await withdrawLaunchOsMeasurementFromBrowser(
    { ...INPUT, reason: "global_privacy_control" },
    browserFacts(cookie),
    dependencies,
  );
  assert.equal(forged.code, "GPC_SIGNAL_REQUIRED");
  assert.equal(calls, 1);
});

test("disabled or exhausted delivery clears authority immediately without claiming an audit receipt", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  let cleared = 0;
  let calls = 0;
  const disabled = await withdrawLaunchOsMeasurementFromBrowser(INPUT, browserFacts(cookie), {
    env: { ...ENV, LAUNCHOS_WITHDRAWAL_ENABLED: "false" },
    nowImpl: () => NOW,
    clearAuthority: () => {
      cleared += 1;
    },
    revokeSourceMeasurement: sourceRevocationSucceeds,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.accepted, false);
  assert.equal(disabled.auditState, "not_recorded");

  const failed = await withdrawLaunchOsMeasurementFromBrowser(INPUT, browserFacts(cookie), {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => `n_${String(++calls).padStart(16, "0")}`,
    sleepImpl: async () => {},
    clearAuthority: () => {
      cleared += 1;
    },
    revokeSourceMeasurement: sourceRevocationSucceeds,
    fetchImpl: async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 2);
  assert.equal(failed.retryable, true);
  assert.equal(cleared, 2, "authority survived a disabled or failed withdrawal transport");
});

test("a failed transport retries only the exact intent with a withdrawal-only HttpOnly capability", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  let capability = "";
  let clearedAuthority = 0;
  let clearedCapability = 0;
  let sourceRevocations = 0;
  let fetchCalls = 0;
  const common = {
    env: ENV,
    nowImpl: () => NOW,
    nonceFactory: () => `n_${String(fetchCalls + 1).padStart(16, "0")}`,
    sleepImpl: async () => {},
    clearAuthority: () => {
      clearedAuthority += 1;
    },
    setRetryCapability: (value: string) => {
      capability = value;
    },
    clearRetryCapability: () => {
      clearedCapability += 1;
    },
    revokeSourceMeasurement: async () => {
      sourceRevocations += 1;
      return { matchedRows: 1 };
    },
  };
  const failed = await withdrawLaunchOsMeasurementFromBrowser(INPUT, browserFacts(cookie), {
    ...common,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.equal(failed.accepted, false);
  assert.equal(failed.retryPending, true);
  assert.equal(failed.sourceSuppression, "complete");
  assert.equal(clearedAuthority, 1);
  assert.match(capability, /^wdwrc_v1\./);
  const opened = openLaunchOsWithdrawalRetryCapability(capability, INPUT, NOW, ENV);
  assert.equal(opened?.authorityReferenceHash.length, 64);
  assert.equal(
    openLaunchOsWithdrawalRetryCapability(capability, INPUT, NOW + 7 * 24 * 60 * 60_000 + 1, ENV),
    undefined,
  );

  const mutated = { ...INPUT, occurredAt: "2026-08-02T09:00:00.001Z" };
  assert.equal(openLaunchOsWithdrawalRetryCapability(capability, mutated, NOW, ENV), undefined);
  const rejected = await withdrawLaunchOsMeasurementFromBrowser(
    mutated,
    { ...browserFacts(cookie), consentCookie: null, withdrawalRetryCapability: capability },
    { ...common, fetchImpl: async () => Response.json({ ok: true }) },
  );
  assert.equal(rejected.code, "WITHDRAWAL_AUTHORITY_REQUIRED");

  const retried = await withdrawLaunchOsMeasurementFromBrowser(
    INPUT,
    { ...browserFacts(cookie), consentCookie: null, withdrawalRetryCapability: capability },
    {
      ...common,
      fetchImpl: async () => {
        fetchCalls += 1;
        return Response.json(
          {
            ok: true,
            duplicate: true,
            status: "pending_purge",
            linkedCanonicalLeadCount: 1,
          },
          { status: 202 },
        );
      },
    },
  );
  assert.equal(retried.accepted, true);
  assert.equal(retried.retryPending, false);
  assert.equal(retried.sourceSuppression, "complete");
  assert.equal(clearedCapability, 1);
  assert.equal(clearedAuthority, 2);
  assert.equal(sourceRevocations, 2);
});

test("an accepted LaunchOS tombstone keeps retry pending until source suppression succeeds", async () => {
  const cookie = createLaunchOsConsentCookie(NOW, ENV);
  let cleared = 0;
  const result = await withdrawLaunchOsMeasurementFromBrowser(INPUT, browserFacts(cookie), {
    env: ENV,
    nowImpl: () => NOW,
    clearAuthority: () => {
      cleared += 1;
    },
    revokeSourceMeasurement: async () => {
      throw new Error("Notion unavailable");
    },
    fetchImpl: async () =>
      Response.json(
        {
          ok: true,
          duplicate: false,
          status: "pending_purge",
          linkedCanonicalLeadCount: 1,
        },
        { status: 202 },
      ),
  });
  assert.equal(result.accepted, true, "aggregate exclusion receipt was hidden");
  assert.equal(result.auditState, "tombstone_recorded");
  assert.equal(result.sourceSuppression, "pending");
  assert.equal(result.retryPending, true);
  assert.equal(cleared, 1);
});

test("external source suppression is bounded and remains explicitly unconfigured by default", async () => {
  const none = await runBoundedExternalMeasurementSuppression(INPUT, []);
  assert.equal(none.configuredAdapters, 0);
  assert.equal(none.allSettled, false);

  let notionCalls = 0;
  const run = await runBoundedExternalMeasurementSuppression(
    INPUT,
    [
      {
        key: "notion_waitlist",
        suppress: async (value) => {
          assert.deepEqual(value, INPUT);
          notionCalls += 1;
          return notionCalls === 1
            ? { state: "retryable_failure", auditCode: "NOTION_RETRYABLE" }
            : { state: "suppressed", auditCode: "NOTION_SUPPRESSED" };
        },
      },
      {
        key: "email_provider",
        suppress: async () => ({ state: "not_found", auditCode: "EMAIL_NOT_FOUND" }),
      },
    ],
    { sleep: async () => {} },
  );
  assert.equal(run.allSettled, true);
  assert.equal(notionCalls, 2);
  assert.deepEqual(
    run.results.map(({ adapter, state, attempts }) => ({ adapter, state, attempts })),
    [
      { adapter: "notion_waitlist", state: "suppressed", attempts: 2 },
      { adapter: "email_provider", state: "not_found", attempts: 1 },
    ],
  );
});
