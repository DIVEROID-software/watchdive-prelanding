// Reservation backend. Stripe is faked at fetch. No live key, no network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseContract, parseHandledEvents } from "../scripts/reservation-readiness.ts";

import { reservationCanonicalEmail } from "../src/lib/reservation/emailIdentity.ts";
import {
  LATER_PRODUCT_PRICE_CENTS,
  PRICE_BEFORE_SHIPPING_OR_TAX_CENTS,
  PRODUCT_DESCRIPTION,
  RESERVATION_FEE_CENTS,
  STRIPE_API_VERSION,
  SUCCESS_PATH,
} from "../src/lib/reservation/constants.ts";
import { readReservationConfig } from "../src/lib/reservation/config.ts";
import {
  contractMetadata,
  isHostedCheckoutUrl,
  reservationEmailHash,
  reservationIdempotencyKey,
  reservationSuccessUrl,
} from "../src/lib/reservation/checkout.ts";
import {
  handleReservationCheckout,
  handleReservationStatus,
  handleReservationWebhook,
} from "../src/lib/reservation/handlers.ts";
import { issueReservationInvite, verifyReservationInvite } from "../src/lib/reservation/invite.ts";
import { issueReservationInvite as issueFromIndex } from "../src/lib/reservation/index.ts";
import { TERMS_VERSION } from "../src/lib/reservation/constants.ts";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";
const EMAIL = "diver@example.com";
const SECRET = "watchdive-reservation-token-secret-v1";
const STRIPE_KEY = "sk_test_watchdive_reservation_example";
const WEBHOOK_SECRET = "whsec_test_watchdive_reservation_example";
const ORIGIN = "https://watchdive.diveroid.com";
const SUCCESS = `${ORIGIN}${SUCCESS_PATH}`;

const ENV = {
  WATCHDIVE_RESERVATION_ENABLED: "true",
  WATCHDIVE_RESERVATION_ALLOW_LIVE: "false",
  STRIPE_SECRET_KEY: STRIPE_KEY,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
};

function invite(overrides: Partial<Parameters<typeof issueReservationInvite>[0]> = {}): string {
  return issueReservationInvite({
    leadId: LEAD,
    email: EMAIL,
    emailVerified: true,
    expiresAtMs: NOW + 86_400_000,
    secret: SECRET,
    nowMs: NOW,
    jti: "invitejti00000001",
    ...overrides,
  });
}

function post(token: string, extra: Record<string, unknown> = {}): Request {
  return new Request("https://evil.example/api/reservation/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "evil.example",
    },
    body: JSON.stringify({
      inviteToken: token,
      acceptedTerms: true,
      termsVersion: TERMS_VERSION,
      email: "attacker@evil.test",
      ...extra,
    }),
  });
}

type StoredCustomer = { id: string; email: string; metadata: Record<string, string> };
type StoredSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  amountTotal: number | null;
  currency: string | null;
  mode: string;
  metadata: Record<string, string>;
  clientReferenceId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  expiresAt: number;
  created: number;
  successUrl: string | null;
};
type StoredCharge = {
  id: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  refunded: boolean;
  disputed: boolean;
  paymentIntentId: string;
  /** Charge.created seconds. Null omits the field, which refuses Purchase. */
  created: number | null;
};
type StoredRefund = { id: string; amount: number; currency: string; status: string; chargeId: string };
type StoredDispute = { id: string; amount: number; currency: string; status: string; chargeId: string };

class MemoryStripe {
  customers: StoredCustomer[] = [];
  sessions: StoredSession[] = [];
  charges = new Map<string, StoredCharge>();
  refunds: StoredRefund[] = [];
  disputes: StoredDispute[] = [];
  calls: { method: string; path: string; version: string; authorization: string }[] = [];
  checkoutParams: URLSearchParams[] = [];
  checkoutKeys: string[] = [];
  idempotency = new Map<string, { body: string; payload: unknown }>();
  amountOverride: number | null = null;
  urlOverride: string | null = null;
  failCharges = false;
  failCreates = false;
  private seq = 1;

  fetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    const idempotencyKey = headers.get("Idempotency-Key");
    this.calls.push({
      method,
      path: url.pathname,
      version: headers.get("Stripe-Version") ?? "",
      authorization: headers.get("Authorization") ?? "",
    });
    return this.route(method, url, body, idempotencyKey);
  };

  seedPaid(input: {
    leadId?: string;
    email?: string;
    amountTotal?: number;
    currency?: string;
    amountRefunded?: number;
    pendingRefund?: number;
    paymentStatus?: "paid" | "unpaid";
    status?: "open" | "complete" | "expired";
    disputed?: boolean;
    disputeStatus?: string;
    chargeCreated?: number | null;
  } = {}): StoredSession {
    const leadId = input.leadId ?? LEAD;
    const email = input.email ?? EMAIL;
    const customer: StoredCustomer = {
      id: `cus_test_${this.seq}`,
      email,
      metadata: {},
    };
    this.seq += 1;
    this.customers.push(customer);
    const emailSha256 = reservationEmailHash(reservationCanonicalEmail(email));
    const amount = input.amountTotal ?? RESERVATION_FEE_CENTS;
    const currency = input.currency ?? "usd";
    const pi = `pi_test_${this.seq}`;
    const ch = `ch_test_${this.seq}`;
    this.seq += 1;
    this.charges.set(ch, {
      id: ch,
      amount,
      amountRefunded: input.amountRefunded ?? 0,
      currency,
      refunded: (input.amountRefunded ?? 0) >= amount,
      disputed: input.disputed === true,
      paymentIntentId: pi,
      created: input.chargeCreated === undefined ? Math.floor(NOW / 1000) : input.chargeCreated,
    });
    if (input.disputed) {
      this.disputes.push({
        id: `du_test_${this.seq}`,
        amount,
        currency,
        status: input.disputeStatus ?? "needs_response",
        chargeId: ch,
      });
      this.seq += 1;
    }
    if (input.pendingRefund) {
      this.refunds.push({
        id: `re_test_${this.seq}`,
        amount: input.pendingRefund,
        currency,
        status: "pending",
        chargeId: ch,
      });
      this.seq += 1;
    }
    const session: StoredSession = {
      id: `cs_test_${this.seq}`,
      url: null,
      status: input.status ?? "complete",
      paymentStatus: input.paymentStatus ?? "paid",
      amountTotal: amount,
      currency,
      mode: "payment",
      metadata: contractMetadata({ emailSha256 }),
      clientReferenceId: emailSha256,
      customerId: customer.id,
      paymentIntentId: pi,
      expiresAt: Math.floor(NOW / 1000) + 3600,
      created: Math.floor(NOW / 1000),
      successUrl: SUCCESS,
    };
    this.seq += 1;
    this.sessions.push(session);
    return session;
  }

  private route(method: string, url: URL, body: string, idempotencyKey: string | null): Response {
    const path = url.pathname;
    if (this.failCharges && path.startsWith("/v1/charges/")) return this.fail(500, "api_error");
    if (path === "/v1/customers" && method === "GET") {
      const email = url.searchParams.get("email") ?? "";
      return this.list(this.customers.filter((customer) => customer.email === email).map(this.customerJson));
    }
    if (path === "/v1/customers" && method === "POST") {
      return this.withIdempotency(`POST ${path}`, idempotencyKey, body, () => {
        const params = new URLSearchParams(body);
        const customer: StoredCustomer = {
          id: `cus_test_${this.seq}`,
          email: params.get("email") ?? "",
          metadata: this.bracket(params, "metadata["),
        };
        this.seq += 1;
        this.customers.push(customer);
        return this.customerJson(customer);
      });
    }
    const customerId = path.match(/^\/v1\/customers\/([^/]+)$/);
    if (customerId && method === "GET") {
      const customer = this.customers.find((item) => item.id === customerId[1]);
      return customer ? this.ok(this.customerJson(customer)) : this.fail(404, "resource_missing");
    }
    if (path === "/v1/checkout/sessions" && method === "GET") {
      const customer = url.searchParams.get("customer");
      const paymentIntent = url.searchParams.get("payment_intent");
      const rows = this.sessions.filter((session) => {
        if (customer && session.customerId !== customer) return false;
        if (paymentIntent && session.paymentIntentId !== paymentIntent) return false;
        return true;
      });
      return this.list(rows.map((session) => this.sessionJson(session)));
    }
    if (path === "/v1/checkout/sessions" && method === "POST") {
      const params = new URLSearchParams(body);
      this.checkoutParams.push(params);
      if (idempotencyKey) this.checkoutKeys.push(idempotencyKey);
      if (this.failCreates) return this.fail(500, "api_error", "api_error");
      return this.withIdempotency(`POST ${path}`, idempotencyKey, body, () => {
        const amount = this.amountOverride ?? Number(params.get("line_items[0][price_data][unit_amount]"));
        const session: StoredSession = {
          id: `cs_test_${this.seq}`,
          url: "",
          status: "open",
          paymentStatus: "unpaid",
          amountTotal: amount,
          currency: params.get("line_items[0][price_data][currency]"),
          mode: params.get("mode") ?? "",
          metadata: this.bracket(params, "metadata["),
          clientReferenceId: params.get("client_reference_id"),
          customerId: params.get("customer"),
          paymentIntentId: null,
          expiresAt: Math.floor(NOW / 1000) + 3600,
          created: Math.floor(NOW / 1000) + this.sessions.length,
          successUrl: params.get("success_url"),
        };
        session.url = this.urlOverride ?? `https://checkout.stripe.com/c/pay/${session.id}`;
        this.seq += 1;
        this.sessions.push(session);
        return this.sessionJson(session);
      });
    }
    const lineItems = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/);
    if (lineItems && method === "GET") {
      const session = this.sessions.find((item) => item.id === lineItems[1]);
      if (!session) return this.fail(404, "resource_missing");
      return this.list([
        {
          id: `li_${session.id}`,
          quantity: 1,
          currency: session.currency,
          amount_total: session.amountTotal,
          price: {
            unit_amount: session.amountTotal,
            currency: session.currency,
            type: "one_time",
            recurring: null,
          },
        },
      ]);
    }
    const expire = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (expire && method === "POST") {
      const session = this.sessions.find((item) => item.id === expire[1]);
      if (!session) return this.fail(404, "resource_missing");
      if (session.status !== "open") return this.fail(400, "checkout_session_invalid_status");
      session.status = "expired";
      session.url = null;
      return this.ok(this.sessionJson(session));
    }
    const oneSession = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (oneSession && method === "GET") {
      const session = this.sessions.find((item) => item.id === oneSession[1]);
      return session ? this.ok(this.sessionJson(session)) : this.fail(404, "resource_missing");
    }
    const paymentIntent = path.match(/^\/v1\/payment_intents\/([^/]+)$/);
    if (paymentIntent && method === "GET") {
      const charge = [...this.charges.values()].find(
        (item) => item.paymentIntentId === paymentIntent[1],
      );
      if (!charge) return this.fail(404, "resource_missing");
      return this.ok({
        id: charge.paymentIntentId,
        amount: charge.amount,
        currency: charge.currency,
        status: "succeeded",
        metadata: {},
        latest_charge: charge.id,
      });
    }
    const chargePath = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (chargePath && method === "GET") {
      const charge = this.charges.get(chargePath[1] ?? "");
      if (!charge) return this.fail(404, "resource_missing");
      return this.ok({
        id: charge.id,
        amount: charge.amount,
        amount_refunded: charge.amountRefunded,
        currency: charge.currency,
        refunded: charge.refunded,
        disputed: charge.disputed,
        payment_intent: charge.paymentIntentId,
        ...(charge.created == null ? {} : { created: charge.created }),
      });
    }
    if (path === "/v1/disputes" && method === "GET") {
      const chargeId = url.searchParams.get("charge") ?? "";
      return this.list(
        this.disputes
          .filter((dispute) => dispute.chargeId === chargeId)
          .map((dispute) => ({
            id: dispute.id,
            amount: dispute.amount,
            currency: dispute.currency,
            status: dispute.status,
            charge: dispute.chargeId,
          })),
      );
    }
    if (path === "/v1/refunds" && method === "GET") {
      const chargeId = url.searchParams.get("charge") ?? "";
      return this.list(
        this.refunds
          .filter((refund) => refund.chargeId === chargeId)
          .map((refund) => ({
            id: refund.id,
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
          })),
      );
    }
    return this.fail(404, "resource_missing");
  }

  private bracket(params: URLSearchParams, prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      if (key.startsWith(prefix) && key.endsWith("]") && !key.slice(prefix.length).includes("[")) {
        out[key.slice(prefix.length, -1)] = value;
      }
    }
    return out;
  }

  private withIdempotency(
    scope: string,
    key: string | null,
    body: string,
    create: () => unknown,
  ): Response {
    const id = `${scope}:${key ?? ""}`;
    if (key) {
      const prior = this.idempotency.get(id);
      if (prior) {
        if (prior.body !== body) return this.fail(400, "idempotency_key_in_use", "idempotency_error");
        return this.ok(prior.payload);
      }
    }
    const payload = create();
    if (key) this.idempotency.set(id, { body, payload });
    return this.ok(payload);
  }

  private customerJson(customer: StoredCustomer) {
    return { id: customer.id, email: customer.email, metadata: customer.metadata };
  }

  private sessionJson(session: StoredSession) {
    return {
      id: session.id,
      object: "checkout.session",
      url: session.url,
      status: session.status,
      payment_status: session.paymentStatus,
      amount_total: session.amountTotal,
      currency: session.currency,
      mode: session.mode,
      metadata: session.metadata,
      client_reference_id: session.clientReferenceId,
      customer: session.customerId,
      payment_intent: session.paymentIntentId,
      expires_at: session.expiresAt,
      created: session.created,
      livemode: false,
      success_url: session.successUrl,
    };
  }

  private ok(payload: unknown): Response {
    return new Response(JSON.stringify(payload), { status: 200 });
  }

  private list(data: unknown[]): Response {
    return this.ok({ object: "list", data, has_more: false });
  }

  private fail(status: number, code: string, type = "invalid_request_error"): Response {
    return new Response(JSON.stringify({ error: { type, code, message: code } }), { status });
  }

  creates(): number {
    return this.calls.filter((call) => call.method === "POST" && call.path === "/v1/checkout/sessions")
      .length;
  }
}

