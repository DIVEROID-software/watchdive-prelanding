// Confirm-link faults that the page and the service can show without a browser,
// a CRM, or a mail provider. Root's live KO/JA clicks are not repeated here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { autoLocaleRedirect } from "../src/lib/i18n/auto-locale.ts";
import {
  resetGeoLookupForTests,
  resolveGeoCountryWithin,
} from "../src/lib/consentRegion.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";
import { VERIFICATION_RESEND_COOLDOWN_MS } from "../src/lib/verification/contracts.ts";
import {
  confirmVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";
import { verificationTokenFromFragment } from "../src/lib/verification/tokenShape.ts";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_SECRET,
} from "./helpers/fakes.ts";

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);

let store: FakeLeadStore;
let mailer: FakeMailer;
let dispatched: { eventId: string; email: string; source: string }[];
let clock: Date;
let nextLeadId: () => string;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: nextLeadId,
    refCode: () => "abcd1234",
    sleep: async () => {},
    dispatchVerifiedLead: async (input: { eventId: string; email: string; source: string }) => {
      dispatched.push(input);
    },
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    ...overrides,
  };
}

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function documentRequest(url: string, headers: Record<string, string> = {}) {
  const method = headers.method ?? "GET";
  const rest = { ...headers };
  delete rest.method;
  return new Request(url, {
    method,
    headers: {
      accept: "text/html",
      "sec-fetch-dest": "document",
      "user-agent": "Mozilla/5.0 WatchDiveLinkAudit",
      ...rest,
    },
  });
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  dispatched = [];
  clock = new Date("2026-11-02T06:00:00.000Z");
  nextLeadId = leadIdFactory();
  resetGeoLookupForTests();
});

test("fresh links for the paid and historical markets confirm in the mailed locale", async () => {
  for (const locale of ["ko", "ja", "zh-TW", "en", "nl"] as const) {
    store = new FakeLeadStore();
    mailer = new FakeMailer();
    dispatched = [];
    nextLeadId = leadIdFactory();
    await requestVerificationService(submit({ locale }), deps());
    const sent = mailer.sent[0];
    const url = new URL(sent && mailer.lastUrl ? mailer.lastUrl : "https://invalid.example/");
    assert.equal(url.search, "", locale);
    assert.equal(verificationTokenFromFragment(url.hash), sent?.token, locale);
    clock = new Date(clock.getTime() + 120_000);
    const confirmed = await confirmVerificationService(sent?.token ?? "", deps());
    assert.equal(confirmed.status, "verified", locale);
    assert.equal(mailer.welcomes[0]?.locale, locale);
    assert.equal(mailer.welcomes.length, 1, locale);
    assert.equal(dispatched.length, 1, locale);
    clock = new Date("2026-11-02T06:00:00.000Z");
  }
});

test("the token locale wins over a different stored signup locale", async () => {
  await requestVerificationService(submit({ locale: "ja" }), deps());
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.ok(row);
  const token = createVerificationToken(
    row.leadId,
    Date.parse(row.expiresAt ?? ""),
    false,
    TEST_SECRET,
    "ko",
  );
  const confirmed = await confirmVerificationService(token, deps());
  assert.equal(confirmed.status, "verified");
  assert.equal(mailer.welcomes[0]?.locale, "ko");
});

test("an authentic expired token is expired before any CRM read, independent of a client clock", async () => {
  await requestVerificationService(submit({ locale: "zh-TW" }), deps());
  const token = mailer.sent[0]?.token ?? "";
  let reads = 0;
  const original = store.findByLeadId.bind(store);
  store.findByLeadId = async (leadId: string) => {
    reads += 1;
    return original(leadId);
  };
  clock = new Date(clock.getTime() + 86_400_000 + 1_000);
  const expired = await confirmVerificationService(token, deps());
  assert.equal(expired.status, "expired");
  assert.equal(reads, 0);
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal(mailer.welcomes.length, 0);
});

test("a still-signed token whose stored attempt window has closed is expired after the read", async () => {
  await requestVerificationService(submit({ locale: "ko" }), deps());
  const token = mailer.sent[0]?.token ?? "";
  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.ok(row);
  clock = new Date(clock.getTime() + 60_000);
  store.rows.set(row.pageId, {
    ...row,
    expiresAt: new Date(clock.getTime() - 1_000).toISOString(),
  });
  let reads = 0;
  const original = store.findByLeadId.bind(store);
  store.findByLeadId = async (leadId: string) => {
    reads += 1;
    return original(leadId);
  };
  const expired = await confirmVerificationService(token, deps());
  assert.equal(expired.status, "expired");
  assert.equal(reads, 1);
  assert.equal(store.markVerifiedCalls, 0);
});

