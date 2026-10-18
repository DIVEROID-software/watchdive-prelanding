// Portable payment regressions for the payment-fixes tree.
// In-memory Stripe only. No network, no live key, no customer email send.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { reservationIdempotencyKey, isHostedCheckoutUrl, reservationEmailHash } from "../src/lib/reservation/checkout.ts";
import { TERMS_VERSION } from "../src/lib/reservation/constants.ts";
import {
  handleReservationCheckout,
  handleReservationStatus,
  handleReservationWebhook,
} from "../src/lib/reservation/handlers.ts";
import { issueReservationInvite, verifyReservationInvite } from "../src/lib/reservation/invite.ts";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";
const EMAIL = "diver@example.com";
const SECRET = "watchdive-reservation-token-secret-v1";
const STRIPE_KEY = "sk_test_watchdive_reservation_example";
const WEBHOOK_SECRET = "whsec_test_watchdive_reservation_example";
const ORIGIN = "https://watchdive.diveroid.com";
const SUCCESS = `${ORIGIN}/reservation?session_id={CHECKOUT_SESSION_ID}`;

const ENV = {
  WATCHDIVE_RESERVATION_ENABLED: "true",
  WATCHDIVE_RESERVATION_ALLOW_LIVE: "false",
  STRIPE_SECRET_KEY: STRIPE_KEY,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
};

type Session = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  mode: string;
  metadata: Record<string, string>;
  client_reference_id: string | null;
  customer: string | null;
  payment_intent: string | null;
  expires_at: number;
  created: number;
  livemode: boolean;
  success_url: string | null;
};

type Charge = {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  refunded: boolean;
  disputed: boolean;
  payment_intent: string;
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

function post(token: string, extra: Record<string, unknown> = {}, env = ENV): Request {
  return new Request("https://evil.example/api/reservation/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", host: "evil.example" },
    body: JSON.stringify({
      inviteToken: token,
      acceptedTerms: true,
      termsVersion: TERMS_VERSION,
      email: "attacker@evil.test",
      amount: 14900,
      paid: true,
      ...extra,
    }),
  });
}

class MemoryStripe {
  customers: { id: string; email: string; metadata: Record<string, string> }[] = [];
  sessions: Session[] = [];
  charges = new Map<string, Charge>();
  refunds: { id: string; amount: number; currency: string; status: string; charge: string }[] = [];
  disputes: { id: string; amount: number; currency: string; status: string; charge: string }[] = [];
  lines = new Map<string, { quantity: number; amount_total: number; currency: string; unit_amount: number }>();
  idempotency = new Map<string, { body: string; id: string }>();
  posts: string[] = [];
  createBodies: string[] = [];
  failCustomerList = false;
  truncateCustomerList = false;
  evilUrl = false;
  redirect = false;
  failExpire = false;
  stickyExpire = false;
  private n = 0;

