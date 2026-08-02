import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  confirmVerificationService,
  requestVerificationService,
  type ServiceDependencies,
} from "../src/lib/verification/service.ts";
import {
  FIELD_LAUNCHOS_REPLAY_METADATA,
  FIELD_MEASUREMENT_CONSENT,
  LAUNCHOS_REPLAY_METADATA_MAX_LENGTH,
  MEASUREMENT_CONSENT_GRANTED,
  type LaunchOsAuthorizedMeasurementContext,
} from "../src/lib/verification/contracts.ts";
import { createNotionLeadStore } from "../src/lib/verification/notionLead.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);
const REPLAY_METADATA = "lorm_v3.payload.mac";
const CONTEXT: LaunchOsAuthorizedMeasurementContext = {
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
  authorityReferenceHash: "e".repeat(64),
  attributionAuthority: "approved_meta_identity_snapshot_v1",
};

let store: FakeLeadStore;
let mailer: FakeMailer;
let clock: Date;
let storedDispatches: unknown[];
let verificationDispatches: unknown[];
let preparedReplaySeeds: unknown[];

function input(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    launchOsMeasurement: CONTEXT,
    ...overrides,
  };
}

function deps(overrides: Partial<ServiceDependencies> = {}): ServiceDependencies {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    prepareLaunchOsReplayMetadata: (value) => {
      preparedReplaySeeds.push(value);
      return REPLAY_METADATA;
    },
    dispatchStoredLeadMeasurement: async (value) => {
      storedDispatches.push(value);
    },
    dispatchVerificationMeasurement: async (value) => {
      verificationDispatches.push(value);
    },
    ...overrides,
  };
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  clock = new Date("2026-08-02T09:00:00.000Z");
  storedDispatches = [];
  verificationDispatches = [];
  preparedReplaySeeds = [];
});

test("a new CRM row is committed before submit/new/quality measurement is dispatched", async () => {
  await requestVerificationService(input(), deps());

  assert.equal(store.createPendingInputs.length, 1);
  assert.equal(store.createPendingInputs[0].launchOsReplayMetadata, REPLAY_METADATA);
  assert.deepEqual(preparedReplaySeeds, [
    {
      canonicalEmail: CANONICAL,
      suspect: false,
      signedUpAt: "2026-08-02T09:00:00.000Z",
      context: CONTEXT,
    },
  ]);
  assert.deepEqual(storedDispatches, [
    {
      replayMetadata: REPLAY_METADATA,
    },
  ]);
});

test("service waits for a bounded adapter attempt but swallows its failure", async () => {
  let release!: () => void;
  const adapter = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled = false;
  const pending = requestVerificationService(
    input(),
    deps({ dispatchStoredLeadMeasurement: async () => adapter }),
  ).then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "the service returned before the adapter attempt completed");
  assert.equal(mailer.sent.length, 1, "email hand-off waited for the measurement adapter");
  release();
  await pending;
  assert.equal(settled, true);

  const result = await requestVerificationService(
    input({ email: "second@example.com", canonical: "second@example.com" }),
    deps({ dispatchStoredLeadMeasurement: async () => Promise.reject(new Error("offline")) }),
  );
  assert.equal(result.status, "pending");
});

test("a resend replays the complete stored envelope and does not rewrite first touch", async () => {
  await requestVerificationService(input(), deps());
  const original = store.createPendingInputs[0].launchOsReplayMetadata;
  storedDispatches = [];
  clock = new Date(clock.getTime() + 120_000);

  await requestVerificationService(
    input({ launchOsMeasurement: { ...CONTEXT, placement: "offer" } }),
    deps(),
  );

  assert.equal(store.startAttemptCalls, 1);
  assert.equal(store.createPendingInputs[0].launchOsReplayMetadata, original);
  assert.deepEqual(storedDispatches, [{ replayMetadata: REPLAY_METADATA }]);
  assert.equal(preparedReplaySeeds.length, 1, "resend resealed current browser state");
});

test("a first relay failure is recovered by a later resend from the CRM envelope", async () => {
  let attempts = 0;
  await requestVerificationService(
    input(),
    deps({
      dispatchStoredLeadMeasurement: async () => {
        attempts += 1;
        throw new Error("relay unavailable");
      },
    }),
  );
  assert.equal(attempts, 1);
  const storedEnvelope = store.createPendingInputs[0].launchOsReplayMetadata;
  assert.equal(storedEnvelope, REPLAY_METADATA);

  clock = new Date(clock.getTime() + 120_000);
  const recovered: unknown[] = [];
  await requestVerificationService(
    input({
      suspect: true,
      launchOsMeasurement: { ...CONTEXT, attribution: {}, placement: "offer" },
    }),
    deps({ dispatchStoredLeadMeasurement: async (value) => void recovered.push(value) }),
  );
  assert.deepEqual(recovered, [{ replayMetadata: REPLAY_METADATA }]);
  assert.equal(preparedReplaySeeds.length, 1, "recovery used current browser state");
});