test("a bad signature and a shapeless fragment do not read the CRM", async () => {
  await requestVerificationService(submit(), deps());
  const token = mailer.sent[0]?.token ?? "";
  let reads = 0;
  const original = store.findByLeadId.bind(store);
  store.findByLeadId = async (leadId: string) => {
    reads += 1;
    return original(leadId);
  };
  const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal((await confirmVerificationService(flipped, deps())).status, "invalid");
  assert.equal((await confirmVerificationService("not-a-token", deps())).status, "invalid");
  assert.equal((await confirmVerificationService("", deps())).status, "invalid");
  assert.equal(reads, 0);
  assert.equal(store.markVerifiedCalls, 0);
});

test("a reissued attempt invalidates the previous link and the new link verifies once", async () => {
  await requestVerificationService(submit({ locale: "ko" }), deps());
  const first = mailer.sent[0]?.token ?? "";
  clock = new Date(clock.getTime() + VERIFICATION_RESEND_COOLDOWN_MS + 1_000);
  await requestVerificationService(submit({ locale: "ko" }), deps());
  assert.equal(mailer.sent.length, 2);
  assert.notEqual(mailer.sent[1]?.leadId, mailer.sent[0]?.leadId);
  assert.equal((await confirmVerificationService(first, deps())).status, "invalid");
  assert.equal(store.markVerifiedCalls, 0);
  const confirmed = await confirmVerificationService(mailer.sent[1]?.token ?? "", deps());
  assert.equal(confirmed.status, "verified");
  assert.equal(store.markVerifiedCalls, 1);
  const repeat = await confirmVerificationService(mailer.sent[1]?.token ?? "", deps());
  assert.equal(repeat.status, "already_verified");
  assert.equal(store.markVerifiedCalls, 1);
  assert.equal(mailer.welcomes.length, 1);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0]?.eventId, dispatched[1]?.eventId);
});

test("a timed-out lead read does not verify, and the same link still works", async () => {
  await requestVerificationService(submit({ locale: "ja" }), deps());
  const token = mailer.sent[0]?.token ?? "";
  const original = store.findByLeadId.bind(store);
  let reads = 0;
  store.findByLeadId = async (leadId: string) => {
    reads += 1;
    if (reads === 1) {
      const error = new Error("Notion request timed out");
      error.name = "TimeoutError";
      throw error;
    }
    return original(leadId);
  };
  await assert.rejects(() => confirmVerificationService(token, deps()), (error: unknown) => {
    assert.equal(error instanceof Error ? error.name : "", "TimeoutError");
    return true;
  });
  assert.equal(store.markVerifiedCalls, 0);
  assert.equal((await store.findByEmail(CANONICAL, EMAIL))?.emailVerified, false);
  const confirmed = await confirmVerificationService(token, deps());
  assert.equal(confirmed.status, "verified");
  assert.equal(store.markVerifiedCalls, 1);
  assert.equal(mailer.welcomes.length, 1);
});

test("a verify write that lands and then times out is not written again", async () => {
  await requestVerificationService(submit({ locale: "zh-TW" }), deps());
  const token = mailer.sent[0]?.token ?? "";
  let writes = 0;
  store.markVerified = async (pageId, input) => {
    writes += 1;
    await FakeLeadStore.prototype.markVerified.call(store, pageId, input);
    const error = new Error("Notion request timed out");
    error.name = "TimeoutError";
    throw error;
  };
  await assert.rejects(() => confirmVerificationService(token, deps()));
  assert.equal(writes, 1);
  assert.equal((await store.findByEmail(CANONICAL, EMAIL))?.emailVerified, true);
  assert.equal(mailer.welcomes.length, 0);

  store.markVerified = FakeLeadStore.prototype.markVerified.bind(store);
  const again = await confirmVerificationService(token, deps());
  assert.equal(again.status, "already_verified");
  assert.equal(mailer.welcomes.length, 1);
  assert.equal(mailer.welcomes[0]?.locale, "zh-TW");
  const third = await confirmVerificationService(token, deps());
  assert.equal(third.status, "already_verified");
  assert.equal(mailer.welcomes.length, 1);
  assert.equal(writes, 1);
});

test("two overlapping confirms share one Meta event id and one welcome lead id", async () => {
  await requestVerificationService(submit({ locale: "ko" }), deps());
  const token = mailer.sent[0]?.token ?? "";
  const leadId = mailer.sent[0]?.leadId ?? "";
  const [first, second] = await Promise.all([
    confirmVerificationService(token, deps()),
    confirmVerificationService(token, deps()),
  ]);
  for (const result of [first, second]) {
    assert.ok(result.status === "verified" || result.status === "already_verified");
  }
  assert.equal(new Set(dispatched.map((event) => event.eventId)).size, 1);
  assert.ok(mailer.welcomes.length >= 1);
  assert.ok(mailer.welcomes.every((welcome) => welcome.leadId === leadId));
  const welcomeSource = read("src/lib/verification/resend.ts");
  assert.match(welcomeSource, /const idempotencyKey = `watchdive-welcome-\$\{leadId\}`/);
  assert.match(welcomeSource, /return `watchdive-verification-\$\{leadId\}`/);
});