  forgetIdempotency(): void {
    this.idempotency.clear();
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.redirect) return new Response("", { status: 302, headers: { location: "https://evil.example" } });
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname;
    if (method === "POST") this.posts.push(path);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
    if (this.failCustomerList && method === "GET" && path === "/v1/customers") {
      return json(500, { error: { type: "api_error", code: "list_failed" } });
    }
    if (this.truncateCustomerList && method === "GET" && path === "/v1/customers") {
      const after = url.searchParams.get("starting_after") ?? "0";
      const id = `cus_page_${after}`;
      return json(200, {
        data: [{ id, email: "other@example.com", metadata: {} }],
        has_more: true,
      });
    }
    if (method === "GET" && path === "/v1/customers") {
      const email = url.searchParams.get("email") ?? "";
      return json(200, {
        data: this.customers.filter((customer) => customer.email === email),
        has_more: false,
      });
    }
    if (method === "POST" && path === "/v1/customers") {
      const params = new URLSearchParams(bodyText);
      const key = headers.get("idempotency-key");
      if (key && this.idempotency.has(`cus:${key}`)) {
        const id = this.idempotency.get(`cus:${key}`)?.id ?? "";
        return json(200, this.customers.find((customer) => customer.id === id));
      }
      const customer = {
        id: `cus_${++this.n}`,
        email: params.get("email") ?? "",
        metadata: metadataFrom(params, "metadata"),
      };
      this.customers.push(customer);
      if (key) this.idempotency.set(`cus:${key}`, { body: bodyText, id: customer.id });
      return json(200, customer);
    }
    const customerGet = path.match(/^\/v1\/customers\/([^/]+)$/);
    if (method === "GET" && customerGet) {
      const customer = this.customers.find((item) => item.id === decodeURIComponent(customerGet[1]));
      return customer ? json(200, customer) : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      this.createBodies.push(bodyText);
      const key = headers.get("idempotency-key") ?? "";
      const prior = key ? this.idempotency.get(`cs:${key}`) : undefined;
      if (prior && prior.body !== bodyText) {
        return json(400, { error: { type: "idempotency_error", code: "idempotency_key_in_use" } });
      }
      if (prior) return json(200, this.sessions.find((session) => session.id === prior.id));
      const params = new URLSearchParams(bodyText);
      const id = `cs_test_${++this.n}abc`;
      const session: Session = {
        id,
        url: this.evilUrl ? "https://checkout.stripe.com.evil.example/c/pay/x" : `https://checkout.stripe.com/c/pay/${id}`,
        status: "open",
        payment_status: "unpaid",
        amount_total: Number(params.get("line_items[0][price_data][unit_amount]")),
        currency: params.get("line_items[0][price_data][currency]"),
        mode: params.get("mode") ?? "",
        metadata: metadataFrom(params, "metadata"),
        client_reference_id: params.get("client_reference_id"),
        customer: params.get("customer"),
        payment_intent: null,
        expires_at: Math.floor(NOW / 1000) + 3600,
        created: Math.floor(NOW / 1000),
        livemode: false,
        success_url: params.get("success_url"),
      };
      this.sessions.push(session);
      this.lines.set(id, {
        quantity: Number(params.get("line_items[0][quantity]")),
        amount_total: session.amount_total ?? 0,
        currency: session.currency ?? "",
        unit_amount: Number(params.get("line_items[0][price_data][unit_amount]")),
      });
      if (key) this.idempotency.set(`cs:${key}`, { body: bodyText, id });
      return json(200, session);
    }
    const sessionGet = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionGet) {
      const session = this.sessions.find((item) => item.id === decodeURIComponent(sessionGet[1]));
      return session ? json(200, session) : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
    }
    const expire = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (method === "POST" && expire) {
      const session = this.sessions.find((item) => item.id === decodeURIComponent(expire[1]));
      if (!session) return json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
      if (this.failExpire) return json(500, { error: { type: "api_error", code: "expire_failed" } });
      if (session.status !== "open") {
        return json(400, { error: { type: "invalid_request_error", code: "checkout_session_invalid_status" } });
      }
      if (!this.stickyExpire) session.status = "expired";
      return json(200, session);
    }
    if (method === "GET" && path === "/v1/checkout/sessions") {
      const customer = url.searchParams.get("customer");
      const paymentIntent = url.searchParams.get("payment_intent");
      const data = this.sessions.filter((session) => {
        if (customer) return session.customer === customer;
        if (paymentIntent) return session.payment_intent === paymentIntent;
        return false;
      });
      return json(200, { data, has_more: false });
    }
    const lines = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/);
    if (method === "GET" && lines) {
      const line = this.lines.get(decodeURIComponent(lines[1]));
      return json(200, {
        data: line
          ? [{
              quantity: line.quantity,
              amount_total: line.amount_total,
              currency: line.currency,
              price: { unit_amount: line.unit_amount, type: "one_time" },
            }]
          : [],
        has_more: false,
      });
    }
    const pi = path.match(/^\/v1\/payment_intents\/([^/]+)$/);
    if (method === "GET" && pi) {
      const id = decodeURIComponent(pi[1]);
      const charge = [...this.charges.values()].find((item) => item.payment_intent === id);
      return json(200, {
        id,
        amount: charge?.amount ?? 0,
        currency: charge?.currency ?? "usd",
        status: "succeeded",
        metadata: {},
        latest_charge: charge?.id ?? null,
      });
    }
    const chargePath = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (method === "GET" && chargePath) {
      const charge = this.charges.get(decodeURIComponent(chargePath[1]));
      return charge ? json(200, charge) : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
    }
    if (method === "GET" && path === "/v1/refunds") {
      const charge = url.searchParams.get("charge");
      return json(200, { data: this.refunds.filter((refund) => refund.charge === charge), has_more: false });
    }
    if (method === "GET" && path === "/v1/disputes") {
      const charge = url.searchParams.get("charge");
      return json(200, { data: this.disputes.filter((dispute) => dispute.charge === charge), has_more: false });
    }
    return json(404, { error: { type: "invalid_request_error", code: "unknown_path" } });
  };

  pay(sessionId: string): Charge {
    const session = this.sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("missing session");
    const pi = `pi_${session.id}`;
    const charge: Charge = {
      id: `ch_${session.id}`,
      amount: 300,
      amount_refunded: 0,
      currency: "usd",
      refunded: false,
      disputed: false,
      payment_intent: pi,
    };
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = pi;
    this.charges.set(charge.id, charge);
    return charge;
  }

  clonePaid(sourceId: string): Session {
    const source = this.sessions.find((item) => item.id === sourceId);
    if (!source) throw new Error("missing source");
    const id = `cs_test_${++this.n}dup`;
    const copy: Session = { ...source, id, created: source.created + 1, metadata: { ...source.metadata } };
    this.sessions.push(copy);
    const line = this.lines.get(sourceId);
    if (line) this.lines.set(id, { ...line });
    this.pay(id);
    return copy;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), { status, headers: { "content-type": "application/json" } });
}