function deps(fake: MemoryStripe, env: Record<string, string> = ENV) {
  return { env, fetchImpl: fake.fetch, nowMs: NOW };
}

function statusRequest(token: string | null, sessionId?: string, queryToken?: string): Request {
  const url = new URL("https://watchdive.diveroid.com/api/reservation/status");
  if (sessionId) url.searchParams.set("session_id", sessionId);
  if (queryToken) url.searchParams.set("inviteToken", queryToken);
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { headers });
}

function inboxHash(email = EMAIL): string {
  return reservationEmailHash(reservationCanonicalEmail(email));
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function stripeSignature(payload: string, secret: string, timestampSeconds: number, digest?: string): string {
  const v1 =
    digest ??
    createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

test("approved prices are 300 cents now and 14900 later, totaling 15200 before shipping or tax", () => {
  assert.equal(RESERVATION_FEE_CENTS, 300);
  assert.equal(LATER_PRODUCT_PRICE_CENTS, 14_900);
  assert.equal(PRICE_BEFORE_SHIPPING_OR_TAX_CENTS, 15_200);
  assert.match(PRODUCT_DESCRIPTION, /not credited/i);
  assert.match(PRODUCT_DESCRIPTION, /lowest/);
  assert.match(PRODUCT_DESCRIPTION, /launch cancellation/);
  assert.doesNotMatch(PRODUCT_DESCRIPTION, /stock|ships on|exclusion|first 30/i);
});

test("the invite helper canonicalizes email and refuses an unverified address", () => {
  assert.throws(() => invite({ emailVerified: false }), /emailVerified/);
  const token = issueFromIndex({
    leadId: LEAD,
    email: "Diver+tag@gmail.com",
    emailVerified: true,
    expiresAtMs: NOW + 60_000,
    secret: SECRET,
    nowMs: NOW,
  });
  const parsed = verifyReservationInvite(token, SECRET, NOW);
  assert.equal(parsed?.email, "diver@gmail.com");
  assert.equal(parsed?.emailVerified, true);
  assert.equal(verifyReservationInvite(token, SECRET, NOW + 60_000), undefined);
  assert.equal(verifyReservationInvite(`${token}x`, SECRET, NOW), undefined);
  assert.equal(verifyReservationInvite(token, `${SECRET}-other-secret-value`, NOW), undefined);
});

test("the invite export is issueReservationInvite and it requires a verified email", async () => {
  const mod = await import("../src/lib/reservation/invite.ts");
  assert.equal(typeof mod.issueReservationInvite, "function");
  assert.equal("createReservationInviteToken" in mod, false);
  assert.equal("createReservationInviteUrl" in mod, false);
  assert.throws(
    () =>
      mod.issueReservationInvite({
        leadId: LEAD,
        email: EMAIL,
        emailVerified: false,
        expiresAtMs: NOW + 60_000,
        secret: SECRET,
        nowMs: NOW,
      }),
    /emailVerified/,
  );
  const token = mod.issueReservationInvite({
    leadId: LEAD,
    email: "Diver+tag@gmail.com",
    emailVerified: true,
    expiresAtMs: NOW + 60_000,
    secret: SECRET,
    nowMs: NOW,
    jti: "invitejti00000077",
  });
  assert.equal(token.includes("@"), false);
  assert.ok(token.length <= 2048);
  const parsed = verifyReservationInvite(token, SECRET, NOW);
  assert.equal(parsed?.email, "diver@gmail.com");
  assert.equal(parsed?.leadId, LEAD);
  assert.equal(parsed?.offerVersion, "2026-10-18");
  const mailed = `https://watchdive.diveroid.com/reservation?lang=ko#invite=${token}`;
  const url = new URL(mailed);
  assert.equal(url.pathname, "/reservation");
  assert.equal(url.searchParams.get("lang"), "ko");
  assert.equal(url.searchParams.get("inviteToken"), null);
  assert.equal(url.searchParams.get("token"), null);
  assert.equal(url.hash, `#invite=${token}`);
});

test("reservation stays disabled until the flag is exactly true, and a live key is refused", () => {
  assert.equal(readReservationConfig({}, { webhookSecret: true, tokenSecret: true, origin: true }).ok, false);
  const disabled = readReservationConfig(
    { ...ENV, WATCHDIVE_RESERVATION_ENABLED: "false" },
    { webhookSecret: true, tokenSecret: true, origin: true },
  );
  assert.equal(disabled.ok, false);
  if (!disabled.ok) assert.equal(disabled.problem, "disabled");
  const live = readReservationConfig(
    { ...ENV, STRIPE_SECRET_KEY: "sk_live_watchdive_reservation_example" },
    { webhookSecret: true, tokenSecret: true, origin: true },
  );
  assert.equal(live.ok, false);
  if (!live.ok) assert.equal(live.problem, "live_key_refused");
  const allowed = readReservationConfig(
    {
      ...ENV,
      STRIPE_SECRET_KEY: "sk_live_watchdive_reservation_example",
      WATCHDIVE_RESERVATION_ALLOW_LIVE: "true",
    },
    { webhookSecret: true, tokenSecret: true, origin: true },
  );
  assert.equal(allowed.ok, true);
  if (allowed.ok) assert.equal(allowed.value.mode, "live");
});

test("checkout is inert and makes no Stripe call when disabled or given a live key", async () => {
  const fake = new MemoryStripe();
  const disabled = await handleReservationCheckout(
    post(invite()),
    deps(fake, { ...ENV, WATCHDIVE_RESERVATION_ENABLED: "false" }),
  );
  assert.equal(disabled.status, 503);
  assert.deepEqual(await bodyOf(disabled), { error: "reservation_disabled" });
  const live = await handleReservationCheckout(
    post(invite()),
    deps(fake, { ...ENV, STRIPE_SECRET_KEY: "sk_live_watchdive_reservation_example" }),
  );
  assert.equal(live.status, 503);
  assert.equal((await bodyOf(live)).error, "reservation_misconfigured");
  assert.equal(fake.calls.length, 0);
});

test("checkout returns a hosted URL for USD 300 and ignores the client email and Host", async () => {
  const fake = new MemoryStripe();
  const response = await handleReservationCheckout(post(invite()), deps(fake));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const body = await bodyOf(response);
  assert.deepEqual(Object.keys(body), ["url"]);
  assert.match(String(body.url), /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
  assert.equal(fake.creates(), 1);
  const params = fake.checkoutParams[0];
  assert.ok(params);
  assert.equal(params.get("mode"), "payment");
  assert.equal(params.get("ui_mode"), "hosted");
  assert.equal(params.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "300");
  assert.equal(params.get("line_items[0][quantity]"), "1");
  assert.equal(params.get("payment_method_types[0]"), "card");
  assert.equal(params.get("success_url"), SUCCESS);
  assert.equal(params.get("cancel_url"), `${ORIGIN}/reservation?canceled=1`);
  assert.equal(params.get("customer_email"), null);
  assert.equal(params.get("metadata[product]"), "watchdive_reservation_fee");
  assert.equal(params.get("metadata[fee_policy]"), "additional_not_credited");
  assert.equal(params.get("metadata[later_price_cents]"), "14900");
  assert.equal(params.get("metadata[price_guarantee]"), "lowest_149_usd_100_percent");
  assert.equal(params.get("metadata[accepted_terms]"), "true");
  assert.equal(params.get("metadata[terms_version]"), TERMS_VERSION);
  assert.equal(params.get("metadata[lead_id]"), null);
  assert.equal(params.get("metadata[invite_jti]"), null);
  assert.equal(params.get("client_reference_id"), inboxHash());
  assert.equal(params.get("client_reference_id")?.includes(LEAD), false);
  assert.equal(fake.checkoutKeys[0], reservationIdempotencyKey(inboxHash(), 1));
  assert.equal(fake.customers[0]?.email, EMAIL);
  assert.equal(reservationSuccessUrl(ORIGIN), SUCCESS);
  assert.equal(STRIPE_API_VERSION, "2024-06-20");
  assert.ok(fake.calls.every((call) => call.version === STRIPE_API_VERSION));
  assert.ok(fake.calls.every((call) => call.authorization === `Bearer ${STRIPE_KEY}`));
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(EMAIL), false);
  assert.equal(serialized.includes(STRIPE_KEY), false);
});

test("a second checkout for an already paid inbox does not create another session", async () => {
  const fake = new MemoryStripe();
  fake.seedPaid();
  const response = await handleReservationCheckout(post(invite()), deps(fake));
  assert.equal(response.status, 409);
  const body = await bodyOf(response);
  assert.equal(body.error, "already_paid");
  assert.equal(body.paid, true);
  assert.equal(fake.creates(), 0);
});

test("the same Gmail inbox cannot pay twice under another spelling or lead", async () => {
  const fake = new MemoryStripe();
  fake.seedPaid({ email: "ab@gmail.com", leadId: LEAD });
  const token = invite({
    leadId: OTHER_LEAD,
    email: "a.b+kickstarter@gmail.com",
    jti: "invitejti00000002",
  });
  const response = await handleReservationCheckout(post(token), deps(fake));
  assert.equal(response.status, 409);
  assert.equal((await bodyOf(response)).error, "already_paid");
  assert.equal(fake.creates(), 0);
});

test("a custom-domain plus address is a different inbox from the address without the tag", async () => {
  const fake = new MemoryStripe();
  fake.seedPaid({ email: "diver+tag@example.com" });
  const tagged = await handleReservationCheckout(
    post(invite({ email: "Diver+Tag@example.com" })),
    deps(fake),
  );
  assert.equal(tagged.status, 409);
  assert.equal((await bodyOf(tagged)).error, "already_paid");
  assert.equal(fake.creates(), 0);

  const other = await handleReservationCheckout(
    post(invite({ email: "diver@example.com", leadId: OTHER_LEAD, jti: "invitejti00000066" })),
    deps(fake),
  );
  assert.equal(other.status, 200);
  assert.equal(fake.creates(), 1);
  assert.equal(fake.customers.at(-1)?.email, "diver@example.com");
});

test("a refunded or partially refunded fee does not start a new charge", async () => {
  const refunded = new MemoryStripe();
  refunded.seedPaid({ amountRefunded: 300 });
  const refundedResponse = await handleReservationCheckout(post(invite()), deps(refunded));
  assert.equal(refundedResponse.status, 409);
  assert.equal((await bodyOf(refundedResponse)).error, "refunded");
  assert.equal(refunded.creates(), 0);

  const partial = new MemoryStripe();
  partial.seedPaid({ amountRefunded: 100 });
  const partialResponse = await handleReservationCheckout(post(invite()), deps(partial));
  assert.equal((await bodyOf(partialResponse)).error, "partially_refunded");
  assert.equal(partial.creates(), 0);

  const pending = new MemoryStripe();
  pending.seedPaid({ pendingRefund: 300 });
  const pendingResponse = await handleReservationCheckout(post(invite()), deps(pending));
  assert.equal((await bodyOf(pendingResponse)).error, "refund_pending");
  assert.equal(pending.creates(), 0);
});

test("an open session is reused instead of creating a second one", async () => {
  const fake = new MemoryStripe();
  const first = await handleReservationCheckout(post(invite()), deps(fake));
  const firstBody = await bodyOf(first);
  const second = await handleReservationCheckout(post(invite()), deps(fake));
  const secondBody = await bodyOf(second);
  assert.equal(second.status, 200);
  assert.equal(secondBody.url, firstBody.url);
  assert.equal(fake.sessions.length, 1);
});

test("two open sessions collapse to the oldest URL and the newer one is expired", async () => {
  const fake = new MemoryStripe();
  const older = fake.seedPaid({ status: "open", paymentStatus: "unpaid" });
  older.url = `https://checkout.stripe.com/c/pay/${older.id}`;
  older.paymentIntentId = null;
  const newer = fake.seedPaid({ status: "open", paymentStatus: "unpaid" });
  newer.url = `https://checkout.stripe.com/c/pay/${newer.id}`;
  newer.paymentIntentId = null;
  newer.created = older.created + 10;
  const response = await handleReservationCheckout(post(invite()), deps(fake));
  const body = await bodyOf(response);
  assert.equal(response.status, 200);
  assert.equal(body.url, older.url);
  assert.equal(newer.status, "expired");
  assert.equal(fake.creates(), 0);
});

test("two racing checkouts share one Stripe session", async () => {
  const fake = new MemoryStripe();
  const token = invite();
  const [left, right] = await Promise.all([
    handleReservationCheckout(post(token), deps(fake)),
    handleReservationCheckout(post(token), deps(fake)),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.equal((await bodyOf(left)).url, (await bodyOf(right)).url);
  assert.equal(fake.sessions.length, 1);
});

test("a wrong amount is not paid and is not offered as the checkout URL", async () => {
  const fake = new MemoryStripe();
  fake.seedPaid({ amountTotal: 100 });
  const status = await handleReservationStatus(
    statusRequest(invite(), fake.sessions[0]?.id),
    deps(fake),
  );
  const statusBody = await bodyOf(status);
  assert.equal(statusBody.paid, false);
  assert.equal(statusBody.status, "invalid");

  const created = new MemoryStripe();
  created.amountOverride = 100;
  const response = await handleReservationCheckout(post(invite()), deps(created));
  const mismatch = await bodyOf(response);
  assert.equal(response.status, 502);
  assert.equal(mismatch.error, "stripe_contract_mismatch");
  assert.equal(mismatch.url, undefined);
});

test("status paid is true only after Stripe says paid, not because the query says so", async () => {
  const unpaid = new MemoryStripe();
  const created = await handleReservationCheckout(post(invite()), deps(unpaid));
  const sessionId = unpaid.sessions[0]?.id;
  assert.equal(created.status, 200);
  const lyingUrl = new URL("https://watchdive.diveroid.com/api/reservation/status");
  lyingUrl.searchParams.set("session_id", sessionId ?? "");
  lyingUrl.searchParams.set("paid", "true");
  lyingUrl.searchParams.set("payment_status", "paid");
  const lying = await handleReservationStatus(
    new Request(lyingUrl, { headers: { authorization: `Bearer ${invite()}` } }),
    deps(unpaid),
  );
  const lyingBody = await bodyOf(lying);
  assert.equal(lyingBody.paid, false);
  assert.equal(lyingBody.status, "open");
  assert.equal(lyingBody.source, "stripe");
  assert.equal(JSON.stringify(lyingBody).includes(EMAIL), false);

  const paid = new MemoryStripe();
  const session = paid.seedPaid();
  const confirmed = await handleReservationStatus(
    statusRequest(invite(), session.id),
    deps(paid),
  );
  const confirmedBody = await bodyOf(confirmed);
  assert.equal(confirmedBody.status, "paid");
  assert.equal(confirmedBody.paid, true);
  assert.equal(confirmedBody.source, "stripe");
  assert.equal(confirmedBody.amountTotal, 300);
  assert.equal(confirmedBody.currency, "usd");
  assert.equal(confirmedBody.amountRefunded, 0);
  assert.equal(JSON.stringify(confirmedBody).includes("email"), false);
});

test("status requires the bearer invite and ignores a query token", async () => {
  const fake = new MemoryStripe();
  fake.seedPaid();
  const token = invite();
  const ok = await handleReservationStatus(statusRequest(token), deps(fake));
  const okBody = await bodyOf(ok);
  assert.equal(ok.status, 200);
  assert.equal(okBody.paid, true);
  assert.equal(okBody.status, "paid");
  assert.equal(okBody.source, "stripe");
  const queryOnly = await handleReservationStatus(
    statusRequest(null, undefined, token),
    deps(fake),
  );
  assert.equal(queryOnly.status, 401);
  assert.equal((await bodyOf(queryOnly)).error, "missing_bearer");
  const badBearer = await handleReservationStatus(statusRequest("not-a-token"), deps(fake));
  assert.equal(badBearer.status, 401);
  assert.equal((await bodyOf(badBearer)).error, "invalid_invite");
});

test("webhook signature uses the raw body and a tampered or stale payload is refused", async () => {
  const fake = new MemoryStripe();
  const payload = JSON.stringify({ id: "evt_test_raw", type: "checkout.session.completed", livemode: false });
  const stamp = Math.floor(NOW / 1000);
  const good = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: { "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, stamp) },
      body: payload,
    }),
    deps(fake),
  );
  assert.equal(good.status, 200);
  assert.equal((await bodyOf(good)).ignored, "not_reservation");

  const callsAfterGood = fake.calls.length;
  const tampered = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: { "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, stamp) },
      body: `${payload} `,
    }),
    deps(fake),
  );
  assert.equal(tampered.status, 400);
  assert.equal((await bodyOf(tampered)).error, "invalid_signature");
  const stale = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: { "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, stamp - 301) },
      body: payload,
    }),
    deps(fake),
  );
  assert.equal(stale.status, 400);
  assert.equal(fake.calls.length, callsAfterGood);

  const rotated = stripeSignature(payload, WEBHOOK_SECRET, stamp);
  const v1 = rotated.split("v1=")[1];
  const withOld = `t=${stamp},v1=${"0".repeat(64)},v1=${v1}`;
  const accepted = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: { "stripe-signature": withOld },
      body: payload,
    }),
    deps(fake),
  );
  assert.equal(accepted.status, 200);
});

