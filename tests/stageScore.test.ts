// Staged WatchDiveStageScore hooks. No Meta, no deploy, no live Stripe.
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contractMetadata, reservationEmailHash } from "../src/lib/reservation/checkout.ts";
import { reservationCanonicalEmail } from "../src/lib/reservation/emailIdentity.ts";
import { processReservationWebhook } from "../src/lib/reservation/webhook.ts";
import type { EnabledReservationConfig } from "../src/lib/reservation/config.ts";
import type {
  StripeApi,
  StripeCharge,
  StripeCheckoutSession,
  StripeCustomer,
  StripePaymentIntent,
} from "../src/lib/reservation/stripeApi.ts";
import { completeSocialIdentity } from "../src/lib/socialAuth/complete.ts";
import type { SocialState } from "../src/lib/socialAuth/state.ts";
import { personKey } from "../src/lib/stageScore/identity.ts";
import { SCHEMA_SQL, readLedger } from "../src/lib/stageScore/ledger.ts";
import {
  resetStageScoreDiagnostics,
  stageScoreDiagnostics,
} from "../src/lib/stageScore/observe.ts";
import { savePhoneOptInService } from "../src/lib/verification/phoneOptIn.ts";
import {
  confirmVerificationService,
  requestVerificationService,
  withdrawAttemptMeasurementService,
} from "../src/lib/verification/service.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, leadIdFactory } from "./helpers/fakes.ts";

const SCORING = fileURLToPath(
  new URL("./fixtures/weighted-scoring/", import.meta.url),
);
const COHORT = "2026-10-25T00:00:00+00:00";
const SIGNUP = new Date("2026-10-25T01:00:00.000Z");
const MATURE = "2026-10-27T02:00:00+00:00";
const EARLY = "2026-10-25T03:00:00+00:00";
const WEBHOOK_SECRET = "whsec_test_watchdive_stage_score";
const PHONE = "07700 900123";
const PHONE_E164 = "+447700900123";

const savedEnv = {
  WATCHDIVE_STAGE_SCORE_INTEGRATION: process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION,
  WATCHDIVE_STAGE_SCORE_LEDGER: process.env.WATCHDIVE_STAGE_SCORE_LEDGER,
  WATCHDIVE_STAGE_SCORE_DATA_PLANE: process.env.WATCHDIVE_STAGE_SCORE_DATA_PLANE,
  VERCEL: process.env.VERCEL,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function enable(file: string | undefined, plane = "live"): void {
  resetStageScoreDiagnostics();
  if (file) process.env.WATCHDIVE_STAGE_SCORE_LEDGER = file;
  else delete process.env.WATCHDIVE_STAGE_SCORE_LEDGER;
  process.env.WATCHDIVE_STAGE_SCORE_DATA_PLANE = plane;
  process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION = "enabled";
}

function plan(file: string, now: string, extra: string[] = []): Record<string, unknown> {
  const stdout = execFileSync(
    "python3",
    [
      "-m",
      "integration.plan_cli",
      "--ledger",
      file,
      "--now",
      now,
      "--cohort-start",
      COHORT,
      "--data-plane",
      "live",
      "--export",
      "dry-run",
      ...extra,
    ],
    { cwd: SCORING, encoding: "utf8" },
  );
  assert.equal(stdout.includes("@"), false);
  assert.equal(stdout.includes(PHONE_E164), false);
  return JSON.parse(stdout) as Record<string, unknown>;
}

let stageScoreQueue: Promise<void> = Promise.resolve();

function serial(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    const previous = stageScoreQueue;
    let release: () => void = () => {};
    stageScoreQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await fn();
    } finally {
      release();
    }
  });
}

function deps(store: FakeLeadStore, mailer: FakeMailer, clock: Date) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    dispatchVerifiedLead: async () => true,
  };
}

