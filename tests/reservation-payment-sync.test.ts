// Payment sync regressions. In-memory Stripe only. No live charge, refund, or Notion write.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { contractMetadata, reservationEmailHash } from "../src/lib/reservation/checkout.ts";
import { reservationCanonicalEmail } from "../src/lib/reservation/emailIdentity.ts";
import {
  NotionMirrorError,
  type ReservationMirrorInput,
  type ReservationPaymentMirror,
} from "../src/lib/reservation/notionMirror.ts";
import { classifyPaymentSync, paymentFingerprint } from "../src/lib/reservation/paymentSync.ts";
import {
  isPriceGuaranteeEligible,
  type ReservationSnapshot,
} from "../src/lib/reservation/state.ts";
import {
  StripeApiError,
  type StripeApi,
  type StripeCharge,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeRefund,
} from "../src/lib/reservation/stripeApi.ts";
import { processReservationWebhook } from "../src/lib/reservation/webhook.ts";
import {
  guardReconcileFetch,
  runReservationPaymentReconcile,
} from "../scripts/reservation-payment-reconcile.ts";

const NOW = Date.parse("2026-10-23T08:00:00.000Z");
const EMAIL = "diver@example.com";
const WEBHOOK_SECRET = "whsec_test_watchdive_reservation_example";
const HASH = reservationEmailHash(reservationCanonicalEmail(EMAIL));

const CONFIG = {
  secretKey: "sk_test_watchdive_reservation_example",
  webhookSecret: WEBHOOK_SECRET,
  tokenSecret: "watchdive-reservation-token-secret-v1",
  origin: "https://watchdive.diveroid.com",
  livemode: false,
  mode: "test" as const,
};

function sign(payload: string, seconds: number): string {
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(`${seconds}.${payload}`).digest("hex");
  return `t=${seconds},v1=${digest}`;
}

function snap(overrides: Partial<ReservationSnapshot> = {}): ReservationSnapshot {
  return {
    status: "paid",
    paid: true,
    sessionId: "cs_test_sync1abc",
    url: null,
    amountTotal: 300,
    currency: "usd",
    amountRefunded: 0,
    amountRefundPending: 0,
    duplicatePaid: false,
    leadId: null,
    source: "stripe",
    ...overrides,
  };
}

function view(overrides: Partial<{
  status: string | null;
  paid: boolean | null;
  sessionId: string | null;
  refundedCents: number | null;
  refundPendingCents: number | null;
  mode: string | null;
  duplicatePaid: boolean | null;
}> = {}) {
  return {
    status: "paid",
    paid: true,
    sessionId: "cs_test_sync1abc",
    refundedCents: 0,
    refundPendingCents: 0,
    mode: "test",
    duplicatePaid: false,
    ...overrides,
  };
}

class SyncStripe implements StripeApi {
  customers: StripeCustomer[] = [{ id: "cus_sync1", email: EMAIL, metadata: {} }];
  sessions: StripeCheckoutSession[] = [];
  charges = new Map<string, StripeCharge>();
  refunds: StripeRefund[] = [];
  creates = 0;

  seed(input: {
    id?: string;
    intent?: string;
    charge?: string;
    refunded?: boolean;
    guarantee?: string;
    created?: number;
  } = {}): StripeCheckoutSession {
    const metadata = contractMetadata({ emailSha256: HASH });
    if (input.guarantee) metadata.price_guarantee = input.guarantee;
    const id = input.id ?? "cs_test_sync1abc";
    const intent = input.intent ?? "pi_sync1";
    const chargeId = input.charge ?? "ch_sync1";
    const session: StripeCheckoutSession = {
      id,
      url: null,
      status: "complete",
      paymentStatus: "paid",
      amountTotal: 300,
      currency: "usd",
      mode: "payment",
      metadata,
      clientReferenceId: HASH,
      customerId: "cus_sync1",
      paymentIntentId: intent,
      expiresAt: Math.floor(NOW / 1000) + 3600,
      created: input.created ?? Math.floor(NOW / 1000),
      livemode: false,
      successUrl: "https://watchdive.diveroid.com/reservation?session_id={CHECKOUT_SESSION_ID}",
    };
    this.sessions.push(session);
    this.charges.set(chargeId, {
      id: chargeId,
      amount: 300,
      amountRefunded: input.refunded ? 300 : 0,
      currency: "usd",
      refunded: input.refunded === true,
      disputed: false,
      paymentIntentId: intent,
      created: input.created ?? Math.floor(NOW / 1000),
    });
    if (input.refunded) {
      this.refunds.push({ id: `re_${chargeId}`, amount: 300, currency: "usd", status: "succeeded" });
    }
    return session;
  }