test("a damaged fragment recovers the shaped token and still rejects a truncated or case-folded one", () => {
  const token = createVerificationToken(
    "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    clock.getTime() + 86_400_000,
    true,
    TEST_SECRET,
    "zh-TW",
  );
  const wrapped = `#https://watchdive.diveroid.com/zh-tw/verify#${token}>`;
  assert.equal(verificationTokenFromFragment(wrapped), token);
  assert.equal(verificationTokenFromFragment(`#token=${encodeURIComponent(token)}.`), token);
  assert.equal(verificationTokenFromFragment(`?token=${token}`), undefined);
  assert.equal(verificationTokenFromFragment(token), undefined);
  assert.equal(verificationTokenFromFragment(`#${token.slice(0, -1)}`), undefined);
  assert.equal(
    verificationTokenFromFragment(`#${token.replace(".zh-TW.", ".zh-tw.")}`),
    undefined,
  );
});

test("a hung country lookup releases confirmation and a cookie does not ask again", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  let calls = 0;
  try {
    globalThis.fetch = (() => {
      calls += 1;
      return new Promise(() => {});
    }) as typeof fetch;
    const started = Date.now();
    assert.equal(await resolveGeoCountryWithin(40), undefined);
    assert.ok(Date.now() - started < 400);
    assert.equal(calls, 1);
    const again = Date.now();
    assert.equal(await resolveGeoCountryWithin(40), undefined);
    assert.ok(Date.now() - again < 400);
    assert.equal(calls, 1, "a hung lookup stays cached");

    resetGeoLookupForTests();
    calls = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ country: "jp" }), { status: 200 })) as typeof fetch;
    const found = Date.now();
    assert.equal(await resolveGeoCountryWithin(1_500), "JP");
    assert.ok(Date.now() - found < 400);

    resetGeoLookupForTests();
    calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(new Response(JSON.stringify({ country: "US" }), { status: 200 }));
    }) as typeof fetch;
    Object.defineProperty(globalThis, "document", {
      value: { cookie: "wd_geo=KR" },
      configurable: true,
    });
    assert.equal(await resolveGeoCountryWithin(40), "KR");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: Document }).document;
    else globalThis.document = previousDocument;
    resetGeoLookupForTests();
  }
});

test("verify routes stay put when the browser language and access country disagree", () => {
  for (const path of ["/verify", "/ko/verify", "/ja/verify", "/zh-tw/verify", "/nl/verify"]) {
    const redirected = autoLocaleRedirect(
      documentRequest(`https://watchdive.diveroid.com${path}`, { "accept-language": "ja" }),
      true,
      "KR",
    );
    assert.equal(redirected, undefined, path);
    const head = autoLocaleRedirect(
      documentRequest(`https://watchdive.diveroid.com${path}`, {
        method: "HEAD",
        "accept-language": "ko",
      }),
      true,
      "JP",
    );
    assert.equal(head, undefined, `${path} HEAD`);
  }
  const home = autoLocaleRedirect(
    documentRequest("https://watchdive.diveroid.com/", { "accept-language": "en" }),
    true,
    "JP",
  );
  assert.equal(home?.location, "/ja/scuba");
});

test("the confirm POST is the only confirmation, and third parties stay off the token routes", () => {
  const page = read("src/routes/verify.tsx");
  const handler = read("src/lib/api/waitlist.functions.ts");
  const fetcher = read(
    "node_modules/@tanstack/start-client-core/dist/esm/client-rpc/serverFnFetcher.js",
  );
  assert.equal(page.split("confirmVerification(").length - 1, 1);
  assert.match(page, /loader: \(\) => loadReferralPriceClaimOnly\("en"\)/);
  assert.match(handler, /export const confirmVerification = createServerFn\(\{ method: "POST" \}\)/);
  const getBranch = fetcher.slice(
    fetcher.indexOf('if (first.method === "GET")'),
    fetcher.indexOf('if (first.method === "POST")'),
  );
  const postBranch = fetcher.slice(
    fetcher.indexOf('if (first.method === "POST")'),
    fetcher.indexOf("return getResponse"),
  );
  assert.match(getBranch, /url \+=/);
  assert.equal(postBranch.includes("url +="), false);
  assert.match(page, /await resolveGeoCountryWithin\(CONFIRM_GEO_WAIT_MS\)/);
  const readFragment = page.indexOf("const fragmentToken = tokenFromFragment(window.location.hash)");
  const strip = page.indexOf("window.history.replaceState");
  const post = page.indexOf("void confirm()");
  assert.ok(readFragment > 0 && readFragment < strip && strip < post);
  assert.match(page, /if \(started\.current\) return;/);
  assert.match(page, /\}, \[\]\);/);
  assert.match(page, /const cookies = measurementPermitted\(\) \? getMetaCookies\(\) : \{\}/);
  for (const path of ["/verify", "/ko/verify", "/ja/verify", "/zh-tw/verify"]) {
    assert.equal(allowsThirdPartyScripts(path), false, path);
  }
  assert.equal(allowsThirdPartyScripts("/ko/scuba"), true);
});