serial("schema copies and the disabled flag leave the ledger untouched", async () => {
  const pythonSchema = readFileSync(join(SCORING, "integration/schema.sql"), "utf8");
  const localSchema = readFileSync(
    fileURLToPath(new URL("../src/lib/stageScore/schema.sql", import.meta.url)),
    "utf8",
  );
  assert.equal(SCHEMA_SQL.trim(), pythonSchema.trim());
  assert.equal(localSchema.trim(), pythonSchema.trim());

  const dir = mkdtempSync(join(tmpdir(), "wd-stage-off-"));
  const file = join(dir, "ledger.sqlite");
  restoreEnv();
  resetStageScoreDiagnostics();
  delete process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION;
  process.env.WATCHDIVE_STAGE_SCORE_LEDGER = file;
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const result = await requestVerificationService(
    {
      email: "diver@example.com",
      canonical: "diver@example.com",
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: true,
      networkSendBlocked: false,
    },
    deps(store, mailer, SIGNUP),
  );
  assert.equal(result.status, "pending");
  assert.equal(mailer.sent.length, 1);
  assert.equal(stageScoreDiagnostics().writes, 0);
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true, force: true });
});

serial("a bad ledger path cannot fail signup or create a file", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  enable("relative.sqlite");
  process.env.VERCEL = "1";
  const result = await requestVerificationService(
    {
      email: "diver@example.com",
      canonical: "diver@example.com",
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: true,
      networkSendBlocked: false,
    },
    deps(store, mailer, SIGNUP),
  );
  assert.equal(result.status, "pending");
  assert.equal(stageScoreDiagnostics().writes, 0);
  assert.ok(stageScoreDiagnostics().skips >= 1);
  restoreEnv();
});

