import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createReservationSubmitLock,
  fetchReservationStatus,
  requestReservationCheckout,
} from "../src/components/reservation/client.ts";
import {
  checkoutPayload,
  isHostedStripeCheckoutUrl,
  isTerminalReservationStatus,
  parseCheckoutResponse,
  parseReservationStatus,
  statusRequestPath,
} from "../src/components/reservation/contract.ts";
import {
  buildReservationView,
  checkoutBlockReason,
  reservationPhase,
} from "../src/components/reservation/model.ts";
import {
  PRODUCT_PRICE_USD_CENTS,
  RESERVATION_FEE_IS_CREDITED,
  RESERVATION_FEE_USD_CENTS,
  STRIPE_CHECKOUT_USD_CENTS,
  TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS,
  formatUsd,
} from "../src/components/reservation/pricing.ts";
import {
  RESERVATION_INVALID_INVITE_KEY,
  RESERVATION_INVITE_STORAGE_KEY,
  parseInviteFragment,
  parseReservationQuery,
  readStoredInvite,
  rememberReservationEntry,
  reservationLangBootstrapScript,
  reservationReturnUrl,
  reservationUrlWithoutSecret,
  reservationLocaleHint,
  shouldPreferKorean,
  withReservationLang,
  writeStoredInvite,
} from "../src/components/reservation/query.ts";
import { buildReservationInviteUrl } from "../src/lib/reservation-mail/inviteLink.ts";

const INVITE = "v1.eyJ2IjoxfQ.abcdefghijklmnopqrstuvwxyz0123456789ABCDE";
const SESSION = "cs_test_abcdefghij";
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_abcdefghij";

const unpaid = {
  serverStatus: "unpaid" as const,
  paid: false,
  authoritativePaid: false,
  amountTotal: null,
  currency: null,
};
const verifiedPaid = {
  serverStatus: "paid" as const,
  paid: true,
  authoritativePaid: true,
  amountTotal: 300,
  currency: "usd" as const,
};

function stripeBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "unpaid",
    paid: false,
    sessionId: null,
    amountTotal: null,
    currency: null,
    amountRefunded: 0,
    amountRefundPending: 0,
    duplicatePaid: false,
    source: "stripe",
    ...overrides,
  };
}

function view(overrides: Partial<Parameters<typeof buildReservationView>[0]> = {}) {
  return buildReservationView({
    search: "",
    inviteToken: INVITE,
    invalidInvite: false,
    termsRead: false,
    termsAccepted: false,
    submitting: false,
    status: unpaid,
    statusError: false,
    statusLoading: false,
    checkoutError: false,
    checkoutConflict: false,
    localizedSite: false,
    ...overrides,
  });
}

test("the fee is additional and the total is the sum, not a credit", () => {
  assert.equal(RESERVATION_FEE_IS_CREDITED, false);
  assert.equal(RESERVATION_FEE_USD_CENTS, 300);
  assert.equal(STRIPE_CHECKOUT_USD_CENTS, 300);
  assert.equal(PRODUCT_PRICE_USD_CENTS, 14_900);
  assert.equal(TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS, 15_200);
  assert.equal(
    RESERVATION_FEE_USD_CENTS + PRODUCT_PRICE_USD_CENTS,
    TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS,
  );
  assert.notEqual(
    PRODUCT_PRICE_USD_CENTS - RESERVATION_FEE_USD_CENTS,
    TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS,
  );
  assert.equal(formatUsd(300), "USD $3.00");
  assert.equal(formatUsd(14_900), "USD $149.00");
  assert.equal(formatUsd(15_200), "USD $152.00");
});