test("a clean paid webhook and status share one Purchase id, and a refund does not", async () => {
  const verifySecret = "test-verification-secret-at-least-32b";
  const previous = {
    META_CAPI_ENABLED: process.env.META_CAPI_ENABLED,
    META_CAPI_ACCESS_TOKEN: process.env.META_CAPI_ACCESS_TOKEN,
    META_PIXEL_ID: process.env.META_PIXEL_ID,
    VITE_META_TRACKING_ENABLED: process.env.VITE_META_TRACKING_ENABLED,
    VITE_META_PIXEL_ID: process.env.VITE_META_PIXEL_ID,
  };
  const pixel = "123456789012345";
  process.env.META_CAPI_ENABLED = "true";
  process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-live";
  process.env.META_PIXEL_ID = pixel;
  process.env.VITE_META_TRACKING_ENABLED = "true";
  process.env.VITE_META_PIXEL_ID = pixel;
  const originalFetch = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/events") && init?.method === "POST") posts.push(String(init.body ?? ""));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  const lookups: string[] = [];
  const signup = {
    pageId: "page-paid-1",
    emailVerified: true,
    status: "verified",
    suspect: false,
    duplicate: false,
    abusive: false,
    unsubscribed: false,
    measurementConsent: "WD-AD-MEASUREMENT-CONSENT-V1:granted",
    signupLocale: "en",
    source: "hero",
    landingPath: "/en",
    fbc: null,
  };
  const measured = async (email: string) => {
    lookups.push(email);
    return signup;
  };
  try {
    const fake = new MemoryStripe();
    const session = fake.seedPaid();
    const payload = JSON.stringify({
      id: "evt_measured_paid",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: session.id, payment_status: "unpaid", amount_total: 1 } },
    });
    const request = () =>
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: payload,
      });
    const env = { ...ENV, WATCHDIVE_VERIFICATION_SECRET: verifySecret };
    const depsPaid = () => ({ ...deps(fake, env), loadMeasuredSignup: measured });
    const first = await bodyOf(await handleReservationWebhook(request(), depsPaid()));
    const second = await bodyOf(await handleReservationWebhook(request(), depsPaid()));
    assert.equal(first.paid, true);
    assert.equal("measurement" in first, false);
    assert.equal("email" in first, false);
    assert.equal(posts.length, 2);
    const sent = posts.map((body) => JSON.parse(body) as {
      data: Array<{ event_name: string; event_id: string; event_time: number }>;
    });
    assert.equal(sent[0].data[0].event_name, "Purchase");
    assert.equal(sent[0].data[0].event_id, sent[1].data[0].event_id);
    assert.equal(sent[0].data[0].event_time, Math.floor(NOW / 1000));
    assert.equal(sent[1].data[0].event_time, sent[0].data[0].event_time);
    assert.equal(posts.some((body) => body.includes(EMAIL) || body.includes(session.id)), false);
    const status = await bodyOf(await handleReservationStatus(
      new Request("https://watchdive.diveroid.com/api/reservation/status", {
        headers: { authorization: `Bearer ${invite()}` },
      }),
      depsPaid(),
    ));
    const purchase = (status.measurement as {
      purchase?: { eventId?: string; eventName?: string; eventTime?: number };
    }).purchase;
    assert.equal(purchase?.eventName, "Purchase");
    assert.equal(purchase?.eventId, sent[0].data[0].event_id);
    assert.equal(purchase?.eventTime, Math.floor(NOW / 1000));
    assert.equal("paidAtSeconds" in status, false);
    assert.equal(JSON.stringify(status.measurement).includes(EMAIL), false);
    assert.equal(JSON.stringify(status.measurement).includes(session.id), false);
    const gpc = await bodyOf(await handleReservationStatus(
      new Request("https://watchdive.diveroid.com/api/reservation/status", {
        headers: { authorization: `Bearer ${invite()}`, "sec-gpc": "1" },
      }),
      depsPaid(),
    ));
    assert.equal("measurement" in gpc, false);
    const beforeRefund = lookups.length;
    const refundedStripe = new MemoryStripe();
    refundedStripe.seedPaid({ amountRefunded: 300 });
    const charge = [...refundedStripe.charges.values()][0];
    const refundPayload = JSON.stringify({
      id: "evt_measured_refund",
      type: "charge.refunded",
      livemode: false,
      data: { object: { id: charge.id, amount_refunded: 300, object: "charge" } },
    });
    await handleReservationWebhook(
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(refundPayload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: refundPayload,
      }),
      { ...deps(refundedStripe, env), loadMeasuredSignup: measured },
    );
    assert.equal(lookups.length, beforeRefund);
    assert.equal(posts.length, 2);
    const unpaidLookups = lookups.length;
    await handleReservationStatus(
      new Request("https://watchdive.diveroid.com/api/reservation/status", {
        headers: { authorization: `Bearer ${invite()}` },
      }),
      { ...deps(new MemoryStripe(), env), loadMeasuredSignup: measured },
    );
    assert.equal(lookups.length, unpaidLookups);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a paid session older than 48 hours and a charge without created do not emit Purchase", async () => {
  const verifySecret = "test-verification-secret-at-least-32b";
  const previousToken = process.env.META_CAPI_ACCESS_TOKEN;
  process.env.META_CAPI_ENABLED = "true";
  process.env.META_CAPI_ACCESS_TOKEN = "test-token-not-live";
  process.env.META_PIXEL_ID = "123456789012345";
  process.env.VITE_META_TRACKING_ENABLED = "true";
  process.env.VITE_META_PIXEL_ID = "123456789012345";
  const originalFetch = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/events") && init?.method === "POST") posts.push(String(init.body ?? ""));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  const lookups: string[] = [];
  const measured = async () => {
    lookups.push("lookup");
    return {
      pageId: "page-old",
      emailVerified: true,
      status: "verified",
      suspect: false,
      duplicate: false,
      abusive: false,
      unsubscribed: false,
      measurementConsent: "WD-AD-MEASUREMENT-CONSENT-V1:granted",
      signupLocale: "en",
      source: "hero",
      landingPath: "/en",
      fbc: null,
    };
  };
  try {
    const env = { ...ENV, WATCHDIVE_VERIFICATION_SECRET: verifySecret };
    const oldStripe = new MemoryStripe();
    const oldSession = oldStripe.seedPaid({ chargeCreated: Math.floor(NOW / 1000) - 48 * 3600 - 1 });
    const oldPayload = JSON.stringify({
      id: "evt_old_paid",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: oldSession.id, payment_status: "unpaid", amount_total: 1 } },
    });
    const oldDeps = { ...deps(oldStripe, env), loadMeasuredSignup: measured };
    const oldWebhook = await bodyOf(await handleReservationWebhook(
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(oldPayload, WEBHOOK_SECRET, Math.floor(NOW / 1000)) },
        body: oldPayload,
      }),
      oldDeps,
    ));
    assert.equal(oldWebhook.paid, true);
    assert.equal(posts.length, 0);
    assert.equal(lookups.length, 0);
    const oldStatus = await bodyOf(await handleReservationStatus(
      new Request("https://watchdive.diveroid.com/api/reservation/status", {
        headers: { authorization: `Bearer ${invite()}` },
      }),
      oldDeps,
    ));
    assert.equal(oldStatus.paid, true);
    assert.equal("measurement" in oldStatus, false);
    assert.equal(lookups.length, 0);

    const missingStripe = new MemoryStripe();
    const missingSession = missingStripe.seedPaid({ chargeCreated: null });
    const missingPayload = JSON.stringify({
      id: "evt_missing_created",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: missingSession.id, payment_status: "unpaid", amount_total: 1 } },
    });
    const missingDeps = { ...deps(missingStripe, env), loadMeasuredSignup: measured };
    const missingWebhook = await bodyOf(await handleReservationWebhook(
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(missingPayload, WEBHOOK_SECRET, Math.floor(NOW / 1000)) },
        body: missingPayload,
      }),
      missingDeps,
    ));
    assert.equal(missingWebhook.paid, true);
    assert.equal(posts.length, 0);
    assert.equal(lookups.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.META_CAPI_ACCESS_TOKEN;
    else process.env.META_CAPI_ACCESS_TOKEN = previousToken;
    delete process.env.META_CAPI_ENABLED;
    delete process.env.META_PIXEL_ID;
    delete process.env.VITE_META_TRACKING_ENABLED;
    delete process.env.VITE_META_PIXEL_ID;
  }
});