  async listCustomersByEmail(email: string): Promise<StripeCustomer[]> {
    return this.customers.filter(
      (customer) => reservationCanonicalEmail(customer.email ?? "") === reservationCanonicalEmail(email),
    );
  }
  async createCustomer(): Promise<StripeCustomer> {
    this.creates += 1;
    throw new Error("create_refused");
  }
  async retrieveCustomer(id: string): Promise<StripeCustomer> {
    const customer = this.customers.find((item) => item.id === id);
    if (!customer) throw new StripeApiError(404, "resource_missing", "invalid_request_error", null);
    return customer;
  }
  async createCheckoutSession(): Promise<StripeCheckoutSession> {
    this.creates += 1;
    throw new Error("create_refused");
  }
  async retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new StripeApiError(404, "resource_missing", "invalid_request_error", null);
    return session;
  }
  async listCheckoutSessions(filter: { customerId?: string; paymentIntentId?: string }): Promise<StripeCheckoutSession[]> {
    return this.sessions.filter((session) => {
      if (filter.customerId && session.customerId !== filter.customerId) return false;
      if (filter.paymentIntentId && session.paymentIntentId !== filter.paymentIntentId) return false;
      return true;
    });
  }
  async expireCheckoutSession(id: string): Promise<StripeCheckoutSession> {
    const session = await this.retrieveCheckoutSession(id);
    session.status = "expired";
    return session;
  }
  async listLineItems() {
    return [{ quantity: 1, currency: "usd", amountTotal: 300, unitAmount: 300, recurring: false }];
  }
  async retrievePaymentIntent(id: string) {
    const charge = [...this.charges.values()].find((item) => item.paymentIntentId === id);
    return {
      id,
      amount: 300,
      currency: "usd",
      status: "succeeded",
      metadata: {},
      latestChargeId: charge?.id ?? null,
    };
  }
  async retrieveCharge(id: string): Promise<StripeCharge> {
    const charge = this.charges.get(id);
    if (!charge) throw new StripeApiError(404, "resource_missing", "invalid_request_error", null);
    return charge;
  }
  async listRefunds(chargeId: string): Promise<StripeRefund[]> {
    return this.refunds.filter((refund) => refund.id === `re_${chargeId}`);
  }
  async listDisputes() {
    return [];
  }
}

function mirrorOf(lead: boolean): { mirror: ReservationPaymentMirror; writes: ReservationMirrorInput[] } {
  const writes: ReservationMirrorInput[] = [];
  return {
    writes,
    mirror: {
      async apply(input) {
        if (!lead) throw new NotionMirrorError("lead_missing");
        writes.push(input);
        return { updated: 1 };
      },
    },
  };
}

async function deliver(
  stripe: SyncStripe,
  type: string,
  object: Record<string, unknown>,
  mirror: ReservationPaymentMirror | undefined,
  eventId = "evt_sync",
  livemode = CONFIG.livemode,
  configLivemode = livemode,
) {
  const payload = JSON.stringify({ id: eventId, type, livemode, data: { object } });
  return processReservationWebhook({
    rawBody: payload,
    signatureHeader: sign(payload, Math.floor(NOW / 1000)),
    config: { ...CONFIG, livemode: configLivemode, mode: configLivemode ? "live" : "test" },
    stripe,
    nowMs: NOW,
    mirror,
  });
}