test("the invite is read from the fragment and a query token is ignored", () => {
  const parsed = parseReservationQuery(`?inviteToken=${INVITE}&email=person@example.com&lang=ko`);
  assert.equal(parsed.lang, "ko");
  assert.equal("inviteToken" in parsed, false);
  const fragment = parseInviteFragment(`#invite=${INVITE}`);
  assert.equal(fragment.token, INVITE);
  assert.equal(fragment.invalid, false);
  assert.equal(parseInviteFragment("#invite=person@example.com").token, null);
  assert.equal(parseInviteFragment("#invite=person@example.com").invalid, true);
  assert.equal(parseInviteFragment("#invite=short").invalid, true);
  assert.equal(parseInviteFragment("").token, null);
  const storage = new Map<string, string>();
  const memory = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  writeStoredInvite(memory, INVITE);
  assert.equal(readStoredInvite(memory), INVITE);
  const stripped = reservationUrlWithoutSecret(
    `https://watchdive.diveroid.com/reservation?lang=ko&inviteToken=${INVITE}#invite=${INVITE}`,
  );
  const strippedUrl = new URL(stripped);
  assert.equal(strippedUrl.hash, "");
  assert.equal(strippedUrl.searchParams.get("inviteToken"), null);
  assert.equal(strippedUrl.searchParams.get("lang"), "ko");
});

test("a mailed invitation uses the direct route and legacy fragments still parse", () => {
  const mailed = buildReservationInviteUrl("https://watchdive.diveroid.com", "en", INVITE);
  const url = new URL(mailed);
  assert.equal(url.pathname, "/api/reservation/direct");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.equal(url.searchParams.get("inviteToken"), null);
  assert.equal(url.searchParams.get("invite"), INVITE);
  assert.equal(url.hash, "");
  assert.equal(parseInviteFragment(`#invite=${INVITE}`).token, INVITE);
  const korean = new URL(buildReservationInviteUrl("https://watchdive.diveroid.com", "ko", INVITE));
  assert.equal(korean.pathname, "/api/reservation/direct");
  assert.equal(korean.searchParams.get("lang"), "ko");
  assert.equal(parseInviteFragment(korean.search).token, null);
  assert.equal(korean.searchParams.get("invite"), INVITE);
  assert.equal(korean.hash, "");
  const french = new URL(buildReservationInviteUrl("https://watchdive.diveroid.com", "fr", INVITE));
  assert.equal(french.pathname, "/api/reservation/direct");
  assert.equal(french.searchParams.get("lang"), "fr");
  assert.equal(french.searchParams.get("invite"), INVITE);
  assert.equal(french.hash, "");
  assert.equal(parseReservationQuery("?lang=ja").lang, "ja");
  assert.equal(parseReservationQuery("?lang=pt-BR").lang, "pt-BR");
  assert.equal(parseReservationQuery("?lang=zz").lang, null);
});

