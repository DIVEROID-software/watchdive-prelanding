import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateKeyPair, exportJWK, exportPKCS8, SignJWT, importPKCS8, decodeJwt } from "jose";
import { test } from "node:test";

import { segmentPath } from "../src/lib/segments/navigation.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { delaySkipReason } from "../src/lib/reservation-mail/schedule.ts";
import { classifyProviderClaims } from "../src/lib/socialAuth/claims.ts";
import { planSocialSignupNotionSchema } from "../src/lib/socialAuth/notionSchema.ts";
import { appleClientSecret } from "../src/lib/socialAuth/appleSecret.ts";
import {
  handleAppleCallback,
  handleGoogleCallback,
  handleSocialContinuation,
  handleSocialProviders,
  handleSocialStart,
  type SocialHttpDependencies,
} from "../src/lib/socialAuth/http.ts";
import { issueSocialStateCookie, newSocialState, resetSocialStateForTests, readSocialState, signSocialState } from "../src/lib/socialAuth/state.ts";
import { classifyEmbeddedBrowser, socialSignupCopy, socialSignupRenderModel } from "../src/lib/socialSignupCopy.ts";
import { createNetworkGate } from "../src/lib/verification/networkGate.ts";
import {
  createNotionLeadStore,
  NotionRequestError,
  SocialAuthSchemaError,
  type NotionRequest,
} from "../src/lib/verification/notionLead.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { runSocialSignupNotionSchema } from "../scripts/social-signup-notion-schema.ts";
import { EXPERIMENT_ID } from "../src/lib/conversionExperimentContract.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_SECRET, leadIdFactory } from "./helpers/fakes.ts";
import { readRetargetingReceipt } from "../src/lib/retargeting/receipt.ts";
import { parseVerificationToken } from "../src/lib/verification/token.ts";
import { resetSocialContinuationForTests } from "../src/lib/socialAuth/continuation.ts";

const NOW = new Date("2026-10-19T12:00:00.000Z");
// Provider JWTs are checked against the wall clock. The application clock stays
// fixed below through `now: () => NOW`.
const SECRET = "social-auth-secret-must-be-32-bytes";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const GOOGLE_SECRET = "google-client-secret-test";
const CODE = "oauth-code-red-herring";
const CUTOFF = Date.parse("2026-10-18T23:21:38.838032Z");

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(keys.publicKey);
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";
const appleKey = await exportPKCS8((await generateKeyPair("ES256", { extractable: true })).privateKey);

const baseEnv = {
  ...TEST_ENV,
  WATCHDIVE_SOCIAL_AUTH_SECRET: SECRET,
  WATCHDIVE_GOOGLE_AUTH_ENABLED: "true",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
  WATCHDIVE_APPLE_AUTH_ENABLED: "true",
  APPLE_CLIENT_ID: "com.diveroid.watchdive.web",
  APPLE_TEAM_ID: "TEAMID1234",
  APPLE_KEY_ID: "KEYID12345",
  APPLE_PRIVATE_KEY: appleKey,
};

function env(extra: Record<string, string | undefined> = {}) {
  return { ...baseEnv, ...extra };
}

async function signToken(claims: Record<string, unknown>, header: Record<string, string> = { alg: "RS256", kid: "test-key", typ: "JWT" }) {
  return new SignJWT(claims)
    .setProtectedHeader(header)
    .sign(keys.privateKey);
}

function tokenFetch(idToken: string, options: { failCode?: boolean; used?: Set<string> } = {}) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/token")) {
      const body = String(init?.body ?? "");
      if (body.includes(GOOGLE_SECRET) || body.includes("APPLE")) {
        // present only on the wire to the provider; tests assert we never echo it
      }
      if (options.failCode) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      const code = new URLSearchParams(body).get("code") ?? "";
      if (options.used?.has(code)) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      options.used?.add(code);
      return new Response(
        JSON.stringify({
          access_token: "access-token-test",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("certs") || url.includes("/auth/keys")) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}

function deps(store: FakeLeadStore, extra: Partial<SocialHttpDependencies> = {}): SocialHttpDependencies & {
  verified: number;
  submits: number;
  logs: string[];
  mailer: FakeMailer;
} {
  const mailer = new FakeMailer();
  const logs: string[] = [];
  let verified = 0;
  let submits = 0;
  const serviceDependencies = {
    store,
    mailer,
    env: extra.env ?? env(),
    now: () => NOW,
    sleep: async () => {},
    leadId: leadIdFactory(),
    dispatchVerifiedLead: async () => {
      verified += 1;
      return true;
    },
    dispatchSubmitLead: async () => {
      submits += 1;
      return true;
    },
    ...extra.serviceDependencies,
  };
  const bag = {
    env: extra.env ?? env(),
    now: () => NOW,
    serviceDependencies,
    isClosed: async () => false,
    log: (line: string) => logs.push(line),
    networkGate: createNetworkGate(),
    ...extra,
    verified,
    submits,
    logs,
    mailer,
  };
  return new Proxy(bag, {
    get(target, prop, receiver) {
      if (prop === "verified") return verified;
      if (prop === "submits") return submits;
      return Reflect.get(target, prop, receiver);
    },
  }) as SocialHttpDependencies & { verified: number; submits: number; logs: string[]; mailer: FakeMailer };
}

function startRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://watchdive.diveroid.com/api/auth/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      origin: "https://watchdive.diveroid.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function begin(
  harness: ReturnType<typeof deps>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const response = await handleSocialStart(startRequest(body, headers), harness);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const payload = JSON.parse(text) as { url: string };
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const bound = readSocialState(cookie.split("=").slice(1).join("="), SECRET, harness.env, NOW.getTime());
  assert.ok(bound);
  return { url: payload.url, cookie, bound };
}

// The OAuth validator uses the wall clock; keep provider tokens current while
// the application clock stays fixed for cohort and scheduling assertions.
function googleClaims(nonce: string, extra: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: "google-client",
    sub: "google-sub-1",
    email: "ab@gmail.com",
    email_verified: true,
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...extra,
  };
}

function appleClaims(nonce: string, extra: Record<string, unknown> = {}) {
  return {
    iss: "https://appleid.apple.com",
    aud: "com.diveroid.watchdive.web",
    sub: "apple.sub.1",
    email: "diver@icloud.com",
    email_verified: true,
    nonce,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...extra,
  };
}

async function googleCallback(
  harness: ReturnType<typeof deps>,
  cookie: string,
  state: string,
  idToken: string,
  query = "",
) {
  const transport = tokenFetch(idToken);
  const response = await handleGoogleCallback(
    new Request(
      `https://watchdive.diveroid.com/api/auth/google/callback?code=${CODE}&state=${encodeURIComponent(state)}${query}`,
      { headers: { cookie, "user-agent": UA } },
    ),
    { ...harness, fetchImpl: transport.fetchImpl },
  );
  return { response, calls: transport.calls };
}