test("a paid webhook trusts the retrieved session, and a replay does not double the fee", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid();
  const payload = JSON.stringify({
    id: "evt_paid_once",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id, payment_status: "unpaid", amount_total: 1 } },
  });
  const request = () =>
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: payload,
    });
  const first = await bodyOf(await handleReservationWebhook(request(), deps(fake)));
  const second = await bodyOf(await handleReservationWebhook(request(), deps(fake)));
  assert.equal(first.paid, true);
  assert.equal(second.paid, true);
  assert.equal(first.sessionId, session.id);
  assert.equal(second.amountRefunded, 0);
  assert.equal(fake.creates(), 0);
  assert.equal(
    fake.calls.filter((call) => call.path.includes("/refunds") && call.method === "POST").length,
    0,
  );
});

test("a custom-domain plus webhook stays bound to that exact inbox", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid({ email: "diver+tag@example.com" });
  const payload = JSON.stringify({
    id: "evt_plus_custom",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id, payment_status: "unpaid", amount_total: 1 } },
  });
  const body = await bodyOf(
    await handleReservationWebhook(
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: payload,
      }),
      deps(fake),
    ),
  );
  assert.equal(body.paid, true);
  assert.equal(body.ignored, undefined);
  assert.equal(fake.creates(), 0);
});

