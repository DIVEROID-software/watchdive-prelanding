import assert from "node:assert/strict";
import { test } from "node:test";
import { onsiteReservation } from "../src/lib/reservation/onsite.ts";
import { verifyReservationInvite } from "../src/lib/reservation/invite.ts";
import {
  issuePendingReservationToken,
  verifyPendingReservationToken,
  PENDING_RESERVATION_TTL_MS,
} from "../src/lib/reservation/pending.ts";
import { createVerificationToken, signPollHandle } from "../src/lib/verification/token.ts";
import {
  FakeLeadStore,
  TEST_ENV,
  TEST_SECRET,
  FakeMailer,
  leadIdFactory,
} from "./helpers/fakes.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { ReservationStripeFake } from "./helpers/reservationStripe.ts";
import { handleReservationStatus } from "../src/lib/reservation/handlers.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { ONSITE_OFFER_COPY } from "../src/components/reservation/onsite-copy.ts";

const now = Date.parse("2026-10-23T00:00:00Z");
const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const reserveSecret = "onsite-reservation-secret-test-32-bytes";
const env = {
  ...TEST_ENV,
  WATCHDIVE_RESERVATION_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_offline_only_fake_key",
  STRIPE_WEBHOOK_SECRET: "whsec_offline_fake",
  WATCHDIVE_RESERVATION_TOKEN_SECRET: reserveSecret,
};
function fixture(overrides = {}) {
  const store = new FakeLeadStore();
  const row = store.seed({
    pageId: "11111111-2222-4333-8444-555555555555",
    email: "diver@example.com",
    canonical: "diver@example.com",
    leadId,
    status: "pending",
    emailVerified: false,
    ...overrides,
  });
  return { store, row, stripe: new ReservationStripeFake(now), env, now: () => now };
}
const confirmation = {
  kind: "confirmation" as const,
  value: createVerificationToken(leadId, now + 60_000, false, TEST_SECRET, "ko"),
};
const attempt = {
  kind: "attempt" as const,
  value: signPollHandle(leadId, now, false, TEST_SECRET, "diver@example.com"),
};
function pending(deps = fixture()) {
  return {
    kind: "pending" as const,
    value: issuePendingReservationToken({ ...deps.row, secret: reserveSecret, nowMs: now }),
  };
}

test("pending payment token is signed, row/email bound, short lived, and separate from verification", () => {
  const deps = fixture();
  const token = pending(deps).value;
  assert.equal(verifyPendingReservationToken(token, reserveSecret, now)?.pageId, deps.row.pageId);
  assert.equal(verifyPendingReservationToken(token, reserveSecret, now)?.email, deps.row.email);
  assert.equal(
    verifyPendingReservationToken(token, reserveSecret, now + PENDING_RESERVATION_TTL_MS - 1)
      ?.leadId,
    leadId,
  );
  for (const [value, key, time] of [
    [token + "x", reserveSecret, now],
    [token, "another-secret-that-is-at-least-32bytes", now],
    [token, reserveSecret, now + PENDING_RESERVATION_TTL_MS],
    [token, reserveSecret, now - 1],
  ])
    assert.equal(
      verifyPendingReservationToken(value as string, key as string, time as number),
      undefined,
    );
  const parts = token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  payload.email = "attacker@example.com";
  assert.equal(
    verifyPendingReservationToken(
      `pv1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`,
      reserveSecret,
      now,
    ),
    undefined,
  );
  assert.equal(verifyReservationInvite(token, reserveSecret, now), undefined);
  assert.equal(
    verifyPendingReservationToken(`pv1.${parts[1]}.${"é".repeat(43)}`, reserveSecret, now),
    undefined,
  );
  assert.equal(
    verifyReservationInvite(`v1.${parts[1]}.${"é".repeat(43)}`, reserveSecret, now),
    undefined,
  );
  assert.ok(
    verifyPendingReservationToken(token, reserveSecret, now + PENDING_RESERVATION_TTL_MS, true),
  );
  assert.equal(
    verifyPendingReservationToken(token, reserveSecret, now + 86_400_000, true),
    undefined,
  );
});