function continuationHeader(response: Response): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-wd_social_continue="));
}

test("authorization code flow verifies a gmail identity once and repeats do not move Verified at", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en", measurementConsent: true });
  const parsed = new URL(started.url);
  assert.equal(parsed.origin, "https://accounts.google.com");
  assert.equal(parsed.searchParams.get("scope"), "openid email");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("prompt"), "select_account");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://watchdive.diveroid.com/api/auth/google/callback");
  assert.equal(started.url.includes(GOOGLE_SECRET), false);
  assert.equal(started.url.includes("https://evil.example"), false);
  const idToken = await signToken(googleClaims(started.bound.nonce));
  const first = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(first.response.status, 303);
  const location = first.response.headers.get("location") ?? "";
  assert.equal(new URL(location).searchParams.get("auth"), "confirmed");
  const cookies = first.response.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith("__Host-wd_social_ack=1;")));
  assert.ok(cookies.some((c) => c.startsWith("__Host-wd_social_state=")));
  assert.equal(location.includes(CODE), false);
  assert.equal(location.includes(idToken), false);
  assert.equal(location.includes("access-token-test"), false);
  const row = [...store.rows.values()][0];
  assert.equal(row.signupMethod, "google");
  assert.equal(row.googleSubject, "google-sub-1");
  assert.equal(row.source, "hero");
  assert.equal(row.emailVerified, true);
  assert.ok(row.verifiedAt);
  const verifiedAt = row.verifiedAt;
  const leadId = row.leadId;
  const meta = row.metaEventId;
  assert.equal(harness.verified, 1);
  assert.equal(harness.submits, 0);
  assert.equal(harness.mailer.welcomes.length, 1);
  assert.equal(row.measurementConsent, "WD-AD-MEASUREMENT-CONSENT-V1:granted");
  const receipt = cookies.find((cookie) => cookie.startsWith("wd_rt="));
  assert.ok(receipt, "the first confirmed finish carries the browser receipt");
  assert.equal(receipt.includes("@"), false);
  assert.equal(/[a-f0-9]{64}/.test(location), false);
  const events = readRetargetingReceipt(receipt.split(";")[0]);
  assert.deepEqual(events?.map((event) => event.eventName).sort(), ["CompleteRegistration", "Lead"]);
  assert.notEqual(events?.[0].eventId, events?.[1].eventId);

  const again = await begin(harness, { provider: "google", source: "offer", locale: "ko", measurementConsent: true });
  const secondToken = await signToken(googleClaims(again.bound.nonce, { email: "a.b+tag@gmail.com" }));
  const second = await googleCallback(harness, again.cookie, again.bound.state, secondToken);
  assert.equal(new URL(second.response.headers.get("location") ?? "").searchParams.get("auth"), "confirmed");
  assert.equal(store.markVerifiedCalls, 1);
  assert.equal(store.rows.size, 1);
  assert.equal(row.verifiedAt, verifiedAt);
  assert.equal(row.leadId, leadId);
  assert.equal(row.metaEventId, meta);
  assert.equal(row.signupMethod, "google");
  assert.equal(row.source, "hero");
  assert.equal(harness.verified, 1);
  assert.equal(harness.mailer.welcomes.length, 1);
  assert.equal(second.response.headers.getSetCookie().some((cookie) => cookie.startsWith("wd_rt=")), false);
});

test("tampered, wrong audience, wrong issuer, and expired tokens write nothing", async () => {
  resetSocialStateForTests();
  for (const mutate of [
    async (nonce: string) => {
      const token = await signToken(googleClaims(nonce));
      const index = token.lastIndexOf(".") + 2;
      const flipped = token[index] === "a" ? "b" : "a";
      return `${token.slice(0, index)}${flipped}${token.slice(index + 1)}`;
    },
    (nonce: string) => signToken(googleClaims(nonce, { aud: "other-client" })),
    (nonce: string) => signToken(googleClaims(nonce, { iss: "https://evil.example" })),
    (nonce: string) => signToken(googleClaims(nonce, { exp: Math.floor(Date.now() / 1000) - 3600 })),
  ]) {
    const store = new FakeLeadStore();
    const harness = deps(store);
    const started = await begin(harness, { provider: "google", source: "hero", locale: "en" });
    const idToken = await mutate(started.bound.nonce);
    const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
    assert.equal(new URL(result.response.headers.get("location") ?? "").searchParams.get("auth"), "error");
    assert.equal(store.rows.size, 0);
    assert.equal(store.markVerifiedCalls, 0);
    assert.deepEqual(harness.logs, ["social_token_rejected"]);
    assert.equal(harness.logs.join(" ").includes(idToken), false);
    assert.equal(harness.logs.join(" ").includes(GOOGLE_SECRET), false);
  }
});

test("state mismatch, reused jti, and reused code write nothing", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en", next: "https://evil.example" });
  assert.equal(started.url.includes("evil.example"), false);
  const idToken = await signToken(googleClaims(started.bound.nonce));
  const mismatch = await handleGoogleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/google/callback?code=abc&state=https%3A%2F%2Fevil.example&next=https%3A%2F%2Fevil.example", {
      headers: { cookie: started.cookie, "user-agent": UA },
    }),
    harness,
  );
  const mismatchLocation = mismatch.headers.get("location") ?? "";
  assert.equal(new URL(mismatchLocation).origin, "https://watchdive.diveroid.com");
  assert.equal(mismatchLocation.includes("evil.example"), false);
  assert.equal(store.rows.size, 0);

  const used = new Set<string>();
  const transport = tokenFetch(idToken, { used });
  const ok = await handleGoogleCallback(
    new Request(`https://watchdive.diveroid.com/api/auth/google/callback?code=${CODE}&state=${started.bound.state}`, {
      headers: { cookie: started.cookie, "user-agent": UA },
    }),
    { ...harness, fetchImpl: transport.fetchImpl },
  );
  assert.equal(new URL(ok.headers.get("location") ?? "").searchParams.get("auth"), "confirmed");
  const replay = await handleGoogleCallback(
    new Request(`https://watchdive.diveroid.com/api/auth/google/callback?code=${CODE}&state=${started.bound.state}`, {
      headers: { cookie: started.cookie, "user-agent": UA },
    }),
    { ...harness, fetchImpl: transport.fetchImpl },
  );
  assert.equal(new URL(replay.headers.get("location") ?? "").searchParams.get("auth"), "error");
  assert.equal(store.markVerifiedCalls, 1);

  const fresh = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  const again = tokenFetch(await signToken(googleClaims(fresh.bound.nonce, { sub: "google-sub-2", email: "other@gmail.com" })), { used });
  const reused = await handleGoogleCallback(
    new Request(`https://watchdive.diveroid.com/api/auth/google/callback?code=${CODE}&state=${fresh.bound.state}`, {
      headers: { cookie: fresh.cookie, "user-agent": UA },
    }),
    { ...harness, fetchImpl: again.fetchImpl },
  );
  assert.equal(new URL(reused.headers.get("location") ?? "").searchParams.get("auth"), "error");
  assert.equal([...store.rows.values()].some((row) => row.googleSubject === "google-sub-2"), false);
});