test("refund webhooks read the charge and stay idempotent when the event amount is wrong", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid({ amountRefunded: 300 });
  const charge = [...fake.charges.values()][0];
  assert.ok(charge);
  const payload = JSON.stringify({
    id: "evt_refund_once",
    type: "charge.refunded",
    livemode: false,
    data: { object: { id: charge.id, amount_refunded: 99999, object: "charge" } },
  });
  const request = () =>
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: payload,
    });
  const first = await bodyOf(await handleReservationWebhook(request(), deps(fake)));
  const second = await bodyOf(await handleReservationWebhook(request(), deps(fake)));
  assert.equal(first.paid, false);
  assert.equal(first.status, "refunded");
  assert.equal(first.amountRefunded, 300);
  assert.equal(second.amountRefunded, 300);
  assert.equal(second.sessionId, session.id);
  assert.equal(fake.creates(), 0);
  assert.equal(charge.amountRefunded, 300);
});

test("an unpaid completed session and a live-mode event are not treated as paid", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid({ paymentStatus: "unpaid", status: "complete" });
  const payload = JSON.stringify({
    id: "evt_unpaid",
    type: "checkout.session.async_payment_succeeded",
    livemode: false,
    data: { object: { id: session.id, payment_status: "paid", amount_total: 300 } },
  });
  const unpaid = await bodyOf(
    await handleReservationWebhook(
      new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: payload,
      }),
      deps(fake),
    ),
  );
  assert.equal(unpaid.paid, false);

  const calls = fake.calls.length;
  const livePayload = JSON.stringify({
    id: "evt_live",
    type: "checkout.session.completed",
    livemode: true,
    data: { object: { id: session.id, payment_status: "paid" } },
  });
  const live = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(livePayload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: livePayload,
    }),
    deps(fake),
  );
  assert.equal((await bodyOf(live)).ignored, "livemode_mismatch");
  assert.equal(fake.calls.length, calls);
});

test("concurrent checkouts for one inbox with different leads and jtis share one session", async () => {
  const fake = new MemoryStripe();
  const leftToken = invite({
    leadId: LEAD,
    email: "A.B+left@gmail.com",
    jti: "invitejti00000011",
  });
  const rightToken = invite({
    leadId: OTHER_LEAD,
    email: "ab@gmail.com",
    jti: "invitejti00000022",
  });
  const [left, right] = await Promise.all([
    handleReservationCheckout(post(leftToken), deps(fake)),
    handleReservationCheckout(post(rightToken), deps(fake)),
  ]);
  const leftBody = await bodyOf(left);
  const rightBody = await bodyOf(right);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.equal(leftBody.url, rightBody.url);
  assert.equal(isHostedCheckoutUrl(String(leftBody.url)), true);
  assert.equal(fake.sessions.length, 1);
  assert.equal(fake.customers.length, 1);
  assert.equal(fake.customers[0]?.email, "ab@gmail.com");
  const hash = inboxHash("ab@gmail.com");
  assert.ok(fake.checkoutKeys.length >= 1);
  assert.ok(fake.checkoutKeys.every((key) => key === reservationIdempotencyKey(hash, 1)));
  const flat = fake.checkoutParams.map((params) => params.toString()).join("\n");
  assert.equal(flat.includes(LEAD), false);
  assert.equal(flat.includes(OTHER_LEAD), false);
  assert.equal(flat.includes("invitejti"), false);
  assert.equal(fake.checkoutParams.every((params) => params.get("ui_mode") === "hosted"), true);
  assert.equal(fake.checkoutParams.every((params) => params.get("client_reference_id") === hash), true);
});

test("an expired session reissues after the idempotency window, and an unknown error stays on attempt 1", async () => {
  const hash = inboxHash();
  const failed = new MemoryStripe();
  failed.failCreates = true;
  const broken = await handleReservationCheckout(post(invite()), deps(failed));
  assert.equal(broken.status, 502);
  assert.equal((await bodyOf(broken)).error, "stripe_error");
  assert.equal(failed.sessions.length, 0);
  failed.failCreates = false;
  const recovered = await handleReservationCheckout(
    post(invite({ leadId: OTHER_LEAD, jti: "invitejti00000033" })),
    deps(failed),
  );
  assert.equal(recovered.status, 200);
  assert.equal(failed.sessions.length, 1);
  assert.deepEqual(failed.checkoutKeys, [
    reservationIdempotencyKey(hash, 1),
    reservationIdempotencyKey(hash, 1),
  ]);

  const fake = new MemoryStripe();
  const first = await handleReservationCheckout(
    post(invite({ jti: "invitejti00000041" })),
    deps(fake),
  );
  assert.equal(first.status, 200);
  const firstUrl = (await bodyOf(first)).url;
  const open = fake.sessions[0];
  assert.ok(open);
  open.status = "expired";
  fake.idempotency.clear();
  const second = await handleReservationCheckout(
    post(invite({ leadId: OTHER_LEAD, jti: "invitejti00000042" })),
    deps(fake),
  );
  assert.equal(second.status, 200);
  const secondUrl = (await bodyOf(second)).url;
  assert.notEqual(secondUrl, firstUrl);
  assert.equal(fake.sessions.length, 2);
  assert.equal(fake.checkoutKeys[0], reservationIdempotencyKey(hash, 1));
  assert.equal(fake.checkoutKeys[1], reservationIdempotencyKey(hash, 2));
  assert.equal(String(fake.checkoutKeys[1]).includes(LEAD), false);
  assert.equal(String(fake.checkoutKeys[1]).includes(OTHER_LEAD), false);
  const third = await handleReservationCheckout(
    post(invite({ jti: "invitejti00000043" })),
    deps(fake),
  );
  assert.equal(third.status, 200);
  assert.equal((await bodyOf(third)).url, secondUrl);
  assert.equal(fake.sessions.filter((session) => session.status === "open").length, 1);
  assert.equal(fake.creates(), 2);
});