test("pending signup immediately creates locked-email USD3 Checkout with row metadata and required terms, without verification writes", async () => {
  const deps = fixture();
  const before = JSON.stringify([...deps.store.rows]);
  const credential = pending(deps);
  const result = await onsiteReservation({ credential, locale: "ko" }, deps);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.match(result.href, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(result.statusToken, credential.value);
  const params = deps.stripe.params[0];
  assert.equal(params["line_items[0][price_data][unit_amount]"], "300");
  assert.equal(params["line_items[0][price_data][currency]"], "usd");
  assert.equal(deps.stripe.customers[0].email, deps.row.email);
  assert.equal(params.customer, deps.stripe.customers[0].id);
  assert.equal(params.customer_email, undefined);
  assert.equal(params["metadata[notion_page_id]"], deps.row.pageId);
  assert.equal(params["payment_intent_data[metadata][notion_page_id]"], deps.row.pageId);
  assert.equal(params["consent_collection[terms_of_service]"], "required");
  assert.match(
    params["custom_text[terms_of_service_acceptance][message]"],
    /https:\/\/watchdive.diveroid.com\/terms/,
  );
  assert.match(params["custom_text[submit][message]"], /No automatic later charge/);
  assert.match(params["custom_text[submit][message]"], /Shipping and tax/);
  assert.equal(JSON.stringify([...deps.store.rows]), before);
  assert.equal(deps.store.markVerifiedCalls, 0);
  assert.equal(deps.store.markSentCalls, 0);
});

test("repeated and concurrent pending clicks reuse one session", async () => {
  const deps = fixture();
  const credential = pending(deps);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => onsiteReservation({ credential, locale: "en" }, deps)),
  );
  assert.ok(results.every((r) => r.status === "ready"));
  assert.equal(deps.stripe.sessions.length, 1);
  assert.equal(deps.stripe.customers.length, 1);
  assert.equal(new Set(results.map((r) => (r.status === "ready" ? r.href : ""))).size, 1);
});

test("already paid row cannot create another charge", async () => {
  const deps = fixture();
  await deps.stripe.seedPaid(deps.row.email);
  const before = deps.stripe.sessions.length;
  assert.equal(
    (await onsiteReservation({ credential: pending(deps), locale: "ko" }, deps)).status,
    "already_paid",
  );
  assert.equal(deps.stripe.sessions.length, before);
});