function metadataFrom(params: URLSearchParams, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    const match = key.match(new RegExp(`^${prefix}\\[(.+)\\]$`));
    if (match?.[1]) out[match[1]] = value;
  }
  return out;
}

function deps(stripe: MemoryStripe, env: Record<string, string> = ENV) {
  return { env, fetchImpl: stripe.fetch, nowMs: NOW };
}

async function checkout(stripe: MemoryStripe, token = invite(), extra?: Record<string, unknown>) {
  const response = await handleReservationCheckout(post(token, extra), deps(stripe));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function statusRequest(token: string, sessionId?: string): Request {
  const url = new URL("https://watchdive.diveroid.com/api/reservation/status");
  if (sessionId) url.searchParams.set("session_id", sessionId);
  url.searchParams.set("inviteToken", token);
  url.searchParams.set("paid", "true");
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

async function status(stripe: MemoryStripe, token = invite(), sessionId?: string) {
  const response = await handleReservationStatus(statusRequest(token, sessionId), deps(stripe));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function sign(payload: string, seconds: number): string {
  const mac = createHmac("sha256", WEBHOOK_SECRET).update(`${seconds}.${payload}`).digest("hex");
  return `t=${seconds},v1=${mac}`;
}

async function webhook(stripe: MemoryStripe, payload: string, header: string | null) {
  const response = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: header ? { "stripe-signature": header } : {},
      body: payload,
    }),
    deps(stripe),
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("terms must be the boolean true and the exact version before Stripe is called", async () => {
  for (const extra of [
    { acceptedTerms: false },
    { acceptedTerms: "true" },
    { acceptedTerms: 1 },
    { termsVersion: "2026-10-17" },
    { termsVersion: " 2026-10-18" },
    { acceptedTerms: true, termsVersion: "" },
  ]) {
    const stripe = new MemoryStripe();
    const result = await checkout(stripe, invite(), extra);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "rejected_terms");
    assert.equal(stripe.posts.length, 0);
  }
});

test("a tampered, expired, or unverified invite is refused and does not call Stripe", async () => {
  const stripe = new MemoryStripe();
  const token = invite();
  const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const tampered = await checkout(stripe, flipped);
  assert.equal(tampered.status, 400);
  assert.equal(tampered.body.error, "invalid_invite");
  const expired = invite({ expiresAtMs: NOW + 1000 });
  assert.equal(verifyReservationInvite(expired, SECRET, NOW + 1000), undefined);
  const expiredCall = await handleReservationCheckout(post(expired), { ...deps(stripe), nowMs: NOW + 1000 });
  assert.equal(expiredCall.status, 400);
  assert.throws(() => invite({ emailVerified: false }));
  assert.equal(stripe.posts.length, 0);
});

test("checkout charges 300 cents once, ignores a client amount of 14900, and ignores the Host header", async () => {
  const stripe = new MemoryStripe();
  const first = await checkout(stripe);
  const second = await checkout(stripe);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.url, second.body.url);
  assert.equal(stripe.sessions.length, 1);
  assert.equal(stripe.createBodies.length, 1);
  const params = new URLSearchParams(stripe.createBodies[0]);
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "300");
  assert.equal(params.get("mode"), "payment");
  assert.equal(params.get("payment_method_types[0]"), "card");
  assert.equal(params.get("setup_future_usage"), null);
  assert.equal(params.get("success_url"), SUCCESS);
  assert.equal(params.getAll("line_items[0][price_data][unit_amount]").includes("14900"), false);
  assert.equal(stripe.posts.includes("/v1/account"), false);
});