serial("email, phone, consent, and Stripe hooks stay unsent without campaign attribution", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-stage-live-"));
  const file = join(dir, "ledger.sqlite");
  enable(file);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("stage score hook called the network");
  };
  try {
    const store = new FakeLeadStore();
    const mailer = new FakeMailer();
    const clock = new Date(SIGNUP);
    const pending = await requestVerificationService(
      {
        email: "Diver+Tag@Example.com",
        canonical: "diver@example.com",
        source: "hero",
        flags: [],
        suspect: false,
        measurementConsent: true,
        networkSendBlocked: false,
        phone: PHONE_E164,
      },
      deps(store, mailer, clock),
    );
    assert.equal(pending.status, "pending");
    const saved = await savePhoneOptInService(
      {
        credential: { kind: "attempt", value: pending.handle ?? "" },
        phone: PHONE,
        country: "GB",
        consent: true,
        locale: "en",
      },
      { store, env: TEST_ENV, now: () => clock, sleep: async () => {} },
    );
    assert.equal(saved.status, "accepted");
    const confirmed = await confirmVerificationService(mailer.sent[0].token, deps(store, mailer, clock));
    assert.equal(confirmed.status, "verified");
    const preview = plan(file, MATURE);
    assert.deepEqual(preview.stage_deltas, []);
    assert.equal(preview.live_sent_sum, 0);
    assert.equal(preview.applied, false);
    assert.equal(
      (preview.reason_counts as { campaign_attribution_missing?: number }).campaign_attribution_missing,
      1,
    );

    const stripe = new StageStripe("diver@example.com");
    const paid = await deliver(stripe, "evt_paid_once", "checkout.session.completed", true);
    assert.equal(paid.paid, true);
    const duplicate = await deliver(stripe, "evt_paid_once", "checkout.session.completed", true);
    assert.equal(duplicate.paid, true);
    const early = plan(file, EARLY, ["--flush"]);
    assert.deepEqual(early.stage_deltas, []);
    assert.equal(early.flushed_value_sum, 0);
    assert.equal(early.live_sent_sum, 0);
    assert.equal(early.live_outbox_rows, 0);
    assert.equal(early.simulated_value_sum, 0);
    assert.deepEqual(early.purchase_values, ["3.00"]);
    assert.equal(early.purchase_send, false);
    const ledger = await readLedger(file);
    assert.equal(ledger.blob.includes("@"), false);
    assert.equal(ledger.blob.includes(PHONE), false);
    assert.equal(ledger.blob.includes(PHONE_E164), false);
    assert.equal(ledger.blob.includes("diver"), false);
    assert.equal(ledger.blob.includes("Purchase"), false);
    assert.equal(ledger.blob.includes("3.00"), false);
    assert.equal(ledger.blob.includes("30.00"), false);

    stripe.refunded = true;
    const refund = await deliver(stripe, "evt_refund_once", "charge.refunded", true);
    assert.equal(refund.paid, false);
    const after = plan(file, EARLY, ["--flush"]);
    assert.equal(after.flushed_value_sum, 0);
    assert.equal(after.live_outbox_rows, 0);
    assert.equal(after.overstatement_people, 0);
    assert.deepEqual(after.stage_deltas, []);
    assert.deepEqual(after.purchase_values, []);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

serial("oauth signup verifies once and a historical login writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-stage-oauth-"));
  const file = join(dir, "ledger.sqlite");
  enable(file);
  try {
    const store = new FakeLeadStore();
    const mailer = new FakeMailer();
    const finish = await completeSocialIdentity({
      provider: "google",
      claims: { sub: "google-subject-1", email: "Me+Tag@gmail.com", email_verified: true },
      bound: bound(),
      dependencies: deps(store, mailer, SIGNUP),
      now: SIGNUP,
      relayReady: true,
      blocked: false,
    });
    assert.equal(finish, "confirmed");
    const beforeSecond = await readLedger(file);
    const flushed = plan(file, MATURE, ["--flush"]);
    assert.deepEqual(flushed.stage_deltas, []);
    assert.equal(flushed.flushed_value_sum, 0);
    assert.equal(flushed.live_outbox_rows, 0);
    const again = await completeSocialIdentity({
      provider: "google",
      claims: { sub: "google-subject-1", email: "Me+Tag@gmail.com", email_verified: true },
      bound: bound(),
      dependencies: deps(store, mailer, SIGNUP),
      now: SIGNUP,
      relayReady: true,
      blocked: false,
    });
    assert.equal(again, "confirmed");
    const second = plan(file, MATURE, ["--flush"]);
    assert.equal(second.flushed_value_sum, 0);
    assert.deepEqual(second.stage_deltas, []);
    const afterSecond = await readLedger(file);
    assert.equal(afterSecond.observations, beforeSecond.observations);
    assert.equal(personKey("Me+Tag@gmail.com"), personKey("me@gmail.com"));
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

serial("withheld consent and a test-mode payment do not emit a stage score", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-stage-hold-"));
  const file = join(dir, "ledger.sqlite");
  enable(file);
  try {
    const store = new FakeLeadStore();
    const mailer = new FakeMailer();
    const pending = await requestVerificationService(
      {
        email: "hold@example.com",
        canonical: "hold@example.com",
        source: "hero",
        flags: [],
        suspect: false,
        measurementConsent: false,
        networkSendBlocked: false,
      },
      deps(store, mailer, SIGNUP),
    );
    await withdrawAttemptMeasurementService(pending.handle ?? "", deps(store, mailer, SIGNUP));
    const withheld = plan(file, MATURE);
    assert.equal(withheld.eligible, 0);
    assert.deepEqual(withheld.stage_deltas, []);

    const stripe = new StageStripe("hold@example.com");
    const testMode = await deliver(stripe, "evt_test_mode", "checkout.session.completed", false);
    assert.equal(testMode.paid, true);
    const scored = plan(file, MATURE);
    assert.deepEqual(scored.stage_deltas, []);
    assert.deepEqual(scored.purchase_values, []);
    const ledger = await readLedger(file);
    assert.equal(ledger.blob.includes("@"), false);
    assert.equal(ledger.blob.includes("+1"), false);
    assert.equal(ledger.observations > 0, true);
  } finally {
    restoreEnv();
    rmSync(dir, { recursive: true, force: true });
  }
});

function bound(): SocialState {
  return {
    v: 1,
    provider: "google",
    state: "state-value",
    nonce: "nonce-value",
    verifier: "verifier-value",
    source: "hero",
    locale: "en",
    origin: "https://watchdive.diveroid.com",
    attribution: {},
    measurementConsent: true,
    country: { trustedVercel: false, header: null },
    exp: Math.floor(SIGNUP.getTime() / 1000) + 600,
    jti: `jti-${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 12)}`,
  };
}