test("unverified google email is not stored or linked", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  let lookups = 0;
  const original = store.findByEmail.bind(store);
  store.findByEmail = async (canonical, email) => {
    lookups += 1;
    return original(canonical, email);
  };
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  const idToken = await signToken(googleClaims(started.bound.nonce, { email_verified: false, email: "person@gmail.com" }));
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(result.response.headers.get("location") ?? "").searchParams.get("auth"), "error");
  assert.equal(store.rows.size, 0);
  assert.equal(lookups, 0);
  assert.equal(harness.mailer.sent.length, 0);
});

test("external google email uses confirmation mail and does not set Verified at", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, {
    provider: "google",
    source: "offer",
    locale: "fr",
    measurementConsent: false,
    attribution: { landingPath: "/", utmSource: "meta" },
  });
  const idToken = await signToken(
    googleClaims(started.bound.nonce, { email: "diver@example.com", hd: "other.example" }),
  );
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(result.response.headers.get("location") ?? "").searchParams.get("auth"), "check-email");
  const row = [...store.rows.values()][0];
  assert.equal(row.emailVerified, false);
  assert.equal(row.verifiedAt, undefined);
  assert.match(continuationHeader(result.response) ?? "", /Max-Age=0/);
  assert.equal(row.signupMethod, "google");
  assert.equal(row.authVerificationProvenance, "google:external-email");
  assert.equal(row.source, "offer");
  assert.equal(row.signupLocale, "fr");
  assert.equal(harness.mailer.sent.length, 1);
  assert.equal(harness.verified, 0);
  assert.equal(store.markVerifiedCalls, 0);
});

test("external google does not bind a subject onto an existing verified email", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const stamp = "2026-10-18T23:21:38.838031Z";
  const row = store.seed({
    email: "diver@example.com",
    canonical: "diver@example.com",
    status: "verified",
    emailVerified: true,
    verifiedAt: stamp,
    source: "hero",
    signupMethod: "email",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
    signedUpAt: "2026-10-18T00:00:00.000Z",
  });
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  const idToken = await signToken(
    googleClaims(started.bound.nonce, { email: "diver@example.com", sub: "external-sub", hd: undefined }),
  );
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(result.response.headers.get("location") ?? "").searchParams.get("auth"), "confirmed");
  assert.equal(row.googleSubject, undefined);
  assert.match(continuationHeader(result.response) ?? "", /Max-Age=0/);
  assert.equal(row.verifiedAt, stamp);
  assert.equal(row.signupMethod, "email");
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal(harness.mailer.sent.length, 0);
  assert.equal(store.rows.size, 1);
});

test("an unsubscribed apple subject is not recreated under a new email", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const row = store.seed({
    email: "old@privaterelay.appleid.com",
    canonical: "old@privaterelay.appleid.com",
    status: "unsubscribed",
    appleSubject: "apple.unsub.1",
    source: "hero",
    signupMethod: "apple",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000003",
    signedUpAt: "2026-10-18T00:00:00.000Z",
  });
  const harness = deps(store);
  const started = await begin(harness, { provider: "apple", source: "hero", locale: "en" });
  const idToken = await signToken(
    appleClaims(started.bound.nonce, {
      email: "new@privaterelay.appleid.com",
      is_private_email: true,
      sub: "apple.unsub.1",
    }),
  );
  const response = await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "unsub-code", state: started.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(idToken).fetchImpl },
  );
  assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("auth"), "error");
  assert.equal(store.rows.size, 1);
  assert.equal(row.status, "unsubscribed");
  assert.equal(row.email, "old@privaterelay.appleid.com");
  assert.equal(store.markVerifiedCalls, 0);
});

test("matching workspace hd verifies once", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en", measurementConsent: true });
  const idToken = await signToken(
    googleClaims(started.bound.nonce, { email: "a@oceanwick.ai", hd: "oceanwick.ai", sub: "hd-sub" }),
  );
  await googleCallback(harness, started.cookie, started.bound.state, idToken);
  const row = [...store.rows.values()][0];
  assert.equal(row.authVerificationProvenance, "google:workspace-hd");
  assert.equal(row.emailVerified, true);
  const stamp = row.verifiedAt;
  const repeat = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  const again = await signToken(googleClaims(repeat.bound.nonce, { email: "a@oceanwick.ai", hd: "oceanwick.ai", sub: "hd-sub" }));
  await googleCallback(harness, repeat.cookie, repeat.bound.state, again);
  assert.equal(row.verifiedAt, stamp);
  assert.equal(store.markVerifiedCalls, 1);
});

test("apple form_post accepts a relay address and does not verify it until the ready flag", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "apple", source: "hero", locale: "ja" });
  const authorize = new URL(started.url);
  assert.equal(authorize.origin, "https://appleid.apple.com");
  assert.equal(authorize.searchParams.get("response_type"), "code id_token");
  assert.equal(authorize.searchParams.get("response_mode"), "form_post");
  assert.equal(authorize.searchParams.get("scope"), "name email");
  const idToken = await signToken(
    appleClaims(started.bound.nonce, {
      email: "hide@privaterelay.appleid.com",
      is_private_email: "true",
    }),
  );
  const response = await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: CODE,
        state: started.bound.state,
        user: JSON.stringify({ email: "attacker@example.com", name: { firstName: "Hidden" } }),
        id_token: idToken,
      }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(idToken).fetchImpl },
  );
  assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("auth"), "pending");
  const row = [...store.rows.values()][0];
  assert.equal(row.email, "hide@privaterelay.appleid.com");
  assert.equal(row.emailVerified, false);
  assert.equal(row.verifiedAt, undefined);
  assert.equal(row.authVerificationProvenance, "apple:private-relay");
  assert.equal(row.signupLocale, "ja");
  assert.match(continuationHeader(response) ?? "", /Max-Age=0/);
  assert.equal(harness.mailer.sent.length, 0);
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal(JSON.stringify(row).includes("Hidden"), false);
});

test("a relay verifies only when the ready flag is exactly true", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store, { env: env({ WATCHDIVE_APPLE_RELAY_MAIL_READY: "true" }) });
  const started = await begin(harness, { provider: "apple", source: "offer", locale: "en" });
  const idToken = await signToken(
    appleClaims(started.bound.nonce, { email: "hide@private.icloud.com", is_private_email: true, sub: "relay-ready" }),
  );
  await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "relay-code", state: started.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(idToken).fetchImpl },
  );
  const row = [...store.rows.values()][0];
  assert.equal(row.emailVerified, true);
  assert.ok(row.verifiedAt);
});

