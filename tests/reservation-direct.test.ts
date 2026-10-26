// Fetch is always faked. These tests never contact Stripe or any other service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  assertInviteUrl,
  buildReservationInviteUrl,
} from "../src/lib/reservation-mail/inviteLink.ts";
import {
  contractMetadata,
  reservationEmailHash,
  reservationSuccessUrl,
} from "../src/lib/reservation/checkout.ts";
import { handleReservationDirect } from "../src/lib/reservation/direct.ts";
import { issueReservationInvite } from "../src/lib/reservation/invite.ts";
import {
  rememberReservationEntry,
  RESERVATION_INVALID_INVITE_KEY,
  RESERVATION_INVITE_STORAGE_KEY,
  RESERVATION_LANG_STORAGE_KEY,
} from "../src/components/reservation/query.ts";

const NOW = Date.parse("2026-10-23T00:00:00Z");
const ORIGIN = "https://watchdive.diveroid.com";
const SECRET = "fake-reservation-signing-secret-32-bytes";
const EMAIL = "diver@example.com";
const ENV = {
  WATCHDIVE_RESERVATION_ENABLED: "true",
  WATCHDIVE_RESERVATION_ALLOW_LIVE: "false",
  STRIPE_SECRET_KEY: "sk_test_direct_fake_123456789",
  STRIPE_WEBHOOK_SECRET: "whsec_fake_direct_test",
  WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
};

function invite(expiresAtMs = NOW + 60_000): string {
  return issueReservationInvite({
    leadId: "11111111-1111-4111-8111-111111111111",
    email: EMAIL,
    emailVerified: true,
    secret: SECRET,
    nowMs: NOW - 60_000,
    expiresAtMs,
    jti: "direct-invite-jti-0001",
  });
}

function request(token = invite(), redirect = false, lang = "ko"): Request {
  const url = new URL("/api/reservation/direct", ORIGIN);
  url.searchParams.set("lang", lang);
  url.searchParams.set("invite", token);
  if (redirect) url.searchParams.set("redirect", "1");
  return new Request(url, { headers: { host: "evil.example" } });
}

function privacy(response: Response): void {
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
}

function fallback(response: Response, token: string, lang = "ko"): void {
  assert.equal(response.status, 303);
  privacy(response);
  const location = response.headers.get("location") ?? "";
  assert.equal(location.startsWith("/reservation?"), true);
  const url = new URL(location, ORIGIN);
  assert.equal(url.searchParams.get("lang"), lang);
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("invite"), token);
  assert.deepEqual([...url.searchParams.keys()], ["lang"]);
}