test("the same canonical inbox with a different lead and jti shares one session", async () => {
  const stripe = new MemoryStripe();
  const dotted = invite({
    email: "di.ver+kickstarter@gmail.com",
    leadId: OTHER_LEAD,
    jti: "invitejti00000002",
  });
  assert.equal(canonicalEmail("di.ver+kickstarter@gmail.com"), "diver@gmail.com");
  const gmailStripe = new MemoryStripe();
  const a = await checkout(gmailStripe, invite({ email: "di.ver+kickstarter@gmail.com", jti: "invitejti0000000a" }));
  const b = await checkout(gmailStripe, invite({
    email: "diver@googlemail.com",
    leadId: OTHER_LEAD,
    jti: "invitejti0000000b",
  }));
  assert.equal(a.status, 200);
  assert.equal(b.body.url, a.body.url);
  assert.equal(gmailStripe.sessions.length, 1);
  assert.equal(dotted.length > 0, true);
  const results = await Promise.all([
    checkout(stripe, invite({ jti: "invitejti00000003" })),
    checkout(stripe, invite({ leadId: OTHER_LEAD, jti: "invitejti00000004" })),
  ]);
  assert.equal(results[0]?.body.url, results[1]?.body.url);
  assert.equal(stripe.sessions.length, 1);
});

test("a forged success query and an unpaid or no-payment session are not paid", async () => {
  const stripe = new MemoryStripe();
  const opened = await checkout(stripe);
  assert.equal(opened.status, 200);
  const pending = await status(stripe, invite(), stripe.sessions[0]?.id);
  assert.equal(pending.body.paid, false);
  assert.equal(pending.body.status, "open");
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  session.status = "complete";
  session.payment_status = "unpaid";
  const declined = await status(stripe);
  assert.equal(declined.body.paid, false);
  session.payment_status = "no_payment_required";
  const free = await status(stripe);
  assert.equal(free.body.paid, false);
});

test("a paid session is authoritative only with the 300-cent contract, and a 14900 session is not that payment", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const paid = await status(stripe);
  assert.equal(paid.body.paid, true);
  assert.equal(paid.body.amountTotal, 300);
  assert.equal(paid.body.currency, "usd");
  assert.equal("email" in paid.body, false);
  session.metadata.fee_cents = "14900";
  const mismatched = await status(stripe);
  assert.equal(mismatched.body.paid, false);
});