test("a Stripe return restores the stored language and keeps the invite out of the query", () => {
  const href = `https://watchdive.diveroid.com/reservation?session_id=${SESSION}`;
  const restored = reservationReturnUrl(href, "ko");
  assert.ok(restored);
  const url = new URL(restored);
  assert.equal(url.searchParams.get("lang"), "ko");
  assert.equal(url.searchParams.get("session_id"), SESSION);
  assert.equal(url.searchParams.get("inviteToken"), null);
  assert.equal(url.searchParams.get("token"), null);
  assert.equal(url.hash, "");
  assert.equal(reservationReturnUrl(`${href}&lang=ja`, "ko"), null);
  assert.equal(reservationReturnUrl(`${href}&lang=ja-JP`, "en"), null);
  assert.equal(reservationReturnUrl(href, null), null);
  assert.equal(reservationReturnUrl(href, "zz"), null);
  const portuguese = reservationReturnUrl(href, "pt_BR");
  assert.equal(new URL(portuguese ?? "").searchParams.get("lang"), "pt-BR");
  const withFragment = reservationReturnUrl(
    `https://watchdive.diveroid.com/reservation?canceled=1#invite=${INVITE}`,
    "fr",
  );
  assert.ok(withFragment);
  const fragmentUrl = new URL(withFragment);
  assert.equal(fragmentUrl.searchParams.get("lang"), "fr");
  assert.equal(fragmentUrl.searchParams.get("canceled"), "1");
  assert.equal(fragmentUrl.hash, `#invite=${INVITE}`);
  assert.equal(fragmentUrl.searchParams.has("invite"), false);
  const script = reservationLangBootstrapScript();
  assert.match(script, /watchdive\.reservation\.lang/);
  assert.match(script, /location\.replace/);
  assert.match(script, /sessionStorage/);
  assert.doesNotMatch(script, /invite=/);
  for (const locale of ["en", "ko", "zh-CN", "zh-TW", "ja", "es", "fr", "de", "pt-BR"]) {
    assert.ok(script.includes(locale));
  }
  const page = readFileSync(
    new URL("../src/components/reservation/ReservationPage.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/components/reservation/reservation.css", import.meta.url),
    "utf8",
  );
  const route = readFileSync(new URL("../src/routes/reservation.tsx", import.meta.url), "utf8");
  assert.match(page, /\/brand\/reservation\/diveroid-wordmark-color-transparent\.png/);
  assert.match(route, /reservationLangBootstrapScript/);
  assert.doesNotMatch(`${page}\n${css}`, /linear-gradient|radial-gradient/);
  for (const hex of ["#201748", "#3D2683", "#EEF9FF", "#10212E", "#F6FAFC"]) {
    assert.match(css, new RegExp(hex, "i"));
  }
  // Pinned SHA256 values verified against the supplied original brand assets.
  for (const [name, expectedHash] of Object.entries({
    "diveroid-wordmark-color-transparent.png": "169ac17c5cdf487a0e5e4b8018fbcd9066d05208daa98f56d1fe35048b23bde7",
    "diveroid-wordmark-white-transparent.png": "7fc996a0dee356ae2a254025c399f65d58f8e306e556e9b53f1e2ceae70a6218",
  })) {
    const published = readFileSync(new URL(`../public/brand/reservation/${name}`, import.meta.url));
    assert.equal(
      expectedHash,
      createHash("sha256").update(published).digest("hex"),
    );
  }
});

test("language links keep the session and attribution and drop a query token", () => {
  const search = `?utm_source=meta&inviteToken=${INVITE}&session_id=${SESSION}&fbclid=abc_DEF-1`;
  const href = withReservationLang(search, "ko");
  assert.match(href, /^\/reservation\?/);
  const params = new URLSearchParams(href.slice(href.indexOf("?")));
  assert.equal(params.get("lang"), "ko");
  assert.equal(params.get("inviteToken"), null);
  assert.equal(params.get("session_id"), SESSION);
  assert.equal(params.get("utm_source"), "meta");
  assert.equal(params.get("fbclid"), "abc_DEF-1");
});

test("an explicit language beats the browser, and a non Korean cookie is not overwritten by inference", () => {
  assert.equal(reservationLocaleHint("watchdive.locale=ko", ["en"]), "ko");
  assert.equal(reservationLocaleHint("watchdive.locale=ja", ["ko"]), null);
  assert.equal(reservationLocaleHint(null, ["fr", "ko-KR"]), "ko");
  assert.equal(shouldPreferKorean("?lang=en", "ko"), false);
  assert.equal(shouldPreferKorean("", "ko"), true);
  assert.equal(shouldPreferKorean("?inviteToken=" + INVITE, "en"), false);
});

test("checkout JSON sends the invite and the accepted terms", () => {
  const payload = checkoutPayload(INVITE);
  assert.deepEqual(payload, {
    inviteToken: INVITE,
    acceptedTerms: true,
    termsVersion: "2026-10-18",
  });
  assert.equal("email" in payload, false);
  assert.equal("amount" in payload, false);
  assert.throws(() => checkoutPayload("person@example.com"));
});

