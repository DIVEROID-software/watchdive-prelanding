import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { shouldOfferReturnForm, submitReservationReturn } from "../src/components/reservation/returnClient.ts";
import {
  readContinuationCredential,
  resumeVerifiedReservation,
  safeReservationHref,
} from "../src/components/reservation/returnResume.ts";
import { buildReservationView } from "../src/components/reservation/model.ts";
import { reservationCopy } from "../src/components/reservation/copy.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { holdMarker, reservationIdempotencyKey, sentMarker } from "../src/lib/reservation-mail/campaign.ts";
import { RESERVATION_COPY } from "../src/lib/reservation-mail/copy.ts";
import { personalizedStageCopy } from "../src/lib/reservation-drip/personalized-copy.ts";
import { issueReservationInvite, verifyReservationInvite } from "../src/lib/reservation/invite.ts";
import { RESERVATION_NOTION } from "../src/lib/reservation/notionSchema.ts";
import {
  createMemoryReturnCooldown,
  createReturnCooldown,
  returnCooldownFile,
} from "../src/lib/reservation/returnCooldown.ts";
import {
  createReservationReturnDirectory,
  toReturnAccount,
} from "../src/lib/reservation/returnDirectory.ts";
import {
  handleReservationReturn as dispatchReturn,
  reservationReturnReady,
  resetReservationReturnFlightsForTests,
  type ReturnHandlerDeps,
} from "../src/lib/reservation/returnHandler.ts";
import { buildReservationReturnMessage } from "../src/lib/reservation/returnMail.ts";
import {
  returnWindowBucket,
  returnWindowStartMs,
  RETURN_WINDOW_MS,
  type ReturnAccount,
} from "../src/lib/reservation/returnEligibility.ts";
import { INVITE_LINK_TTL_MS } from "../src/lib/reservation-mail/inviteLink.ts";
import { createNetworkGate } from "../src/lib/verification/networkGate.ts";
import type { ReservationMessage } from "../src/lib/reservation-mail/run.ts";

const SECRET = "test-reservation-token-secret-32b!!";
const VERIFY = "test-verification-secret-value-32b!";
const UNSUB = "test-unsubscribe-secret-value-32b!";
const ORIGIN = "https://watchdive.example";
const LEAD = "11111111-1111-4111-8111-111111111111";
const LEAD_OLDER = "22222222-2222-4222-8222-222222222222";
const EMAIL = "diver@example.com";
const NOW = Date.parse("2026-10-27T00:00:00.000Z");
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const root = new URL("../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function baseEnv(patch: Record<string, string | undefined> = {}): ReturnHandlerDeps["env"] {
  return {
    WATCHDIVE_RESERVATION_TOKEN_SECRET: SECRET,
    WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
    WATCHDIVE_VERIFICATION_SECRET: VERIFY,
    WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET: UNSUB,
    RESEND_API_KEY: "re_test_not_used",
    WATCHDIVE_EMAIL_FROM: "WatchDive <mail@watchdive.example>",
    NOTION_API_KEY: "ntn_test",
    NOTION_WAITLIST_DB_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...patch,
  };
}

function account(patch: Partial<ReturnAccount> = {}): ReturnAccount {
  return {
    leadId: LEAD,
    email: EMAIL,
    status: "verified",
    emailVerified: true,
    suspect: false,
    duplicate: false,
    flags: [],
    verifiedAt: "2026-10-20T00:00:00.000Z",
    payment: "unpaid",
    mirrorStatus: null,
    refundedCents: null,
    refundPendingCents: null,
    dispute: null,
    ...patch,
  };
}

function openGate() {
  return createNetworkGate({
    windowMs: 60 * 60 * 1000,
    repeatThreshold: 100,
    blockThreshold: 100,
    globalWindowMs: 60 * 60 * 1000,
    globalThreshold: 1000,
  });
}