for (const failure of ["missing", "timeout"] as const) {
  test(`Apple callback does not confirm a pending row when final verification reread is ${failure}`, async () => {
    resetSocialStateForTests();
    const store = new FakeLeadStore();
    const originalReread = store.reread.bind(store);
    let rereads = 0;
    store.reread = async (pageId: string) => {
      rereads += 1;
      // The created row is present for settlement, then the final pre-write
      // verification read fails. No verified state has ever been observed.
      if (rereads === 2) {
        if (failure === "timeout") throw new Error("simulated Notion timeout");
        return undefined;
      }
      return originalReread(pageId);
    };
    const harness = deps(store, { env: env({ WATCHDIVE_APPLE_RELAY_MAIL_READY: "true" }) });
    const started = await begin(harness, { provider: "apple", source: "hero", locale: "zh-TW" });
    const idToken = await signToken(appleClaims(started.bound.nonce, {
      email: "pending@privaterelay.appleid.com",
      is_private_email: true,
      sub: `relay-reread-${failure}`,
    }));
    const response = await handleAppleCallback(new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: `relay-${failure}`, state: started.bound.state }).toString(),
    }), { ...harness, fetchImpl: tokenFetch(idToken).fetchImpl });
    assert.ok(rereads >= 2);
    const destination = new URL(response.headers.get("location")!);
    assert.equal(destination.searchParams.get("auth"), "error");
    const row = [...store.rows.values()][0];
    assert.equal(row.status, "pending");
    assert.equal(row.emailVerified, false);
    assert.equal(row.verifiedAt, undefined);
    assert.equal(store.markVerifiedCalls, 0);
    assert.equal(harness.verified, 0);
    assert.equal(harness.mailer.sent.length, 0);
  });
}

test("bare icloud.com is not a relay and a later login without email writes nothing", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "apple", source: "hero", locale: "en" });
  const firstToken = await signToken(appleClaims(started.bound.nonce));
  await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "apple-code-1", state: started.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(firstToken).fetchImpl },
  );
  const row = [...store.rows.values()][0];
  assert.equal(row.emailVerified, true);
  const stamp = row.verifiedAt;
  const leadId = row.leadId;
  const meta = row.metaEventId;
  const second = await begin(harness, { provider: "apple", source: "offer", locale: "de" });
  const noEmail = await signToken(appleClaims(second.bound.nonce, { email: undefined }));
  const before = store.markVerifiedCalls;
  const response = await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: second.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "apple-code-2", state: second.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(noEmail).fetchImpl },
  );
  assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("auth"), "confirmed");
  assert.equal(store.markVerifiedCalls, before);
  assert.equal(row.verifiedAt, stamp);
  assert.equal(row.leadId, leadId);
  assert.equal(row.metaEventId, meta);
  assert.equal(row.source, "hero");
  assert.equal(row.signupMethod, "apple");
  assert.equal(store.rows.size, 1);
});

test("a different apple sub with the same relay address does not attach", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "apple", source: "hero", locale: "en" });
  const firstToken = await signToken(
    appleClaims(started.bound.nonce, { email: "same@privaterelay.appleid.com", is_private_email: true, sub: "relay.sub.a" }),
  );
  await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "relay-a", state: started.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(firstToken).fetchImpl },
  );
  const other = await begin(harness, { provider: "apple", source: "hero", locale: "en" });
  const secondToken = await signToken(
    appleClaims(other.bound.nonce, { email: "same@privaterelay.appleid.com", is_private_email: true, sub: "relay.sub.b" }),
  );
  const response = await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: other.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "relay-b", state: other.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(secondToken).fetchImpl },
  );
  assert.equal(new URL(response.headers.get("location") ?? "").searchParams.get("auth"), "error");
  const row = [...store.rows.values()][0];
  assert.equal(row.appleSubject, "relay.sub.a");
  assert.equal(store.rows.size, 1);
  assert.equal(row.emailVerified, false);
});

test("an already verified email keeps its timestamp when another provider repeats", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const stamp = "2026-10-18T23:21:38.838031Z";
  const row = store.seed({
    email: "ab@gmail.com",
    canonical: "ab@gmail.com",
    status: "verified",
    emailVerified: true,
    verifiedAt: stamp,
    source: "hero",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    metaEventId: "meta-existing",
    signupMethod: "email",
    measurementConsent: "WD-AD-MEASUREMENT-CONSENT-V1:withheld",
    signedUpAt: "2026-10-18T00:00:00.000Z",
  });
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "offer", locale: "ko", measurementConsent: true });
  const idToken = await signToken(googleClaims(started.bound.nonce));
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(result.response.headers.get("location") ?? "").searchParams.get("auth"), "confirmed");
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal(store.startAttemptCalls, 0);
  assert.equal(row.verifiedAt, stamp);
  assert.equal(row.leadId, "aaaaaaaa-bbbb-4ccc-8ddd-000000000001");
  assert.equal(row.metaEventId, "meta-existing");
  assert.equal(row.source, "hero");
  assert.equal(row.signupMethod, "email");
  assert.equal(row.measurementConsent, "WD-AD-MEASUREMENT-CONSENT-V1:withheld");
  assert.equal(row.googleSubject, "google-sub-1");
  assert.equal(harness.verified, 0);
  assert.equal(harness.mailer.sent.length, 0);
  assert.equal(harness.mailer.welcomes.length, 0);
  assert.equal(
    delaySkipReason({ verifiedAt: row.verifiedAt }, { nowMs: CUTOFF + 180_000, notBeforeMs: CUTOFF }),
    undefined,
  );
  assert.equal(
    delaySkipReason(
      { verifiedAt: "2026-10-18T23:21:38.837Z" },
      { nowMs: CUTOFF + 180_000, notBeforeMs: CUTOFF },
    ),
    "before_cutoff",
  );

  const apple = await begin(harness, { provider: "apple", source: "offer", locale: "en" });
  const appleToken = await signToken(appleClaims(apple.bound.nonce, { email: "ab@gmail.com", sub: "apple.other" }));
  await handleAppleCallback(
    new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
      method: "POST",
      headers: { cookie: apple.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: "apple-cross", state: apple.bound.state }).toString(),
    }),
    { ...harness, fetchImpl: tokenFetch(appleToken).fetchImpl },
  );
  assert.equal(row.appleSubject, "apple.other");
  assert.equal(row.googleSubject, "google-sub-1");
  assert.equal(row.signupMethod, "email");
  assert.equal(row.verifiedAt, stamp);
  assert.equal(store.rows.size, 1);
  assert.equal(store.markVerifiedCalls, 0);
});

