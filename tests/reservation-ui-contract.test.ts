// The page and the live handlers share one contract. Stripe is a fake fetch.
// No live key and no network.
import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchReservationStatus,
  requestReservationCheckout,
  type FetchLike,
} from "../src/components/reservation/client.ts";
import {
  checkoutPayload,
  parseReservationStatus,
  statusRequestPath,
} from "../src/components/reservation/contract.ts";
import { reservationCopy } from "../src/components/reservation/copy.ts";
import {
  handleReservationCheckout,
  handleReservationStatus,
} from "../src/lib/reservation/handlers.ts";
import { issueReservationInvite } from "../src/lib/reservation/invite.ts";
import { TERMS_VERSION } from "../src/lib/reservation/constants.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const LEAD = "11111111-1111-4111-8111-111111111111";
const EMAIL = "buyer@example.com";
const SECRET = "watchdive-reservation-token-secret-v1";
const ORIGIN = "https://watchdive.diveroid.com";
const ENV = {
  WATCHDIVE_RESERVATION_ENABLED: "true",
  WATCHDIVE_RESERVATION_ALLOW_LIVE: "false",
  STRIPE_SECRET_KEY: "sk_test_watchdive_reservation_example",
  STRIPE_WEBHOOK_SECRET: "whsec_test_watchdive_reservation_example",
  WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
};

function invite(): string {
  return issueReservationInvite({
    leadId: LEAD,
    email: EMAIL,
    emailVerified: true,
    expiresAtMs: NOW + 86_400_000,
    secret: SECRET,
    nowMs: NOW,
    jti: "invitejti00000001",
  });
}