test("hosted Stripe URLs are the only checkout destinations", () => {
  assert.equal(isHostedStripeCheckoutUrl(STRIPE_URL), true);
  for (const rejected of [
    "http://checkout.stripe.com/c/pay/cs_test_abcdefghij",
    "https://checkout.stripe.com.evil.example/c/pay/cs_test_abcdefghij",
    "https://evil.example/checkout.stripe.com",
    "https://user:pass@checkout.stripe.com/c/pay/cs_test_abcdefghij",
    "javascript:alert(1)",
    "https://checkout.stripe.com/c/pay/cs_test_abcdefghij\n",
    "/reservation?paid=1",
  ]) {
    assert.equal(parseCheckoutResponse({ url: rejected }), null, rejected);
  }
});

test("paid is authoritative only for a Stripe-sourced 300-cent payment", () => {
  const paid = parseReservationStatus(
    stripeBody({ status: "paid", paid: true, amountTotal: 300, currency: "usd" }),
  );
  assert.equal(paid?.authoritativePaid, true);
  assert.equal(paid?.serverStatus, "paid");

  const wrongAmount = parseReservationStatus(
    stripeBody({ status: "paid", paid: true, amountTotal: 14_900, currency: "usd" }),
  );
  assert.equal(wrongAmount?.authoritativePaid, false);
  assert.equal(wrongAmount?.serverStatus, "invalid");

  const unpaidFlag = parseReservationStatus(
    stripeBody({ status: "paid", paid: false, amountTotal: 300, currency: "usd" }),
  );
  assert.equal(unpaidFlag?.authoritativePaid, false);

  assert.equal(parseReservationStatus({ paid: true }), null);
  assert.equal(parseReservationStatus({ paymentState: "paid", stripeVerified: true }), null);
  assert.equal(
    parseReservationStatus(
      stripeBody({
        status: "paid",
        paid: true,
        amountTotal: 300,
        currency: "usd",
        source: "client",
      }),
    ),
    null,
  );
  assert.equal(
    parseReservationStatus(
      stripeBody({ status: "refunded", paid: false, amountTotal: 300, currency: "usd" }),
    )?.authoritativePaid,
    false,
  );
});

test("a success return URL is pending until the status endpoint verifies payment", () => {
  const search = `?session_id=${SESSION}&paid=1&success=1`;
  const pending = view({
    search,
    status: null,
    statusLoading: true,
    termsRead: true,
    termsAccepted: true,
  });
  assert.equal(pending.phase, "pending");
  assert.equal(pending.checkoutEnabled, false);
  assert.equal(
    pending.statusText.includes("not payment") || pending.copy.pendingStatus.length > 0,
    true,
  );
  assert.doesNotMatch(pending.statusText, /verified this reservation/i);

  const unresolved = view({
    search,
    inviteToken: null,
    status: unpaid,
    termsRead: true,
    termsAccepted: true,
  });
  assert.equal(unresolved.phase, "needs_invitation");
  assert.equal(unresolved.checkoutEnabled, false);
  assert.equal(unresolved.showCheckoutForm, false);
  assert.match(unresolved.statusText, /email/i);

  const inviteStillUnpaid = view({
    search: `?session_id=${SESSION}&paid=1`,
    status: unpaid,
    termsRead: true,
    termsAccepted: true,
  });
  assert.equal(inviteStillUnpaid.phase, "offer");
  assert.equal(inviteStillUnpaid.checkoutEnabled, true);
  assert.doesNotMatch(inviteStillUnpaid.statusText, /verified this reservation/i);

  const browserCanceled = view({
    search: "?canceled=1",
    inviteToken: null,
    status: null,
    statusLoading: false,
  });
  assert.equal(browserCanceled.phase, "canceled");
  assert.equal(browserCanceled.showCheckoutForm, false);
  assert.match(browserCanceled.statusDetail ?? "", /email/i);

  const paid = view({ search, status: verifiedPaid });
  assert.equal(paid.phase, "paid");
  assert.equal(paid.showCheckoutForm, false);
  assert.match(paid.statusText, /not credited/i);
  assert.match(paid.statusText, /USD \$3\.00/);
  assert.match(paid.statusText, /USD \$149\.00/);
});