test("withheld measurement and GPC send no lead", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en", measurementConsent: false });
  const idToken = await signToken(googleClaims(started.bound.nonce, { sub: "withheld-sub", email: "withheld@gmail.com" }));
  await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal([...store.rows.values()][0].measurementConsent, "WD-AD-MEASUREMENT-CONSENT-V1:withheld");
  assert.equal(harness.verified, 0);
  assert.equal(harness.submits, 0);

  const gpcStore = new FakeLeadStore();
  const gpc = deps(gpcStore);
  const gpcStart = await begin(
    gpc,
    { provider: "google", source: "hero", locale: "en", measurementConsent: true },
    { "sec-gpc": "1" },
  );
  const gpcToken = await signToken(googleClaims(gpcStart.bound.nonce, { sub: "gpc-sub", email: "gpc@gmail.com" }));
  await googleCallback(gpc, gpcStart.cookie, gpcStart.bound.state, gpcToken);
  assert.equal([...gpcStore.rows.values()][0].measurementConsent, "WD-AD-MEASUREMENT-CONSENT-V1:withheld");
  assert.equal(gpc.verified, 0);
});

test("trusted country, locale, and experiment are kept from the start request", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store, { env: env({ VERCEL: "1" }) });
  const experiment = {
    experimentId: EXPERIMENT_ID,
    variant: "form_first",
    sessionId: "11111111-1111-4111-8111-111111111111",
    assignedAt: NOW.getTime(),
    team: "organic",
    qa: false,
  };
  const started = await begin(
    harness,
    {
      provider: "google",
      source: "offer",
      locale: "ko",
      measurementConsent: true,
      attribution: { landingPath: "/ko", utmSource: "meta" },
      experiment,
    },
    { "x-vercel-ip-country": "KR" },
  );
  const idToken = await signToken(googleClaims(started.bound.nonce, { sub: "kr-sub", email: "kr@gmail.com" }));
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(result.response.headers.get("location") ?? "").pathname, "/ko");
  const row = [...store.rows.values()][0];
  assert.equal(row.signupCountry, "KR");
  assert.equal(row.signupLocale, "ko");
  assert.equal(row.source, "offer");
  assert.equal(store.createPendingInputs[0]?.experiment?.variant, "form_first");
  assert.equal(store.createPendingInputs[0]?.attribution?.landingPath, "/ko");
});

test("instagram does not send the browser to Google", async () => {
  resetSocialStateForTests();
  const harness = deps(new FakeLeadStore());
  const response = await handleSocialStart(
    startRequest(
      { provider: "google", source: "hero", locale: "en" },
      { "user-agent": "Mozilla/5.0 Instagram 300.0.0.0.0" },
    ),
    harness,
  );
  const text = await response.text();
  assert.equal(response.status, 409);
  assert.equal(text.includes("accounts.google.com"), false);
  assert.equal(JSON.parse(text).error, "in_app_browser");
  const apple = await handleSocialStart(
    startRequest(
      { provider: "apple", source: "hero", locale: "en" },
      { "user-agent": "Mozilla/5.0 Instagram 300.0.0.0.0" },
    ),
    harness,
  );
  assert.equal(apple.status, 200);
  assert.equal((await apple.json()).url.includes("appleid.apple.com"), true);
  for (const agent of [
    "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 KAKAOTALK 10.5.0",
    "Mozilla/5.0 FB4A",
    "Mozilla/5.0 FBIOS",
  ]) {
    const blocked = await handleSocialStart(
      startRequest({ provider: "google", source: "hero", locale: "en" }, { "user-agent": agent }),
      harness,
    );
    assert.equal(blocked.status, 409, agent);
    assert.equal((await blocked.text()).includes("accounts.google.com"), false, agent);
  }
});

test("the largest accepted attribution still issues a readable host cookie", async () => {
  resetSocialStateForTests();
  const harness = deps(new FakeLeadStore());
  const value = "a".repeat(200);
  const click = "b".repeat(255);
  const started = await begin(harness, {
    provider: "google",
    source: "hero",
    locale: "en",
    attribution: {
      utmSource: value,
      utmMedium: value,
      utmCampaign: value,
      utmContent: value,
      utmTerm: value,
      landingPath: `/${"p".repeat(180)}`,
      fbclid: click,
      gclid: click,
      gbraid: click,
      wbraid: click,
      ttclid: click,
      capturedAt: NOW.getTime(),
    },
  });
  assert.equal(started.cookie.startsWith("__Host-wd_social_state="), true);
  assert.equal(started.bound.attribution.utmSource?.length, 200);
  const header = issueSocialStateCookie(started.cookie.slice("__Host-wd_social_state=".length));
  assert.ok(header);
  assert.equal(header.includes("Path=/"), true);
  assert.equal(header.includes("Domain="), false);
  assert.equal(header.includes("Secure"), true);
  const huge = newSocialState(
    {
      provider: "google",
      source: "hero",
      locale: "en",
      origin: "https://watchdive.diveroid.com",
      attribution: { utmSource: "x".repeat(8000) },
      measurementConsent: false,
      country: { trustedVercel: false, header: null },
    },
    NOW.getTime(),
  );
  assert.equal(issueSocialStateCookie(signSocialState(huge, SECRET)), undefined);
});

test("a duplicate state cookie and an unlisted loopback origin are rejected", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  const idToken = await signToken(googleClaims(started.bound.nonce, { sub: "dup-sub", email: "dup@gmail.com" }));
  const doubled = await googleCallback(harness, `${started.cookie}; ${started.cookie}`, started.bound.state, idToken);
  assert.equal(doubled.response.status, 400);
  assert.equal(store.rows.size, 0);
  const loopback = await handleSocialStart(
    new Request("http://127.0.0.1:3000/api/auth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ provider: "google", source: "hero", locale: "en" }),
    }),
    harness,
  );
  assert.equal(loopback.status, 400);
  assert.equal(loopback.headers.get("set-cookie"), null);
  const listed = await handleSocialStart(
    new Request("http://127.0.0.1:3000/api/auth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ provider: "google", source: "hero", locale: "en" }),
    }),
    deps(new FakeLeadStore(), { env: env({ WATCHDIVE_SOCIAL_CALLBACK_ORIGINS: "http://127.0.0.1:3000" }) }),
  );
  assert.equal(listed.status, 200);
  assert.equal((listed.headers.get("set-cookie") ?? "").startsWith("__Host-wd_social_state="), true);
});

test("start rejects a cross-site post before it sets a state cookie", async () => {
  resetSocialStateForTests();
  const harness = deps(new FakeLeadStore());
  const crossed = await handleSocialStart(
    startRequest(
      { provider: "google", source: "hero", locale: "en" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    ),
    harness,
  );
  assert.equal(crossed.status, 400);
  assert.equal(crossed.headers.get("set-cookie"), null);
  const missingOrigin = await handleSocialStart(
    new Request("https://watchdive.diveroid.com/api/auth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ provider: "google", source: "hero", locale: "en" }),
    }),
    harness,
  );
  assert.equal(missingOrigin.status, 400);
  assert.equal(missingOrigin.headers.get("set-cookie"), null);
});

