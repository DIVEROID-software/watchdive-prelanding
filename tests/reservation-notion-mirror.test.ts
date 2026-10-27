// Notion payment mirror. In-memory Stripe and Notion only.
// No network, no live key, no schema write, no customer mail.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TERMS_VERSION } from "../src/lib/reservation/constants.ts";
import {
  handleReservationCheckout,
  handleReservationStatus,
  handleReservationWebhook,
} from "../src/lib/reservation/handlers.ts";
import { issueReservationInvite } from "../src/lib/reservation/invite.ts";
import {
  createReservationNotionMirror,
  NotionMirrorError,
  readReservationNotionMirrorConfig,
  reservationMirrorProperties,
  reservationMirrorWrite,
  type ReservationMirrorInput,
} from "../src/lib/reservation/notionMirror.ts";
import {
  planReservationNotionSchema,
  reservationNotionFields,
  RESERVATION_NOTION,
  RESERVATION_NOTION_PROPERTY_NAMES,
  RESERVATION_STATUS_OPTIONS,
  TEST_RESERVATION_NOTION,
} from "../src/lib/reservation/notionSchema.ts";
import type { ReservationSnapshot } from "../src/lib/reservation/state.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import {
  parseMigrateArgs,
  runReservationNotionMigration,
} from "../scripts/reservation-notion-migrate.ts";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const LEAD = "11111111-1111-4111-8111-111111111111";
const EMAIL = "diver@example.com";
const SECRET = "watchdive-reservation-token-secret-v1";
const STRIPE_KEY = "sk_test_watchdive_reservation_example";
const WEBHOOK_SECRET = "whsec_test_watchdive_reservation_example";
const ORIGIN = "https://watchdive.diveroid.com";
const NOTION_KEY = "secret_test_notion_mirror_example";
const DATABASE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_DATABASE_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHARGE_AT = Math.floor(NOW / 1000) + 180;
const CHARGE_ISO = "2026-10-18T12:03:00.000Z";
const LIVE_KEY = "sk_live_watchdive_reservation_example";

const ENV = {
  WATCHDIVE_RESERVATION_ENABLED: "true",
  WATCHDIVE_RESERVATION_ALLOW_LIVE: "false",
  STRIPE_SECRET_KEY: STRIPE_KEY,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
};

const MIRROR_ENV = {
  ...ENV,
  WATCHDIVE_RESERVATION_NOTION_MIRROR: "true",
  NOTION_API_KEY: NOTION_KEY,
  NOTION_WAITLIST_DB_ID: DATABASE_ID,
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

function invite(email = EMAIL): string {
  return issueReservationInvite({
    leadId: LEAD,
    email,
    emailVerified: true,
    expiresAtMs: NOW + 86_400_000,
    secret: SECRET,
    nowMs: NOW,
    jti: "invitejti00000001",
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function metadataFrom(params: URLSearchParams, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    const match = key.match(new RegExp(`^${prefix}\\[(.+)\\]$`));
    if (match?.[1]) out[match[1]] = value;
  }
  return out;
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
  livemode = false;
  omitChargeCreated = false;
  private n = 0;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname;
    if (method === "POST") this.posts.push(path);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers);
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
      return customer
        ? json(200, customer)
        : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
    }
    if (method === "POST" && path === "/v1/checkout/sessions") {
      const key = headers.get("idempotency-key") ?? "";
      const prior = key ? this.idempotency.get(`cs:${key}`) : undefined;
      if (prior && prior.body !== bodyText) {
        return json(400, { error: { type: "idempotency_error", code: "idempotency_key_in_use" } });
      }
      if (prior) return json(200, this.sessions.find((session) => session.id === prior.id));
      const params = new URLSearchParams(bodyText);
      const id = `${this.livemode ? "cs_live_" : "cs_test_"}${++this.n}abc`;
      const session: Session = {
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
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
        livemode: this.livemode,
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
      return session
        ? json(200, session)
        : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
    }
    const expire = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (method === "POST" && expire) {
      const session = this.sessions.find((item) => item.id === decodeURIComponent(expire[1]));
      if (!session) return json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
      if (session.status === "open") session.status = "expired";
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
        created: Math.floor(NOW / 1000),
      });
    }
    const chargePath = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (method === "GET" && chargePath) {
      const charge = this.charges.get(decodeURIComponent(chargePath[1]));
      return charge
        ? json(200, charge)
        : json(404, { error: { type: "invalid_request_error", code: "resource_missing" } });
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
      ...(this.omitChargeCreated ? {} : { created: CHARGE_AT }),
    };
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = pi;
    this.charges.set(charge.id, charge);
    return charge;
  }
}

type StoredPage = {
  id: string;
  title: string;
  canonical: string;
  properties: Record<string, unknown>;
};

class NotionLedger {
  pages: StoredPage[] = [];
  calls: { method: string; path: string; body: unknown }[] = [];
  failPatches = 0;
  failStatus = 503;
  database: { properties: Record<string, { type?: string; select?: { options?: { id?: string; name?: string; color?: string }[] } }> } = {
    properties: {},
  };