test("terms must be read and accepted before checkout, and a canceled invitation can retry", () => {
  const unread = view({ termsRead: false, termsAccepted: false });
  assert.equal(unread.phase, "offer");
  assert.equal(unread.checkoutBlock, "terms_unread");
  assert.equal(unread.checkoutEnabled, false);

  const unaccepted = view({ termsRead: true, termsAccepted: false });
  assert.equal(unaccepted.checkoutBlock, "terms_unaccepted");
  assert.equal(unaccepted.showCheckoutForm, true);

  const ready = view({ termsRead: true, termsAccepted: true });
  assert.equal(ready.checkoutEnabled, true);
  assert.equal(ready.checkoutBlock, null);

  const canceled = view({
    search: `?inviteToken=${INVITE}&canceled=1`,
    status: unpaid,
    termsRead: true,
    termsAccepted: true,
  });
  assert.equal(canceled.phase, "canceled");
  assert.equal(canceled.checkoutEnabled, true);

  const refunded = view({
    search: `?inviteToken=${INVITE}`,
    status: {
      serverStatus: "refunded",
      paid: false,
      authoritativePaid: false,
      amountTotal: 300,
      currency: "usd",
    },
    termsRead: true,
    termsAccepted: true,
  });
  assert.equal(refunded.phase, "refunded");
  assert.equal(refunded.checkoutEnabled, false);
  assert.equal(refunded.showCheckoutForm, false);
  assert.match(refunded.statusText, /refunded/i);
  assert.doesNotMatch(refunded.statusText, /verified this reservation/i);
});

test("checkout stays closed while status is unknown so a second charge is not started", () => {
  assert.equal(
    checkoutBlockReason({
      inviteToken: INVITE,
      termsRead: true,
      termsAccepted: true,
      submitting: false,
      status: null,
      statusError: true,
      statusLoading: false,
    }),
    "status_unavailable",
  );
  assert.equal(
    reservationPhase({
      inviteToken: null,
      sessionId: null,
      canceled: false,
      status: unpaid,
      statusError: false,
      statusLoading: false,
    }),
    "needs_invitation",
  );
  assert.equal(
    reservationPhase({
      inviteToken: null,
      sessionId: SESSION,
      canceled: false,
      status: verifiedPaid,
      statusError: false,
      statusLoading: false,
    }),
    "paid",
  );
  const missing = view({
    search: "?paid=1&success=true",
    inviteToken: null,
    status: null,
    statusLoading: false,
  });
  assert.equal(missing.phase, "needs_invitation");
  assert.equal(missing.showCheckoutForm, false);
  assert.match(missing.statusText, /email/i);
});

test("Korean and English both keep the three prices on separate rows", () => {
  for (const lang of ["en", "ko"] as const) {
    const localized = view({ search: `?inviteToken=${INVITE}&lang=${lang}` });
    assert.equal(localized.locale, lang);
    assert.deepEqual(
      localized.copy.priceRows.map((row) => row.amount),
      ["USD $3.00", "USD $149.00", "USD $152.00"],
    );
    assert.equal(new Set(localized.copy.priceRows.map((row) => row.label)).size, 3);
  }
  assert.equal(
    view({ search: `?inviteToken=${INVITE}&lang=ko`, localizedSite: true }).supportLinks.home,
    "/ko",
  );
  assert.equal(view({ localizedSite: false, search: "?lang=ko" }).supportLinks.privacy, "/privacy");
});