test("provider flags fail closed unless the exact string true", async () => {
  const off = await handleSocialProviders(
    new Request("https://watchdive.diveroid.com/api/auth/providers"),
    { env: env({ WATCHDIVE_GOOGLE_AUTH_ENABLED: "TRUE", WATCHDIVE_APPLE_AUTH_ENABLED: "1" }) },
  );
  assert.deepEqual(await off.json(), { google: false, apple: false });
  for (const locale of SUPPORTED_LOCALES) {
    const copy = socialSignupCopy[locale];
    assert.equal(copy.google.includes("Google"), true);
    assert.equal(copy.apple.includes("Apple"), true);
    assert.equal(copy.embedded.body.length > 10, true);
    const shown = socialSignupRenderModel(
      { locale, enabledProviders: { google: true, apple: true } },
      classifyEmbeddedBrowser(UA),
    );
    assert.equal(shown.items.length, 2);
    const hidden = socialSignupRenderModel(
      { locale, enabledProviders: { google: false, apple: false } },
      classifyEmbeddedBrowser(UA),
    );
    assert.equal(hidden.items.length, 0);
  }
});

test("email signup sets method on new rows and a repeat does not replace it", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const dependencies = { store, mailer, env: TEST_ENV, now: () => NOW, sleep: async () => {} };
  await requestVerificationService(
    {
      email: "new@example.com",
      canonical: "new@example.com",
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: false,
      networkSendBlocked: false,
      locale: "en",
    },
    dependencies,
  );
  assert.equal(store.createPendingInputs[0]?.signupMethod, "email");
  assert.equal(store.createPendingInputs[0]?.authVerificationProvenance, "email:double-opt-in");
  store.seed({
    email: "old@example.com",
    canonical: "old@example.com",
    status: "pending",
    sends: 1,
    sentAt: "2026-10-19T11:00:00.000Z",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000009",
    signupMethod: "email",
  });
  const before = store.createPendingInputs.length;
  await requestVerificationService(
    {
      email: "old@example.com",
      canonical: "old@example.com",
      source: "offer",
      flags: [],
      suspect: false,
      measurementConsent: false,
      networkSendBlocked: false,
    },
    dependencies,
  );
  assert.equal(store.createPendingInputs.length, before);
  assert.equal(store.startAttemptCalls >= 1, true);
  assert.equal([...store.rows.values()].find((row) => row.email === "old@example.com")?.signupMethod, "email");
});

test("a missing signup method column is dropped and a missing subject column is not", async () => {
  const bodies: Record<string, unknown>[] = [];
  const request: NotionRequest = async (_method, path, body) => {
    const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
    if (path === "pages") bodies.push(properties);
    if (properties["Signup method"]) {
      throw new NotionRequestError(400, JSON.stringify({ code: "validation_error", message: "Signup method is not a property that exists." }));
    }
    return { id: "page-1", properties: { Email: { title: [{ plain_text: "a@gmail.com" }] } } };
  };
  await createNotionLeadStore(request, "db").createPending({
    email: "a@gmail.com",
    canonical: "a@gmail.com",
    source: "hero",
    refCode: "abcd1234",
    flags: [],
    suspect: false,
    signedUpAt: NOW.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000010",
    expiresAt: NOW.toISOString(),
    signupMethod: "google",
    googleSubject: "sub-1",
    authVerificationProvenance: "google:gmail",
    signupLocale: "en",
  });
  assert.equal(bodies.length, 2);
  assert.equal("Signup method" in bodies[0], true);
  assert.equal("Google subject" in bodies[0], true);
  assert.equal("Signup method" in bodies[1], false);
  assert.equal("Google subject" in bodies[1], true);

  let posts = 0;
  const failing: NotionRequest = async (_method, path, body) => {
    if (path === "pages") posts += 1;
    const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
    if (properties["Google subject"]) {
      throw new NotionRequestError(400, JSON.stringify({ code: "validation_error", message: "Google subject is not a property that exists." }));
    }
    return { id: "page-2", properties: {} };
  };
  await assert.rejects(
    () =>
      createNotionLeadStore(failing, "db").createPending({
        email: "b@gmail.com",
        canonical: "b@gmail.com",
        source: "hero",
        refCode: "abcd1234",
        flags: [],
        suspect: false,
        signedUpAt: NOW.toISOString(),
        leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000011",
        expiresAt: NOW.toISOString(),
        signupMethod: "google",
        googleSubject: "sub-2",
        requireProviderSubject: true,
      }),
    SocialAuthSchemaError,
  );
  assert.equal(posts, 1);
});