class FakeStripe {
  calls: string[] = [];
  creates = 0;
  params: URLSearchParams | null = null;
  url = "https://checkout.stripe.com/c/pay/cs_test_direct";
  fail = false;
  paid = false;
  refunded = 0;
  pendingRefund = 0;
  disputed = false;
  open = false;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    assert.equal(url.origin, "https://api.stripe.com");
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}`);
    const ok = (value: unknown) => new Response(JSON.stringify(value));
    const list = (data: unknown[]) => ok({ data, has_more: false });
    if (this.fail)
      return new Response(JSON.stringify({ error: { type: "api_error" } }), { status: 500 });
    if (url.pathname === "/v1/customers") {
      assert.equal(method, "GET");
      assert.equal(url.searchParams.get("email"), EMAIL);
      return list([{ id: "cus_test_direct", email: EMAIL, metadata: {} }]);
    }
    if (url.pathname === "/v1/checkout/sessions") {
      if (method === "POST") {
        this.creates += 1;
        this.params = new URLSearchParams(String(init?.body));
        assert.ok(new Headers(init?.headers).get("Idempotency-Key"));
        this.open = true;
        return ok(this.session());
      }
      return list(this.open || this.paid ? [this.session()] : []);
    }
    if (url.pathname.endsWith("/line_items")) {
      return list([
        {
          quantity: 1,
          currency: "usd",
          amount_total: 300,
          price: { unit_amount: 300, currency: "usd", type: "one_time", recurring: null },
        },
      ]);
    }
    if (url.pathname.endsWith("/expire")) {
      this.open = false;
      return ok({ ...this.session(), status: "expired" });
    }
    if (url.pathname === "/v1/payment_intents/pi_test_direct") {
      return ok({
        id: "pi_test_direct",
        amount: 300,
        currency: "usd",
        status: "succeeded",
        latest_charge: "ch_test_direct",
        metadata: {},
      });
    }
    if (url.pathname === "/v1/charges/ch_test_direct") {
      return ok({
        id: "ch_test_direct",
        amount: 300,
        amount_refunded: this.refunded,
        currency: "usd",
        refunded: this.refunded === 300,
        disputed: this.disputed,
        payment_intent: "pi_test_direct",
        created: NOW / 1000,
      });
    }
    if (url.pathname === "/v1/refunds") {
      return list(
        this.pendingRefund
          ? [
              {
                id: "re_test_direct",
                amount: this.pendingRefund,
                currency: "usd",
                status: "pending",
              },
            ]
          : [],
      );
    }
    if (url.pathname === "/v1/disputes") {
      return list([
        { id: "du_test_direct", amount: 300, currency: "usd", status: "needs_response" },
      ]);
    }
    assert.fail(`Unexpected fake request ${method} ${url.pathname}`);
  };

  session() {
    const emailHash = reservationEmailHash(EMAIL);
    const metadata = this.params
      ? Object.fromEntries(
          [...this.params]
            .filter(([key]) => /^metadata\[[^\]]+\]$/.test(key))
            .map(([key, value]) => [key.slice(9, -1), value]),
        )
      : contractMetadata({ emailSha256: emailHash });
    return {
      id: "cs_test_direct",
      url: this.paid ? null : this.url,
      status: this.paid ? "complete" : "open",
      payment_status: this.paid ? "paid" : "unpaid",
      mode: "payment",
      amount_total: 300,
      currency: "usd",
      customer: "cus_test_direct",
      client_reference_id: emailHash,
      metadata,
      payment_intent: this.paid ? "pi_test_direct" : null,
      created: NOW / 1000,
      expires_at: NOW / 1000 + 3600,
      livemode: false,
      success_url: reservationSuccessUrl(ORIGIN),
      consent_collection: { terms_of_service: "required" },
      consent: { terms_of_service: this.paid ? "accepted" : null },
    };
  }
}

const deps = (fake: FakeStripe, env = ENV) => ({ env, fetchImpl: fake.fetch, nowMs: NOW });

test("email GET stores the verified invite and locale before the second GET redirects to Checkout", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const token = invite();
    const fake = new FakeStripe();
    const response = await handleReservationDirect(request(token, false, locale), deps(fake));
    assert.equal(response.status, 200);
    privacy(response);
    assert.equal(fake.calls.length, 0);
    const html = await response.text();
    const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
    assert.ok(script);
    assert.equal(
      (response.headers.get("content-security-policy") ?? "").includes(`'nonce-${script[1]}'`),
      true,
    );
    assert.equal(html.includes("<script src="), false);
    const storage = new Map([[RESERVATION_INVALID_INVITE_KEY, "1"]]);
    let next = "";
    let clean = "";
    runInNewContext(script[2], {
      sessionStorage: {
        setItem: (key: string, value: string) => storage.set(key, value),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
      },
      history: {
        replaceState: (_state: unknown, _title: string, href: string) => {
          clean = href;
        },
      },
      location: {
        replace: (href: string) => {
          next = href;
        },
      },
    });
    assert.equal(storage.get(RESERVATION_INVITE_STORAGE_KEY), token);
    assert.equal(storage.get(RESERVATION_LANG_STORAGE_KEY), locale);
    assert.equal(storage.has(RESERVATION_INVALID_INVITE_KEY), false);
    assert.equal(clean, "/api/reservation/direct");
    const nextUrl = new URL(next, ORIGIN);
    assert.equal(nextUrl.pathname, "/api/reservation/direct");
    assert.equal(nextUrl.searchParams.get("redirect"), "1");
    assert.equal(nextUrl.searchParams.get("invite"), token);
    const checkout = await handleReservationDirect(new Request(nextUrl), deps(fake));
    assert.equal(checkout.status, 303);
    privacy(checkout);
    assert.equal(checkout.headers.get("location"), fake.url);
    assert.equal(fake.creates, 1);
    assert.equal(fake.params?.get("success_url"), reservationSuccessUrl(ORIGIN));
    assert.equal(fake.params?.get("success_url")?.includes("invite"), false);
    const again = await handleReservationDirect(new Request(nextUrl), deps(fake));
    assert.equal(again.headers.get("location"), fake.url);
    assert.equal(fake.creates, 1);
  }
});

test("storage failure returns to the old fragment page without creating a session", async () => {
  const fake = new FakeStripe();
  const token = invite();
  const response = await handleReservationDirect(request(token), deps(fake));
  const html = await response.text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  let next = "";
  runInNewContext(script, {
    sessionStorage: {
      setItem: () => {
        throw new Error("storage disabled");
      },
    },
    location: {
      replace: (href: string) => {
        next = href;
      },
    },
  });
  assert.equal(next, `/reservation?lang=ko#invite=${token}`);
  assert.match(html, /<noscript><a href="\/reservation\?lang=ko#invite=/);
  assert.equal(fake.calls.length, 0);
});

test("invalid, expired, and incorrectly signed invites never reach Stripe on either GET", async () => {
  const signed = invite();
  const tokens = [
    "not-a-token",
    invite(NOW - 1),
    `${signed.slice(0, -1)}!`,
    // Same character count, different UTF-8 byte count: verifier errors must
    // still return the page fallback rather than escape as a server 500.
    `${signed.slice(0, signed.lastIndexOf(".") + 1)}${"é".repeat(43)}`,
    issueReservationInvite({
      leadId: "11111111-1111-4111-8111-111111111111",
      email: EMAIL,
      emailVerified: true,
      secret: `${SECRET}-wrong`,
      nowMs: NOW,
      expiresAtMs: NOW + 60_000,
      jti: "different-secret-01",
    }),
  ];
  for (const token of tokens)
    for (const redirect of [false, true]) {
      const fake = new FakeStripe();
      fallback(await handleReservationDirect(request(token, redirect), deps(fake)), token);
      assert.equal(fake.calls.length, 0);
    }
});