test("paid and refunded inboxes expire every open session", async () => {
  const fake = new MemoryStripe();
  const paid = fake.seedPaid();
  const older = fake.seedPaid({ status: "open", paymentStatus: "unpaid" });
  older.url = `https://checkout.stripe.com/c/pay/${older.id}`;
  older.paymentIntentId = null;
  const newer = fake.seedPaid({ status: "open", paymentStatus: "unpaid" });
  newer.url = `https://evil.example/pay/${newer.id}`;
  newer.paymentIntentId = null;
  const response = await handleReservationCheckout(
    post(invite({ leadId: OTHER_LEAD, jti: "invitejti00000055" })),
    deps(fake),
  );
  assert.equal(response.status, 409);
  assert.equal((await bodyOf(response)).error, "already_paid");
  assert.equal(fake.creates(), 0);
  assert.equal(older.status, "expired");
  assert.equal(newer.status, "expired");
  assert.equal(paid.status, "complete");

  const refundedFake = new MemoryStripe();
  const refunded = refundedFake.seedPaid({ amountRefunded: 300 });
  const refundedOpen = refundedFake.seedPaid({ status: "open", paymentStatus: "unpaid" });
  refundedOpen.url = `https://checkout.stripe.com/c/pay/${refundedOpen.id}`;
  refundedOpen.paymentIntentId = null;
  const refundedResponse = await handleReservationCheckout(post(invite()), deps(refundedFake));
  assert.equal(refundedResponse.status, 409);
  assert.equal((await bodyOf(refundedResponse)).error, "refunded");
  assert.equal(refundedOpen.status, "expired");
  assert.equal(refunded.status, "complete");
  assert.equal(refundedFake.creates(), 0);
});

test("refund and dispute replays read Stripe and never refund or create", async () => {
  const disputed = new MemoryStripe();
  const session = disputed.seedPaid({ disputed: true, disputeStatus: "needs_response" });
  const charge = [...disputed.charges.values()][0];
  assert.ok(charge);
  const payload = JSON.stringify({
    id: "evt_dispute_once",
    type: "charge.dispute.created",
    livemode: false,
    data: {
      object: {
        id: "du_evt_1",
        object: "dispute",
        charge: charge.id,
        amount: 99999,
        status: "warning_needs_response",
      },
    },
  });
  const request = () =>
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: payload,
    });
  const first = await bodyOf(await handleReservationWebhook(request(), deps(disputed)));
  const second = await bodyOf(await handleReservationWebhook(request(), deps(disputed)));
  assert.equal(first.paid, false);
  assert.equal(first.status, "disputed");
  assert.equal(first.amountRefunded, 0);
  assert.equal(second.paid, false);
  assert.equal(second.status, "disputed");
  assert.equal(second.amountRefunded, 0);
  assert.equal(second.sessionId, session.id);
  assert.equal(disputed.creates(), 0);
  assert.equal(
    disputed.calls.filter((call) => call.method === "POST" && call.path === "/v1/refunds").length,
    0,
  );

  const won = new MemoryStripe();
  won.seedPaid({ disputed: true, disputeStatus: "won" });
  const wonBody = await bodyOf(await handleReservationStatus(statusRequest(invite()), deps(won)));
  assert.equal(wonBody.paid, true);
  assert.equal(wonBody.status, "paid");
  assert.equal(wonBody.amountRefunded, 0);

  const empty = new MemoryStripe();
  empty.seedPaid();
  const emptyCharge = [...empty.charges.values()][0];
  assert.ok(emptyCharge);
  emptyCharge.disputed = true;
  const emptyBody = await bodyOf(
    await handleReservationStatus(statusRequest(invite()), deps(empty)),
  );
  assert.equal(emptyBody.paid, false);
  assert.equal(emptyBody.status, "disputed");

  const refunded = new MemoryStripe();
  refunded.seedPaid({ amountRefunded: 300, disputed: true, disputeStatus: "needs_response" });
  const refundedBody = await bodyOf(await handleReservationCheckout(post(invite()), deps(refunded)));
  assert.equal(refundedBody.error, "refunded");
  assert.equal(refundedBody.paid, false);
  assert.equal(refunded.creates(), 0);

  const blocked = new MemoryStripe();
  const openBesideDispute = blocked.seedPaid({ status: "open", paymentStatus: "unpaid" });
  openBesideDispute.url = `https://checkout.stripe.com/c/pay/${openBesideDispute.id}`;
  openBesideDispute.paymentIntentId = null;
  blocked.seedPaid({ disputed: true, disputeStatus: "under_review" });
  const disputeCheckout = await handleReservationCheckout(
    post(invite({ jti: "invitejti00000066" })),
    deps(blocked),
  );
  assert.equal(disputeCheckout.status, 409);
  assert.equal((await bodyOf(disputeCheckout)).error, "disputed");
  assert.equal(openBesideDispute.status, "expired");
  assert.equal(blocked.creates(), 0);
});

test("missing bearer is rejected before Stripe even when a session id and query token are present", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid();
  const response = await handleReservationStatus(
    statusRequest(null, session.id, invite()),
    deps(fake),
  );
  const body = await bodyOf(response);
  assert.equal(response.status, 401);
  assert.equal(body.error, "missing_bearer");
  assert.equal(body.paid, undefined);
  assert.equal(fake.calls.length, 0);
  const spaced = await handleReservationStatus(
    new Request(
      `https://watchdive.diveroid.com/api/reservation/status?session_id=${session.id}&paid=true`,
      { headers: { authorization: "Bearer one two" } },
    ),
    deps(fake),
  );
  assert.equal(spaced.status, 401);
  assert.equal((await bodyOf(spaced)).error, "missing_bearer");
  assert.equal(fake.calls.length, 0);

  const other = invite({
    email: "other@example.com",
    leadId: OTHER_LEAD,
    jti: "invitejti00000088",
  });
  const foreign = await handleReservationStatus(statusRequest(other, session.id), deps(fake));
  const foreignBody = await bodyOf(foreign);
  assert.equal(foreign.status, 404);
  assert.equal(foreignBody.error, "not_found");
  assert.equal(foreignBody.paid, undefined);
});

test("rejected terms never call Stripe", async () => {
  const cases: Record<string, unknown>[] = [
    { acceptedTerms: false },
    { acceptedTerms: "true" },
    { acceptedTerms: 1 },
    { termsVersion: "2026-10-17" },
    { acceptedTerms: true, termsVersion: "" },
  ];
  for (const extra of cases) {
    const fake = new MemoryStripe();
    const response = await handleReservationCheckout(post(invite(), extra), deps(fake));
    assert.equal(response.status, 400);
    assert.deepEqual(await bodyOf(response), { error: "rejected_terms" });
    assert.equal(fake.calls.length, 0);
    assert.equal(fake.sessions.length, 0);
  }
});