test("price guarantee eligibility follows the clean paid snapshot", () => {
  assert.equal(isPriceGuaranteeEligible(snap()), true);
  assert.equal(isPriceGuaranteeEligible(snap({ duplicatePaid: true })), true);
  assert.equal(isPriceGuaranteeEligible(snap({ status: "refunded", paid: false, amountRefunded: 300 })), false);
  assert.equal(isPriceGuaranteeEligible(snap({ status: "partially_refunded", paid: false, amountRefunded: 100 })), false);
  assert.equal(isPriceGuaranteeEligible(snap({ status: "refund_pending", paid: false, amountRefundPending: 300 })), false);
  assert.equal(isPriceGuaranteeEligible(snap({ status: "disputed", paid: false })), false);
  assert.equal(isPriceGuaranteeEligible(snap({ status: "invalid", paid: false })), false);
});

test("a missing signup row is not treated as a page to create", () => {
  const refunded = classifyPaymentSync({
    ourProduct: true,
    bound: true,
    livemodeMatches: true,
    addressed: true,
    snapshot: snap({ status: "refunded", paid: false, amountRefunded: 300 }),
    leads: [],
    mode: "live",
  });
  assert.equal(refunded.classification, "lead_missing");
  assert.equal(refunded.httpStatus, 500);
  assert.equal(refunded.retryable, true);
  assert.equal(refunded.wouldWrite, false);
  assert.equal(refunded.priceGuaranteeEligible, false);

  const paid = classifyPaymentSync({
    ourProduct: true,
    bound: true,
    livemodeMatches: true,
    addressed: true,
    snapshot: snap(),
    leads: [],
    mode: "live",
  });
  assert.equal(paid.classification, "lead_missing");
  assert.equal(paid.priceGuaranteeEligible, true);
  assert.equal(paid.wouldWrite, false);
});

test("an existing row is stale only when its columns differ, and test columns do not count as live", () => {
  const synced = classifyPaymentSync({
    ourProduct: true,
    bound: true,
    livemodeMatches: true,
    addressed: true,
    snapshot: snap({ status: "refunded", paid: false, amountRefunded: 300 }),
    leads: [view({ status: "refunded", paid: false, refundedCents: 300, mode: "live" })],
    mode: "live",
  });
  assert.equal(synced.classification, "in_sync");
  assert.equal(synced.wouldWrite, false);

  const stale = classifyPaymentSync({
    ourProduct: true,
    bound: true,
    livemodeMatches: true,
    addressed: true,
    snapshot: snap({ status: "refunded", paid: false, amountRefunded: 300 }),
    leads: [view({ mode: "live" })],
    mode: "live",
  });
  assert.equal(stale.classification, "notion_stale");
  assert.equal(stale.wouldWrite, true);
  assert.equal(stale.priceGuaranteeEligible, false);

  const separated = classifyPaymentSync({
    ourProduct: true,
    bound: true,
    livemodeMatches: true,
    addressed: true,
    snapshot: snap(),
    leads: [view({ mode: "test" })],
    mode: "live",
  });
  assert.equal(separated.classification, "notion_stale");
});

test("a paid webhook mirrors one clean fee and a replay does not create or double it", async () => {
  const stripe = new SyncStripe();
  const session = stripe.seed();
  const { mirror, writes } = mirrorOf(true);
  const first = await deliver(stripe, "checkout.session.completed", { id: session.id, amount_total: 14900 }, mirror);
  assert.equal(first.httpStatus, 200);
  assert.equal(first.body.paid, true);
  assert.equal(first.body.status, "paid");
  assert.equal(writes.length, 1);
  assert.equal(isPriceGuaranteeEligible(writes[0].snapshot), true);
  assert.equal(writes[0].mode, "test");
  const replay = await deliver(
    stripe,
    "checkout.session.completed",
    { id: session.id, amount_total: 14900 },
    mirror,
    "evt_sync",
  );
  assert.equal(replay.body.paid, true);
  assert.equal(replay.body.amountRefunded, 0);
  assert.equal(stripe.creates, 0);
  assert.equal(writes.at(-1)?.snapshot.amountTotal, 300);
});