function stripeList(): Response {
  return new Response(JSON.stringify({ object: "list", data: [], has_more: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("checkout rejects missing terms before Stripe", async () => {
  let called = 0;
  const response = await handleReservationCheckout(
    new Request(`${ORIGIN}/api/reservation/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: invite() }),
    }),
    {
      env: ENV,
      nowMs: NOW,
      fetchImpl: async () => {
        called += 1;
        return new Response("no", { status: 500 });
      },
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "rejected_terms" });
  assert.equal(called, 0);
});

test("status rejects a missing bearer before Stripe", async () => {
  let called = 0;
  const response = await handleReservationStatus(
    new Request(`${ORIGIN}/api/reservation/status?session_id=cs_test_abc&inviteToken=${invite()}`),
    {
      env: ENV,
      nowMs: NOW,
      fetchImpl: async () => {
        called += 1;
        return new Response("no", { status: 500 });
      },
    },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "missing_bearer" });
  assert.equal(called, 0);
});

test("accepted terms reach Stripe, and a Stripe failure is not a payment URL", async () => {
  const token = invite();
  let called = 0;
  const response = await handleReservationCheckout(
    new Request(`${ORIGIN}/api/reservation/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(checkoutPayload(token)),
    }),
    {
      env: ENV,
      nowMs: NOW,
      fetchImpl: async () => {
        called += 1;
        return new Response(JSON.stringify({ error: { type: "api_error" } }), { status: 500 });
      },
    },
  );
  assert.equal(called, 1);
  assert.equal(response.status, 502);
  const body = (await response.json()) as { error?: string; url?: string };
  assert.equal(body.error, "stripe_error");
  assert.equal(body.url, undefined);
});

test("a bearer status is the handler shape, and only paid 300 usd counts", async () => {
  const token = invite();
  const response = await handleReservationStatus(
    new Request(`${ORIGIN}/api/reservation/status`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { env: ENV, nowMs: NOW, fetchImpl: async () => stripeList() },
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal("email" in body, false);
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "amountRefundPending",
      "amountRefunded",
      "amountTotal",
      "currency",
      "duplicatePaid",
      "paid",
      "sessionId",
      "source",
      "status",
    ].sort(),
  );
  assert.equal(parseReservationStatus(body)?.authoritativePaid, false);
  assert.equal(parseReservationStatus(body)?.serverStatus, "unpaid");

  const paid = parseReservationStatus({
    ...body,
    status: "paid",
    paid: true,
    amountTotal: 300,
    currency: "usd",
    source: "stripe",
  });
  assert.equal(paid?.authoritativePaid, true);

  for (const status of [
    "open",
    "unpaid",
    "refunded",
    "partially_refunded",
    "refund_pending",
    "disputed",
    "invalid",
  ]) {
    const parsed = parseReservationStatus({
      status,
      paid: false,
      source: "stripe",
      amountTotal: status === "unpaid" ? null : 300,
      currency: status === "unpaid" ? null : "usd",
      amountRefunded: 0,
      amountRefundPending: 0,
      duplicatePaid: false,
      sessionId: null,
    });
    assert.equal(parsed?.authoritativePaid, false, status);
    assert.equal(parsed?.serverStatus, status, status);
  }
});

test("the page client posts terms and sends the bearer to the handler", async () => {
  const token = invite();
  let stripeCalls = 0;
  const deps = {
    env: ENV,
    nowMs: NOW,
    fetchImpl: async () => {
      stripeCalls += 1;
      return new Response(JSON.stringify({ error: { type: "api_error" } }), { status: 500 });
    },
  };
  const bridge: FetchLike = async (input, init) => {
    const url = new URL(input, ORIGIN);
    const request = new Request(url, init);
    if (url.pathname === "/api/reservation/checkout") {
      const posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(posted, {
        inviteToken: token,
        acceptedTerms: true,
        termsVersion: TERMS_VERSION,
        measurementConsent: false,
      });
      return handleReservationCheckout(request, deps);
    }
    assert.equal(url.pathname, "/api/reservation/status");
    assert.equal(url.searchParams.has("inviteToken"), false);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    return handleReservationStatus(request, {
      ...deps,
      fetchImpl: async () => stripeList(),
    });
  };

  const checkout = await requestReservationCheckout(token, bridge);
  assert.deepEqual(checkout, { ok: false, reason: "bad_response" });
  assert.equal(stripeCalls, 1);

  let conflicts = 0;
  const conflict = await requestReservationCheckout(token, async () => {
    conflicts += 1;
    return new Response(JSON.stringify({ error: "already_paid", status: "paid", paid: true }), {
      status: 409,
    });
  });
  assert.deepEqual(conflict, { ok: false, reason: "conflict" });
  assert.equal(conflicts, 1);

  const status = await fetchReservationStatus({ inviteToken: token, sessionId: null }, bridge);
  assert.equal(statusRequestPath("cs_test_return0001").includes("inviteToken"), false);
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.status.authoritativePaid, false);
});

test("buyer copy stays readable in every site locale", () => {
  assert.equal(reservationCopy("ko").title, "지금 $3로 최저 출시가 $149를 보장받으세요");
  assert.equal(
    reservationCopy("ko").intro,
    "예약금 $3는 별도이며, 출시 시 제품 가격 $149에서 차감되지 않습니다.",
  );
  assert.equal(reservationCopy("ko").needsInvitation, "이메일로 받은 예약 링크를 열어 주세요.");
  assert.match(reservationCopy("en").title, /\$149/);
  assert.match(reservationCopy("en").intro, /not deducted/i);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = reservationCopy(locale);
    assert.equal(copy.priceRows.length, 3, locale);
    assert.equal(copy.priceRows[0]?.amount, "USD $3.00", locale);
    assert.equal(copy.priceRows[1]?.amount, "USD $149.00", locale);
    assert.equal(copy.priceRows[2]?.amount, "USD $152.00", locale);
    assert.equal(copy.terms.length >= 3 && copy.terms.length <= 4, true, locale);
    assert.match(copy.title, /\$3/, locale);
    assert.match(copy.title, /\$149/, locale);
    assert.match(copy.needsInvitation, /\S/, locale);
  }
});