  add(title: string, canonical = title, id = `page_${this.pages.length + 1}`): StoredPage {
    const page = { id, title, canonical, properties: {} as Record<string, unknown> };
    this.pages.push(page);
    return page;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) as unknown : undefined;
    this.calls.push({ method, path: url.pathname, body });
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (auth !== `Bearer ${NOTION_KEY}`) return json(401, { object: "error", code: "unauthorized", message: "denied" });

    const query = url.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/);
    if (method === "POST" && query) {
      const rawFilter = (body as { filter?: Record<string, unknown> } | undefined)?.filter ?? {};
      const filter = (rawFilter.or as Record<string, unknown>[] | undefined) ?? [rawFilter];
      const hits = this.pages.filter((page) => filter.some((clause) => pageMatches(page, clause)));
      return json(200, { results: hits.map(toNotionPage), has_more: false, next_cursor: null });
    }
    const pagePatch = url.pathname.match(/^\/v1\/pages\/([^/]+)$/);
    if (method === "PATCH" && pagePatch) {
      if (this.failPatches > 0) {
        this.failPatches -= 1;
        return json(this.failStatus, { object: "error", code: "service_unavailable", message: "unavailable" });
      }
      const id = decodeURIComponent(pagePatch[1]);
      const page = this.pages.find((item) => item.id === id);
      if (!page) return json(404, { object: "error", code: "object_not_found", message: "missing" });
      const properties = (body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
      page.properties = { ...page.properties, ...properties };
      return json(200, { id: page.id, properties });
    }
    if (method === "POST" && url.pathname === "/v1/pages") {
      return json(500, { object: "error", code: "unexpected_create", message: "pages are not created" });
    }
    const databaseGet = url.pathname.match(/^\/v1\/databases\/([^/]+)$/);
    if (method === "GET" && databaseGet) return json(200, { id: databaseGet[1], properties: this.database.properties });
    if (method === "PATCH" && databaseGet) {
      const properties = (body as { properties?: Record<string, { select?: { options?: { name: string }[] } }> } | undefined)?.properties ?? {};
      for (const [name, spec] of Object.entries(properties)) {
        const type = Object.keys(spec).find((key) => key !== "id") ?? "unknown";
        this.database.properties[name] = {
          type,
          ...(spec.select ? { select: { options: spec.select.options } } : {}),
        };
      }
      return json(200, { id: databaseGet[1], properties: this.database.properties });
    }
    return json(404, { object: "error", code: "object_not_found", message: "missing" });
  };

  patches(): Record<string, unknown>[] {
    return this.calls
      .filter((call) => call.method === "PATCH" && call.path.startsWith("/v1/pages/"))
      .map((call) => call.body as Record<string, unknown>);
  }
}

function pageMatches(page: StoredPage, clause: Record<string, unknown>): boolean {
  if (clause.property === "Lead ID") return (clause.rich_text as { equals?: string })?.equals === LEAD;
  if (clause.property === "Email") {
    const equals = (clause.title as { equals?: string } | undefined)?.equals;
    return typeof equals === "string" && page.title.toLowerCase() === equals.toLowerCase();
  }
  if (clause.property === "Canonical email") {
    const email = (clause.email as { equals?: string } | undefined)?.equals;
    const rich = (clause.rich_text as { equals?: string } | undefined)?.equals;
    const equals = email ?? rich;
    return typeof equals === "string" && page.canonical.toLowerCase() === equals.toLowerCase();
  }
  return false;
}

function toNotionPage(page: StoredPage): Record<string, unknown> {
  return {
    id: page.id,
    properties: {
      Email: { title: [{ plain_text: page.title }] },
      "Canonical email": { email: page.canonical },
      "Lead ID": { rich_text: [{ plain_text: LEAD }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      ...page.properties,
    },
  };
}

function route(stripe: MemoryStripe, notion: NotionLedger): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.hostname === "api.notion.com") return notion.fetch(input, init);
    return stripe.fetch(input, init);
  };
}

function sign(payload: string, seconds = Math.floor(NOW / 1000)): string {
  const mac = createHmac("sha256", WEBHOOK_SECRET).update(`${seconds}.${payload}`).digest("hex");
  return `t=${seconds},v1=${mac}`;
}