test("the checkout request posts the token and rejects a non-Stripe URL", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const ok = await requestReservationCheckout(INVITE, async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ url: STRIPE_URL }), { status: 200 });
  });
  assert.equal(ok.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/reservation/checkout");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.redirect, "error");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    inviteToken: INVITE,
    acceptedTerms: true,
    termsVersion: "2026-10-18",
  });
  assert.equal(JSON.stringify(JSON.parse(String(calls[0]?.init?.body))).includes("email"), false);

  const rejected = await requestReservationCheckout(INVITE, async () => {
    return new Response(JSON.stringify({ url: "https://evil.example/pay" }), { status: 200 });
  });
  assert.deepEqual(rejected, { ok: false, reason: "bad_response" });
  assert.deepEqual(await requestReservationCheckout("not a token"), {
    ok: false,
    reason: "invalid_invite",
  });
});

test("status is requested from the server and an unverified paid body stays unpaid", async () => {
  const path = statusRequestPath(SESSION);
  assert.equal(path, `/api/reservation/status?session_id=${encodeURIComponent(SESSION)}`);
  assert.equal(path.includes("inviteToken"), false);
  let requested = "";
  let authorization = "";
  const result = await fetchReservationStatus(
    { inviteToken: INVITE, sessionId: SESSION },
    async (input, init) => {
      requested = input;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(
        JSON.stringify(
          stripeBody({ status: "paid", paid: true, amountTotal: 14_900, currency: "usd" }),
        ),
        { status: 200 },
      );
    },
  );
  assert.equal(requested, path);
  assert.equal(authorization, `Bearer ${INVITE}`);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status.authoritativePaid, false);
    assert.equal(result.status.serverStatus, "invalid");
  }
  const failed = await fetchReservationStatus({ inviteToken: null, sessionId: null });
  assert.deepEqual(failed, { ok: false, reason: "nothing_to_check" });
  const sessionAlone = await fetchReservationStatus({ inviteToken: null, sessionId: SESSION });
  assert.deepEqual(sessionAlone, { ok: false, reason: "nothing_to_check" });
});

test("a refunded or disputed body is not accepted as a paid reservation", () => {
  const clean = parseReservationStatus(
    stripeBody({ status: "paid", paid: true, amountTotal: 300, currency: "usd" }),
  );
  assert.equal(clean?.authoritativePaid, true);
  assert.equal(isTerminalReservationStatus(clean!), true);

  for (const field of ["amountRefunded", "amountRefundPending"] as const) {
    const blocked = parseReservationStatus(
      stripeBody({
        status: "paid",
        paid: true,
        amountTotal: 300,
        currency: "usd",
        [field]: 300,
      }),
    );
    assert.equal(blocked?.authoritativePaid, false, field);
    assert.equal(blocked?.serverStatus, "invalid", field);
    assert.equal(isTerminalReservationStatus(blocked!), false, field);
  }

  for (const status of ["refunded", "partially_refunded", "refund_pending"] as const) {
    const parsed = parseReservationStatus(
      stripeBody({ status, paid: true, amountTotal: 300, currency: "usd" }),
    );
    assert.equal(parsed?.serverStatus, status);
    assert.equal(parsed?.authoritativePaid, false);
    assert.equal(isTerminalReservationStatus(parsed!), true);
  }

  const disputed = parseReservationStatus(
    stripeBody({ status: "disputed", paid: true, amountTotal: 300, currency: "usd" }),
  );
  assert.equal(disputed?.serverStatus, "disputed");
  assert.equal(disputed?.authoritativePaid, false);
  assert.equal(disputed?.paid, false);
  const screen = view({ status: disputed });
  assert.equal(screen.phase, "disputed");
  assert.equal(screen.showCheckoutForm, false);
  assert.equal(screen.checkoutEnabled, false);
  assert.equal(screen.checkoutBlock, "payment_closed");
  assert.equal(screen.statusText, screen.copy.disputedStatus);
  assert.doesNotMatch(screen.statusText, /\bpaid\b/i);

  assert.equal(
    parseReservationStatus(
      stripeBody({
        status: "paid",
        paid: true,
        amountTotal: 300,
        currency: "usd",
        amountRefunded: 1.5,
      }),
    ),
    null,
  );
});