test("partial, pending, failed, and full refunds, and an open dispute, follow the charge", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  const charge = stripe.pay(session.id);
  stripe.refunds.push({ id: "re_failed", amount: 300, currency: "usd", status: "failed", charge: charge.id });
  const failed = await status(stripe);
  assert.equal(failed.body.paid, true, "a failed refund must not clear a paid reservation");
  stripe.refunds.length = 0;
  stripe.refunds.push({ id: "re_pending", amount: 300, currency: "usd", status: "pending", charge: charge.id });
  const pending = await status(stripe);
  assert.equal(pending.body.paid, false);
  assert.equal(pending.body.status, "refund_pending");
  const again = await checkout(stripe);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "refund_pending");
  stripe.refunds[0] = { id: "re_partial", amount: 100, currency: "usd", status: "succeeded", charge: charge.id };
  charge.amount_refunded = 100;
  const partial = await status(stripe);
  assert.equal(partial.body.status, "partially_refunded");
  assert.equal(partial.body.paid, false);
  charge.amount_refunded = 300;
  charge.refunded = true;
  const full = await status(stripe);
  assert.equal(full.body.status, "refunded");
  assert.equal(full.body.paid, false);
  charge.amount_refunded = 0;
  charge.refunded = false;
  stripe.refunds.length = 0;
  charge.disputed = true;
  const emptyList = await status(stripe);
  assert.equal(emptyList.body.status, "disputed");
  assert.equal(emptyList.body.paid, false);
  stripe.disputes.push({ id: "du_won", amount: 300, currency: "usd", status: "won", charge: charge.id });
  const won = await status(stripe);
  assert.equal(won.body.paid, true);
  stripe.disputes[0] = { id: "du_open", amount: 300, currency: "usd", status: "needs_response", charge: charge.id };
  const openDispute = await status(stripe);
  assert.equal(openDispute.body.paid, false);
  const blocked = await checkout(stripe);
  assert.equal(blocked.body.error, "disputed");
});

test("a clean paid charge stays paid when a sibling charge for the same inbox is fully refunded", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const first = stripe.sessions[0];
  if (!first) throw new Error("missing session");
  const kept = stripe.pay(first.id);
  const extra = stripe.clonePaid(first.id);
  const extraCharge = stripe.charges.get(`ch_${extra.id}`);
  if (!extraCharge) throw new Error("missing extra charge");
  extraCharge.amount_refunded = 300;
  extraCharge.refunded = true;
  const result = await status(stripe);
  assert.equal(kept.amount_refunded, 0);
  assert.equal(result.body.paid, true, "one remaining unrefunded 300-cent charge must stay authoritative paid");
  assert.equal(result.body.status, "paid");
  assert.equal(result.body.duplicatePaid, false);
  assert.equal(result.body.sessionId, first.id);
  assert.equal(result.body.amountTotal, 300);
  const again = await checkout(stripe);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "already_paid");
  assert.equal(again.body.paid, true);
});

test("webhook signature covers the raw body, and a replay does not create a charge", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const payload = JSON.stringify({
    id: "evt_paid",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: session.id, amount_total: 14900, payment_status: "unpaid" } },
  });
  const seconds = Math.floor(NOW / 1000);
  const bad = await webhook(stripe, payload, null);
  assert.equal(bad.status, 400);
  const flipped = await webhook(stripe, `${payload} `, sign(payload, seconds));
  assert.equal(flipped.status, 400);
  const stale = await webhook(stripe, payload, sign(payload, seconds - 301));
  assert.equal(stale.status, 400);
  const future = await webhook(stripe, payload, sign(payload, seconds + 301));
  assert.equal(future.status, 400);
  const ok = await webhook(stripe, payload, sign(payload, seconds));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.paid, true);
  const replay = await webhook(stripe, payload, sign(payload, seconds));
  assert.equal(replay.body.paid, true);
  assert.equal(stripe.posts.filter((path) => path === "/v1/checkout/sessions").length, 1);
  assert.equal(stripe.posts.includes("/v1/refunds"), false);
});