class StageStripe implements StripeApi {
  customer: StripeCustomer;
  session: StripeCheckoutSession;
  charge: StripeCharge;
  refunded = false;
  readonly email: string;

  constructor(email: string) {
    this.email = email;
    const canonical = reservationCanonicalEmail(email);
    const hash = reservationEmailHash(canonical);
    this.customer = { id: "cus_stage1", email, metadata: {} };
    this.session = {
      id: "cs_live_stage1",
      url: null,
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 300,
      currency: "usd",
      mode: "payment",
      metadata: contractMetadata({ emailSha256: hash }),
      clientReferenceId: hash,
      customerId: this.customer.id,
      paymentIntentId: "pi_stage1",
      expiresAt: Math.floor(SIGNUP.getTime() / 1000) + 3600,
      created: Math.floor(SIGNUP.getTime() / 1000),
      livemode: true,
      successUrl: "https://watchdive.diveroid.com/reservation/success",
    };
    this.charge = {
      id: "ch_stage1",
      amount: 300,
      amountRefunded: 0,
      currency: "usd",
      refunded: false,
      disputed: false,
      paymentIntentId: "pi_stage1",
      created: Math.floor(SIGNUP.getTime() / 1000),
    };
  }

  async listCustomersByEmail(): Promise<StripeCustomer[]> {
    return [this.customer];
  }
  async createCustomer(): Promise<StripeCustomer> {
    return this.customer;
  }
  async retrieveCustomer(): Promise<StripeCustomer> {
    return this.customer;
  }
  async createCheckoutSession(): Promise<StripeCheckoutSession> {
    return this.session;
  }
  async retrieveCheckoutSession(): Promise<StripeCheckoutSession> {
    return this.session;
  }
  async listCheckoutSessions(): Promise<StripeCheckoutSession[]> {
    return [this.session];
  }
  async expireCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    return { ...this.session, id };
  }
  async listLineItems() {
    return [{ quantity: 1, currency: "usd", amountTotal: 300, unitAmount: 300, recurring: false }];
  }
  async retrievePaymentIntent(): Promise<StripePaymentIntent> {
    return {
      id: "pi_stage1",
      amount: 300,
      currency: "usd",
      status: "succeeded",
      metadata: {},
      latestChargeId: this.charge.id,
    };
  }
  async retrieveCharge(): Promise<StripeCharge> {
    return {
      ...this.charge,
      amountRefunded: this.refunded ? 300 : 0,
      refunded: this.refunded,
    };
  }
  async listRefunds() {
    return this.refunded
      ? [{ id: "re_stage1", amount: 300, currency: "usd", status: "succeeded" }]
      : [];
  }
  async listDisputes() {
    return [];
  }
}

function signature(payload: string, stamp: number): string {
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(`${stamp}.${payload}`).digest("hex");
  return `t=${stamp},v1=${digest}`;
}

async function deliver(stripe: StageStripe, eventId: string, type: string, livemode: boolean) {
  stripe.session.livemode = livemode;
  const payload = JSON.stringify({
    id: eventId,
    type,
    livemode,
    data: {
      object:
        type === "charge.refunded"
          ? { id: "ch_stage1", object: "charge", payment_intent: "pi_stage1" }
          : { id: stripe.session.id },
    },
  });
  const stamp = Math.floor(SIGNUP.getTime() / 1000);
  const config: EnabledReservationConfig = {
    secretKey: "sk_test_stage_score_example",
    webhookSecret: WEBHOOK_SECRET,
    tokenSecret: "watchdive-reservation-token-secret-v1",
    origin: "https://watchdive.diveroid.com",
    livemode,
    mode: livemode ? "live" : "test",
  };
  const result = await processReservationWebhook({
    rawBody: payload,
    signatureHeader: signature(payload, stamp),
    config,
    stripe,
    nowMs: SIGNUP.getTime(),
  });
  assert.equal(result.httpStatus, 200);
  return result.body;
}