test("analytics outages cannot defer payment mirror persistence or trigger a legacy post", async () => {
  const stripe = new SyncStripe();
  const session = stripe.seed();
  const { mirror, writes } = mirrorOf(true);
  const payload = JSON.stringify({ id: "evt_measurement_down", type: "checkout.session.completed", livemode: false, data: { object: { id: session.id } } });
  for (const throws of [false, true]) {
    const before = writes.length;
    let legacyPosts = 0;
    const result = await processReservationWebhook({
      rawBody: payload,
      signatureHeader: sign(payload, Math.floor(NOW / 1000)),
      config: CONFIG,
      stripe,
      nowMs: NOW,
      mirror,
      measure: async () => {
        assert.equal(writes.length, before + 1);
        assert.equal(writes.at(-1)?.snapshot.paid, true);
        if (throws) throw new Error("analytics store unavailable");
        return "retry";
      },
      onPaidSnapshot: async () => { legacyPosts++; },
    });
    assert.equal(result.httpStatus, 500);
    assert.equal(result.body.error, "measurement_unavailable");
    assert.equal(writes.length, before + 1);
    assert.equal(legacyPosts, 0);
  }
});

test("a refund object on charge.refund.updated is applied, including before the paid event and on a late replay", async () => {
  const stripe = new SyncStripe();
  const session = stripe.seed({ refunded: true });
  const { mirror, writes } = mirrorOf(true);
  const early = await deliver(stripe, "charge.refund.updated", {
    id: "re_ch_sync1",
    object: "refund",
    charge: "ch_sync1",
    payment_intent: "pi_sync1",
    amount: 99999,
    status: "succeeded",
  }, mirror, "evt_refund_first");
  assert.equal(early.httpStatus, 200);
  assert.equal(early.body.ignored, undefined);
  assert.equal(early.body.status, "refunded");
  assert.equal(early.body.paid, false);
  assert.equal(early.body.amountRefunded, 300);
  assert.equal(isPriceGuaranteeEligible(writes[0].snapshot), false);

  const late = await deliver(
    stripe,
    "checkout.session.completed",
    { id: session.id, amount_total: 14900, payment_status: "unpaid" },
    mirror,
    "evt_late_completed",
  );
  assert.equal(late.body.status, "refunded");
  assert.equal(late.body.paid, false);
  assert.equal(late.body.amountRefunded, 300);
  assert.equal(stripe.creates, 0);

  const expanded = await deliver(stripe, "charge.refund.updated", {
    id: "re_ch_sync1",
    object: "refund",
    charge: { id: "ch_sync1" },
    payment_intent: "pi_sync1",
  }, mirror, "evt_refund_expanded");
  assert.equal(expanded.body.status, "refunded");
  assert.equal(expanded.body.amountRefunded, 300);
});

test("a refund webhook with no charge id stays foreign, and a missing lead is a retryable 500", async () => {
  const stripe = new SyncStripe();
  stripe.seed({ refunded: true });
  const foreign = await deliver(stripe, "charge.refund.updated", { id: "re_orphan", object: "refund" }, undefined, "evt_orphan");
  assert.equal(foreign.httpStatus, 200);
  assert.equal(foreign.body.ignored, "not_reservation");

  const { mirror } = mirrorOf(false);
  const missing = await deliver(stripe, "charge.refunded", { id: "ch_sync1", object: "charge" }, mirror, "evt_missing_lead");
  assert.equal(missing.httpStatus, 500);
  assert.equal(missing.body.error, "notion_mirror_failed");
  assert.equal(missing.body.reason, "lead_missing");
  assert.equal(missing.body.retryable, true);
  assert.equal(missing.body.received, undefined);
});

test("two clean payments stay paid, and refunding one leaves the other eligible", async () => {
  const stripe = new SyncStripe();
  const first = stripe.seed({ id: "cs_test_sync1abc", intent: "pi_sync1", charge: "ch_sync1", created: 100 });
  stripe.seed({ id: "cs_test_sync2abc", intent: "pi_sync2", charge: "ch_sync2", created: 200 });
  const { mirror, writes } = mirrorOf(true);
  const both = await deliver(stripe, "checkout.session.completed", { id: first.id }, mirror, "evt_both");
  assert.equal(both.body.paid, true);
  assert.equal(both.body.duplicatePaid, true);
  assert.equal(isPriceGuaranteeEligible(writes[0].snapshot), true);

  const second = stripe.charges.get("ch_sync2");
  if (!second) throw new Error("missing charge");
  second.refunded = true;
  second.amountRefunded = 300;
  stripe.refunds.push({ id: "re_ch_sync2", amount: 300, currency: "usd", status: "succeeded" });
  const after = await deliver(stripe, "charge.refunded", { id: "ch_sync2" }, mirror, "evt_one_refund");
  assert.equal(after.body.paid, true);
  assert.equal(after.body.status, "paid");
  assert.equal(after.body.duplicatePaid, false);
  assert.equal(after.body.sessionId, first.id);
  assert.equal(isPriceGuaranteeEligible(writes.at(-1)!.snapshot), true);
  assert.equal(stripe.creates, 0);
});