test("HEAD and other methods never create a session and carry privacy headers", async () => {
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    const fake = new FakeStripe();
    const response = await handleReservationDirect(
      new Request(request().url, { method }),
      deps(fake),
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(await response.text(), "");
    privacy(response);
    assert.equal(fake.calls.length, 0);
  }
  const route = readFileSync(
    new URL("../src/routes/api.reservation.direct.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /createFileRoute\("\/api\/reservation\/direct"\)/);
  assert.match(route, /HEAD: async/);
});

test("disabled, missing and live-refused configuration falls back without provider calls", async () => {
  for (const env of [
    {},
    { ...ENV, WATCHDIVE_RESERVATION_ENABLED: "false" },
    { ...ENV, WATCHDIVE_RESERVATION_TOKEN_SECRET: "" },
    { ...ENV, STRIPE_WEBHOOK_SECRET: "" },
    { ...ENV, STRIPE_SECRET_KEY: "sk_live_refused_fake_123456789" },
  ]) {
    const fake = new FakeStripe();
    const token = invite();
    fallback(await handleReservationDirect(request(token, true), { ...deps(fake), env }), token);
    assert.equal(fake.calls.length, 0);
  }
});

test("paid, refunded, pending-refund and disputed reservations fall back without another checkout", async () => {
  for (const state of [
    {},
    { refunded: 300 },
    { refunded: 100 },
    { pendingRefund: 300 },
    { disputed: true },
  ]) {
    const fake = Object.assign(new FakeStripe(), { paid: true }, state);
    const token = invite();
    fallback(await handleReservationDirect(request(token, true), deps(fake)), token);
    assert.equal(fake.creates, 0);
  }
});

test("Stripe errors and non-hosted Checkout URLs fall back to the fragment page", async () => {
  for (const setting of [
    { fail: true },
    { url: "https://evil.example/pay" },
    { url: "http://checkout.stripe.com/pay" },
    { url: "https://checkout.stripe.com.evil.example/pay" },
  ]) {
    const fake = Object.assign(new FakeStripe(), setting);
    const token = invite();
    fallback(await handleReservationDirect(request(token, true), deps(fake)), token);
  }
});

test("malformed direct parameters cannot create sessions or inject fallback redirects", async () => {
  const token = invite();
  for (const query of [
    "",
    "invite=",
    `lang=ko&invite=${token}&invite=${token}`,
    `lang=ko&lang=en&invite=${token}`,
    `lang=ko&invite=${token}&redirect=0`,
    `lang=ko&invite=${token}&redirect=1&redirect=1`,
    `lang=ko&invite=${token}&next=https://evil.example`,
    `lang=ko&invite=${"x".repeat(4097)}`,
  ]) {
    const fake = new FakeStripe();
    const response = await handleReservationDirect(
      new Request(`${ORIGIN}/api/reservation/direct?${query}`),
      deps(fake),
    );
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", /^\/reservation\?lang=(?:ko|en)#invite=/);
    assert.equal(fake.calls.length, 0);
  }
});

test("old reservation fragment URLs still load the signed token using the existing page contract", () => {
  const token = invite();
  const storage = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
  const entry = rememberReservationEntry({
    href: `${ORIGIN}/reservation?lang=ko#invite=${token}`,
    storage: adapter,
  });
  assert.equal(storage.get(RESERVATION_INVITE_STORAGE_KEY), token);
  assert.equal(entry.replaceUrl, `${ORIGIN}/reservation?lang=ko`);
  const restored = rememberReservationEntry({ href: entry.replaceUrl!, storage: adapter });
  assert.equal(restored.inviteToken, token);
  assert.equal(restored.invalidInvite, false);
});

test("mail URLs reject extra parameters, altered origins, fragments and emails", () => {
  const valid = buildReservationInviteUrl(ORIGIN, "ko", invite());
  assert.equal(assertInviteUrl(valid, ORIGIN, "ko"), valid);
  for (const invalid of [
    valid.replace(ORIGIN, "https://evil.example"),
    `${valid}#invite=other`,
    `${valid}&redirect=1`,
    `${valid}&lang=ko`,
    `${valid}&invite=other`,
    `${valid}&email=diver%40example.com`,
    valid.replace("lang=ko", "lang=en"),
    valid.replace("/api/reservation/direct", "/reservation"),
    valid.replace("https://", "https://user:password@"),
  ]) {
    assert.throws(() => assertInviteUrl(invalid, ORIGIN, "ko"), /Invalid invite url/);
  }
  assert.throws(() => buildReservationInviteUrl(ORIGIN, "en", "diver@example.com-invalid-token"));
});