for (const credential of [confirmation, attempt]) {
  test(`${credential.kind} requires actual verification and creates a usable reservation status credential`, async () => {
    assert.equal(
      (await onsiteReservation({ credential, locale: "en" }, fixture())).status,
      "verification_required",
    );
    const deps = fixture({ status: "verified", emailVerified: true });
    const result = await onsiteReservation({ credential, locale: "ko" }, deps);
    assert.equal(result.status, "ready");
    if (result.status === "ready")
      assert.equal(
        verifyReservationInvite(result.statusToken, reserveSecret, now)?.email,
        deps.row.email,
      );
  });
}
for (const [name, overrides] of Object.entries({
  unsubscribed: { status: "unsubscribed" },
  suspect: { suspect: true },
  abuse: { flags: ["headless"] },
  duplicate: { duplicate: true },
  emailChanged: { email: "new@example.com" },
  pageChanged: { pageId: "changed-page" },
  leadChanged: { leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002" },
})) {
  test(`${name} cannot use a pending token`, async () => {
    const deps = fixture();
    const credential = pending(deps);
    Object.assign(deps.row, overrides);
    assert.equal(
      (await onsiteReservation({ credential, locale: "en" }, deps)).status,
      "verification_required",
    );
    assert.equal(deps.stripe.sessions.length, 0);
  });
}
test("expired and tampered pending credentials fail closed", async () => {
  const deps = fixture();
  const credential = pending(deps);
  assert.equal(
    (
      await onsiteReservation(
        { credential: { ...credential, value: credential.value + "x" }, locale: "en" },
        deps,
      )
    ).status,
    "verification_required",
  );
  assert.equal(
    (
      await onsiteReservation(
        { credential, locale: "en" },
        { ...deps, now: () => now + PENDING_RESERVATION_TTL_MS },
      )
    ).status,
    "verification_required",
  );
});
test("disabled reservations and invalid config never call Stripe", async () => {
  for (const badEnv of [
    { ...env, WATCHDIVE_RESERVATION_ENABLED: "false" },
    { ...env, WATCHDIVE_RESERVATION_TOKEN_SECRET: "" },
    { ...env, STRIPE_SECRET_KEY: "sk_live_this_must_stay_disabled" },
  ]) {
    const deps = fixture();
    assert.equal(
      (
        await onsiteReservation(
          { credential: pending(deps), locale: "en" },
          { ...deps, env: badEnv },
        )
      ).status,
      "unavailable",
    );
    assert.equal(deps.stripe.sessions.length, 0);
  }
});
test("measurement refusal does not prevent voluntary payment", async () => {
  const deps = fixture({ flags: ["measurement-withdrawn"] });
  assert.equal(
    (await onsiteReservation({ credential: pending(deps), locale: "en" }, deps)).status,
    "ready",
  );
});
test("new signup, retry during cooldown, rotated attempt and mail failure issue payment token, never email verification", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const deps = {
    store,
    mailer,
    env,
    now: () => new Date(now),
    sleep: async () => {},
    leadId: leadIdFactory(),
  };
  const input = {
    email: "diver@example.com",
    canonical: "diver@example.com",
    source: "hero",
    flags: [],
    suspect: false,
    measurementConsent: false,
    networkSendBlocked: false,
  };
  const first = await requestVerificationService(input, deps);
  assert.ok(first.pendingReservationToken);
  const claims = verifyPendingReservationToken(first.pendingReservationToken!, reserveSecret, now);
  assert.ok(claims);
  assert.equal(claims.pageId, [...store.rows.values()][0].pageId);
  const second = await requestVerificationService(input, deps);
  assert.ok(second.pendingReservationToken);
  assert.equal(mailer.sent.length, 1);
  assert.equal(store.markVerifiedCalls, 0);
  const third = await requestVerificationService(input, {
    ...deps,
    now: () => new Date(now + 61_000),
  });
  assert.ok(third.pendingReservationToken);
  assert.notEqual(
    verifyPendingReservationToken(third.pendingReservationToken!, reserveSecret, now + 61_000)
      ?.leadId,
    claims.leadId,
  );
  const failMailer = {
    ...mailer,
    send: async () => {
      throw new Error("fake provider failure");
    },
    sendWelcome: async () => {},
  };
  const failed = await requestVerificationService(
    { ...input, email: "second@example.com", canonical: "second@example.com" },
    { ...deps, mailer: failMailer },
  );
  assert.ok(failed.pendingReservationToken);
  assert.equal(store.markVerifiedCalls, 0);
});
test("abuse and existing verified status disclosure do not issue pending payment authority", async () => {
  const input = {
    email: "diver@example.com",
    canonical: "diver@example.com",
    source: "hero",
    flags: ["headless"],
    suspect: true,
    measurementConsent: false,
    networkSendBlocked: false,
  };
  const deps = fixture();
  const out = await requestVerificationService(input, {
    ...deps,
    now: () => new Date(now),
    sleep: async () => {},
    mailer: new FakeMailer(),
  });
  assert.equal(out.pendingReservationToken, undefined);
});
test("pending token authorizes read-only status after checkout-token expiry without enabling a new checkout", async () => {
  const deps = fixture();
  const credential = pending(deps);
  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.stripe.com");
    return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  };
  const response = await handleReservationStatus(
    new Request("https://watchdive.diveroid.com/api/reservation/status", {
      headers: { authorization: `Bearer ${credential.value}` },
    }),
    { env, fetchImpl, nowMs: now + 20 * 60_000 },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paid, false);
  assert.equal(calls, 1);
  assert.equal(
    (
      await onsiteReservation(
        { credential, locale: "en" },
        { ...deps, now: () => now + 20 * 60_000 },
      )
    ).status,
    "verification_required",
  );
});
test("all nine languages retain prices and separate verification guidance", () => {
  assert.deepEqual(Object.keys(ONSITE_OFFER_COPY).sort(), [...SUPPORTED_LOCALES].sort());
  for (const copy of Object.values(ONSITE_OFFER_COPY)) {
    for (const value of Object.values(copy)) assert.ok(value.trim().length > 0);
    assert.match(copy.body, /149/);
    assert.match(copy.nextPrice, /200/);
    assert.match(copy.separate, /149/);
    assert.match(copy.separate, /3/);
    assert.notEqual(copy.pending, copy.verified);
  }
});

test("old open sessions without Checkout consent are retired before a new payment URL is returned", async () => {
  const deps = fixture();
  const credential = pending(deps);
  assert.equal((await onsiteReservation({ credential, locale: "en" }, deps)).status, "ready");
  const legacy = deps.stripe.sessions[0];
  delete legacy.metadata.checkout_terms_consent;
  legacy.consentCollectionTermsOfService = null;
  const next = await onsiteReservation({ credential, locale: "en" }, deps);
  assert.equal(next.status, "ready");
  assert.equal(legacy.status, "expired");
  assert.equal(deps.stripe.sessions.filter((s) => s.status === "open").length, 1);
  assert.equal(deps.stripe.sessions.at(-1)?.consentCollectionTermsOfService, "required");
});
test("a completed Stripe charge missing required terms acceptance is not marked paid and never permits another charge", async () => {
  const deps = fixture();
  const credential = pending(deps);
  assert.equal((await onsiteReservation({ credential, locale: "en" }, deps)).status, "ready");
  const charged = deps.stripe.sessions[0];
  charged.status = "complete";
  charged.paymentStatus = "paid";
  charged.paymentIntentId = "pi_fake";
  charged.consentTermsOfService = null;
  assert.equal((await onsiteReservation({ credential, locale: "en" }, deps)).status, "unavailable");
  assert.equal(deps.stripe.sessions.length, 1);
  charged.consentTermsOfService = "accepted";
  assert.equal(
    (await onsiteReservation({ credential, locale: "en" }, deps)).status,
    "already_paid",
  );
});