test("the wrong price guarantee is not a paid reservation, and a live event is ignored on a test config", async () => {
  const stripe = new SyncStripe();
  const session = stripe.seed({ guarantee: "not-the-contract" });
  const { mirror, writes } = mirrorOf(true);
  const invalid = await deliver(stripe, "checkout.session.completed", { id: session.id }, mirror, "evt_guarantee");
  assert.equal(invalid.body.paid, false);
  assert.equal(invalid.body.status, "invalid");
  assert.equal(isPriceGuaranteeEligible(writes[0].snapshot), false);

  const live = new SyncStripe();
  live.seed();
  const { mirror: liveMirror, writes: liveWrites } = mirrorOf(true);
  const ignored = await deliver(
    live,
    "checkout.session.completed",
    { id: "cs_test_sync1abc" },
    liveMirror,
    "evt_live",
    true,
    false,
  );
  assert.equal(ignored.body.ignored, "livemode_mismatch");
  assert.equal(liveWrites.length, 0);
});

test("a settled refund is measured only after the Notion mirror write", async () => {
  const stripe = new SyncStripe();
  stripe.seed({ refunded: true });
  const { mirror, writes } = mirrorOf(true);
  const seen: { refundId?: string; sessionId?: string; writes: number }[] = [];
  const payload = JSON.stringify({
    id: "evt_refund_measure",
    type: "charge.refunded",
    livemode: false,
    data: { object: { id: "ch_sync1" } },
  });
  const result = await processReservationWebhook({
    rawBody: payload,
    signatureHeader: sign(payload, Math.floor(NOW / 1000)),
    config: CONFIG,
    stripe,
    nowMs: NOW,
    mirror,
    measure: async (_email, snapshot, _occurredAt, refunds) => {
      seen.push({
        refundId: refunds?.[0]?.refundId,
        sessionId: refunds?.[0]?.sessionId,
        writes: writes.length,
      });
      assert.equal(snapshot.status, "refunded");
      assert.equal(snapshot.paid, false);
      return "skipped";
    },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(writes.length, 1);
  assert.deepEqual(seen, [{ refundId: "re_ch_sync1", sessionId: "cs_test_sync1abc", writes: 1 }]);
});

test("a Notion mirror failure does not call measurement", async () => {
  const stripe = new SyncStripe();
  stripe.seed({ refunded: true });
  const { mirror } = mirrorOf(false);
  let called = 0;
  const payload = JSON.stringify({
    id: "evt_mirror_blocks_measure",
    type: "charge.refunded",
    livemode: false,
    data: { object: { id: "ch_sync1" } },
  });
  const result = await processReservationWebhook({
    rawBody: payload,
    signatureHeader: sign(payload, Math.floor(NOW / 1000)),
    config: CONFIG,
    stripe,
    nowMs: NOW,
    mirror,
    measure: async () => {
      called += 1;
      return "accepted";
    },
  });
  assert.equal(result.httpStatus, 500);
  assert.equal(result.body.error, "notion_mirror_failed");
  assert.equal(called, 0);
});

test("the stage score hook remains on the acknowledged payment path", () => {
  const source = readFileSync(new URL("../src/lib/reservation/webhook.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ noteStagePayment \} from "\.\.\/stageScore\/observe\.ts"/);
  assert.match(source, /WATCHDIVE_STAGE_SCORE_INTEGRATION === "enabled"/);
  assert.match(source, /await noteStagePayment\(/);
  assert.match(source, /charge\.refund\.updated/);
});

test("the reconciler refuses mutation flags and does not write a missing or stale row", async () => {
  let calls = 0;
  const refused = await runReservationPaymentReconcile({
    args: ["--apply"],
    env: {},
    fetchImpl: async () => {
      calls += 1;
      throw new Error("called");
    },
  });
  assert.equal(refused.exitCode, 2);
  assert.equal(calls, 0);
  assert.equal(refused.report.applied, false);

  const guarded = guardReconcileFetch(async () => new Response("{}", { status: 200 }));
  await assert.rejects(() => guarded("https://api.stripe.com/v1/refunds", { method: "POST" }));
  await assert.rejects(() => guarded("https://api.notion.com/v1/pages/page_1", { method: "PATCH" }));

  const hash = HASH;
  const metadata = contractMetadata({ emailSha256: hash });
  const session = {
    id: "cs_test_sync1abc",
    status: "complete",
    payment_status: "paid",
    amount_total: 300,
    currency: "usd",
    mode: "payment",
    metadata,
    client_reference_id: hash,
    customer: "cus_sync1",
    payment_intent: "pi_sync1",
    expires_at: Math.floor(NOW / 1000) + 3600,
    created: Math.floor(NOW / 1000),
    livemode: false,
  };
  const methods: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    methods.push(`${method} ${url.pathname}`);
    if (url.pathname === "/v1/checkout/sessions" && !url.searchParams.get("payment_intent")) {
      return Response.json({ data: [session], has_more: false });
    }
    if (url.pathname === "/v1/customers/cus_sync1") {
      return Response.json({ id: "cus_sync1", email: EMAIL, metadata: {} });
    }
    if (url.pathname.endsWith("/line_items")) {
      return Response.json({
        data: [{ quantity: 1, amount_total: 300, currency: "usd", price: { unit_amount: 300, type: "one_time" } }],
        has_more: false,
      });
    }
    if (url.pathname === "/v1/payment_intents/pi_sync1") {
      return Response.json({
        id: "pi_sync1",
        amount: 300,
        currency: "usd",
        status: "succeeded",
        latest_charge: "ch_sync1",
        metadata: {},
      });
    }
    if (url.pathname === "/v1/charges/ch_sync1") {
      return Response.json({
        id: "ch_sync1",
        amount: 300,
        amount_refunded: 300,
        currency: "usd",
        refunded: true,
        disputed: false,
        payment_intent: "pi_sync1",
        created: Math.floor(NOW / 1000),
      });
    }
    if (url.pathname === "/v1/refunds") {
      return Response.json({
        data: [{ id: "re_ch_sync1", amount: 300, currency: "usd", status: "succeeded" }],
        has_more: false,
      });
    }
    if (url.pathname.endsWith("/query")) {
      return Response.json({ results: [], has_more: false });
    }
    return Response.json({ data: [], has_more: false });
  };

  const result = await runReservationPaymentReconcile({
    args: ["--dry-run"],
    env: {
      STRIPE_SECRET_KEY: "sk_test_watchdive_reservation_example",
      NOTION_API_KEY: "secret-notion-test-token",
      NOTION_WAITLIST_DB_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    fetchImpl,
    nowMs: NOW,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.applied, false);
  assert.equal(result.report.mutations, "none");
  assert.equal(result.report.rows?.length, 1);
  assert.equal(result.report.rows?.[0]?.classification, "lead_missing");
  assert.equal(result.report.rows?.[0]?.wouldWrite, false);
  assert.equal(result.report.rows?.[0]?.priceGuaranteeEligible, false);
  assert.equal(result.report.rows?.[0]?.stripeStatus, "refunded");
  assert.equal(result.report.rows?.[0]?.sessionFingerprints[0], paymentFingerprint("cs_test_sync1abc"));
  assert.equal(JSON.stringify(result.report).includes("@"), false);
  assert.equal(methods.some((call) => call.startsWith("POST https") || call.includes("PATCH")), false);
  assert.equal(methods.some((call) => call.startsWith("POST ")), true);
  assert.equal(methods.every((call) => call.startsWith("GET ") || call.startsWith("POST /v1/databases")), true);
});