test("an expanded dispute object does not get ignored while an open sibling session remains", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const paidSession = stripe.sessions[0];
  if (!paidSession) throw new Error("missing session");
  const charge = stripe.pay(paidSession.id);
  charge.disputed = true;
  stripe.disputes.push({ id: "du_open", amount: 300, currency: "usd", status: "needs_response", charge: charge.id });
  stripe.forgetIdempotency();
  const open = stripe.clonePaid(paidSession.id);
  open.status = "open";
  open.payment_status = "unpaid";
  open.payment_intent = null;
  const payload = JSON.stringify({
    id: "evt_dispute",
    type: "charge.dispute.created",
    livemode: false,
    data: { object: { id: "du_open", charge: { id: charge.id } } },
  });
  const result = await webhook(stripe, payload, sign(payload, Math.floor(NOW / 1000)));
  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, undefined);
  assert.equal(result.body.status, "disputed");
  assert.equal(result.body.paid, false);
  assert.equal(open.status, "expired");
  const ignoredPayload = JSON.stringify({
    id: "evt_dispute_bad",
    type: "charge.dispute.created",
    livemode: false,
    data: { object: { id: "du_open", charge: { id: "pi_not_a_charge" } } },
  });
  const ignored = await webhook(stripe, ignoredPayload, sign(ignoredPayload, Math.floor(NOW / 1000)));
  assert.equal(ignored.body.ignored, "not_reservation");
});

test("a malicious checkout host is refused", async () => {
  for (const url of [
    "https://checkout.stripe.com.evil.example/c/pay/x",
    "https://evil.example/checkout.stripe.com",
    "https://user:pass@checkout.stripe.com/c/pay/x",
    "http://checkout.stripe.com/c/pay/x",
    "https://checkout.stripe.com:444/c/pay/x",
    "javascript:alert(1)",
  ]) {
    assert.equal(isHostedCheckoutUrl(url), false, url);
  }
  const stripe = new MemoryStripe();
  stripe.evilUrl = true;
  const result = await checkout(stripe);
  assert.equal(result.status, 502);
  assert.equal(result.body.error, "stripe_contract_mismatch");
  assert.equal(stripe.sessions[0]?.status, "expired");
});

test("a dropped idempotency key does not leave two payable sessions when the first is past expires_at but still open", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const first = stripe.sessions[0];
  if (!first) throw new Error("missing session");
  first.expires_at = Math.floor(NOW / 1000) - 10;
  stripe.forgetIdempotency();
  const second = await checkout(stripe);
  const payable = stripe.sessions.filter((session) => session.status === "open");
  assert.equal(second.status, 200);
  assert.equal(payable.length, 1, `payable open sessions: ${payable.map((session) => session.id).join(",")}`);
  assert.notEqual(payable[0]?.id, first.id);
  assert.equal(first.status, "expired");
  assert.equal(stripe.posts.some((path) => path.endsWith("/expire")), true);
  const hash = reservationEmailHash(canonicalEmail(EMAIL));
  assert.equal(
    stripe.idempotency.has(`cs:${reservationIdempotencyKey(hash, 2)}`),
    true,
  );
});

test("a live-shaped key is refused without the live opt-in, and a Stripe failure does not create a session", async () => {
  const stripe = new MemoryStripe();
  const live = await handleReservationCheckout(post(invite()), {
    env: { ...ENV, STRIPE_SECRET_KEY: "sk_live_fixture_not_a_real_key" },
    fetchImpl: stripe.fetch,
    nowMs: NOW,
  });
  assert.equal(live.status, 503);
  assert.equal(stripe.posts.length, 0);
  const failing = new MemoryStripe();
  failing.failCustomerList = true;
  const error = await checkout(failing);
  assert.equal(error.status, 502);
  assert.equal(failing.sessions.length, 0);
  const truncated = new MemoryStripe();
  truncated.truncateCustomerList = true;
  const page = await checkout(truncated);
  assert.equal(page.status, 502);
  assert.equal(truncated.sessions.length, 0);
});

test("status without the bearer, or for another inbox session, does not reveal payment", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const missing = await handleReservationStatus(
    new Request(`https://watchdive.diveroid.com/api/reservation/status?session_id=${session.id}&paid=true`),
    deps(stripe),
  );
  assert.equal(missing.status, 401);
  const other = invite({ email: "other@example.com", jti: "invitejti00000009" });
  const foreign = await status(stripe, other, session.id);
  assert.equal(foreign.status, 404);
});