test("schema plan skips a correct signup method and refuses a wrong type and --apply", () => {
  const ready = planSocialSignupNotionSchema({
    properties: {
      "Signup method": { type: "select", select: { options: [{ name: "email" }, { name: "google" }, { name: "apple" }] } },
      "Google subject": { type: "rich_text" },
      "Apple subject": { type: "rich_text" },
      "Auth verification provenance": { type: "rich_text" },
      "Signup locale": { type: "rich_text" },
    },
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.patch, null);
  assert.equal(ready.actions.every((action) => action.op === "skip"), true);

  const partial = planSocialSignupNotionSchema({
    properties: {
      "Signup method": { type: "select", select: { options: [{ name: "qa-slack", color: "gray" }, { name: "email" }] } },
    },
  });
  const method = partial.patch?.properties["Signup method"] as { select: { options: { name: string }[] } };
  assert.deepEqual(method.select.options.map((option) => option.name), ["qa-slack", "email", "google", "apple"]);

  const conflict = planSocialSignupNotionSchema({
    properties: { "Google subject": { type: "number" } },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflicts.some((item) => item.name === "Google subject"), true);
});

test("the schema script refuses --apply and never patches", async () => {
  const refused = await runSocialSignupNotionSchema({ args: ["--apply"], env: { NOTION_API_KEY: "secret", NOTION_WAITLIST_DB_ID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } });
  assert.equal(refused.exitCode, 2);
  assert.equal(refused.report.error, "refused_apply");
  let patched = false;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "PATCH") patched = true;
    return new Response(JSON.stringify({ properties: { "Google subject": { type: "title" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const conflict = await runSocialSignupNotionSchema({
    args: ["--dry-run"],
    env: { NOTION_API_KEY: "secret", NOTION_WAITLIST_DB_ID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    fetchImpl,
  });
  assert.equal(conflict.exitCode, 2);
  assert.equal(patched, false);
});

test("two overlapping creates verify only the earliest page", async () => {
  resetSocialStateForTests();
  const fake = new FakeLeadStore();
  let decided = 0;
  let created = 0;
  let releaseDecided: () => void = () => {};
  let releaseCreated: () => void = () => {};
  const bothDecided = new Promise<void>((resolve) => {
    releaseDecided = resolve;
  });
  const bothCreated = new Promise<void>((resolve) => {
    releaseCreated = resolve;
  });
  const store = new Proxy(fake, {
    get(target, prop, receiver) {
      if (prop === "createPending") {
        return async (input: Parameters<FakeLeadStore["createPending"]>[0]) => {
          decided += 1;
          if (decided >= 2) releaseDecided();
          else await bothDecided;
          const row = await target.createPending(input);
          created += 1;
          if (created >= 2) releaseCreated();
          else await bothCreated;
          return row;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const harness = deps(store as unknown as FakeLeadStore);
  const first = await begin(harness, { provider: "google", source: "hero", locale: "en", measurementConsent: true });
  const second = await begin(harness, { provider: "google", source: "hero", locale: "en", measurementConsent: true });
  const firstToken = await signToken(googleClaims(first.bound.nonce, { sub: "race-sub", email: "race@gmail.com" }));
  const secondToken = await signToken(googleClaims(second.bound.nonce, { sub: "race-sub", email: "race@gmail.com" }));
  await Promise.race([
    Promise.all([
      googleCallback(harness, first.cookie, first.bound.state, firstToken),
      googleCallback(harness, second.cookie, second.bound.state, secondToken),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("race hung")), 2000)),
  ]);
  const rows = [...fake.rows.values()];
  assert.equal(rows.length, 2);
  const verified = rows.filter((row) => row.verifiedAt);
  const losers = rows.filter((row) => row.duplicate);
  assert.equal(verified.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0]?.emailVerified, false);
  assert.equal(losers[0]?.verifiedAt, undefined);
  assert.equal(fake.markVerifiedCalls, 1);
  assert.equal(harness.verified, 1);
});

test("social handlers do not mint reservation invites", () => {
  const root = new URL("../src/lib/socialAuth/", import.meta.url);
  const sources = ["http.ts", "complete.ts", "oidc.ts"].map((name) => readFileSync(new URL(name, root), "utf8")).join("\n");
  for (const name of ["issueReservationInvite", "loadReservationState", "startReservationCheckout"]) {
    assert.equal(sources.includes(name), false);
  }
  assert.equal(classifyProviderClaims("apple", { sub: "abc", email: "a@icloud.com", email_verified: true }).ok, true);
  const relay = classifyProviderClaims("apple", {
    sub: "abc",
    email: "a@private.icloud.com",
    email_verified: "true",
    is_private_email: "true",
  });
  assert.equal(relay.ok && relay.identity.relay, true);
});

test("apple client secret is a short ES256 JWT and a non-PKCS8 key fails", async () => {
  const secret = await appleClientSecret(env());
  const header = decodeJwt(secret);
  assert.equal(typeof header.sub, "string");
  const protectedHeader = JSON.parse(Buffer.from(secret.split(".")[0], "base64url").toString("utf8")) as { alg: string; kid: string };
  assert.equal(protectedHeader.alg, "ES256");
  assert.equal(protectedHeader.kid, "KEYID12345");
  await assert.rejects(() => appleClientSecret(env({ APPLE_PRIVATE_KEY: "not a key" })), /apple_key_shape/);
  const imported = await importPKCS8(appleKey, "ES256");
  assert.equal(imported.type, "private");
  assert.equal(createHash("sha256").update(GOOGLE_SECRET).digest("hex").length, 64);
});


// Audience returns use fake stores, mailers, token exchanges and signing keys only.
for (const provider of ["google", "apple"] as const) {
  test(`${provider} signed audience context returns to all locale routes and both signup anchors`, async () => {
    resetSocialStateForTests();
    for (const segment of ["freediving", "scuba"] as const) {
      for (const locale of SUPPORTED_LOCALES) {
        for (const source of ["hero", "offer"] as const) {
          const store = new FakeLeadStore();
          const harness = deps(store);
          const attribution = { landingPath: segmentPath(segment, locale), utmSource: "meta", utmCampaign: "segment-offline-fixture", utmContent: "video" };
          const started = await begin(harness, { provider, source, locale, segment, attribution, next: "https://evil.example" });
          assert.equal(started.bound.segment, segment);
          assert.equal(started.bound.source, source);
          assert.deepEqual(started.bound.attribution, attribution);
          assert.equal(new URL(started.url).searchParams.get("redirect_uri"), `https://watchdive.diveroid.com/api/auth/${provider}/callback`);
          const idToken = await signToken(provider === "google" ? googleClaims(started.bound.nonce) : appleClaims(started.bound.nonce));
          const response = provider === "google"
            ? (await googleCallback(harness, started.cookie, started.bound.state, idToken, "&segment=scuba&next=https://evil.example")).response
            : await handleAppleCallback(new Request("https://watchdive.diveroid.com/api/auth/apple/callback", {
                method: "POST",
                headers: { cookie: started.cookie, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ code: CODE, state: started.bound.state, segment: "scuba", next: "https://evil.example" }).toString(),
              }), { ...harness, fetchImpl: tokenFetch(idToken).fetchImpl });
          assert.equal(response.status, 303);
          const target = new URL(response.headers.get("location")!);
          assert.equal(target.origin, "https://watchdive.diveroid.com");
          assert.equal(target.pathname, segmentPath(segment, locale));
          assert.equal(target.search, "?auth=confirmed");
          assert.equal(target.hash, source === "hero" ? "#signup-middle" : "#signup-bottom");
          assert.equal([...store.rows.values()][0]?.source, source);
          for (const [key, value] of Object.entries(attribution)) {
            assert.equal(store.createPendingInputs[0]?.attribution?.[key as keyof typeof attribution], value);
          }
          assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-wd_social_ack=1;")));
          const grant = continuationHeader(response);
          assert.ok(grant);
          assert.match(grant, /HttpOnly/);
          assert.match(grant, /Secure/);
          assert.match(grant, /SameSite=Lax/);
          assert.match(grant, /Path=\//);
          assert.match(grant, /Max-Age=600/);
          assert.doesNotMatch(grant, /Domain=/i);
          assert.equal(grant.includes("@"), false);
          const grantValue = grant.split(";")[0].slice("__Host-wd_social_continue=".length);
          assert.equal(target.toString().includes(grantValue), false);
          assert.equal([...store.rows.values()][0]?.signupLocale, locale);
        }
      }
    }
  });
}

test("malformed audience context is rejected at start and signed-state read", async () => {
  const harness = deps(new FakeLeadStore());
  const started = await begin(harness, { provider: "google", source: "hero", locale: "en" });
  assert.equal(started.bound.segment, undefined);
  for (const segment of [null, "", "SCUBA", "scuba/", "/scuba", "//evil.example", "https://evil.example", "scuba?next=evil", "freediving#token", {}, ["scuba"], 1]) {
    const response = await handleSocialStart(startRequest({ provider: "google", source: "hero", locale: "en", segment }), harness);
    assert.equal(response.status, 400, JSON.stringify(segment));
    assert.equal(response.headers.get("set-cookie"), null);
    const signed = signSocialState({ ...started.bound, segment } as unknown as Parameters<typeof signSocialState>[0], SECRET);
    assert.equal(readSocialState(signed, SECRET, harness.env, NOW.getTime()), undefined);
  }
});

test("audience errors and open-browser results return to signed context and replay grants nothing", async () => {
  resetSocialStateForTests();
  for (const error of ["access_denied", "disallowed_useragent"]) {
    const store = new FakeLeadStore();
    const harness = deps(store);
    const started = await begin(harness, { provider: "google", source: "offer", locale: "ko", segment: "freediving" });
    const request = () => new Request(`https://watchdive.diveroid.com/api/auth/google/callback?state=${started.bound.state}&error=${error}&segment=scuba`, { headers: { cookie: started.cookie, "user-agent": UA } });
    const first = await handleGoogleCallback(request(), harness);
    assert.equal(first.headers.get("location"), `https://watchdive.diveroid.com/ko/freediving?auth=${error === "disallowed_useragent" ? "open-browser" : "error"}#signup-bottom`);
    assert.equal(store.rows.size, 0);
    assert.equal(harness.mailer.sent.length, 0);
    assert.ok(first.headers.getSetCookie().every((cookie) => !cookie.startsWith("__Host-wd_social_ack=1;")));
    const replay = await handleGoogleCallback(request(), harness);
    assert.equal(replay.headers.get("location"), "https://watchdive.diveroid.com/ko/freediving?auth=error#signup-bottom");
  }
});

test("legacy OAuth context still returns home without a new anchor", async () => {
  resetSocialStateForTests();
  const harness = deps(new FakeLeadStore());
  const started = await begin(harness, { provider: "google", source: "offer", locale: "ko", next: "/scuba" });
  const result = await googleCallback(harness, started.cookie, started.bound.state, await signToken(googleClaims(started.bound.nonce)));
  assert.equal(result.response.headers.get("location"), "https://watchdive.diveroid.com/ko?auth=confirmed");
});


test("segmented external-email fallback keeps its destination without claiming verification", async () => {
  resetSocialStateForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, { provider: "google", source: "hero", locale: "fr", segment: "scuba" });
  const token = await signToken(googleClaims(started.bound.nonce, { email: "diver@example.com", hd: "other.example" }));
  const result = await googleCallback(harness, started.cookie, started.bound.state, token);
  assert.equal(result.response.headers.get("location"), "https://watchdive.diveroid.com/fr/scuba?auth=check-email#signup-middle");
  assert.equal([...store.rows.values()][0]?.emailVerified, false);
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal(harness.mailer.sent.length, 1); // FakeMailer only.
  assert.ok(result.response.headers.getSetCookie().every((cookie) => !cookie.startsWith("__Host-wd_social_ack=1;")));
  assert.match(continuationHeader(result.response) ?? "", /Max-Age=0/);
});

test("a confirmed continuation exchanges only for that verified lead", async () => {
  resetSocialStateForTests();
  resetSocialContinuationForTests();
  const store = new FakeLeadStore();
  const harness = deps(store);
  const started = await begin(harness, {
    provider: "google",
    source: "offer",
    locale: "ko",
    segment: "freediving",
    attribution: { landingPath: segmentPath("freediving", "ko") },
  });
  const idToken = await signToken(googleClaims(started.bound.nonce, { email: "ko.diver@gmail.com", sub: "ko-sub" }));
  const result = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  const location = result.response.headers.get("location") ?? "";
  assert.equal(location, "https://watchdive.diveroid.com/ko/freediving?auth=confirmed#signup-bottom");
  const grant = continuationHeader(result.response);
  assert.ok(grant);
  const row = [...store.rows.values()][0];
  const before = { source: row.source, locale: row.signupLocale, country: row.signupCountry, email: row.email };
  const other = "other-person@example.com";
  const logs: string[] = [];
  const exchanged = await handleSocialContinuation(
    new Request("https://watchdive.diveroid.com/api/auth/continuation", {
      method: "POST",
      headers: {
        origin: "https://watchdive.diveroid.com",
        cookie: `${grant.split(";")[0]}; __Host-wd_social_ack=1`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: other, leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000099" }),
    }),
    { ...harness, log: (line) => logs.push(line) },
  );
  const body = await exchanged.text();
  assert.equal(body.includes(other), false);
  assert.equal(body.includes(row.email), false);
  assert.equal(body.includes(idToken), false);
  assert.equal(logs.join(" ").includes(other), false);
  assert.equal(logs.join(" ").includes(row.email), false);
  const grantValue = grant.split(";")[0].slice("__Host-wd_social_continue=".length);
  assert.equal(location.includes(grantValue), false);
  const parsed = JSON.parse(body) as { status: string; credential: { kind: string; value: string } };
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.credential.kind, "confirmation");
  const token = parseVerificationToken(parsed.credential.value, TEST_SECRET, NOW.getTime());
  assert.equal(token?.leadId, row.leadId);
  assert.equal(token?.locale, "ko");
  assert.equal(row.source, before.source);
  assert.equal(row.signupLocale, before.locale);
  assert.equal(row.signupCountry, before.country);
  assert.equal(row.email, before.email);
  const ackOnly = await handleSocialContinuation(
    new Request("https://watchdive.diveroid.com/api/auth/continuation", {
      method: "POST",
      headers: {
        origin: "https://watchdive.diveroid.com",
        cookie: "__Host-wd_social_ack=1",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    harness,
  );
  const ackBody = await ackOnly.json() as { reason?: string };
  assert.equal(ackBody.reason, "missing");
  const replay = await googleCallback(harness, started.cookie, started.bound.state, idToken);
  assert.equal(new URL(replay.response.headers.get("location") ?? "").searchParams.get("auth"), "error");
  assert.match(continuationHeader(replay.response) ?? "", /Max-Age=0/);
  assert.ok(replay.response.headers.getSetCookie().every((cookie) => !cookie.startsWith("__Host-wd_social_ack=1;")));
});

test("social start keeps a Google client id only with measurement consent", async () => {
  const harness = deps(new FakeLeadStore());
  const allowed = await begin(harness, {
    provider: "google",
    source: "hero",
    locale: "en",
    measurementConsent: true,
    googleClientId: "123.456",
  });
  assert.equal(allowed.bound.googleClientId, "123.456");
  assert.equal(allowed.bound.measurementConsent, true);

  const denied = await begin(harness, {
    provider: "google",
    source: "hero",
    locale: "ko",
    measurementConsent: false,
    googleClientId: "123.456",
  });
  assert.equal(denied.bound.measurementConsent, false);
  assert.equal(denied.bound.googleClientId, undefined);

  const gpc = await begin(
    harness,
    {
      provider: "google",
      source: "offer",
      locale: "en",
      measurementConsent: true,
      googleClientId: "123.456",
    },
    { "sec-gpc": "1" },
  );
  assert.equal(gpc.bound.measurementConsent, false);
  assert.equal(gpc.bound.googleClientId, undefined);

  const malformed = await begin(harness, {
    provider: "google",
    source: "hero",
    locale: "de",
    measurementConsent: true,
    googleClientId: "not-a-client-id",
  });
  assert.equal(malformed.bound.measurementConsent, true);
  assert.equal(malformed.bound.googleClientId, undefined);
});