test("a cooldown duplicate also retries the complete stored envelope", async () => {
  await requestVerificationService(input(), deps());
  storedDispatches = [];
  await requestVerificationService(
    input({ launchOsMeasurement: undefined, measurementConsent: false }),
    deps(),
  );
  assert.deepEqual(storedDispatches, [{ replayMetadata: REPLAY_METADATA }]);
});

test("a failed CRM create emits no successful funnel stage", async () => {
  store.createPending = async () => {
    throw new Error("Notion unavailable");
  };
  await assert.rejects(requestVerificationService(input(), deps()), /Notion unavailable/);
  assert.deepEqual(storedDispatches, []);
});

test("a source-side replay clear wins over stale lead objects before every dispatch", async () => {
  const originalReread = store.reread.bind(store);
  store.reread = async (pageId) => {
    const current = await originalReread(pageId);
    return current ? { ...current, launchOsReplayMetadata: undefined } : undefined;
  };
  const signup = await requestVerificationService(input(), deps());
  assert.equal(signup.status, "pending");
  assert.equal(mailer.sent.length, 1, "privacy telemetry suppression broke the signup");
  assert.deepEqual(storedDispatches, [], "stale CRM replay metadata reached the adapter");

  store = new FakeLeadStore();
  mailer = new FakeMailer();
  storedDispatches = [];
  verificationDispatches = [];
  await requestVerificationService(input(), deps());
  const token = mailer.sent[0].token;
  const freshReread = store.reread.bind(store);
  store.reread = async (pageId) => {
    const current = await freshReread(pageId);
    return current ? { ...current, launchOsReplayMetadata: undefined } : undefined;
  };
  clock = new Date(clock.getTime() + 120_000);
  const confirmed = await confirmVerificationService(token, deps());
  assert.equal(confirmed.status, "verified");
  assert.deepEqual(
    verificationDispatches,
    [],
    "verification telemetry was called after source revocation",
  );
});

test("known verified and expired outcomes use the sealed replay context", async () => {
  await requestVerificationService(input(), deps());
  const token = mailer.sent[0].token;
  clock = new Date(clock.getTime() + 120_000);
  const verified = await confirmVerificationService(token, deps());
  assert.equal(verified.status, "verified");
  assert.equal((verificationDispatches[0] as { outcome: string }).outcome, "verified");
  const firstVerifiedOccurredAt = (verificationDispatches[0] as { occurredAt: string }).occurredAt;
  clock = new Date(clock.getTime() + 5 * 60_000);
  assert.equal((await confirmVerificationService(token, deps())).status, "already_verified");
  assert.equal(
    (verificationDispatches[1] as { occurredAt: string }).occurredAt,
    firstVerifiedOccurredAt,
  );

  store = new FakeLeadStore();
  mailer = new FakeMailer();
  verificationDispatches = [];
  clock = new Date("2026-08-02T09:00:00.000Z");
  await requestVerificationService(input(), deps());
  const expiredToken = mailer.sent[0].token;
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.ok(row);
  row.expiresAt = "2026-08-02T08:59:59.000Z";

  const expired = await confirmVerificationService(expiredToken, deps());
  assert.equal(expired.status, "expired");
  clock = new Date(clock.getTime() + 5 * 60_000);
  assert.equal((await confirmVerificationService(expiredToken, deps())).status, "expired");
  assert.deepEqual(
    verificationDispatches.map((value) => ({
      outcome: (value as { outcome: string }).outcome,
      reasonCode: (value as { reasonCode?: string }).reasonCode,
      occurredAt: (value as { occurredAt: string }).occurredAt,
    })),
    [
      {
        outcome: "failed",
        reasonCode: "expired",
        occurredAt: "2026-08-02T08:59:59.000Z",
      },
      {
        outcome: "failed",
        reasonCode: "expired",
        occurredAt: "2026-08-02T08:59:59.000Z",
      },
    ],
  );
});