function request(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  const encoded = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${ORIGIN}/api/reservation/return`, {
    method,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "user-agent": BROWSER,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    body: method === "GET" ? undefined : encoded,
  });
}

function harness(
  rows: ReturnAccount[],
  options: {
    env?: ReturnHandlerDeps["env"];
    nowMs?: number;
    gate?: ReturnType<typeof createNetworkGate>;
    cooldown?: ReturnHandlerDeps["cooldown"];
    failSend?: boolean;
    list?: (email: string) => Promise<ReturnAccount[]>;
  } = {},
) {
  const sent: ReservationMessage[] = [];
  const looked: string[] = [];
  const deps: ReturnHandlerDeps = {
    env: options.env ?? baseEnv(),
    directory: {
      async list(email) {
        looked.push(email);
        if (options.list) return options.list(email);
        return rows.map((row) => ({ ...row }));
      },
    },
    async send(message) {
      if (options.failSend) throw new Error("provider down");
      sent.push(message);
    },
    cooldown: options.cooldown ?? createMemoryReturnCooldown(),
    nowMs: options.nowMs ?? NOW,
    networkGate: options.gate ?? openGate(),
  };
  return { sent, looked, deps };
}

let turn: Promise<void> = Promise.resolve();

function withTurn<T>(work: () => Promise<T>): Promise<T> {
  const previous = turn;
  let release: () => void = () => {};
  turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(work).finally(release);
}

function handleReservationReturn(input: Request, deps: ReturnHandlerDeps): Promise<Response> {
  return withTurn(async () => {
      return dispatchReturn(input, deps);
  });
}

function inviteToken(html: string): string {
  const match = html.match(/#invite=(v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
  assert.ok(match?.[1], "invite fragment missing");
  return match[1];
}

test("a fresh browser sees the email form only after entry and resume settle", () => {
  assert.equal(
    shouldOfferReturnForm({
      inviteToken: null,
      phase: "needs_invitation",
      entryResolved: false,
      resumeSettled: false,
    }),
    false,
  );
  assert.equal(
    shouldOfferReturnForm({
      inviteToken: null,
      phase: "needs_invitation",
      entryResolved: true,
      resumeSettled: false,
    }),
    false,
  );
  assert.equal(
    shouldOfferReturnForm({
      inviteToken: null,
      phase: "needs_invitation",
      entryResolved: true,
      resumeSettled: true,
    }),
    true,
  );
  assert.equal(
    shouldOfferReturnForm({
      inviteToken: "v1.already.here",
      phase: "needs_invitation",
      entryResolved: true,
      resumeSettled: true,
    }),
    false,
  );
  assert.equal(
    shouldOfferReturnForm({
      inviteToken: null,
      phase: "offer",
      entryResolved: true,
      resumeSettled: true,
    }),
    false,
  );
});

test("the browser posts the return path and keeps the token out of the URL", async () => {
  let called = "";
  let payload = "";
  const result = await submitReservationReturn({
    email: EMAIL,
    locale: "en",
    honeypot: "",
    fetchImpl: async (url, init) => {
      called = String(url);
      payload = String(init?.body);
      return new Response(JSON.stringify({ ok: true, status: "accepted" }), { status: 200 });
    },
  });
  assert.equal(result, "accepted");
  assert.equal(called, "/api/reservation/return");
  assert.equal(called.includes("?"), false);
  assert.equal(payload.includes("invite"), false);
  assert.equal(payload.includes("token"), false);
  const body = JSON.parse(payload) as { email: string; company: string };
  assert.equal(body.email, EMAIL);
  assert.equal(body.company, "");
});

test("a fresh browser with no continuation does not open a reservation", async () => {
  let opened = 0;
  const href = await resumeVerifiedReservation({
    locale: "en",
    exchange: async () => ({ status: "none" }),
    openReservation: async () => {
      opened += 1;
      return { status: "ready", href: "/reservation?lang=en#invite=v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb" };
    },
  });
  assert.equal(href, null);
  assert.equal(opened, 0);
  assert.equal(readContinuationCredential({ status: "missing" }), null);
});

test("an existing continuation opens only a same-origin invite fragment", async () => {
  const good = "/reservation?lang=ko#invite=v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb";
  const credential = { kind: "confirmation" as const, value: "a".repeat(40) };
  const href = await resumeVerifiedReservation({
    locale: "ko",
    exchange: async () => ({ status: "ready", credential }),
    openReservation: async (passed, locale) => {
      assert.deepEqual(passed, credential);
      assert.equal(locale, "ko");
      return { status: "ready", href: good };
    },
  });
  assert.equal(href, good);
  assert.equal(safeReservationHref("https://evil.example/reservation?lang=en#invite=v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb"), null);
  assert.equal(safeReservationHref("/reservation?lang=en&token=abc#invite=v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb"), null);
  assert.equal(safeReservationHref("/reservation?lang=en#invite=short"), null);
  assert.equal(safeReservationHref("/reservation?lang=en#invite=v1.aaaaaaaaaaaaaaaa.bbbb@bbbbbbbbbbb"), null);
});

test("checkout without an invite stays disabled", () => {
  const view = buildReservationView({
    search: "?lang=en",
    inviteToken: null,
    invalidInvite: false,
    termsRead: true,
    termsAccepted: true,
    submitting: false,
    status: null,
    statusError: false,
    statusLoading: false,
    checkoutError: false,
    checkoutConflict: false,
    localizedSite: true,
  });
  assert.equal(view.phase, "needs_invitation");
  assert.equal(view.checkoutEnabled, false);
  assert.equal(view.showCheckoutForm, false);
  assert.equal(view.checkoutBlock, "missing_invite");
});

test("a verified unpaid signup receives one personal link and the same public answer", async () => {
  const row = account({ reservationMail: sentMarker(new Date("2026-10-21T00:00:00.000Z")) });
  const before = JSON.stringify(row);
  const box = harness([row]);
  const response = await handleReservationReturn(request({ email: ` ${EMAIL.toUpperCase()} `, locale: "fr", invite: "nope", token: "nope", leadId: "nope" }), box.deps);
  const raw = await response.text();
  assert.equal(response.status, 200);
  assert.equal(raw, JSON.stringify({ ok: true, status: "accepted" }));
  assert.equal(raw.includes(EMAIL), false);
  assert.equal(raw.includes(LEAD), false);
  assert.equal(raw.includes("invite"), false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.equal(box.sent.length, 1);
  assert.equal(box.looked[0], EMAIL);
  const message = box.sent[0]!;
  assert.equal(message.to, EMAIL);
  assert.equal(message.idempotencyKey, `watchdive-reservation-return-${LEAD}-${returnWindowBucket(NOW)}`);
  assert.notEqual(message.idempotencyKey, reservationIdempotencyKey(LEAD));
  assert.equal(message.tags?.[0]?.value, "wd-reservation-return-v1");
  assert.equal(message.html.includes("inviteToken="), false);
  assert.equal(message.text.includes("inviteToken="), false);
  const token = inviteToken(message.html);
  const claims = verifyReservationInvite(token, SECRET, NOW);
  assert.equal(claims?.leadId, LEAD);
  assert.equal(claims?.email, EMAIL);
  assert.equal(claims?.emailVerified, true);
  assert.equal(JSON.stringify(row), before);
  assert.equal(message.subject, personalizedStageCopy("general", "en", "d0").subject);
  assert.notEqual(message.subject, RESERVATION_COPY.en.subject);
});

test("pending, new, duplicate, and unknown addresses get the same answer and no mail", async () => {
  const cases: ReturnAccount[][] = [
    [],
    [account({ status: "pending", emailVerified: false, verifiedAt: undefined })],
    [account({ status: "new", emailVerified: false })],
    [account({ duplicate: true })],
    [account({ emailVerified: false })],
  ];
  const bodies: string[] = [];
  for (const rows of cases) {
    const box = harness(rows);
    const response = await handleReservationReturn(request({ email: EMAIL }), box.deps);
    bodies.push(await response.text());
    assert.equal(response.status, 200);
    assert.equal(box.sent.length, 0);
  }
  assert.equal(new Set(bodies).size, 1);
});

test("paid, refund, hold, unsubscribe, and suspect inboxes are not mailed", async () => {
  const blocked: ReturnAccount[] = [
    account({ payment: "live" }),
    account({ payment: "unreadable" }),
    account({ mirrorStatus: "paid" }),
    account({ mirrorStatus: "refunded", refundedCents: 300 }),
    account({ refundPendingCents: 300 }),
    account({ dispute: "open" }),
    account({ reservationMail: holdMarker("expired_intent", new Date("2026-10-01T00:00:00.000Z")) }),
    account({ status: "unsubscribed" }),
    account({ launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" }),
    account({ reservationMail: "hand written note" }),
    account({ suspect: true }),
    account({ flags: ["review"] }),
  ];
  for (const row of blocked) {
    const box = harness([row]);
    const response = await handleReservationReturn(request({ email: EMAIL }), box.deps);
    assert.equal(await response.text(), JSON.stringify({ ok: true, status: "accepted" }));
    assert.equal(box.sent.length, 0, JSON.stringify(row));
  }
});

test("a test-mode payment and a measurement-withdrawal flag can still receive the link", async () => {
  const box = harness([account({ payment: "test", flags: ["measurement-withdrawn", "ip-repeat"] })]);
  await handleReservationReturn(request({ email: EMAIL }), box.deps);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0]?.to, EMAIL);
});

test("gmail aliases mail the stored row, and other plus-tags do not share an inbox", async () => {
  const stored = account({ email: "Diver.A@gmail.com", leadId: LEAD });
  const older = account({
    email: "divera@gmail.com",
    leadId: LEAD_OLDER,
    verifiedAt: "2026-10-01T00:00:00.000Z",
  });
  const box = harness([stored, older]);
  await handleReservationReturn(request({ email: "Diver.A+Ads@gmail.com" }), box.deps);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0]?.to, "divera@gmail.com");
  const claims = verifyReservationInvite(inviteToken(box.sent[0]!.html), SECRET, NOW);
  assert.equal(claims?.email, "divera@gmail.com");
  assert.equal(claims?.leadId, LEAD_OLDER);

  const separate = harness([account({ email: "diver@example.com" })]);
  await handleReservationReturn(request({ email: "diver+ads@example.com" }), separate.deps);
  assert.equal(separate.sent.length, 0);
});

test("one poisoned alias suppresses the whole gmail inbox", async () => {
  const box = harness([
    account({ email: "divera@gmail.com" }),
    account({ email: "diver.a@gmail.com", leadId: LEAD_OLDER, payment: "live" }),
  ]);
  await handleReservationReturn(request({ email: "divera+return@gmail.com" }), box.deps);
  assert.equal(box.sent.length, 0);
});

test("an invalid address is rejected and a honeypot is accepted without a lookup", async () => {
  const box = harness([account()]);
  const invalid = await handleReservationReturn(request({ email: "not-an-email" }), box.deps);
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), JSON.stringify({ error: "invalid_email" }));
  const honey = await handleReservationReturn(request({ email: EMAIL, company: "acme" }), box.deps);
  assert.equal(honey.status, 200);
  assert.equal(await honey.text(), JSON.stringify({ ok: true, status: "accepted" }));
  const typed = await handleReservationReturn(request({ email: EMAIL, company: 1 }), box.deps);
  assert.equal(typed.status, 200);
  assert.equal(box.looked.length, 0);
  assert.equal(box.sent.length, 0);
});

test("the same window sends once, and the provider body is stable across a replay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-return-"));
  try {
    const cooldown = createReturnCooldown(dir);
    const box = harness([account({ locale: "ko" })], { cooldown });
    const first = await handleReservationReturn(request({ email: EMAIL, locale: "en" }), box.deps);
    const second = await handleReservationReturn(request({ email: EMAIL, locale: "de" }), box.deps);
    assert.equal(await first.text(), await second.text());
    assert.equal(box.sent.length, 1);
    assert.equal(box.sent[0]?.subject, personalizedStageCopy("general", "ko", "d0").subject);
    const again = buildReservationReturnMessage({
      account: account({ locale: "ko" }),
      bucket: returnWindowBucket(NOW),
      nowMs: NOW,
      env: baseEnv(),
    });
    assert.equal(again.html, box.sent[0]?.html);
    assert.equal(again.idempotencyKey, box.sent[0]?.idempotencyKey);
    assert.equal(again.text, box.sent[0]?.text);
    const later = harness([account({ locale: "ko" })], {
      cooldown: createReturnCooldown(dir),
      nowMs: NOW,
    });
    await handleReservationReturn(request({ email: EMAIL }), later.deps);
    assert.equal(later.sent.length, 0);
    const ledger = readFileSync(returnCooldownFile(dir), "utf8");
    assert.equal(ledger.includes("@"), false);
    assert.equal(ledger.includes("invite="), false);
    assert.equal(ledger.includes(EMAIL), false);
    assert.equal(existsSync(join(dir, "wd-reservation-invite-v1.jsonl")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invite bytes stay fixed for the whole rate window and carry no issue time", () => {
  const bucket = returnWindowBucket(NOW);
  const start = returnWindowStartMs(bucket);
  const early = buildReservationReturnMessage({
    account: account(),
    bucket,
    nowMs: start + 1000,
    env: baseEnv(),
  });
  const later = buildReservationReturnMessage({
    account: account(),
    bucket,
    nowMs: start + RETURN_WINDOW_MS - 1000,
    env: baseEnv(),
  });
  assert.equal(later.html, early.html);
  assert.equal(later.text, early.text);
  assert.equal(later.subject, early.subject);
  assert.equal(later.idempotencyKey, early.idempotencyKey);
  const token = inviteToken(early.html);
  assert.equal(inviteToken(later.html), token);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    iat?: unknown;
    exp?: unknown;
    jti?: unknown;
  };
  assert.equal(payload.iat, undefined);
  assert.equal(payload.exp, Math.floor((start + INVITE_LINK_TTL_MS) / 1000));
  assert.equal(typeof payload.jti, "string");
  assert.equal((payload.jti as string).length >= 16, true);
});

test("the next rate window can send again with a different provider key", async () => {
  const cooldown = createMemoryReturnCooldown();
  const first = harness([account()], { cooldown, nowMs: NOW });
  await handleReservationReturn(request({ email: EMAIL }), first.deps);
  const nextAt = NOW + 23 * 60 * 60 * 1000;
  const second = harness([account()], { cooldown, nowMs: nextAt });
  await handleReservationReturn(request({ email: EMAIL }), second.deps);
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
  assert.notEqual(first.sent[0]?.idempotencyKey, second.sent[0]?.idempotencyKey);
  assert.notEqual(first.sent[0]?.html, second.sent[0]?.html);
});

test("two overlapping requests send one message", async () => {
  await withTurn(async () => {
    resetReservationReturnFlightsForTests();
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const box = harness([account()], {
      list: async () => {
        await wait;
        return [account()];
      },
    });
    const left = dispatchReturn(request({ email: EMAIL }), box.deps);
    const right = dispatchReturn(request({ email: EMAIL }), box.deps);
    release();
    const responses = await Promise.all([left, right]);
    assert.equal(box.sent.length, 1);
    assert.deepEqual(
      await Promise.all(responses.map((response) => response.text())),
      [JSON.stringify({ ok: true, status: "accepted" }), JSON.stringify({ ok: true, status: "accepted" })],
    );
  });
});

test("the network gate, a headless agent, and a foreign origin do not send", async () => {
  const gate = createNetworkGate({
    windowMs: 60 * 60 * 1000,
    repeatThreshold: 2,
    blockThreshold: 2,
    globalWindowMs: 60 * 60 * 1000,
    globalThreshold: 100,
  });
  const limited = harness([account()], { gate });
  await handleReservationReturn(request({ email: EMAIL }), limited.deps);
  const blocked = await handleReservationReturn(request({ email: EMAIL }), limited.deps);
  assert.equal(blocked.status, 200);
  assert.equal(limited.sent.length, 1);
  assert.equal(limited.looked.length, 1);

  const headless = harness([account()]);
  const bot = await handleReservationReturn(
    request({ email: EMAIL }, { "user-agent": "HeadlessChrome/120" }),
    headless.deps,
  );
  assert.equal(bot.status, 200);
  assert.equal(headless.looked.length, 0);
  assert.equal(headless.sent.length, 0);

  const foreign = harness([account()]);
  const rejected = await handleReservationReturn(
    request({ email: EMAIL }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    foreign.deps,
  );
  assert.equal(rejected.status, 400);
  assert.equal(foreign.looked.length, 0);
});

test("a missing configuration refuses every valid address before lookup", async () => {
  const env = baseEnv();
  delete env.NOTION_API_KEY;
  assert.equal(reservationReturnReady(env), false);
  const box = harness([account()], { env });
  const first = await handleReservationReturn(request({ email: EMAIL }), box.deps);
  const second = await handleReservationReturn(request({ email: "other@example.com" }), box.deps);
  const firstBody = await first.text();
  const secondBody = await second.text();
  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal(firstBody, secondBody);
  assert.equal(secondBody, JSON.stringify({ error: "unavailable" }));
  assert.equal(box.looked.length, 0);
  assert.equal(box.sent.length, 0);
});

test("lookup and provider failures stay the public accepted answer", async () => {
  const broken = harness([], {
    list: async () => {
      throw new Error("notion down");
    },
  });
  const lookup = await handleReservationReturn(request({ email: EMAIL }), broken.deps);
  assert.equal(await lookup.text(), JSON.stringify({ ok: true, status: "accepted" }));
  assert.equal(broken.sent.length, 0);

  const provider = harness([account()], { failSend: true });
  const failed = await handleReservationReturn(request({ email: EMAIL }), provider.deps);
  assert.equal(failed.status, 200);
  assert.equal(provider.sent.length, 0);
});

test("an older signed invite still verifies after a return request", async () => {
  const previous = issueReservationInvite({
    leadId: LEAD,
    email: EMAIL,
    emailVerified: true,
    expiresAtMs: NOW + 86_400_000,
    secret: SECRET,
    jti: "campaign-jti-fixed1",
    nowMs: NOW - 60_000,
  });
  const box = harness([account()]);
  await handleReservationReturn(request({ email: EMAIL }), box.deps);
  const claims = verifyReservationInvite(previous, SECRET, NOW);
  assert.equal(claims?.jti, "campaign-jti-fixed1");
  assert.equal(claims?.leadId, LEAD);
  assert.notEqual(inviteToken(box.sent[0]!.html).includes("campaign-jti-fixed1"), true);
});

test("a scuba landing path still uses that segment template", async () => {
  const box = harness([account({ landingPath: "/scuba", locale: "en" })]);
  await handleReservationReturn(request({ email: EMAIL, locale: "ja" }), box.deps);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0]?.subject, personalizedStageCopy("scuba", "en", "d0").subject);
  assert.equal(box.sent[0]?.tags?.find((tag) => tag.name === "locale")?.value, "en");
});

test("Notion rows map payment and refund without a page id the caller could patch", () => {
  const paid = toReturnAccount(notionPage({
    [RESERVATION_NOTION.paid]: { checkbox: true },
    [RESERVATION_NOTION.mode]: { select: { name: "live" } },
    [RESERVATION_NOTION.status]: { select: { name: "paid" } },
    [RESERVATION_NOTION.refundedCents]: { number: 0 },
    [RESERVATION_NOTION.dispute]: { select: { name: "none" } },
  }));
  assert.equal(paid?.payment, "live");
  assert.equal(paid?.mirrorStatus, "paid");
  assert.equal("pageId" in (paid ?? {}), false);
  const refunded = toReturnAccount(notionPage({
    [RESERVATION_NOTION.paid]: { checkbox: false },
    [RESERVATION_NOTION.mode]: { select: { name: "live" } },
    [RESERVATION_NOTION.status]: { select: { name: "refunded" } },
    [RESERVATION_NOTION.refundedCents]: { number: 300 },
    [RESERVATION_NOTION.dispute]: { select: null },
  }));
  assert.equal(refunded?.payment, "unpaid");
  assert.equal(refunded?.mirrorStatus, "refunded");
  assert.equal(refunded?.refundedCents, 300);
  assert.equal(toReturnAccount({ properties: {} }), undefined);
});

test("the directory queries and does not create rows", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const directory = createReservationReturnDirectory(async (method, path, body) => {
    calls.push({ method, path, body });
    return { results: [notionPage()], has_more: false };
  }, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const rows = await directory.list(EMAIL);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.leadId, LEAD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, "POST");
  assert.match(calls[0]?.path ?? "", /\/query$/);
  const filter = JSON.stringify(calls[0]?.body);
  assert.equal(filter.includes(EMAIL), true);
  assert.equal(filter.includes("\"create\""), false);
  const empty = createReservationReturnDirectory(async () => {
    throw new Error("should not query");
  }, "   ");
  assert.deepEqual(await empty.list(EMAIL), []);
});

test("a truncated lookup does not send", async () => {
  const directory = createReservationReturnDirectory(async () => ({
    results: [notionPage()],
    has_more: true,
    next_cursor: "cursor-1",
  }), "cccccccccccccccccccccccccccccccc");
  const sent: ReservationMessage[] = [];
  const response = await handleReservationReturn(request({ email: EMAIL }), {
    env: baseEnv(),
    directory,
    send: async (message) => {
      sent.push(message);
    },
    cooldown: createMemoryReturnCooldown(),
    nowMs: NOW,
    networkGate: openGate(),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), JSON.stringify({ ok: true, status: "accepted" }));
  assert.equal(sent.length, 0);
});

test("return copy exists in every locale and the public files mint no signup", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = reservationCopy(locale);
    assert.match(copy.returnLead, /\S/);
    assert.match(copy.returnSubmit, /\S/);
    assert.match(copy.returnAccepted, /\S/);
    assert.doesNotMatch(copy.returnAccepted, /on its way|already on the WatchDive list|名单上|名簿/);
    assert.doesNotMatch(`${copy.returnLead} ${copy.returnAccepted}`, /credential|inviteToken|signed invitation/i);
  }
  const files = [
    "src/lib/reservation/returnHandler.ts",
    "src/lib/reservation/returnDirectory.ts",
    "src/lib/reservation/returnMail.ts",
    "src/lib/reservation/returnProduction.ts",
    "src/routes/api/reservation/return.ts",
    "src/components/reservation/ReservationPage.tsx",
    "src/components/reservation/ReturnLinkForm.tsx",
    "src/components/reservation/returnClient.ts",
    "src/components/reservation/returnResume.ts",
  ];
  const source = files.map((path) => read(path)).join("\n");
  assert.doesNotMatch(source, /createPending|markVerified|markConversionMilestone|metaPixel|fbq\(|gtag\(/);
  assert.match(read("src/routeTree.gen.ts"), /\/api\/reservation\/return/);
  assert.match(read("src/routes/api/reservation/return.ts"), /POST:/);
  assert.doesNotMatch(read("src/lib/reservation/returnDirectory.ts"), /recordReservationMail|pages\/\$\{|method:\s*"PATCH"/);
  const page = read("src/components/reservation/ReservationPage.tsx");
  assert.equal(page.match(/requestReservationCheckout/g)?.length, 2);
  assert.match(page, /resumeVerifiedReservation/);
  assert.doesNotMatch(page, /\/api\/auth\/start/);
});

test("a poisoned cooldown line is ignored and a foreign origin body is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-return-poison-"));
  try {
    const file = returnCooldownFile(dir);
    writeFileSync(file, `${JSON.stringify({ v: 1, leadId: EMAIL, bucket: 1, at: "2026-10-27T00:00:00.000Z" })}\n`);
    const cooldown = createReturnCooldown(dir);
    assert.equal(await cooldown.alreadySent(LEAD, returnWindowBucket(NOW)), false);
    const box = harness([account()], { cooldown });
    const bad = await handleReservationReturn(request("{"), box.deps);
    assert.equal(bad.status, 400);
    const method = await handleReservationReturn(request({ email: EMAIL }, {}, "GET"), box.deps);
    assert.equal(method.status, 405);
    assert.equal(box.sent.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function notionPage(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "page-return-1",
    properties: {
      Email: { title: [{ plain_text: EMAIL }] },
      "Lead ID": { rich_text: [{ plain_text: LEAD }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      Suspect: { checkbox: false },
      Duplicate: { checkbox: false },
      "Verified at": { date: { start: "2026-10-20T00:00:00.000Z" } },
      "Reservation paid": { checkbox: false },
      "Reservation mode": { select: { name: "test" } },
      ...extra,
    },
  };
}