async function checkout(stripe: MemoryStripe, notion: NotionLedger, env: Record<string, string> = MIRROR_ENV) {
  const response = await handleReservationCheckout(
    new Request("https://evil.example/api/reservation/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inviteToken: invite(),
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        amount: 14900,
        paid: true,
      }),
    }),
    { env, fetchImpl: route(stripe, notion), nowMs: NOW },
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function webhook(
  stripe: MemoryStripe,
  notion: NotionLedger,
  payload: string,
  env: Record<string, string> = MIRROR_ENV,
) {
  const response = await handleReservationWebhook(
    new Request("https://watchdive.diveroid.com/api/reservation/webhook", {
      method: "POST",
      headers: { "stripe-signature": sign(payload) },
      body: payload,
    }),
    { env, fetchImpl: route(stripe, notion), nowMs: NOW },
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function completed(sessionId: string, amount = 1, livemode = false): string {
  return JSON.stringify({
    id: livemode ? "evt_live_paid" : "evt_paid",
    type: "checkout.session.completed",
    livemode,
    data: { object: { id: sessionId, amount_total: amount, payment_status: "unpaid" } },
  });
}

function snapshot(partial: Partial<ReservationSnapshot>): ReservationSnapshot {
  return {
    status: "unpaid",
    paid: false,
    sessionId: null,
    url: null,
    amountTotal: null,
    currency: null,
    amountRefunded: 0,
    amountRefundPending: 0,
    duplicatePaid: false,
    leadId: null,
    source: "stripe",
    ...partial,
  };
}

function paidInput(partial: Partial<ReservationMirrorInput> = {}): ReservationMirrorInput {
  return {
    rawEmail: EMAIL,
    email: EMAIL,
    snapshot: snapshot({
      status: "paid",
      paid: true,
      sessionId: "cs_test_paid1abc",
      amountTotal: 300,
      currency: "usd",
    }),
    session: {
      id: "cs_test_paid1abc",
      paymentIntentId: "pi_cs_test_paid1abc",
      chargeCreated: CHARGE_AT,
      livemode: false,
    },
    mode: "test",
    ...partial,
  };
}

function checkbox(body: Record<string, unknown> | undefined, name = TEST_RESERVATION_NOTION.paid): unknown {
  const properties = body?.properties as Record<string, { checkbox?: boolean }> | undefined;
  return properties?.[name]?.checkbox;
}

function assertColumnSide(mode: "test" | "live", body: Record<string, unknown> | undefined): void {
  const properties = (body?.properties ?? {}) as Record<string, unknown>;
  const own = new Set<string>(Object.values(reservationNotionFields(mode)));
  const other = new Set<string>(Object.values(reservationNotionFields(mode === "test" ? "live" : "test")));
  const keys = Object.keys(properties);
  assert.equal(keys.length > 0, true);
  for (const key of keys) {
    assert.equal(own.has(key), true, key);
    assert.equal(other.has(key), false, key);
  }
}

function selectName(body: Record<string, unknown> | undefined, key: string): unknown {
  const properties = body?.properties as Record<string, { select?: { name?: string } | null }> | undefined;
  return properties?.[key]?.select?.name ?? null;
}

test("the mirror flag is off unless it is exactly true with a database id and a key", () => {
  assert.deepEqual(readReservationNotionMirrorConfig({}), { enabled: false });
  assert.deepEqual(readReservationNotionMirrorConfig({ WATCHDIVE_RESERVATION_NOTION_MIRROR: "TRUE" }), { enabled: false });
  assert.deepEqual(
    readReservationNotionMirrorConfig({ WATCHDIVE_RESERVATION_NOTION_MIRROR: "true" }),
    { enabled: true, ok: false, problem: "missing_database" },
  );
  assert.deepEqual(
    readReservationNotionMirrorConfig({
      WATCHDIVE_RESERVATION_NOTION_MIRROR: "true",
      NOTION_WAITLIST_DB_ID: DATABASE_ID,
    }),
    { enabled: true, ok: false, problem: "missing_key" },
  );
  assert.deepEqual(readReservationNotionMirrorConfig(MIRROR_ENV).enabled, true);
});

test("a 300 USD payment checks only the column set for its mode", () => {
  const write = reservationMirrorWrite(paidInput());
  assert.equal(write.paid, true);
  assert.equal(write.mode, "test");
  assert.equal(write.amountCents, 300);
  assert.equal(write.paidAt, CHARGE_ISO);
  const properties = reservationMirrorProperties(write);
  assertColumnSide("test", { properties });
  assert.equal((properties[TEST_RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, true);
  assert.equal((properties[TEST_RESERVATION_NOTION.mode] as { select: { name: string } }).select.name, "test");
  assert.equal((properties[TEST_RESERVATION_NOTION.amountCents] as { number: number }).number, 300);
  assert.equal((properties[TEST_RESERVATION_NOTION.currency] as { rich_text: { text: { content: string } }[] }).rich_text[0]?.text.content, "usd");
  assert.equal((properties[TEST_RESERVATION_NOTION.source] as { rich_text: { text: { content: string } }[] }).rich_text[0]?.text.content, "stripe-retrieve");
  assert.equal(properties[RESERVATION_NOTION.paid], undefined);

  const wrongAmount = reservationMirrorWrite(paidInput({
    snapshot: snapshot({ status: "paid", paid: true, amountTotal: 14900, currency: "usd", sessionId: "cs_test_paid1abc" }),
  }));
  assert.equal(wrongAmount.paid, false);
  assert.equal(wrongAmount.status, "invalid");
  const wrongCurrency = reservationMirrorWrite(paidInput({
    snapshot: snapshot({ status: "paid", paid: true, amountTotal: 300, currency: "eur", sessionId: "cs_test_paid1abc" }),
  }));
  assert.equal(wrongCurrency.paid, false);
  assert.equal(wrongCurrency.status, "invalid");
  assert.throws(
    () => reservationMirrorWrite(paidInput({
      session: { id: "cs_test_paid1abc", paymentIntentId: "pi_cs_test_paid1abc", chargeCreated: null, livemode: false },
    })),
    (error: unknown) => error instanceof NotionMirrorError && error.reason === "contract",
  );

  const live = reservationMirrorWrite(paidInput({
    mode: "live",
    session: { id: "cs_live_paid1abc", paymentIntentId: "pi_livepayment1", chargeCreated: CHARGE_AT, livemode: true },
  }));
  assert.equal(live.mode, "live");
  assert.equal(live.paid, true);
  const liveProperties = reservationMirrorProperties(live);
  assertColumnSide("live", { properties: liveProperties });
  assert.equal((liveProperties[RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, true);
  assert.equal((liveProperties[RESERVATION_NOTION.mode] as { select: { name: string } }).select.name, "live");
  assert.equal(liveProperties[TEST_RESERVATION_NOTION.paid], undefined);
  assert.throws(
    () => reservationMirrorWrite(paidInput({
      mode: "test",
      session: { id: "cs_live_paid1abc", paymentIntentId: "pi_livepayment1", chargeCreated: CHARGE_AT, livemode: true },
    })),
    (error: unknown) => error instanceof NotionMirrorError && error.reason === "mode_mismatch",
  );
});

test("a refund, a dispute, and an unpaid snapshot clear the paid checkbox", () => {
  const refunded = reservationMirrorWrite(paidInput({
    snapshot: snapshot({
      status: "refunded",
      paid: false,
      amountTotal: 300,
      currency: "usd",
      amountRefunded: 300,
      sessionId: "cs_test_paid1abc",
    }),
  }));
  assert.equal(refunded.paid, false);
  assert.equal(refunded.refundedCents, 300);
  assert.equal(refunded.paidAt, CHARGE_ISO);
  const refundedProperties = reservationMirrorProperties(refunded);
  assertColumnSide("test", { properties: refundedProperties });
  assert.equal((refundedProperties[TEST_RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, false);
  assert.equal((refundedProperties[TEST_RESERVATION_NOTION.refundedCents] as { number: number }).number, 300);

  const disputed = reservationMirrorWrite(paidInput({
    snapshot: snapshot({
      status: "disputed",
      paid: false,
      amountTotal: 300,
      currency: "usd",
      sessionId: "cs_test_paid1abc",
    }),
  }));
  assert.equal(disputed.paid, false);
  assert.equal(disputed.dispute, "open");

  const unpaid = reservationMirrorProperties(reservationMirrorWrite(paidInput({
    snapshot: snapshot({ status: "unpaid", paid: false }),
    session: null,
  })));
  assert.equal((unpaid[TEST_RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, false);
  assert.equal((unpaid[TEST_RESERVATION_NOTION.paidAt] as { date: null }).date, null);
  assert.equal((unpaid[TEST_RESERVATION_NOTION.status] as { select: { name: string } }).select.name, "unpaid");
  assert.equal(unpaid[RESERVATION_NOTION.paid], undefined);
});

test("a payment with no matching lead is retryable and does not create a page", async () => {
  const calls: string[] = [];
  const request: NotionRequest = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path.endsWith("/query")) {
      return { results: [{ id: "other", properties: { Email: { title: [{ plain_text: "a@example.com" }] } } }], has_more: false };
    }
    throw new Error("created or patched");
  };
  const mirror = createReservationNotionMirror({ request, databaseId: DATABASE_ID });
  await assert.rejects(
    () => mirror.apply(paidInput({ rawEmail: "a+tag@example.com", email: "a+tag@example.com" })),
    (error: unknown) => error instanceof NotionMirrorError && error.reason === "lead_missing",
  );
  assert.equal(calls.some((call) => call.startsWith("PATCH") || call === "POST pages"), false);
});

test("gmail canonical rows are updated and a truncated query is not acknowledged", async () => {
  const patches: unknown[] = [];
  const request: NotionRequest = async (method, path, body) => {
    if (path.endsWith("/query")) {
      return {
        results: [{
          id: "page_gmail",
          properties: { Email: { title: [{ plain_text: "di.ver+tag@gmail.com" }] } },
        }],
        has_more: false,
      };
    }
    patches.push(body);
    return { id: "page_gmail" };
  };
  const mirror = createReservationNotionMirror({ request, databaseId: DATABASE_ID });
  const updated = await mirror.apply(paidInput({ rawEmail: "diver@gmail.com", email: "diver@gmail.com" }));
  assert.deepEqual(updated, { updated: 1 });
  assert.equal(patches.length, 1);

  let pages = 0;
  const truncated: NotionRequest = async (method, path) => {
    if (!path.endsWith("/query")) throw new Error("patched a truncated read");
    pages += 1;
    return {
      results: [{ id: `page_${pages}`, properties: { Email: { title: [{ plain_text: EMAIL }] } } }],
      has_more: true,
      next_cursor: `cursor_${pages}`,
    };
  };
  const limited = createReservationNotionMirror({ request: truncated, databaseId: DATABASE_ID });
  await assert.rejects(
    () => limited.apply(paidInput()),
    (error: unknown) => error instanceof NotionMirrorError && error.reason === "truncated",
  );
  assert.equal(pages, 3);
});

test("checkout and the success URL do not write Notion, and a disabled flag makes no Notion call", async () => {
  const checkoutSource = readFileSync(new URL("../src/lib/reservation/checkout.ts", import.meta.url), "utf8");
  assert.equal(checkoutSource.includes("notionMirror"), false);
  assert.equal(checkoutSource.includes("Reservation paid"), false);
  const handlers = readFileSync(new URL("../src/lib/reservation/handlers.ts", import.meta.url), "utf8");
  const statusSource = handlers.slice(
    handlers.indexOf("export async function handleReservationStatus"),
    handlers.indexOf("export async function handleReservationWebhook"),
  );
  assert.equal(statusSource.includes("reservationMirror"), false);

  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  notion.add(EMAIL);
  const opened = await checkout(stripe, notion);
  assert.equal(opened.status, 200);
  assert.equal(notion.calls.length, 1); // Read-only checkout identity check.
  assert.equal(notion.patches().length, 0);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  const token = invite();
  const statusUrl = new URL("https://watchdive.diveroid.com/api/reservation/status");
  statusUrl.searchParams.set("session_id", session.id);
  statusUrl.searchParams.set("paid", "true");
  const statusResponse = await handleReservationStatus(
    new Request(statusUrl, { headers: { authorization: `Bearer ${token}` } }),
    { env: MIRROR_ENV, fetchImpl: route(stripe, notion), nowMs: NOW },
  );
  const statusBody = await statusResponse.json() as Record<string, unknown>;
  assert.equal(statusBody.paid, false);
  assert.equal(notion.calls.length, 1); // Status adds no Notion read/write.

  stripe.pay(session.id);
  const disabled = new NotionLedger();
  const paid = await webhook(stripe, disabled, completed(session.id, 1), ENV);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid, true);
  assert.equal(paid.body.received, true);
  assert.equal(disabled.calls.length, 0);
});

test("checkout refuses missing, mismatched or no-longer-verified leads before creating Stripe objects", async () => {
  const invalidProperties: (Record<string, unknown> | null)[] = [
    null,
    { "Verification status": { select: { name: "pending" } } },
    { "Verification status": { select: { name: "unsubscribed" } } },
    { "Email verified": { checkbox: false } },
    { Email: { title: [{ plain_text: "another@example.com" }] } },
    { "Lead ID": { rich_text: [{ plain_text: "22222222-2222-4222-8222-222222222222" }] } },
    { Suspect: { checkbox: true } },
  ];
  for (const properties of invalidProperties) {
    const stripe = new MemoryStripe();
    const notion = new NotionLedger();
    if (properties) notion.add(EMAIL).properties = properties;
    const result = await checkout(stripe, notion);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_invite");
    assert.equal(stripe.posts.length, 0);
    assert.equal(stripe.customers.length, 0);
    assert.equal(stripe.sessions.length, 0);
    assert.equal(notion.patches().length, 0);
  }
});

test("live checkout requires a configured mirror and fails closed on a Notion read failure", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  for (const env of [
    { ...ENV, WATCHDIVE_RESERVATION_ALLOW_LIVE: "true", STRIPE_SECRET_KEY: LIVE_KEY },
    { ...MIRROR_ENV, NOTION_API_KEY: "" },
  ]) {
    assert.equal((await checkout(stripe, notion, env)).status, 503);
  }
  notion.fetch = async () => json(503, { object: "error", code: "service_unavailable" });
  const result = await checkout(stripe, notion);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "reservation_unavailable");
  assert.equal(stripe.posts.length, 0);
  assert.equal(stripe.sessions.length, 0);
  assert.equal(notion.patches().length, 0);
});

test("a paid webhook marks the existing lead once, and a second delivery repeats the same absolute patch", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  const seeded = notion.add(EMAIL);
  seeded.properties[RESERVATION_NOTION.paid] = { checkbox: true };
  await checkout(stripe, notion);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const first = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(first.status, 200);
  assert.equal(first.body.received, true);
  assert.equal(first.body.mirror, "updated");
  assert.equal(first.body.pages, 1);
  assert.equal(checkbox(notion.patches().at(-1)), true);
  assertColumnSide("test", notion.patches().at(-1));
  assert.equal(selectName(notion.patches().at(-1), TEST_RESERVATION_NOTION.mode), "test");
  assert.equal(selectName(notion.patches().at(-1), TEST_RESERVATION_NOTION.status), "paid");
  const properties = (notion.patches().at(-1)?.properties ?? {}) as Record<string, { date?: { start?: string }; number?: number; rich_text?: { text: { content: string } }[] }>;
  assert.equal(properties[TEST_RESERVATION_NOTION.paidAt]?.date?.start, CHARGE_ISO);
  assert.notEqual(properties[TEST_RESERVATION_NOTION.paidAt]?.date?.start, "2026-10-18T12:00:00.000Z");
  assert.equal(properties[TEST_RESERVATION_NOTION.amountCents]?.number, 300);
  assert.equal(properties[TEST_RESERVATION_NOTION.sessionId]?.rich_text?.[0]?.text.content, session.id);
  assert.equal(properties[TEST_RESERVATION_NOTION.paymentId]?.rich_text?.[0]?.text.content, `pi_${session.id}`);
  assert.equal((notion.pages[0]?.properties[RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, true);
  assert.equal(notion.calls.some((call) => call.path === "/v1/pages"), false);

  const second = await webhook(stripe, notion, completed(session.id, 14900));
  assert.equal(second.status, 200);
  assert.equal(second.body.paid, true);
  assert.equal(notion.pages.length, 1);
  assert.deepEqual(notion.patches()[0], notion.patches()[1]);
});

test("a failed payment clears a paid mark, and a later refund wins over a stale completed event", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  notion.add(EMAIL);
  await checkout(stripe, notion);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  session.status = "complete";
  session.payment_status = "unpaid";
  const failed = await webhook(stripe, notion, completed(session.id, 300));
  assert.equal(failed.status, 200);
  assert.equal(failed.body.paid, false);
  assert.equal(checkbox(notion.patches().at(-1)), false);
  assert.equal(selectName(notion.patches().at(-1), TEST_RESERVATION_NOTION.status), "unpaid");
  const cleared = (notion.patches().at(-1)?.properties ?? {}) as Record<string, { date: unknown }>;
  assert.equal(cleared[TEST_RESERVATION_NOTION.paidAt]?.date, null);
  assertColumnSide("test", notion.patches().at(-1));

  stripe.pay(session.id);
  const paid = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(paid.body.paid, true);
  assert.equal(checkbox(notion.patches().at(-1)), true);
  const charge = stripe.charges.get(`ch_${session.id}`);
  if (!charge) throw new Error("missing charge");
  charge.amount_refunded = 300;
  charge.refunded = true;
  stripe.refunds.push({ id: "re_full", amount: 300, currency: "usd", status: "succeeded", charge: charge.id });
  const stale = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(stale.status, 200);
  assert.equal(stale.body.paid, false);
  assert.equal(stale.body.status, "refunded");
  assert.equal(checkbox(notion.patches().at(-1)), false);
  const refunded = (notion.patches().at(-1)?.properties ?? {}) as Record<string, { number?: number }>;
  assert.equal(refunded[TEST_RESERVATION_NOTION.refundedCents]?.number, 300);
  assertColumnSide("test", notion.patches().at(-1));
  assert.equal(notion.pages.length, 1);
});

test("a live-mode event on a test key and a missing lead do not acknowledge a payment", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  // Reproduce an orphan created before the pre-check existed.
  await checkout(stripe, notion, ENV);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const livePayload = JSON.stringify({
    id: "evt_live",
    type: "checkout.session.completed",
    livemode: true,
    data: { object: { id: session.id, amount_total: 300, payment_status: "paid" } },
  });
  const ignored = await webhook(stripe, notion, livePayload);
  assert.equal(ignored.status, 200);
  assert.equal(ignored.body.ignored, "livemode_mismatch");
  assert.equal(notion.calls.length, 0);

  const missing = await webhook(stripe, notion, completed(session.id, 300));
  assert.equal(missing.status, 500);
  assert.equal(missing.body.error, "notion_mirror_failed");
  assert.equal(missing.body.reason, "lead_missing");
  assert.equal(missing.body.retryable, true);
  assert.equal(missing.body.received, undefined);
  assert.equal(notion.calls.some((call) => call.path === "/v1/pages"), false);
  assert.equal(notion.patches().length, 0);
});

test("a Notion outage is a retryable webhook failure, and the next delivery writes once", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  notion.add(EMAIL);
  notion.failPatches = 1;
  notion.failStatus = 503;
  await checkout(stripe, notion);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const failed = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(failed.status, 500);
  assert.equal(failed.body.reason, "delivery");
  assert.equal(failed.body.retryable, true);
  assert.equal(failed.body.received, undefined);
  assert.equal(notion.pages[0]?.properties && Object.keys(notion.pages[0].properties).length, 0);
  const retried = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(retried.status, 200);
  assert.equal(retried.body.received, true);
  assert.equal(checkbox(notion.patches().at(-1)), true);
  assert.equal(notion.patches().length, 2);
  assert.deepEqual(notion.patches()[0], notion.patches()[1]);
});

test("the mirror stays retryable when the flag is on but Notion is not configured", async () => {
  const stripe = new MemoryStripe();
  const notion = new NotionLedger();
  notion.add(EMAIL);
  await checkout(stripe, notion, ENV);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const result = await webhook(stripe, notion, completed(session.id, 1), {
    ...ENV,
    WATCHDIVE_RESERVATION_NOTION_MIRROR: "true",
  });
  assert.equal(result.status, 500);
  assert.equal(result.body.reason, "misconfigured");
  assert.equal(result.body.received, undefined);
  assert.equal(notion.calls.length, 0);
});

test("a live payment writes only live columns and leaves the test paid mark", async () => {
  const stripe = new MemoryStripe();
  stripe.livemode = true;
  const notion = new NotionLedger();
  const page = notion.add(EMAIL);
  page.properties[TEST_RESERVATION_NOTION.paid] = { checkbox: true };
  const env = {
    ...MIRROR_ENV,
    WATCHDIVE_RESERVATION_ALLOW_LIVE: "true",
    STRIPE_SECRET_KEY: LIVE_KEY,
  };
  const opened = await checkout(stripe, notion, env);
  assert.equal(opened.status, 200);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  assert.equal(session.id.startsWith("cs_live_"), true);
  assert.equal(session.livemode, true);
  stripe.pay(session.id);
  const result = await webhook(stripe, notion, completed(session.id, 1, true), env);
  assert.equal(result.status, 200);
  assert.equal(result.body.paid, true);
  assert.equal(checkbox(notion.patches().at(-1), RESERVATION_NOTION.paid), true);
  assertColumnSide("live", notion.patches().at(-1));
  assert.equal((notion.pages[0]?.properties[TEST_RESERVATION_NOTION.paid] as { checkbox: boolean }).checkbox, true);
  const paidAt = (notion.patches().at(-1)?.properties ?? {}) as Record<string, { date?: { start?: string } }>;
  assert.equal(paidAt[RESERVATION_NOTION.paidAt]?.date?.start, CHARGE_ISO);
});

test("a paid charge without a created timestamp is not acknowledged", async () => {
  const stripe = new MemoryStripe();
  stripe.omitChargeCreated = true;
  const notion = new NotionLedger();
  notion.add(EMAIL);
  await checkout(stripe, notion);
  const session = stripe.sessions[0];
  if (!session) throw new Error("missing session");
  stripe.pay(session.id);
  const result = await webhook(stripe, notion, completed(session.id, 1));
  assert.equal(result.status, 500);
  assert.equal(result.body.reason, "contract");
  assert.equal(result.body.retryable, true);
  assert.equal(result.body.received, undefined);
  assert.equal(notion.patches().length, 0);
});

test("the schema plan is additive, keeps select option ids, and refuses a type collision", () => {
  const empty = planReservationNotionSchema({ properties: {} });
  assert.equal(empty.conflicts.length, 0);
  assert.equal(empty.actions.filter((action) => action.action === "add").length, RESERVATION_NOTION_PROPERTY_NAMES.length);
  assert.ok(empty.patch);
  const added = Object.fromEntries(
    RESERVATION_NOTION_PROPERTY_NAMES.map((name) => {
      const spec = empty.patch?.[name] as Record<string, unknown>;
      const type = Object.keys(spec)[0] ?? "";
      return [name, spec.select ? { type, select: spec.select } : { type }];
    }),
  );
  const second = planReservationNotionSchema({ properties: added });
  assert.equal(second.actions.every((action) => action.action === "unchanged"), true);
  assert.equal(second.patch, null);

  function materialize(names: readonly string[]) {
    return Object.fromEntries(names.map((name) => {
      const spec = empty.patch?.[name] as Record<string, unknown>;
      const type = Object.keys(spec)[0] ?? "";
      return [name, spec.select ? { type, select: spec.select } : { type }];
    }));
  }
  const liveNames = Object.values(RESERVATION_NOTION);
  const testNames = Object.values(TEST_RESERVATION_NOTION);
  const addTest = planReservationNotionSchema({ properties: materialize(liveNames) });
  assert.equal(addTest.conflicts.length, 0);
  assert.deepEqual(Object.keys(addTest.patch ?? {}).sort(), [...testNames].sort());
  assert.equal(addTest.actions.filter((action) => action.name.startsWith("Reservation ") && action.action === "unchanged").length, liveNames.length);
  const addLive = planReservationNotionSchema({ properties: materialize(testNames) });
  assert.equal(addLive.conflicts.length, 0);
  assert.deepEqual(Object.keys(addLive.patch ?? {}).sort(), [...liveNames].sort());
  assert.equal(addLive.actions.filter((action) => action.name.startsWith("Test reservation ") && action.action === "unchanged").length, testNames.length);
  const testConflict = planReservationNotionSchema({
    properties: { ...materialize(liveNames), [TEST_RESERVATION_NOTION.paid]: { type: "rich_text" } },
  });
  assert.equal(testConflict.patch, null);
  assert.equal(testConflict.conflicts.some((item) => item.name === TEST_RESERVATION_NOTION.paid), true);

  const extended = planReservationNotionSchema({
    properties: {
      [RESERVATION_NOTION.status]: {
        type: "select",
        select: { options: [{ id: "opt_paid", name: "paid", color: "green" }] },
      },
    },
  });
  const statusPatch = extended.patch?.[RESERVATION_NOTION.status] as {
    select: { options: { id?: string; name: string; color?: string }[] };
  };
  const kept = statusPatch.select.options.find((option) => option.name === "paid");
  assert.equal(kept?.id, "opt_paid");
  assert.equal(kept?.color, "green");
  assert.equal(statusPatch.select.options.some((option) => option.name === "refunded"), true);
  assert.deepEqual(
    statusPatch.select.options.map((option) => option.name).filter((name) => RESERVATION_STATUS_OPTIONS.includes(name as typeof RESERVATION_STATUS_OPTIONS[number])).sort(),
    [...RESERVATION_STATUS_OPTIONS].sort(),
  );

  const conflict = planReservationNotionSchema({
    properties: { [RESERVATION_NOTION.status]: { type: "rich_text" } },
  });
  assert.equal(conflict.patch, null);
  assert.equal(conflict.conflicts[0]?.expected, "select");
  assert.equal(conflict.conflicts[0]?.actual, "rich_text");
});

test("migration dry-run is the default, and apply writes properties only when the database id matches", async () => {
  assert.deepEqual(parseMigrateArgs([]), { apply: false, databaseId: null });
  assert.deepEqual(parseMigrateArgs(["--apply", "--database-id", DATABASE_ID]), { apply: true, databaseId: DATABASE_ID });
  const env = { NOTION_API_KEY: NOTION_KEY, NOTION_WAITLIST_DB_ID: DATABASE_ID };
  const notion = new NotionLedger();
  const dry = await runReservationNotionMigration({ args: [], env, fetchImpl: notion.fetch });
  assert.equal(dry.exitCode, 0);
  assert.equal(dry.report.applied, false);
  assert.equal(dry.report.wouldWrite, true);
  assert.equal(notion.calls.some((call) => call.method === "PATCH"), false);
  assert.equal(JSON.stringify(dry.report).includes(NOTION_KEY), false);
  assert.equal(JSON.stringify(dry.report).includes("@"), false);

  const refused = await runReservationNotionMigration({
    args: ["--apply", "--database-id", OTHER_DATABASE_ID],
    env,
    fetchImpl: notion.fetch,
  });
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.report.error, "database_id_mismatch");
  assert.equal(notion.calls.some((call) => call.method === "PATCH"), false);

  const missingArg = await runReservationNotionMigration({
    args: ["--apply"],
    env,
    fetchImpl: notion.fetch,
  });
  assert.equal(missingArg.report.error, "database_id_mismatch");

  const applied = await runReservationNotionMigration({
    args: ["--apply", "--database-id", DATABASE_ID],
    env,
    fetchImpl: notion.fetch,
  });
  assert.equal(applied.exitCode, 0);
  assert.equal(applied.report.applied, true);
  const write = notion.calls.find((call) => call.method === "PATCH");
  const written = write?.body as { properties?: Record<string, unknown> };
  assert.ok(written?.properties);
  const expectedNames = new Set<string>(RESERVATION_NOTION_PROPERTY_NAMES);
  assert.equal(Object.keys(written.properties).every((key) => expectedNames.has(key)), true);
  assert.equal(Object.keys(written.properties).some((key) => key.startsWith("Test reservation ")), true);
  assert.equal(Object.keys(written.properties).some((key) => key === RESERVATION_NOTION.paid), true);
  assert.equal("pages" in (write?.body as object), false);

  const again = await runReservationNotionMigration({
    args: ["--apply", "--database-id", DATABASE_ID],
    env,
    fetchImpl: notion.fetch,
  });
  assert.equal(again.exitCode, 0);
  assert.equal(again.report.applied, false);
  assert.equal(again.report.wouldWrite, false);

  const blocked = new NotionLedger();
  blocked.database.properties[RESERVATION_NOTION.paid] = { type: "select" };
  const conflict = await runReservationNotionMigration({
    args: ["--apply", "--database-id", DATABASE_ID],
    env,
    fetchImpl: blocked.fetch,
  });
  assert.equal(conflict.exitCode, 2);
  assert.equal(conflict.report.error, "schema_conflict");
  assert.equal(blocked.calls.some((call) => call.method === "PATCH"), false);
});