test("the route tree mounts the reservation page and the three API routes", () => {
  const tree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
  const checkoutRoute = readFileSync(
    new URL("../src/routes/api/reservation/checkout.ts", import.meta.url),
    "utf8",
  );
  assert.match(checkoutRoute, /handleReservationCheckout/);
  assert.match(tree, /routes\/api\/reservation\/checkout/);
  assert.match(tree, /routes\/api\/reservation\/status/);
  assert.match(tree, /routes\/api\/reservation\/webhook/);
  assert.match(tree, /\/reservation/);
  assert.equal(tree.match(/from '\.\/routes\/api\/reservation\/checkout'/g)?.length, 1);
  assert.equal(tree.match(/from '\.\/routes\/api\/reservation\/status'/g)?.length, 1);
  assert.equal(tree.match(/from '\.\/routes\/api\/reservation\/webhook'/g)?.length, 1);
});

test("checkout and webhook handlers do not retrieve the Stripe account id", () => {
  const root = new URL("../src/lib/reservation/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, root), "utf8");
  const chargePath = `${read("checkout.ts")}\n${read("handlers.ts")}\n${read("webhook.ts")}`;
  assert.equal(chargePath.includes("/v1/account"), false);
  assert.equal(chargePath.includes("acct_1Tl9bv1UxFzpSUuA"), false);
});

test("two clean payments set duplicatePaid, and refunding one leaves the other paid", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const first = stripe.sessions[0];
  if (!first) throw new Error("missing session");
  stripe.pay(first.id);
  const extra = stripe.clonePaid(first.id);
  const both = await status(stripe);
  assert.equal(both.body.paid, true);
  assert.equal(both.body.duplicatePaid, true);
  assert.equal(both.body.sessionId, first.id);
  const blocked = await checkout(stripe);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "already_paid");
  const extraCharge = stripe.charges.get(`ch_${extra.id}`);
  if (!extraCharge) throw new Error("missing extra charge");
  extraCharge.amount_refunded = 300;
  extraCharge.refunded = true;
  const after = await status(stripe);
  assert.equal(after.body.paid, true);
  assert.equal(after.body.status, "paid");
  assert.equal(after.body.duplicatePaid, false);
  assert.equal(after.body.amountRefunded, 0);
});

test("a live dispute or a pending refund still blocks while a clean charge remains", async () => {
  const disputed = new MemoryStripe();
  await checkout(disputed);
  const kept = disputed.sessions[0];
  if (!kept) throw new Error("missing session");
  disputed.pay(kept.id);
  const extra = disputed.clonePaid(kept.id);
  const extraCharge = disputed.charges.get(`ch_${extra.id}`);
  if (!extraCharge) throw new Error("missing extra charge");
  extraCharge.disputed = true;
  disputed.disputes.push({
    id: "du_sibling",
    amount: 300,
    currency: "usd",
    status: "needs_response",
    charge: extraCharge.id,
  });
  const disputeStatus = await status(disputed);
  assert.equal(disputeStatus.body.status, "disputed");
  assert.equal(disputeStatus.body.paid, false);
  assert.equal(disputeStatus.body.duplicatePaid, false);
  const disputeCheckout = await checkout(disputed);
  assert.equal(disputeCheckout.status, 409);
  assert.equal(disputeCheckout.body.error, "disputed");

  const pending = new MemoryStripe();
  await checkout(pending);
  const original = pending.sessions[0];
  if (!original) throw new Error("missing session");
  pending.pay(original.id);
  const pendingExtra = pending.clonePaid(original.id);
  const pendingCharge = pending.charges.get(`ch_${pendingExtra.id}`);
  if (!pendingCharge) throw new Error("missing pending charge");
  pending.refunds.push({
    id: "re_sibling_pending",
    amount: 300,
    currency: "usd",
    status: "pending",
    charge: pendingCharge.id,
  });
  const pendingStatus = await status(pending);
  assert.equal(pendingStatus.body.status, "refund_pending");
  assert.equal(pendingStatus.body.paid, false);
  const pendingCheckout = await checkout(pending);
  assert.equal(pendingCheckout.status, 409);
  assert.equal(pendingCheckout.body.error, "refund_pending");
});