test("401 invalid_invite is an invalid link, and another 401 stays unavailable", async () => {
  const status = await fetchReservationStatus({ inviteToken: INVITE, sessionId: null }, async () => {
    return new Response(JSON.stringify({ error: "invalid_invite" }), { status: 401 });
  });
  assert.deepEqual(status, { ok: false, reason: "invalid_invite" });

  const missingBearer = await fetchReservationStatus(
    { inviteToken: INVITE, sessionId: null },
    async () => new Response(JSON.stringify({ error: "missing_bearer" }), { status: 401 }),
  );
  assert.deepEqual(missingBearer, { ok: false, reason: "bad_response" });

  const checkout = await requestReservationCheckout(INVITE, async () => {
    return new Response(JSON.stringify({ error: "invalid_invite" }), { status: 400 });
  });
  assert.deepEqual(checkout, { ok: false, reason: "invalid_invite" });

  const closed = view({ inviteToken: INVITE, invalidInvite: true, status: unpaid });
  assert.equal(closed.phase, "needs_invitation");
  assert.equal(closed.showCheckoutForm, false);
  assert.match(closed.statusText, /cannot be used/i);
  const paidWins = view({ invalidInvite: true, status: verifiedPaid });
  assert.equal(paidWins.phase, "paid");
});

test("an invalid fragment keeps a non-secret flag and never copies the token into the query", () => {
  const forged = "not-a-signed-invite";
  const storage = memoryStorage();
  const first = rememberReservationEntry({
    href: `https://watchdive.diveroid.com/reservation#invite=${forged}`,
    storage,
  });
  assert.ok(first.replaceUrl);
  assert.equal(first.replaceUrl?.includes(forged), false);
  assert.equal(first.replaceUrl?.includes("inviteToken"), false);
  assert.equal(first.replaceUrl?.includes("#"), false);
  assert.equal(storage.data[RESERVATION_INVITE_STORAGE_KEY], undefined);
  assert.equal(storage.data[RESERVATION_INVALID_INVITE_KEY], "1");
  const second = rememberReservationEntry({ href: first.replaceUrl ?? "", storage });
  assert.equal(second.replaceUrl, null);
  assert.equal(second.invalidInvite, true);
  assert.equal(second.inviteToken, null);

  const kept = memoryStorage({ [RESERVATION_INVITE_STORAGE_KEY]: INVITE });
  rememberReservationEntry({
    href: "https://watchdive.diveroid.com/reservation#invite=not-a-token",
    storage: kept,
  });
  assert.equal(kept.data[RESERVATION_INVITE_STORAGE_KEY], INVITE);
  assert.equal(kept.data[RESERVATION_INVALID_INVITE_KEY], "1");

  const repaired = memoryStorage({ [RESERVATION_INVALID_INVITE_KEY]: "1" });
  const valid = rememberReservationEntry({
    href: `https://watchdive.diveroid.com/reservation#invite=${INVITE}`,
    storage: repaired,
  });
  assert.equal(repaired.data[RESERVATION_INVITE_STORAGE_KEY], INVITE);
  assert.equal(repaired.data[RESERVATION_INVALID_INVITE_KEY], undefined);
  assert.equal(valid.replaceUrl?.includes(INVITE), false);
  const restored = rememberReservationEntry({ href: valid.replaceUrl ?? "", storage: repaired });
  assert.equal(restored.invalidInvite, false);
  assert.equal(restored.inviteToken, INVITE);
});

test("the submit lock rejects a second begin in the same turn", () => {
  const lock = createReservationSubmitLock();
  assert.equal(lock.tryBegin(), true);
  assert.equal(lock.tryBegin(), false);
  lock.end();
  assert.equal(lock.tryBegin(), true);
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}