test("an evil checkout URL is refused and that open session is expired", async () => {
  const evils = [
    "https://evil.example/pay",
    "https://checkout.stripe.com.evil.example/pay",
    "https://attacker@checkout.stripe.com/pay",
    "https://checkout.stripe.com:8443/pay",
    "http://checkout.stripe.com/pay",
  ];
  for (const evil of evils) {
    const fake = new MemoryStripe();
    fake.urlOverride = evil;
    const response = await handleReservationCheckout(post(invite()), deps(fake));
    const body = await bodyOf(response);
    assert.equal(response.status, 502, evil);
    assert.equal(body.error, "stripe_contract_mismatch", evil);
    assert.equal("url" in body, false, evil);
    assert.equal(JSON.stringify(body).includes("evil"), false);
    assert.equal(JSON.stringify(body).includes("attacker"), false);
    assert.equal(fake.sessions[0]?.status, "expired", evil);
    assert.equal(isHostedCheckoutUrl(evil), false, evil);
  }
  assert.equal(isHostedCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_ok"), true);
  assert.equal(isHostedCheckoutUrl("https://checkout.stripe.com:443/c/pay/cs_test_ok"), true);
});

test("the contract pins the approved account, bearer status, and the handled webhook events", () => {
  const root = new URL("../", import.meta.url);
  const contract = readFileSync(new URL("docs/reservation-contract.md", root), "utf8");
  const webhook = readFileSync(new URL("src/lib/reservation/webhook.ts", root), "utf8");
  const parsed = parseContract(contract);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.problems.join("; "));
  if (!parsed.ok) return;
  assert.equal(parsed.value.stripeAccountId, "acct_1Tl9bv1UxFzpSUuA");
  const handled = parseHandledEvents(webhook);
  assert.ok(handled);
  assert.deepEqual(parsed.value.webhookEvents, handled);
  assert.equal(contract.includes("hosted_page"), false);
  assert.match(contract, /ui_mode` is `hosted`/);
  assert.match(contract, /Authorization: Bearer/);
  assert.match(contract, /#invite=/);
  assert.match(contract, /\/ko\/reservation` does not exist/);
  assert.match(contract, /not an atomic lock/);
  assert.equal((contract.match(/```reservation-readiness/g) ?? []).length, 1);
  assert.equal(contract.includes("acct_REPLACE_AFTER_LOGIN"), false);
});

test("route files and the route tree expose checkout, status, and the webhook", () => {
  const root = new URL("../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), "utf8");
  assert.match(read("src/routes/api/reservation/checkout.ts"), /\/api\/reservation\/checkout/);
  assert.match(read("src/routes/api/reservation/status.ts"), /\/api\/reservation\/status/);
  assert.match(read("src/routes/api/reservation/webhook.ts"), /\/api\/reservation\/webhook/);
  const tree = read("src/routeTree.gen.ts");
  assert.match(tree, /routes\/api\/reservation\/checkout/);
  assert.match(tree, /routes\/api\/reservation\/status/);
  assert.match(tree, /routes\/api\/reservation\/webhook/);
  assert.match(tree, /\/reservation/);
  assert.equal(tree.match(/from '\.\/routes\/api\/reservation\/checkout'/g)?.length, 1);
});

test("verified payment measurement receives fetched state and retries without a second purchase", async () => {
  const { createGoogleConversions } =
    await import("../src/lib/analytics/googleConversions.server.ts");
  const { purchaseEvent } = await import("../src/lib/reservation/measurement.server.ts");
  for (const variant of ["paid", "unpaid", "refunded"]) {
    const fake = new MemoryStripe();
    const session = fake.seedPaid(
      variant === "unpaid"
        ? { paymentStatus: "unpaid" }
        : variant === "refunded"
          ? { amountRefunded: 300 }
          : {},
    );
    const payload = JSON.stringify({
      id: "evt_analytics",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: session.id, payment_status: "paid" } },
    });
    const claims = new Set<string>();
    let posts = 0;
    const google = createGoogleConversions({
      env: {
        WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
        VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
        VITE_GA_MEASUREMENT_ID: "G-TEST1234",
        GA4_API_SECRET: "fixture",
        WATCHDIVE_VERIFICATION_SECRET: SECRET,
        WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
        WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture",
        WATCHDIVE_CONVERSION_LEDGER_EPOCH: "watchdive-ledger-20261030",
      },
      now: () => NOW,
      store: {
        epoch: async () => "watchdive-ledger-20261030",
        context: async () => ({ clientId: "123.456", capturedAt: NOW }),
        capture: async () => {},
        forget: async () => {},
        claim: async (key) => {
          if (claims.has(key)) return false;
          claims.add(key);
          return true;
        },
        status: async (key) => (claims.has(key) ? ("accepted" as const) : null),
        finish: async () => {},
        release: async (key) => {
          claims.delete(key);
        },
      },
      fetchImpl: async () => {
        posts++;
        return new Response(null, { status: 204 });
      },
    });
    const measurement = {
      capture: async () => {},
      completed: async (
        email: string,
        snapshot: import("../src/lib/reservation/state.ts").ReservationSnapshot,
      ) => {
        const event = purchaseEvent(snapshot);
        return event ? google.send(email, event, async () => true) : ("skipped" as const);
      },
    };
    const request = () =>
      new Request(`${ORIGIN}/api/reservation/webhook`, {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: payload,
      });
    assert.equal(
      (await handleReservationWebhook(request(), { ...deps(fake), measurement })).status,
      200,
    );
    assert.equal(
      (await handleReservationWebhook(request(), { ...deps(fake), measurement })).status,
      200,
    );
    assert.equal(posts, variant === "paid" ? 1 : 0);
  }
});

test("webhook retries pre-dispatch measurement failure; invalid signatures never measure", async () => {
  const fake = new MemoryStripe();
  const session = fake.seedPaid();
  let attempts = 0;
  const payload = JSON.stringify({
    id: "evt_retry",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id } },
  });
  const measurement = {
    capture: async () => {},
    completed: async () => (++attempts === 1 ? "retry" : "accepted") as "retry" | "accepted",
  };
  const request = (signature: string) =>
    new Request(`${ORIGIN}/api/reservation/webhook`, {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
  assert.equal(
    (await handleReservationWebhook(request("invalid"), { ...deps(fake), measurement })).status,
    400,
  );
  assert.equal(attempts, 0);
  const signature = stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000));
  assert.equal(
    (await handleReservationWebhook(request(signature), { ...deps(fake), measurement })).status,
    500,
  );
  assert.equal(
    (await handleReservationWebhook(request(signature), { ...deps(fake), measurement })).status,
    200,
  );
});

test("checkout uses separate measurement choice, honors GPC and fails closed if refusal cannot persist", async () => {
  const fake = new MemoryStripe();
  const choices: boolean[] = [];
  const measurement = {
    capture: async (_email: string, _id: unknown, permitted: boolean) => {
      choices.push(permitted);
    },
    completed: async () => "skipped" as const,
  };
  const denied = post(invite(), { measurementConsent: false });
  assert.equal(
    (await handleReservationCheckout(denied, { ...deps(fake), measurement })).status,
    200,
  );
  const gpc = post(invite(), { measurementConsent: true });
  gpc.headers.set("sec-gpc", "1");
  assert.equal((await handleReservationCheckout(gpc, { ...deps(fake), measurement })).status, 200);
  assert.deepEqual(choices, [false, false]);
  const before = fake.calls.length;
  assert.equal(
    (
      await handleReservationCheckout(post(invite()), {
        ...deps(fake),
        measurement: {
          ...measurement,
          capture: async () => {
            throw new Error("store down");
          },
        },
      })
    ).status,
    503,
  );
  assert.equal(fake.calls.length, before);
});

test("a ledger epoch rejection returns checkout 503 and does not call Stripe", async () => {
  const { LedgerEpochRejected } = await import("../src/lib/analytics/googleConversions.server.ts");
  const fake = new MemoryStripe();
  const before = fake.calls.length;
  const error = new LedgerEpochRejected("missing");
  assert.equal(error.message, "conversion_ledger_epoch");
  const response = await handleReservationCheckout(
    post(invite(), { measurementConsent: true }),
    {
      ...deps(fake),
      measurement: {
        capture: async () => {
          throw error;
        },
        completed: async () => "skipped" as const,
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "measurement_unavailable");
  assert.equal(fake.calls.length, before);
});

test("enabled durable Purchase posts once, shares the browser id, and skips the legacy post", async () => {
  const verifySecret = "test-verification-secret-at-least-32b";
  const pixel = "123456789012345";
  const purchaseEnv = {
    ...ENV,
    WATCHDIVE_META_PURCHASE_ENABLED: "true",
    META_CAPI_ENABLED: "true",
    VITE_META_TRACKING_ENABLED: "true",
    META_PIXEL_ID: pixel,
    VITE_META_PIXEL_ID: pixel,
    META_CAPI_ACCESS_TOKEN: "fixture-only",
    WATCHDIVE_VERIFICATION_SECRET: verifySecret,
    WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
    WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
    WATCHDIVE_CONVERSION_LEDGER_EPOCH: "watchdive-ledger-20261030",
  };
  const previous = {
    META_CAPI_ENABLED: process.env.META_CAPI_ENABLED,
    META_CAPI_ACCESS_TOKEN: process.env.META_CAPI_ACCESS_TOKEN,
    META_PIXEL_ID: process.env.META_PIXEL_ID,
    VITE_META_TRACKING_ENABLED: process.env.VITE_META_TRACKING_ENABLED,
    VITE_META_PIXEL_ID: process.env.VITE_META_PIXEL_ID,
    WATCHDIVE_META_PURCHASE_ENABLED: process.env.WATCHDIVE_META_PURCHASE_ENABLED,
  };
  process.env.META_CAPI_ENABLED = "true";
  process.env.META_CAPI_ACCESS_TOKEN = "fixture-only";
  process.env.META_PIXEL_ID = pixel;
  process.env.VITE_META_TRACKING_ENABLED = "true";
  process.env.VITE_META_PIXEL_ID = pixel;
  process.env.WATCHDIVE_META_PURCHASE_ENABLED = "true";
  const originalFetch = globalThis.fetch;
  const legacyPosts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/events") && init?.method === "POST") legacyPosts.push(String(init.body ?? ""));
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    const { createMetaPurchases } = await import("../src/lib/analytics/metaPurchases.server.ts");
    const { createGoogleConversions } = await import("../src/lib/analytics/googleConversions.server.ts");
    const { createReservationMeasurement } = await import("../src/lib/reservation/measurement.server.ts");
    const { retargetingEventId } = await import("../src/lib/retargeting/eventId.ts");
    const { MEASUREMENT_CONSENT_GRANTED } = await import("../src/lib/verification/contracts.ts");
    const contexts = new Map<string, { capturedAt: number; clientId?: string }>();
    const states = new Map<string, "accepted" | "uncertain">();
    const store = {
      async epoch() {
        return "watchdive-ledger-20261030";
      },
      async context(key: string) {
        return contexts.get(key) ?? null;
      },
      async capture(key: string, context: { capturedAt: number; clientId?: string }) {
        if (!contexts.has(key)) contexts.set(key, context);
      },
      async forget(key: string) {
        contexts.delete(key);
      },
      async claim(key: string) {
        if (states.has(key)) return false;
        states.set(key, "uncertain");
        return true;
      },
      async status(key: string) {
        return states.get(key) ?? null;
      },
      async finish(key: string, status: "accepted" | "uncertain") {
        states.set(key, status);
      },
      async release(key: string) {
        states.delete(key);
      },
    };
    const bodies: { data: { event_id: string; event_name: string; event_time: number }[] }[] = [];
    const meta = createMetaPurchases({
      env: purchaseEnv,
      store,
      now: () => NOW,
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ events_received: 1 });
      },
    });
    const google = createGoogleConversions({ env: {} });
    const row = {
      email: EMAIL,
      emailVerified: true,
      status: "verified",
      duplicate: false,
      flags: [],
      measurementConsent: MEASUREMENT_CONSENT_GRANTED,
    } as unknown as import("../src/lib/verification/contracts.ts").LeadRecord;
    const measurement = createReservationMeasurement(google, meta, async () => row);
    await measurement.capture(EMAIL, undefined, true);
    const signup = {
      pageId: "page-paid-durable",
      emailVerified: true,
      status: "verified",
      suspect: false,
      duplicate: false,
      abusive: false,
      unsubscribed: false,
      measurementConsent: MEASUREMENT_CONSENT_GRANTED,
      signupLocale: "en",
      source: "hero",
      landingPath: "/en",
      fbc: null,
    };
    const fake = new MemoryStripe();
    const session = fake.seedPaid();
    const payload = JSON.stringify({
      id: "evt_durable_paid",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: session.id, payment_status: "unpaid", amount_total: 1 } },
    });
    const request = () =>
      new Request(`${ORIGIN}/api/reservation/webhook`, {
        method: "POST",
        headers: {
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
        },
        body: payload,
      });
    const paidDeps = {
      ...deps(fake, purchaseEnv),
      measurement,
      loadMeasuredSignup: async () => signup,
    };
    const [first, second] = await Promise.all([
      handleReservationWebhook(request(), paidDeps),
      handleReservationWebhook(request(), paidDeps),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(bodies.length, 1);
    assert.equal(legacyPosts.length, 0);
    const expectedId = retargetingEventId("purchase", session.id, verifySecret);
    assert.equal(bodies[0]?.data[0]?.event_name, "Purchase");
    assert.equal(bodies[0]?.data[0]?.event_id, expectedId);
    assert.equal(bodies[0]?.data[0]?.event_time, Math.floor(NOW / 1000));
    assert.equal(JSON.stringify(bodies).includes(EMAIL), false);
    const replay = await handleReservationWebhook(request(), paidDeps);
    assert.equal(replay.status, 200);
    assert.equal(bodies.length, 1);
    const status = await bodyOf(
      await handleReservationStatus(
        new Request(`${ORIGIN}/api/reservation/status`, {
          headers: { authorization: `Bearer ${invite()}` },
        }),
        paidDeps,
      ),
    );
    const purchase = (
      status.measurement as {
        purchase?: { eventId?: string; eventName?: string; eventTime?: number; metaDelivery?: string };
      }
    ).purchase;
    assert.equal(purchase?.eventName, "Purchase");
    assert.equal(purchase?.eventId, expectedId);
    assert.equal(purchase?.eventTime, Math.floor(NOW / 1000));
    assert.equal(purchase?.metaDelivery, "server");
    const charge = [...fake.charges.values()][0];
    charge.amountRefunded = 300;
    charge.refunded = true;
    fake.refunds.push({
      id: "re_test_durable",
      amount: 300,
      currency: "usd",
      status: "succeeded",
      chargeId: charge.id,
    });
    const refunded = await bodyOf(await handleReservationWebhook(request(), paidDeps));
    assert.equal(refunded.status, "refunded");
    assert.equal(bodies.length, 1);
    assert.equal(legacyPosts.length, 0);
    const refundStatus = await bodyOf(
      await handleReservationStatus(
        new Request(`${ORIGIN}/api/reservation/status`, {
          headers: { authorization: `Bearer ${invite()}` },
        }),
        paidDeps,
      ),
    );
    assert.equal("measurement" in refundStatus, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("durable measurement retry, uncertain, and storage failure keep a single Purchase", async () => {
  const verifySecret = "test-verification-secret-at-least-32b";
  const pixel = "123456789012345";
  const purchaseEnv = {
    ...ENV,
    WATCHDIVE_META_PURCHASE_ENABLED: "true",
    META_CAPI_ENABLED: "true",
    VITE_META_TRACKING_ENABLED: "true",
    META_PIXEL_ID: pixel,
    VITE_META_PIXEL_ID: pixel,
    META_CAPI_ACCESS_TOKEN: "fixture-only",
    WATCHDIVE_VERIFICATION_SECRET: verifySecret,
    WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
    WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
    WATCHDIVE_CONVERSION_LEDGER_EPOCH: "watchdive-ledger-20261030",
  };
  const { createMetaPurchases } = await import("../src/lib/analytics/metaPurchases.server.ts");
  const { createGoogleConversions } = await import("../src/lib/analytics/googleConversions.server.ts");
  const { createReservationMeasurement } = await import("../src/lib/reservation/measurement.server.ts");
  const { MEASUREMENT_CONSENT_GRANTED } = await import("../src/lib/verification/contracts.ts");
  const contexts = new Map<string, { capturedAt: number }>();
  const states = new Map<string, "accepted" | "uncertain">();
  let contextDown = false;
  let mode: "retry" | "uncertain" | "ok" = "retry";
  const store = {
    async epoch() {
      return "watchdive-ledger-20261030";
    },
    async context(key: string) {
      if (contextDown) throw new Error("store down");
      return contexts.get(key) ?? null;
    },
    async capture(key: string, context: { capturedAt: number }) {
      if (!contexts.has(key)) contexts.set(key, context);
    },
    async forget(key: string) {
      contexts.delete(key);
    },
    async claim(key: string) {
      if (states.has(key)) return false;
      states.set(key, "uncertain");
      return true;
    },
    async status(key: string) {
      return states.get(key) ?? null;
    },
    async finish(key: string, status: "accepted" | "uncertain") {
      states.set(key, status);
    },
    async release(key: string) {
      states.delete(key);
    },
  };
  let posts = 0;
  const meta = createMetaPurchases({
    env: purchaseEnv,
    store,
    now: () => NOW,
    fetchImpl: async () => {
      posts += 1;
      if (mode === "retry") return Response.json({ events_received: 0 });
      if (mode === "uncertain") throw new Error("connection lost");
      return Response.json({ events_received: 1 });
    },
  });
  const row = {
    email: EMAIL,
    emailVerified: true,
    status: "verified",
    duplicate: false,
    flags: [],
    measurementConsent: MEASUREMENT_CONSENT_GRANTED,
  } as unknown as import("../src/lib/verification/contracts.ts").LeadRecord;
  const measurement = createReservationMeasurement(
    createGoogleConversions({ env: {} }),
    meta,
    async () => row,
  );
  await measurement.capture(EMAIL, undefined, true);
  const fake = new MemoryStripe();
  const session = fake.seedPaid();
  const payload = JSON.stringify({
    id: "evt_durable_failures",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id } },
  });
  const request = () =>
    new Request(`${ORIGIN}/api/reservation/webhook`, {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: payload,
    });
  const paidDeps = { ...deps(fake, purchaseEnv), measurement };
  contextDown = true;
  assert.equal((await handleReservationWebhook(request(), paidDeps)).status, 500);
  assert.equal(posts, 0);
  contextDown = false;
  assert.equal((await handleReservationWebhook(request(), paidDeps)).status, 500);
  assert.equal(posts, 1);
  mode = "ok";
  assert.equal((await handleReservationWebhook(request(), paidDeps)).status, 200);
  assert.equal(posts, 2);
  assert.equal((await handleReservationWebhook(request(), paidDeps)).status, 200);
  assert.equal(posts, 2);

  mode = "uncertain";
  states.clear();
  const other = new MemoryStripe();
  const otherSession = other.seedPaid();
  const otherPayload = JSON.stringify({
    id: "evt_durable_uncertain",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: otherSession.id } },
  });
  const otherRequest = () =>
    new Request(`${ORIGIN}/api/reservation/webhook`, {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(otherPayload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: otherPayload,
    });
  const uncertainDeps = { ...deps(other, purchaseEnv), measurement };
  const before = posts;
  assert.equal((await handleReservationWebhook(otherRequest(), uncertainDeps)).status, 200);
  assert.equal((await handleReservationWebhook(otherRequest(), uncertainDeps)).status, 200);
  assert.equal(posts, before + 1);
});

test("paid then refunded and a replayed old paid webhook never report a second purchase", async () => {
  const { purchaseEvent } = await import("../src/lib/reservation/measurement.server.ts");
  const fake = new MemoryStripe();
  const session = fake.seedPaid();
  let purchases = 0;
  const measurement = {
    capture: async () => {},
    completed: async (
      _email: string,
      snapshot: import("../src/lib/reservation/state.ts").ReservationSnapshot,
    ) => {
      if (purchaseEvent(snapshot)) purchases++;
      return "accepted" as const;
    },
  };
  const payload = JSON.stringify({
    id: "evt_paid_then_refunded",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id, payment_status: "paid" } },
  });
  const request = () =>
    new Request(`${ORIGIN}/api/reservation/webhook`, {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET, Math.floor(NOW / 1000)),
      },
      body: payload,
    });
  assert.equal(
    (await handleReservationWebhook(request(), { ...deps(fake), measurement })).status,
    200,
  );
  const charge = [...fake.charges.values()][0];
  charge.amountRefunded = 300;
  charge.refunded = true;
  fake.refunds.push({
    id: "re_test_after_payment",
    amount: 300,
    currency: "usd",
    status: "succeeded",
    chargeId: charge.id,
  });
  for (let replay = 0; replay < 2; replay++) {
    const result = await bodyOf(
      await handleReservationWebhook(request(), { ...deps(fake), measurement }),
    );
    assert.equal(result.status, "refunded");
    assert.equal(result.paid, false);
  }
  assert.equal(purchases, 1);
});