test("a partial sibling refund does not clear a clean charge, and a sole full refund with a dispute stays refunded", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const first = stripe.sessions[0];
  if (!first) throw new Error("missing session");
  const kept = stripe.pay(first.id);
  const extra = stripe.clonePaid(first.id);
  const extraCharge = stripe.charges.get(`ch_${extra.id}`);
  if (!extraCharge) throw new Error("missing extra charge");
  extraCharge.amount_refunded = 100;
  stripe.refunds.push({
    id: "re_sibling_partial",
    amount: 100,
    currency: "usd",
    status: "succeeded",
    charge: extraCharge.id,
  });
  const partial = await status(stripe);
  assert.equal(partial.body.paid, true);
  assert.equal(partial.body.status, "paid");
  assert.equal(partial.body.duplicatePaid, false);
  assert.equal(kept.amount_refunded, 0);

  const only = new MemoryStripe();
  await checkout(only);
  const session = only.sessions[0];
  if (!session) throw new Error("missing session");
  const charge = only.pay(session.id);
  charge.amount_refunded = 300;
  charge.refunded = true;
  charge.disputed = true;
  only.disputes.push({
    id: "du_with_refund",
    amount: 300,
    currency: "usd",
    status: "needs_response",
    charge: charge.id,
  });
  const refunded = await status(only);
  assert.equal(refunded.body.status, "refunded");
  assert.equal(refunded.body.paid, false);
  const blocked = await checkout(only);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "refunded");
});

test("an expire failure or a session that stays open does not create a second payable URL", async () => {
  const failing = new MemoryStripe();
  await checkout(failing);
  const failedSession = failing.sessions[0];
  if (!failedSession) throw new Error("missing session");
  failedSession.expires_at = Math.floor(NOW / 1000) - 10;
  failing.forgetIdempotency();
  failing.failExpire = true;
  const failed = await checkout(failing);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "stripe_error");
  assert.equal(failing.sessions.length, 1);
  assert.equal(failedSession.status, "open");

  const sticky = new MemoryStripe();
  await checkout(sticky);
  const stuck = sticky.sessions[0];
  if (!stuck) throw new Error("missing session");
  stuck.expires_at = Math.floor(NOW / 1000) - 10;
  sticky.forgetIdempotency();
  sticky.stickyExpire = true;
  const held = await checkout(sticky);
  assert.equal(held.status, 409);
  assert.equal(held.body.error, "reservation_in_progress");
  assert.equal(sticky.sessions.length, 1);
  assert.equal(stuck.status, "open");
  assert.equal(sticky.sessions.filter((session) => session.status === "open").length, 1);
});

test("two checkouts racing a past-due open session leave one payable URL", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const first = stripe.sessions[0];
  if (!first) throw new Error("missing session");
  first.expires_at = Math.floor(NOW / 1000) - 5;
  stripe.forgetIdempotency();
  const [left, right] = await Promise.all([checkout(stripe), checkout(stripe)]);
  const payable = stripe.sessions.filter((session) => session.status === "open");
  assert.equal(first.status, "expired");
  assert.equal(payable.length, 1);
  assert.equal(left.body.url ?? right.body.url, payable[0] ? `https://checkout.stripe.com/c/pay/${payable[0].id}` : "");
  assert.equal(left.status === 200 || left.status === 409, true);
  assert.equal(right.status === 200 || right.status === 409, true);
});

test("an expanded refund charge id is applied and does not create another charge", async () => {
  const stripe = new MemoryStripe();
  await checkout(stripe);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  const charge = stripe.pay(session.id);
  charge.amount_refunded = 300;
  charge.refunded = true;
  const payload = JSON.stringify({
    id: "evt_refund_expanded",
    type: "refund.updated",
    livemode: false,
    data: { object: { id: "re_expanded", charge: { id: charge.id, object: "charge" } } },
  });
  const result = await webhook(stripe, payload, sign(payload, Math.floor(NOW / 1000)));
  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, undefined);
  assert.equal(result.body.status, "refunded");
  assert.equal(result.body.paid, false);
  assert.equal(stripe.posts.filter((path) => path === "/v1/checkout/sessions").length, 1);
  assert.equal(stripe.posts.includes("/v1/refunds"), false);
});
