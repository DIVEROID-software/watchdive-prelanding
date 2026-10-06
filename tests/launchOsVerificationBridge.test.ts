// The LaunchOS bridge from the signup/verification service is NOT wired.
//
// 4172529 connected the service and the Notion store to the LaunchOS relay
// (sealed replay envelope, stored-lead and verification dispatch). The
// production working tree committed verbatim in 5b5b1a1 had removed that
// wiring from service.ts, notionLead.ts and contracts.ts, and every release
// since (#5–#10) shipped without it; the 2026-10-03 tracking audit likewise
// records the LaunchOS files as present but not operationally connected.
//
// The relay, withdrawal and revocation modules themselves are still covered by
// launchOsRelay, measurementWithdrawal and measurementRevocationRegistry tests.
// This file pins the live truth instead: the service never prepares, stores or
// dispatches LaunchOS measurement. Re-enabling LaunchOS is an owner decision;
// the original bridge contract tests are in 4172529 to restore alongside it.
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
  type LaunchOsAuthorizedMeasurementContext,
} from "../src/lib/verification/contracts.ts";
import { createNotionLeadStore } from "../src/lib/verification/notionLead.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);
const CONTEXT: LaunchOsAuthorizedMeasurementContext = {
  funnelInstanceId: `fi_v1_${"A".repeat(32)}`,
  attribution: { campaignId: "1001", adsetId: "2002", adId: "3003" },
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
let launchOsCalls: string[];

function deps(): ServiceDependencies {
  // The hooks the 4172529 bridge used. The live service must not call them.
  const launchOsHooks = {
    prepareLaunchOsReplayMetadata: () => {
      launchOsCalls.push("prepare");
      return "lorm_v3.payload.mac";
    },
    dispatchStoredLeadMeasurement: async () => {
      launchOsCalls.push("stored");
    },
    dispatchVerificationMeasurement: async () => {
      launchOsCalls.push("verification");
    },
  };
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    ...launchOsHooks,
  } as ServiceDependencies;
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  clock = new Date("2026-08-02T09:00:00.000Z");
  launchOsCalls = [];
});

test("a granted, authorized signup and its confirmation never touch LaunchOS", async () => {
  const signup = await requestVerificationService(
    {
      email: EMAIL,
      canonical: CANONICAL,
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: true,
      networkSendBlocked: false,
      launchOsMeasurement: CONTEXT,
    } as Parameters<typeof requestVerificationService>[0],
    deps(),
  );
  assert.equal(signup.status, "pending");
  assert.equal(mailer.sent.length, 1);
  assert.equal(store.createPendingInputs.length, 1);
  assert.equal("launchOsReplayMetadata" in store.createPendingInputs[0], false);

  clock = new Date(clock.getTime() + 120_000);
  const confirmed = await confirmVerificationService(mailer.sent[0].token, deps());
  assert.equal(confirmed.status, "verified");
  assert.deepEqual(launchOsCalls, []);
});

test("Notion writes no LaunchOS replay column or measurement grant marker", async () => {
  const requests: unknown[] = [];
  const notionStore = createNotionLeadStore(async (_method, _path, body) => {
    requests.push(body);
    return { id: "notion-page-1", properties: { Email: { title: [{ plain_text: EMAIL }] } } };
  }, "database-1");

  await notionStore.createPending({
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: clock.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    expiresAt: new Date(clock.getTime() + 86_400_000).toISOString(),
    // A stale caller passing the old envelope must not get it written.
    launchOsReplayMetadata: "lorm_v3.payload.mac",
  } as Parameters<typeof notionStore.createPending>[0]);

  const written = requests[0] as { properties: Record<string, unknown> };
  assert.equal(FIELD_LAUNCHOS_REPLAY_METADATA in written.properties, false);
  assert.equal(FIELD_MEASUREMENT_CONSENT in written.properties, false);
});