test("concurrent verification timestamps remain individually immutable and later retry uses CRM", async () => {
  await requestVerificationService(input(), deps());
  const token = mailer.sent[0].token;
  verificationDispatches = [];
  const firstTime = new Date("2026-08-02T09:02:00.000Z");
  const secondTime = new Date("2026-08-02T09:02:00.001Z");

  const [first, second] = await Promise.all([
    confirmVerificationService(token, deps({ now: () => firstTime })),
    confirmVerificationService(token, deps({ now: () => secondTime })),
  ]);
  assert.ok([first.status, second.status].every((status) => status === "verified"));
  assert.deepEqual(
    verificationDispatches.map((value) => (value as { occurredAt: string }).occurredAt).sort(),
    [firstTime.toISOString(), secondTime.toISOString()],
  );

  const stored = await store.findByEmail(CANONICAL, EMAIL);
  assert.ok(stored?.verifiedAt);
  clock = new Date("2026-08-02T09:05:00.000Z");
  await confirmVerificationService(token, deps());
  assert.equal(
    (verificationDispatches.at(-1) as { occurredAt: string }).occurredAt,
    new Date(stored.verifiedAt).toISOString(),
  );
});

test("an invalid stored expiry emits no ambiguous deterministic failure event", async () => {
  await requestVerificationService(input(), deps());
  const token = mailer.sent[0].token;
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.ok(row);
  row.expiresAt = "not-a-date";

  assert.equal((await confirmVerificationService(token, deps())).status, "expired");
  clock = new Date(clock.getTime() + 5 * 60_000);
  assert.equal((await confirmVerificationService(token, deps())).status, "expired");
  assert.deepEqual(verificationDispatches, []);
});

test("invalid or consent-denied attempts produce no LaunchOS verification outcome", async () => {
  assert.equal((await confirmVerificationService("not-a-token", deps())).status, "invalid");
  assert.deepEqual(verificationDispatches, []);

  await requestVerificationService(
    input({ measurementConsent: false, launchOsMeasurement: undefined }),
    deps(),
  );
  clock = new Date(clock.getTime() + 120_000);
  await confirmVerificationService(mailer.sent[0].token, deps());
  assert.deepEqual(verificationDispatches, []);
});

test("LaunchOS verification remains independent from the Meta pixel consent boolean", async () => {
  await requestVerificationService(input({ measurementConsent: false }), deps());
  clock = new Date(clock.getTime() + 120_000);
  assert.equal((await confirmVerificationService(mailer.sent[0].token, deps())).status, "verified");
  assert.equal(verificationDispatches.length, 1);
  assert.equal((verificationDispatches[0] as { outcome: string }).outcome, "verified");
});

test("Notion keeps the existing replay column byte-exact and refuses silent truncation", async () => {
  const requests: unknown[] = [];
  const exactEnvelope = `lorm_v3.${"a".repeat(1_720)}.${"b".repeat(64)}`;
  const notionStore = createNotionLeadStore(async (_method, _path, body) => {
    requests.push(body);
    return {
      id: "notion-page-1",
      properties: {
        Email: { title: [{ plain_text: EMAIL }] },
        [FIELD_LAUNCHOS_REPLAY_METADATA]: {
          rich_text: [{ plain_text: exactEnvelope }],
        },
      },
    };
  }, "database-1");
  const createInput = {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [] as string[],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    expiresAt: new Date(clock.getTime() + 86_400_000).toISOString(),
    launchOsReplayMetadata: exactEnvelope,
  };
  await notionStore.createPending(createInput);
  const written = requests[0] as {
    properties: Record<string, { rich_text?: { text?: { content?: string } }[] }>;
  };
  assert.equal(
    written.properties[FIELD_LAUNCHOS_REPLAY_METADATA].rich_text?.[0]?.text?.content,
    exactEnvelope,
  );
  assert.equal(
    written.properties[FIELD_MEASUREMENT_CONSENT].rich_text?.[0]?.text?.content,
    MEASUREMENT_CONSENT_GRANTED,
  );
  await assert.rejects(
    notionStore.createPending({
      ...createInput,
      launchOsReplayMetadata: "x".repeat(LAUNCHOS_REPLAY_METADATA_MAX_LENGTH + 1),
    }),
    /exceeds the CRM field bound/,
  );
  assert.equal(requests.length, 1);
});

test("Notion writes no measurement grant marker without an authorized replay envelope", async () => {
  const requests: unknown[] = [];
  const notionStore = createNotionLeadStore(async (_method, _path, body) => {
    requests.push(body);
    return {
      id: "notion-page-unconsented",
      properties: {
        Email: { title: [{ plain_text: EMAIL }] },
      },
    };
  }, "database-1");

  await notionStore.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [] as string[],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
    expiresAt: new Date(clock.getTime() + 86_400_000).toISOString(),
  });

  const written = requests[0] as { properties: Record<string, unknown> };
  assert.equal(FIELD_MEASUREMENT_CONSENT in written.properties, false);
});
