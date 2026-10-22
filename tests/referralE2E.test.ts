// Buddy Invite end to end, through the production modules, with only the
// network faked (tests/helpers/fakeNetwork.ts speaks the Notion and Resend
// HTTP APIs). Every store, parser, query, PATCH body, mail payload, signed
// link, ledger rule, cron handler and ops script below is the real one.
//
// One story, run with the master switch ON and again OFF:
//   ops adds the columns → A signs up and confirms (welcome guide / legacy
//   welcome) → friends arrive on A's share link (12 confirm: 11 on one Korean
//   calendar day, one the next; one disposable, one never confirms, one is A's
//   own alias; one of the friends refers someone too) → the office cron tick
//   (reminder + notices) → a late friend → a second tick inside the hour →
//   A's status page, nickname, leaderboard opt-in, ops hide → ops report and
//   the announcement script.
//
// What is mirrored rather than called (TanStack server functions and .tsx
// routes do not load under the Node test runner): the joinWaitlist handler's
// input mapping (`submit`), the /r/<code> redirect (`refFromShareLink`), and
// referralServiceDeps' wiring (`referralDeps`). Each mirror names its source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalEmail, isDisposableEmail } from "../src/lib/api/abuse.ts";
import type { Locale } from "../src/lib/i18n/locale.ts";
import { REFERRAL_COLUMNS, type LeaderboardSnapshot } from "../src/lib/referral/contract.ts";
import { buildLeaderboard, computeLedger, statusFor } from "../src/lib/referral/ledger.ts";
import { checkNickname } from "../src/lib/referral/nickname.ts";
import { BUDDY_GUIDE_DELAY_MS, WELCOME_DELAY_MS } from "../src/lib/verification/contracts.ts";
import {
  REFERRAL_PROGRAM_ID,
  referralClosesAt,
  referralProgramEnabled,
} from "../src/lib/referral/program.ts";
import {
  createLeaderboardCache,
  createRateLimiter,
  getReferralProgressService,
  getReferralStatusService,
  leaderboardResponse,
  updateReferralSettingsService,
  type ReferralServiceDeps,
} from "../src/lib/referral/service.server.ts";
import {
  referralSecret,
  shareUrl,
  signStatusToken,
  verifyStatusToken,
} from "../src/lib/referral/statusToken.ts";
import { createNotionReferralStore } from "../src/lib/referral/store.ts";
import { handleUnsubscribeRequest } from "../src/lib/launchMail/unsubscribe.server.ts";
import { createNotionLeadStore, createNotionRequest } from "../src/lib/verification/notionLead.ts";
import { handleVerificationReminderCron } from "../src/lib/verification/reminderCron.server.ts";
import {
  KR_AD_SUBJECT_PREFIX,
  KR_OPT_OUT_LINE,
  KR_SENDER_ADDRESS,
  buddyAdFooter,
  buddyListUnsubscribeHeaders,
  buddyUnsubscribeUrl,
  createResendMailer,
  referralNoticeBody,
} from "../src/lib/verification/resend.ts";
import {
  confirmVerificationService,
  requestVerificationService,
  type ServiceDependencies,
} from "../src/lib/verification/service.ts";
import { requirePublicOrigin } from "../src/lib/verification/token.ts";
import { handleReferralAnnounce } from "../src/lib/referral/announce.server.ts";
// Exercise the server assembly with the story's fake Notion and Resend transport.
async function announceMain(args: string[], env: Record<string, string>) {
  const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const apply = args.includes("--apply");
  const secret = "e2e-referral-cron-secret";
  const response = await handleReferralAnnounce(new Request("https://x.test/api/cron/referral-announce", {
    method: "POST", headers: { authorization: `Bearer ${secret}` },
    body: JSON.stringify({ releasedAt: value("--released-at"), mode: apply ? "apply" : "dry-run",
      confirm: value("--confirm") ?? (apply ? undefined : REFERRAL_PROGRAM_ID), only: value("--only") }),
  }), { ...env, WATCHDIVE_REMINDER_CRON_SECRET: secret });
  const result = await response.json();
  process.stdout.write(JSON.stringify(result));
  return response.ok && result.ok ? 0 : 2;
}
import { main as reportMain, type ReportSummary } from "../scripts/referral-report.ts";
import { runReferralSchema } from "../scripts/referral-schema.ts";
import { createFakeNetwork, type ResendMessage } from "./helpers/fakeNetwork.ts";

const DB = "0123456789abcdef0123456789abcdef";
const ORIGIN = "https://watchdive.diveroid.com";
const CRON_SECRET = "cron-secret-0123456789abcdef";
const A_EMAIL = "diver@example.com";
const A_CODE = "abc12345";
const A_LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const A_SIGNUP = "2026-07-31T23:55:00.000Z";
const A_CONFIRM = "2026-08-01T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const LEGACY_ROWS = 230;
const SENDER_PHONE = "+82 10-6517-6232";

// sha256 of the request body createResendMailer().sendWelcome produced at
// b364429 (before any Buddy Invite mail work) for exactly A's welcome:
// en, to diver@example.com, code abc12345, lead A_LEAD, origin ORIGIN,
// scheduled 2026-08-02T00:00:00.000Z, BASE_ENV sender. Recomputed from that
// commit's resend.ts on 2026-10-22 (git archive b364429 src).
const LEGACY_A_WELCOME_SHA256 = "c3e162e1e3fe07d83edc7122fe620d5bb4f6b965d195df7c50b4002903586253";

const BASE_ENV = {
  NOTION_API_KEY: "secret_fake_notion_key",
  NOTION_WAITLIST_DB_ID: DB,
  RESEND_API_KEY: "re_test_key",
  WATCHDIVE_EMAIL_FROM: "hello@watchdive.example",
  WATCHDIVE_EMAIL_REPLY_TO: "help@diveroid.com",
  WATCHDIVE_VERIFICATION_SECRET: "test-verification-secret-at-least-32b",
  WATCHDIVE_PUBLIC_ORIGIN: ORIGIN,
  WATCHDIVE_REMINDER_CRON_SECRET: CRON_SECRET,
  // On in both runs: OFF must stay silent because of the master switch alone.
  WATCHDIVE_REFERRAL_NOTICES_ENABLED: "1",
};

const noSleep = async () => {};

function kstMidnight(ms: number): number {
  return Math.floor((ms + KST_OFFSET) / DAY) * DAY - KST_OFFSET;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Mirror of src/routes/r.$code.tsx: `/r/<code>` → 302 `/?ref=<code>` → the form's referredBy. */
function refFromShareLink(link: string): string | undefined {
  const match = /^\/(?:[a-zA-Z-]+\/)?r\/([^/?#]+)$/.exec(new URL(link).pathname);
  const code = (match?.[1] ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return /^[a-z0-9]{8}$/.test(code) ? code : undefined;
}

type Scenario = ReturnType<typeof createScenario>;

function createScenario(on: boolean) {
  const env: Record<string, string> = {
    ...BASE_ENV,
    ...(on ? { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" } : {}),
    // Korean advertising mail must name the sender's phone, or it is refused.
    WATCHDIVE_SENDER_PHONE: SENDER_PHONE,
  };
  const net = createFakeNetwork(DB);
  const request = createNotionRequest(net.fetch, env);
  const participants = new Set<string>();
  let clockMs = Date.now();
  const shared = {
    leaderboardCache: createLeaderboardCache(),
    settingsLimiter: createRateLimiter(),
  };

  function verificationDeps(
    at: string | number,
    extra: Partial<ServiceDependencies> = {},
  ): ServiceDependencies {
    const now = new Date(at);
    return {
      store: createNotionLeadStore(request, DB),
      mailer: createResendMailer(env, net.fetch, noSleep),
      env,
      now: () => now,
      sleep: noSleep,
      ...extra,
    };
  }

  /**
   * Mirror of joinWaitlist's handler (src/lib/api/waitlist.functions.ts): the
   * address normalization, the abuse flags a plain browser submit can raise
   * (disposable domain), `suspect = flags.length > 0` and `sanitizeRef`. The
   * waitlist cap and the network gate are not part of this story.
   */
  async function submit(
    rawEmail: string,
    options: {
      at: string | number;
      ref?: string;
      locale?: Locale;
      leadId?: string;
      refCode?: string;
    },
  ) {
    const email = rawEmail.trim().toLowerCase();
    participants.add(email);
    const flags: string[] = [];
    if (isDisposableEmail(email)) flags.push("disposable");
    const ref = (options.ref ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8);
    return requestVerificationService(
      {
        email,
        canonical: canonicalEmail(email),
        source: "hero",
        ...(ref ? { referredBy: ref } : {}),
        attribution: { landingPath: ref ? `/?ref=${ref}` : "/" },
        flags,
        suspect: flags.length > 0,
        measurementConsent: false,
        locale: options.locale ?? "en",
        networkSendBlocked: false,
      },
      verificationDeps(options.at, {
        ...(options.leadId ? { leadId: () => options.leadId as string } : {}),
        ...(options.refCode ? { refCode: () => options.refCode as string } : {}),
      }),
    );
  }

  /** The token from the newest confirmation mail to this address, as the inbox shows it. */
  function mailedToken(email: string): string {
    const mail = net.resend
      .to(email)
      .filter((m) => m.idempotencyKey.startsWith("watchdive-verification-"))
      .at(-1);
    assert.ok(mail, `a confirmation mail reached ${email}`);
    const link = /https:\/\/\S+#(\S+)/.exec(mail.body.text as string);
    assert.ok(link, "the confirmation mail carries a link");
    return link[1];
  }

  async function confirm(email: string, at: string | number) {
    return confirmVerificationService(mailedToken(email), verificationDeps(at));
  }

  function welcomeOf(email: string): ResendMessage[] {
    return net.resend.to(email).filter((m) => m.idempotencyKey.startsWith("watchdive-welcome-"));
  }

  /** Mirror of referralServiceDeps (src/lib/api/referral.functions.ts) over the fake network. */
  function referralDeps(): ReferralServiceDeps {
    return {
      enabled: () => referralProgramEnabled(env),
      store: createNotionReferralStore(request, DB),
      secret: referralSecret(env),
      origin: requirePublicOrigin(env),
      now: () => new Date(clockMs),
      closesAt: () => referralClosesAt(env),
      verifyStatusToken,
      computeLedger,
      statusFor,
      buildLeaderboard,
      checkNickname,
      shareUrl,
      ...shared,
    };
  }

  /** One office Mac mini tick, exactly as launchd calls the v2 route. */
  async function cronTick(query = "") {
    const lines: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    console.error = console.log;
    try {
      const response = await handleVerificationReminderCron(
        new Request(`${ORIGIN}/api/cron/verification-reminder-v2${query}`, {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        }),
      );
      const notice = lines.find((line) => line.startsWith("[referral-notices]"));
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
        lines,
        notices: notice?.startsWith("[referral-notices] run ")
          ? (JSON.parse(notice.slice("[referral-notices] run ".length)) as Record<string, number>)
          : undefined,
      };
    } finally {
      console.log = log;
      console.error = error;
    }
  }

  return {
    on,
    env,
    net,
    participants,
    submit,
    confirm,
    welcomeOf,
    referralDeps,
    cronTick,
    advance(ms: number) {
      clockMs += ms;
    },
  };
}

/** Swap in the fake network and a clean env for code that reads the globals (cron, scripts). */
async function withGlobals<T>(s: Scenario, run: () => Promise<T>): Promise<T> {
  const savedFetch = globalThis.fetch;
  const savedEnv = process.env;
  globalThis.fetch = s.net.fetch;
  process.env = { PATH: savedEnv.PATH, TZ: savedEnv.TZ, ...s.env };
  try {
    return await run();
  } finally {
    globalThis.fetch = savedFetch;
    process.env = savedEnv;
  }
}

async function captureStdio<T>(
  run: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await run(), stdout, stderr };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

function referralCallsSince(s: Scenario, from: number) {
  const names = Object.values(REFERRAL_COLUMNS).filter(
    (name) => name !== "Ref code" && name !== "Referred by",
  );
  return s.net.notion.calls.slice(from).filter((call) => {
    const text = JSON.stringify(call.body ?? {});
    return names.some((name) => text.includes(name)) || text.includes('"Ref code"');
  });
}

/** No address, page id or (for the board) ref code in anything a stranger or the owner's browser receives. */
function assertNoPii(
  s: Scenario,
  label: string,
  value: unknown,
  options: { refCodes?: string[] } = {},
) {
  // The sender's own published contact address is required in every mail
  // footer (opt-out and Korean advertising rules); nothing else may carry "@".
  const text = JSON.stringify(value).replaceAll("help@diveroid.com", "");
  assert.equal(text.includes("@"), false, `${label}: no "@" in ${text}`);
  for (const email of s.participants)
    assert.equal(text.includes(email), false, `${label}: no ${email}`);
  for (const pageId of s.net.notion.pages.keys()) {
    assert.equal(text.includes(pageId), false, `${label}: no page id`);
  }
  for (const code of options.refCodes ?? []) {
    assert.equal(text.includes(code), false, `${label}: no ref code ${code}`);
  }
}

/**
 * Every Buddy Invite mail: RFC 8058 one-click https opt-out first, the mailto
 * fallback second, and the same https link in the footer. Returns that link.
 */
function assertBuddyOptOut(m: ResendMessage): string {
  const header = String(m.body.headers?.["List-Unsubscribe"] ?? "");
  const match =
    /^<(https:\/\/watchdive\.diveroid\.com\/unsubscribe\/[^>\s]+)>, <mailto:help@diveroid\.com\?subject=unsubscribe>$/.exec(
      header,
    );
  assert.ok(match, `one-click https + mailto List-Unsubscribe, got ${header}`);
  assert.equal(m.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok((m.body.text as string).includes(match[1]), "the text footer carries the opt-out");
  assert.ok((m.body.html as string).includes(`href="${match[1]}"`), "so does the HTML footer");
  assert.ok((m.body.text as string).includes("help@diveroid.com"), "the sender's contact");
  return match[1];
}

/** Korean reader: "(광고)" subject, Korean sender block with the phone, Korean opt-out line. */
function assertKoreanAdMail(m: ResendMessage): string {
  const link = assertBuddyOptOut(m);
  assert.ok((m.body.subject as string).startsWith("(광고) "), m.body.subject);
  assert.equal(KR_AD_SUBJECT_PREFIX, "(광고) ");
  assert.ok(
    (m.body.text as string).includes(
      `보내는 곳: DIVEROID LTD · help@diveroid.com · ${SENDER_PHONE} · ${KR_SENDER_ADDRESS}`,
    ),
    "the Korean sender block names company, contact, phone and address",
  );
  assert.ok((m.body.text as string).includes(KR_OPT_OUT_LINE));
  assert.ok((m.body.text as string).includes(`수신거부 / Unsubscribe: ${link}`));
  assert.ok(
    (m.body.html as string).includes(`<span style="white-space:nowrap;">${SENDER_PHONE}</span>`),
  );
  return link;
}

/** Everyone else: no ad prefix, no Korean sender block, the company footer. */
function assertNotKoreanAdMail(m: ResendMessage): string {
  const link = assertBuddyOptOut(m);
  assert.equal((m.body.subject as string).includes("(광고)"), false);
  assert.equal((m.body.text as string).includes("보내는 곳"), false);
  assert.equal((m.body.text as string).includes(SENDER_PHONE), false);
  assert.ok((m.body.text as string).includes("DIVEROID LTD · "), "company footer");
  return link;
}

async function runStory(on: boolean) {
  const s = createScenario(on);
  const { net, env } = s;
  const unsubscribeFor = (lead: string, locale: Locale): string => {
    const url = buddyUnsubscribeUrl(ORIGIN, lead, locale, env);
    assert.ok(url, "an opt-out link can be signed for this lead");
    return url;
  };
  const footerFor = (lead: string, locale: Locale) =>
    buddyAdFooter({ locale, unsubscribeUrl: unsubscribeFor(lead, locale), env });
  const realNow = Date.now();
  const day1 = kstMidnight(realNow - 2 * DAY);

  // Pre-program single opt-in rows, enough that every full scan pages (100 a page).
  for (let i = 0; i < LEGACY_ROWS; i++) {
    const email = `legacy${i}@example.com`;
    const response = await net.notion.handle("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: { Authorization: "Bearer seed" },
      body: JSON.stringify({
        parent: { database_id: DB },
        properties: {
          Email: { title: [{ text: { content: email } }] },
          "Canonical email": { email },
          Source: { select: { name: "hero" } },
          "Signed up": { date: { start: "2026-07-20T00:00:00.000Z" } },
          "Ref code": { rich_text: [{ text: { content: `lg${String(i).padStart(6, "0")}` } }] },
          Suspect: { checkbox: false },
        },
      }),
    });
    assert.equal(response.status, 200);
  }

  // ---- 0. Ops adds the program columns (ON only; OFF ships before ops runs it).
  if (on) {
    const first = await runReferralSchema({ args: ["--apply"], env, fetchImpl: net.fetch });
    assert.equal(first.exitCode, 0);
    assert.equal(first.report.applied, true);
    const again = await runReferralSchema({ args: ["--apply"], env, fetchImpl: net.fetch });
    assert.deepEqual(
      [again.exitCode, again.report.applied],
      [0, false],
      "a second run changes nothing",
    );
  }

  // ---- 1. A signs up and confirms.
  const aSubmit = await s.submit(A_EMAIL, { at: A_SIGNUP, leadId: A_LEAD, refCode: A_CODE });
  assert.equal(aSubmit.status, "pending");
  const aConfirm = await s.confirm(A_EMAIL, A_CONFIRM);
  assert.equal(aConfirm.status, "verified");
  assert.equal((aConfirm as { refCode?: string }).refCode, A_CODE);
  const aPage = net.notion.pageByEmail(A_EMAIL)!;
  assert.equal(net.notion.text(aPage.id, "Ref code"), A_CODE);

  const [welcome, ...extraWelcomes] = s.welcomeOf(A_EMAIL);
  assert.ok(welcome, "A's welcome mail was handed to Resend");
  assert.equal(extraWelcomes.length, 0);
  assert.equal(welcome.idempotencyKey, `watchdive-welcome-${A_LEAD}`);
  const delay = Date.parse(welcome.body.scheduled_at) - Date.parse(A_CONFIRM);
  const share = /https:\/\/\S+?\/r\/[a-z0-9]{8}/.exec(welcome.body.text as string)?.[0];
  assert.equal(share, `${ORIGIN}/r/${A_CODE}`);

  let aStatusToken = "";
  if (on) {
    assert.equal(delay, BUDDY_GUIDE_DELAY_MS, "the guide is held 30 minutes");
    assert.equal(welcome.body.subject, "You’re on the WatchDive waitlist — invite your buddies");
    const status = /https:\/\/\S+?\/buddy#([a-z0-9]{8}\.1\.[A-Za-z0-9_-]{24})/.exec(
      welcome.body.text,
    );
    assert.ok(status, "the guide links the signed status page");
    aStatusToken = status[1];
    assert.equal(verifyStatusToken(aStatusToken, referralSecret(env)), A_CODE);
    assert.match(
      welcome.body.text,
      new RegExp(`${ORIGIN}/buddy-rules(\\s|$)`),
      "the guide links the rules",
    );
    assert.ok((welcome.body.html as string).includes(`href="${ORIGIN}/buddy#${aStatusToken}"`));
    assert.equal(assertNotKoreanAdMail(welcome), unsubscribeFor(A_LEAD, "en"), "A's own opt-out");
  } else {
    assert.equal(delay, WELCOME_DELAY_MS, "the legacy welcome is held 24 hours");
    assert.equal(sha256(welcome.raw), LEGACY_A_WELCOME_SHA256, "legacy welcome, byte for byte");
    assert.equal(/buddy/i.test(welcome.raw), false);
  }
  assertNoPii(s, "welcome body", {
    subject: welcome.body.subject,
    text: welcome.body.text,
    html: welcome.body.html,
  });

  // A clicks the same link again: `Welcome email` is set, so no second request at all.
  assert.ok(net.notion.pages.get(aPage.id)!.properties["Welcome email"]);
  const requestsBefore = net.resend.messages.length + net.resend.collapsed;
  assert.equal((await s.confirm(A_EMAIL, Date.parse(A_CONFIRM) + MIN)).status, "already_verified");
  assert.equal(net.resend.messages.length + net.resend.collapsed, requestsBefore);

  // ---- 2. Friends arrive through A's share link.
  const ref = refFromShareLink(share!);
  assert.equal(ref, A_CODE);
  const friends = Array.from(
    { length: 12 },
    (_, i) => `f${String(i + 1).padStart(2, "0")}@example.net`,
  );
  for (const [i, email] of friends.entries()) {
    // f01..f11 on one Korean calendar day (one over the daily cap), f12 the next.
    const at = i < 11 ? day1 + 2 * 60 * MIN + i * 2 * MIN : day1 + DAY + 2 * 60 * MIN;
    // B (f01) reads the site in Korean: their guide, status link and notices are Korean.
    const locale = i === 0 ? "ko" : "en";
    assert.equal((await s.submit(email, { at, ref, locale })).status, "pending");
    assert.equal((await s.confirm(email, at + 2 * MIN)).status, "verified");
    assert.equal(net.notion.text(net.notion.pageByEmail(email)!.id, "Referred by"), A_CODE);
  }
  // f01 (B) shares too: one friend of their own.
  const bEmail = friends[0];
  const bCode = net.notion.text(net.notion.pageByEmail(bEmail)!.id, "Ref code");
  const bLead = net.notion.text(net.notion.pageByEmail(bEmail)!.id, "Lead ID");
  const bShare = /https:\/\/\S+?\/r\/[a-z0-9]{8}/.exec(s.welcomeOf(bEmail)[0].body.text)![0];
  // Every Buddy Invite mail hands out the unprefixed /r/<code>: the friend's own
  // language picks the page. The legacy welcome (OFF) keeps the sender's locale
  // prefix, exactly as at b364429; both routes redirect to the same ?ref=.
  assert.equal(bShare, on ? `${ORIGIN}/r/${bCode}` : `${ORIGIN}/ko/r/${bCode}`);
  if (on) {
    assert.match(
      s.welcomeOf(bEmail)[0].body.text,
      new RegExp(`${ORIGIN}/ko/buddy#${bCode}\\.1\\.`),
    );
    // B's guide is Korean advertising mail.
    assert.equal(assertKoreanAdMail(s.welcomeOf(bEmail)[0]), unsubscribeFor(bLead, "ko"));
  } else {
    // The legacy Korean welcome stays the pre-program mail: no ad block, mailto only.
    const legacy = s.welcomeOf(bEmail)[0];
    assert.equal(legacy.body.subject.startsWith("(광고)"), false);
    assert.equal(legacy.body.text.includes(SENDER_PHONE), false);
    assert.deepEqual(legacy.body.headers, {
      "List-Unsubscribe": "<mailto:help@diveroid.com?subject=unsubscribe>",
    });
  }
  assert.equal(refFromShareLink(bShare), bCode);
  await s.submit("m@example.org", { at: day1 + 5 * 60 * MIN, ref: refFromShareLink(bShare) });
  assert.equal(
    (await s.confirm("m@example.org", day1 + 5 * 60 * MIN + 2 * MIN)).status,
    "verified",
  );

  // A disposable inbox: the row is kept for review, no mail goes out.
  const sentBefore = net.resend.messages.length;
  assert.equal(
    (await s.submit("x@mailinator.com", { at: day1 + 3 * 60 * MIN, ref })).status,
    "pending",
  );
  assert.equal(
    net.resend.messages.length,
    sentBefore,
    "no confirmation mail to a disposable inbox",
  );
  const xPage = net.notion.pageByEmail("x@mailinator.com")!;
  assert.equal(net.notion.text(xPage.id, "Referred by"), A_CODE);
  // Someone who never confirms.
  await s.submit("never@example.org", { at: day1 + 3 * 60 * MIN + MIN, ref });
  // A's own alias on A's link: the canonical dedupe answers before any row exists.
  const pagesBefore = net.notion.pages.size;
  const alias = await s.submit("Diver+buddy@example.com", {
    at: day1 + 3 * 60 * MIN + 2 * MIN,
    ref,
  });
  assert.equal(alias.status, "already_verified");
  assert.equal(net.notion.pages.size, pagesBefore, "a self-referral alias creates no row");
  assert.equal(net.resend.to("diver+buddy@example.com").length, 0);
  // A mistyped share link: the row keeps the code it came in on, nobody is credited.
  const typoRef = refFromShareLink(`${ORIGIN}/r/zzzzzzzz`);
  await s.submit("typo@example.net", { at: day1 + 4 * 60 * MIN, ref: typoRef });
  assert.equal(
    (await s.confirm("typo@example.net", day1 + 4 * 60 * MIN + 2 * MIN)).status,
    "verified",
  );

  // ---- 3. The office cron tick.
  const unauthorized = await withGlobals(s, () =>
    handleVerificationReminderCron(new Request(`${ORIGIN}/api/cron/verification-reminder-v2`)),
  );
  assert.equal(unauthorized.status, 401);

  // A dry-run tick counts and changes nothing.
  const mailsBeforeDry = net.resend.messages.length;
  const callsBeforeDry = net.notion.calls.length;
  const dryTick = await withGlobals(s, () => s.cronTick("?mode=dry-run"));
  assert.equal(dryTick.status, 200);
  assert.equal(net.resend.messages.length, mailsBeforeDry, "dry run: no mail");
  assert.deepEqual(
    net.notion.calls
      .slice(callsBeforeDry)
      // Reads only: row queries and (at most) the notice pass's schema GET.
      .filter(
        (call) =>
          call.method !== "GET" && (call.method !== "POST" || !call.path.endsWith("/query")),
      ),
    [],
    "dry run: reads only, no write",
  );
  if (on) {
    assert.deepEqual([dryTick.notices?.wouldSend, dryTick.notices?.sent], [2, 0]);
  } else {
    assert.equal(dryTick.notices, undefined);
  }

  const callsBeforeTick = net.notion.calls.length;
  const tick1 = await withGlobals(s, () => s.cronTick());
  if (on) {
    // The program scan walked every page of the 250-odd rows.
    const scan = net.notion.calls
      .slice(callsBeforeTick)
      .filter((call) => JSON.stringify(call.body ?? {}).includes('"is_not_empty":true'));
    assert.deepEqual(
      scan.map((call) => (call.body as { start_cursor?: string }).start_cursor ?? null),
      [null, "cursor-100", "cursor-200"],
    );
  }
  assert.equal(tick1.status, 200);
  assert.equal(tick1.body.ok, true);
  assertNoPii(s, "cron response and log", { body: tick1.body, lines: tick1.lines });
  assert.equal(tick1.body.sent, 1, "the shared tick still sends the one 24h reminder");
  assert.equal(
    net.resend
      .to("never@example.org")
      .filter((m) => m.idempotencyKey.startsWith("watchdive-verification-reminder-")).length,
    1,
  );
  const notices = () => net.resend.messages.filter((m) => m.idempotencyKey.includes("-notice-"));

  if (on) {
    assert.deepEqual(
      {
        sent: tick1.notices?.sent,
        pending: tick1.notices?.pending,
        enabled: tick1.notices?.enabled,
      },
      { sent: 2, pending: 2, enabled: true },
    );
    const toA = notices().filter((m) => m.body.to.includes(A_EMAIL));
    assert.equal(toA.length, 1, "one notice to A");
    const notice = toA[0];
    assert.deepEqual(notice.body.to, [A_EMAIL]);
    assert.equal(notice.idempotencyKey, `${REFERRAL_PROGRAM_ID}-notice-${A_CODE}-11`);
    const statusUrl = /https:\/\/\S+?\/buddy#([a-z0-9]{8}\.1\.[A-Za-z0-9_-]{24})/.exec(
      notice.body.text,
    );
    assert.equal(verifyStatusToken(statusUrl?.[1], referralSecret(env)), A_CODE);
    // 11 credited: ten on day one (the eleventh is over the cap), one on day two.
    const expected = referralNoticeBody(
      {
        locale: "en",
        credited: 11,
        crossed: ["first", "buddy", "team", "leader"],
        nextTier: null,
        remainingToNext: null,
        statusUrl: statusUrl![0],
      },
      footerFor(A_LEAD, "en"),
    );
    assert.deepEqual(
      { subject: notice.body.subject, text: notice.body.text, html: notice.body.html },
      expected,
    );
    const toB = notices().filter((m) => m.body.to.includes(bEmail));
    assert.equal(toB.length, 1);
    assert.equal(toB[0].idempotencyKey, `${REFERRAL_PROGRAM_ID}-notice-${bCode}-1`);
    // B's notice is the Korean one, byte for byte: "(광고)" subject, Korean
    // sender block with the phone, Korean opt-out line.
    const bStatusUrl = /https:\/\/\S+?\/ko\/buddy#[a-z0-9]{8}\.1\.[A-Za-z0-9_-]{24}/.exec(
      toB[0].body.text,
    )?.[0];
    assert.ok(bStatusUrl, "B's notice links B's Korean status page");
    assert.deepEqual(
      { subject: toB[0].body.subject, text: toB[0].body.text, html: toB[0].body.html },
      referralNoticeBody(
        {
          locale: "ko",
          credited: 1,
          crossed: ["first"],
          nextTier: "buddy",
          remainingToNext: 2,
          statusUrl: bStatusUrl,
        },
        footerFor(bLead, "ko"),
      ),
    );
    assertKoreanAdMail(toB[0], bLead);
    assertNotKoreanAdMail(notice);
    for (const m of notices()) {
      assertNoPii(
        s,
        "notice mail",
        { subject: m.body.subject, text: m.body.text, html: m.body.html },
        {
          refCodes: [A_CODE, bCode].filter(
            (code) => !(m.body.text as string).includes(`/buddy#${code}.`),
          ),
        },
      );
      // Only the sender's own addresses besides To.
      assert.deepEqual(Object.keys(m.body).sort(), [
        "from",
        "headers",
        "html",
        "reply_to",
        "subject",
        "text",
        "to",
      ]);
      // RFC 8058 one-click (https first) plus the mailto fallback, for the
      // recipient's own lead.
      const lead = m.body.to[0] === A_EMAIL ? A_LEAD : bLead;
      const locale = m.body.to[0] === A_EMAIL ? "en" : "ko";
      assert.deepEqual(
        m.body.headers,
        buddyListUnsubscribeHeaders(unsubscribeFor(lead, locale), "help@diveroid.com"),
      );
    }
    const aCells = net.notion.pages.get(aPage.id)!.properties as Record<
      string,
      { number?: number; date?: { start: string } }
    >;
    assert.equal(aCells[REFERRAL_COLUMNS.notifiedCount].number, 11);
    assert.ok(aCells[REFERRAL_COLUMNS.notifiedAt].date?.start);
  } else {
    assert.equal(tick1.notices, undefined, "OFF: the notice pass does not even log");
    assert.equal(notices().length, 0, "OFF: no notice");
    assert.deepEqual(
      referralCallsSince(s, callsBeforeTick),
      [],
      "OFF: no referral Notion read or write",
    );
  }

  // ---- 4. A late friend each for A and B (B has turned notices off), then a
  // second tick inside the hour.
  const bToken = signStatusToken(bCode, referralSecret(env));
  if (on) {
    const bWelcomeToken = /\/buddy#([a-z0-9]{8}\.1\.[A-Za-z0-9_-]{24})/.exec(
      s.welcomeOf(bEmail)[0].body.text,
    )?.[1];
    assert.equal(bWelcomeToken, bToken, "B's guide links B's own status page");
    const off = await updateReferralSettingsService(
      bToken,
      { nickname: null, leaderboard: false, noticesOff: true },
      s.referralDeps(),
    );
    assert.equal(off.status, "ok");
  }
  await s.submit("late@example.net", { at: Date.now() - 4 * MIN, ref });
  assert.equal((await s.confirm("late@example.net", Date.now() - 2 * MIN)).status, "verified");
  await s.submit("m2@example.org", { at: Date.now() - 4 * MIN, ref: bCode });
  assert.equal((await s.confirm("m2@example.org", Date.now() - 2 * MIN)).status, "verified");
  const sentBeforeTick2 = net.resend.messages.length;
  const callsBeforeTick2 = net.notion.calls.length;
  const tick2 = await withGlobals(s, () => s.cronTick());
  assert.equal(tick2.status, 200);
  assert.equal(net.resend.messages.length, sentBeforeTick2, "the second tick sends nothing");
  if (on) {
    assert.deepEqual(
      {
        sent: tick2.notices?.sent,
        pending: tick2.notices?.pending,
        skippedInterval: tick2.notices?.skippedInterval,
        skippedNoticesOff: tick2.notices?.skippedNoticesOff,
      },
      { sent: 0, pending: 2, skippedInterval: 1, skippedNoticesOff: 1 },
      "A's 12th friend waits for the hourly interval; B asked for no notices",
    );
  } else {
    assert.deepEqual(referralCallsSince(s, callsBeforeTick2), []);
  }

  // ---- 5. Status page, settings, leaderboard.
  const publicOut: unknown[] = [];
  const board = async () => {
    const response = await leaderboardResponse(referralProgramEnabled(env), async () =>
      s.referralDeps(),
    );
    const body = (await response.json()) as LeaderboardSnapshot & { enabled?: boolean };
    publicOut.push(body);
    return { response, body };
  };
  if (on) {
    const deps = s.referralDeps();
    const status = await getReferralStatusService(aStatusToken, "en", deps);
    publicOut.push(status);
    assert.equal(status.status, "ok");
    assert.ok(status.status === "ok");
    assert.equal(status.referral.credited, 12);
    assert.equal(status.referral.highestTier, "leader");
    assert.equal(status.referral.nextTier, null);
    assert.equal(status.referral.remainingToNext, null);
    assert.equal(status.referral.earlyNoticeHours, 2);
    assert.equal(status.referral.lightEligible, true);
    assert.equal(status.referral.rank, 1);
    assert.equal(status.referral.nickname, null);
    assert.equal(status.referral.leaderboard, false);
    assert.equal(status.referral.nicknameHidden, false);
    assert.equal(status.referral.noticesOff, false);
    assert.equal(status.referral.shareUrl, `${ORIGIN}/r/${A_CODE}`);
    assert.equal(status.referral.closed, false);
    assert.match(
      status.referral.shareCode ?? "",
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
    );
    assert.equal(status.referral.shareCodeCustom, false);
    assert.equal(status.referral.shareCodeLocked, false);
    const bStatus = await getReferralStatusService(bToken, "en", deps);
    publicOut.push(bStatus);
    assert.ok(bStatus.status === "ok");
    assert.deepEqual(
      [
        bStatus.referral.credited,
        bStatus.referral.rank,
        bStatus.referral.nextTier,
        bStatus.referral.remainingToNext,
      ],
      [2, 2, "buddy", 1],
    );

    // A forged link costs no Notion read.
    const before = net.notion.calls.length;
    const forged = `${A_CODE}.1.${bToken.split(".")[2]}`;
    assert.deepEqual(await getReferralStatusService(forged, "en", deps), { status: "invalid" });
    assert.equal(net.notion.calls.length, before);

    let lb = await board();
    assert.equal(lb.response.status, 200);
    assert.match(lb.response.headers.get("Cache-Control") ?? "", /public, s-maxage=300/);
    assert.deepEqual(lb.body.entries, [
      { rank: 1, nickname: null, credited: 12 },
      { rank: 2, nickname: null, credited: 2 },
    ]);
    const progress = await getReferralProgressService(A_CODE, deps);
    publicOut.push(progress);
    assert.deepEqual(progress, { enabled: true, credited: 12 });

    const save = async (input: { nickname: string | null; leaderboard: boolean }) => {
      const result = await updateReferralSettingsService(
        aStatusToken,
        { ...input, noticesOff: false },
        s.referralDeps(),
      );
      publicOut.push(result);
      return result;
    };
    // Nickname without opt-in: stored, not shown.
    assert.equal((await save({ nickname: "Reef Runner", leaderboard: false })).status, "ok");
    assert.equal(net.notion.text(aPage.id, REFERRAL_COLUMNS.nickname), "Reef Runner");
    lb = await board();
    assert.equal(lb.body.entries[0].nickname, null);
    // Opt in: shown.
    await save({ nickname: "Reef Runner", leaderboard: true });
    lb = await board();
    assert.equal(lb.body.entries[0].nickname, "Reef Runner");
    // Ops hides it in Notion; the public board catches up after its cache lifetime.
    net.notion.setCell(aPage.id, REFERRAL_COLUMNS.nicknameHidden, { checkbox: true });
    s.advance(301 * 1000);
    lb = await board();
    assert.equal(lb.body.entries[0].nickname, null, "a hidden nickname is not shown");
    const hiddenStatus = await getReferralStatusService(aStatusToken, "en", s.referralDeps());
    assert.ok(hiddenStatus.status === "ok" && hiddenStatus.referral.nicknameHidden);
    // Saving the same nickname does not undo the hide; a new one does.
    await save({ nickname: "Reef Runner", leaderboard: true });
    assert.equal((await board()).body.entries[0].nickname, null);
    await save({ nickname: "Coral Kid", leaderboard: true });
    assert.equal((await board()).body.entries[0].nickname, "Coral Kid");
    const cells = net.notion.pages.get(aPage.id)!.properties as Record<
      string,
      { checkbox?: boolean }
    >;
    assert.equal(cells[REFERRAL_COLUMNS.nicknameHidden].checkbox, false);
    // Contact details and staff-like names never reach Notion.
    assert.deepEqual(await save({ nickname: "me@mail.com", leaderboard: true }), {
      status: "rejected",
      reason: "contact_info",
    });
    assert.deepEqual(await save({ nickname: "WatchDive Admin", leaderboard: true }), {
      status: "rejected",
      reason: "reserved",
    });
    assert.equal(net.notion.text(aPage.id, REFERRAL_COLUMNS.nickname), "Coral Kid");
  } else {
    const before = net.notion.calls.length;
    const token = signStatusToken(A_CODE, referralSecret(env));
    const deps = s.referralDeps();
    assert.deepEqual(await getReferralStatusService(token, "en", deps), { status: "disabled" });
    assert.deepEqual(
      await updateReferralSettingsService(
        token,
        { nickname: "Reef Runner", leaderboard: true, noticesOff: false },
        deps,
      ),
      { status: "disabled" },
    );
    assert.deepEqual(await getReferralProgressService(A_CODE, deps), { enabled: false });
    const lb = await board();
    assert.equal(lb.response.status, 404);
    assert.equal(lb.response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(lb.body, { enabled: false });
    assert.equal(net.notion.calls.length, before, "OFF: no Notion call from any referral surface");
  }
  for (const [i, value] of publicOut.entries()) {
    // The owner's own share link carries the owner's code by design; nothing else may.
    const isOwnerStatus = typeof value === "object" && value !== null && "referral" in value;
    assertNoPii(s, `public response ${i}`, value, {
      refCodes: isOwnerStatus ? [] : [A_CODE, bCode],
    });
  }

  // ---- 6. Ops report against the same database.
  const dir = await mkdtemp(join(tmpdir(), "wd-referral-e2e-"));
  try {
    const summaryPath = join(dir, "summary.json");
    const report = await withGlobals(s, () =>
      captureStdio(() =>
        reportMain(
          ["--out", summaryPath, "--with-emails", "--out-dir", join(dir, "private")],
          s.env,
        ),
      ),
    );
    assert.equal(report.result, 0, report.stderr);
    const raw = await readFile(summaryPath, "utf8");
    assert.equal(raw.includes("@"), false, "the summary holds no address");
    const summary = JSON.parse(raw) as ReportSummary;
    assert.equal(summary.rowsScanned, net.notion.pages.size);
    assert.deepEqual(
      summary.top10.map((r) => [r.rank, r.refCode, r.credited]),
      [
        [1, A_CODE, 12],
        [2, bCode, 2],
      ],
    );
    assert.equal(summary.top10[0].nickname, on ? "Coral Kid" : null);
    assert.deepEqual(summary.tierCounts, { first: 2, buddy: 1, team: 1, leader: 1 });
    assert.equal(summary.excluded.daily_cap, 1);
    assert.equal(
      summary.excluded.not_verified,
      2,
      "the disposable row and the one who never confirmed",
    );
    assert.equal(summary.excluded.self_referral, 0, "the alias never became a row");
    assert.equal(summary.excluded.unknown_referrer, 1, "the mistyped link");
    assert.deepEqual(
      summary.lightAllocation.map((l) => [l.order, l.refCode]),
      [[1, A_CODE]],
    );
    const aReview = summary.review.find((c) => c.refCode === A_CODE)!;
    // Eleven friends two minutes apart, all on the same link and language: flagged for a look.
    // …and every one of them on example.net, signed up minutes apart.
    assert.deepEqual(aReview.reasons, [
      "burst_verifications",
      "same_locale",
      "same_landing_path",
      "domain_concentration",
      "burst_signups",
    ]);
    assert.equal(aReview.review_needed, true);
    assert.deepEqual(
      summary.leaderboardSnapshot.entries.map((e) => e.credited),
      [12, 2],
    );
    const files = (await readdir(join(dir, "private"))).sort();
    assert.deepEqual(files, [
      "dive-team.csv",
      "early-notice-1h.csv",
      "early-notice-2h.csv",
      "light-winners.csv",
      "top-candidates.csv",
    ]);
    assert.match(
      await readFile(join(dir, "private", "early-notice-2h.csv"), "utf8"),
      /diver@example\.com,abc12345,12/,
    );
    assert.match(
      await readFile(join(dir, "private", "early-notice-1h.csv"), "utf8"),
      new RegExp(`${bEmail},${bCode},2`),
    );

    // ---- 7. The announcement script: dry run, then the switch and --confirm gates.
    const releasedAt = new Date(realNow + DAY).toISOString();
    const dry = await withGlobals(s, () =>
      captureStdio(() =>
        announceMain(["--released-at", releasedAt], s.env),
      ),
    );
    if (on) {
      assert.equal(dry.result, 0, dry.stderr);
      const dryResult = JSON.parse(dry.stdout) as Record<string, unknown> & {
        skipped: Record<string, number>;
      };
      assert.equal(dryResult.mode, "dry-run");
      assert.equal(dryResult.rowsScanned, net.notion.pages.size);
      assert.equal(dryResult.eligible, net.notion.pages.size - 2 - LEGACY_ROWS);
      assert.deepEqual(
        dryResult.skipped,
        { not_verified: 2 + LEGACY_ROWS },
        "pending rows and legacy rows",
      );
      for (const email of s.participants)
        assert.equal(dry.stdout.includes(email), false, "dry run masks addresses");

    } else {
      assert.equal(dry.result, 2);
    }

    const mailsBefore = net.resend.messages.length;
    const callsBefore = net.notion.calls.length;
    const noConfirm = await withGlobals(s, () =>
      captureStdio(() =>
        announceMain(
          ["--released-at", releasedAt, "--apply"],
          s.env,
        ),
      ),
    );
    assert.equal(noConfirm.result, 2, "apply without --confirm is refused");
    assert.equal(net.resend.messages.length, mailsBefore);
    if (on) {
      const selfTest = await withGlobals(s, () =>
        captureStdio(() =>
          announceMain(
            [
              "--released-at",
              releasedAt,
              "--only",
              A_EMAIL,
              "--apply",
              "--confirm",
              REFERRAL_PROGRAM_ID,
            ],
            s.env,
          ),
        ),
      );
      assert.equal(selfTest.result, 0, selfTest.stderr);
      const announced = net.resend.messages.slice(mailsBefore);
      assert.equal(announced.length, 1);
      assert.deepEqual(announced[0].body.to, [A_EMAIL]);
      assert.equal(assertNotKoreanAdMail(announced[0]), unsubscribeFor(A_LEAD, "en"));
      assert.equal(
        announced[0].idempotencyKey,
        `${REFERRAL_PROGRAM_ID}-announce-${A_LEAD}-selftest`,
      );
      for (const email of s.participants) {
        if (email !== A_EMAIL) assert.equal(announced[0].raw.includes(email), false);
      }
      assert.equal(net.notion.pageByEmail(A_EMAIL)!.properties["Referral announce"], undefined,
        "self-test does not mark the row");

      const announce = (only: string, runEnv: Record<string, string> = s.env) =>
        withGlobals(s, () =>
          captureStdio(() =>
            announceMain(
              [
                "--released-at",
                releasedAt,
                "--only",
                only,
                "--apply",
                "--confirm",
                REFERRAL_PROGRAM_ID,
              ],
              runEnv,
            ),
          ),
        );
      // A Korean recipient without WATCHDIVE_SENDER_PHONE: the run is refused
      // before any send, not mailed without the sender block.
      const { WATCHDIVE_SENDER_PHONE: _phone, ...noPhoneEnv } = s.env;
      const noPhone = await announce(bEmail, noPhoneEnv);
      assert.equal(noPhone.result, 2, noPhone.stdout);
      assert.deepEqual(
        [
          (JSON.parse(noPhone.stdout) as { aborted?: string }).aborted,
          (JSON.parse(noPhone.stdout) as { senderPhoneMissing?: number }).senderPhoneMissing,
          net.resend.messages.length,
        ],
        ["sender_phone_missing", 1, mailsBefore + 1],
      );

      // ---- 7b. Opt-outs, through the real one-click endpoint, and legal
      // review D7: unsubscribing stops mail, it never removes standing.
      const pageOf = (email: string) => net.notion.pageByEmail(email)!.id;
      const oneClick = async (link: string, method: "GET" | "POST") => {
        const token = /\/unsubscribe\/([^/?#]+)$/.exec(new URL(link).pathname)![1];
        return withGlobals(s, () =>
          handleUnsubscribeRequest(
            new Request(link, {
              method,
              ...(method === "POST"
                ? {
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: "List-Unsubscribe=One-Click",
                  }
                : {}),
            }),
            decodeURIComponent(token),
          ),
        );
      };
      // B turns notices back on, and an hour passes since the last notices, so
      // both referrers have a pending, sendable notice again.
      assert.equal(
        (
          await updateReferralSettingsService(
            bToken,
            { nickname: null, leaderboard: false, noticesOff: false },
            s.referralDeps(),
          )
        ).status,
        "ok",
      );
      const hourAgo = new Date(Date.now() - 61 * MIN).toISOString();
      for (const page of [aPage.id, pageOf(bEmail)]) {
        net.notion.setCell(page, REFERRAL_COLUMNS.notifiedAt, { date: { start: hourAgo } });
      }
      const wouldTick = await withGlobals(s, () => s.cronTick("?mode=dry-run"));
      assert.deepEqual(
        [wouldTick.notices?.pending, wouldTick.notices?.wouldSend],
        [2, 2],
        "before the opt-outs both notices would go",
      );

      // A uses the one-click link from the notice's List-Unsubscribe header. A
      // link scanner's GET only shows the confirm page and writes nothing.
      const aLink = assertBuddyOptOut(notices().find((m) => m.body.to[0] === A_EMAIL)!);
      const callsBeforeGet = net.notion.calls.length;
      assert.equal((await oneClick(aLink, "GET")).status, 200);
      assert.equal(net.notion.calls.length, callsBeforeGet, "GET writes nothing");
      assert.equal(net.notion.text(aPage.id, "Launch mail"), "");
      assert.equal((await oneClick(aLink, "POST")).status, 200);
      assert.match(net.notion.text(aPage.id, "Launch mail"), /^unsubscribed \d{4}-/);
      // B opted out on another row of the same inbox (an older repeat sign-up,
      // different case): that holds every row of the address.
      const bOther = await net.notion.handle("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: { Authorization: "Bearer seed" },
        body: JSON.stringify({
          parent: { database_id: DB },
          properties: {
            Email: { title: [{ text: { content: bEmail.toUpperCase() } }] },
            "Canonical email": { email: bEmail },
            Source: { select: { name: "hero" } },
            "Signed up": { date: { start: "2026-07-20T00:00:00.000Z" } },
            "Ref code": { rich_text: [{ text: { content: "bother00" } }] },
            Suspect: { checkbox: false },
            "Reservation mail": { rich_text: [{ text: { content: "unsubscribed" } }] },
          },
        }),
      });
      assert.equal(bOther.status, 200);
      assert.equal(net.notion.text(pageOf(bEmail), "Reservation mail"), "", "B's own row is clean");
      // Two of A's friends unsubscribe after confirming: f02 by its guide's
      // one-click link, f12 marked unsubscribed by ops. f12 is the day-two
      // friend, so losing it would show (a day-one loss is refilled by the
      // friend over that day's cap).
      const f02Link = assertBuddyOptOut(s.welcomeOf(friends[1])[0]);
      assert.equal((await oneClick(f02Link, "POST")).status, 200);
      assert.match(net.notion.text(pageOf(friends[1]), "Launch mail"), /^unsubscribed /);
      net.notion.setCell(pageOf(friends[11]), "Verification status", {
        select: { name: "unsubscribed" },
      });

      const mailsBeforeTick3 = net.resend.messages.length;
      const tick3 = await withGlobals(s, () => s.cronTick());
      assert.equal(tick3.status, 200);
      assert.deepEqual(
        {
          pending: tick3.notices?.pending,
          sent: tick3.notices?.sent,
          skippedUnsubscribed: tick3.notices?.skippedUnsubscribed,
        },
        { pending: 2, sent: 0, skippedUnsubscribed: 2 },
        "A opted out on its row, B on another row of its inbox: no notice to either",
      );
      assert.equal(net.resend.messages.length, mailsBeforeTick3, "the opt-out tick mails nobody");
      assertNoPii(s, "opt-out tick", { body: tick3.body, lines: tick3.lines });
      // Neither can be re-announced either, whatever row the run would pick.
      const aAgain = await announce(A_EMAIL);
      assert.equal(aAgain.result, 0, aAgain.stderr);
      assert.deepEqual(
        (JSON.parse(aAgain.stdout) as { skipped: Record<string, number> }).skipped.unsubscribed,
        1,
      );
      const bAgain = await announce(bEmail);
      assert.equal(bAgain.result, 0, bAgain.stderr);
      assert.equal(
        (JSON.parse(bAgain.stdout) as { skipped: Record<string, number> }).skipped
          .unsubscribed_address,
        1,
      );
      assert.equal(net.resend.messages.length, mailsBeforeTick3);

      // D7: every standing is kept — the unsubscribed referrer, and the friends
      // who unsubscribed after confirming.
      s.advance(301 * 1000);
      const kept = await getReferralStatusService(aStatusToken, "en", s.referralDeps());
      assert.ok(kept.status === "ok");
      assert.deepEqual(
        [kept.referral.credited, kept.referral.rank, kept.referral.highestTier],
        [12, 1, "leader"],
      );
      const keptBoard = await leaderboardResponse(true, async () => s.referralDeps());
      const keptBody = (await keptBoard.json()) as LeaderboardSnapshot;
      assert.deepEqual(
        keptBody.entries.map((e) => [e.rank, e.credited]),
        [
          [1, 12],
          [2, 2],
        ],
      );
      assertNoPii(s, "board after opt-outs", keptBody, { refCodes: [A_CODE, bCode] });
    } else {
      assert.equal(noConfirm.result, 2);
      const withConfirm = await withGlobals(s, () =>
        captureStdio(() =>
          announceMain(
            [
              "--released-at",
              releasedAt,
              "--apply",
              "--confirm",
              REFERRAL_PROGRAM_ID,
            ],
            s.env,
          ),
        ),
      );
      assert.equal(withConfirm.result, 2, "OFF: even --confirm cannot send");
      assert.equal(net.resend.messages.length, mailsBefore);
      assert.equal(net.notion.calls.length, callsBefore, "OFF: refused before reading Notion");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // ---- 7c. A Korean sign-up while WATCHDIVE_SENDER_PHONE is unset. ON: the
  // guide is refused (no mail, `Welcome email` stays empty) and goes out on
  // the next click once the phone is set. OFF: the legacy welcome never
  // depended on it.
  const kEmail = "k@example.net";
  const kAt = Date.now() - 10 * MIN;
  delete env.WATCHDIVE_SENDER_PHONE;
  try {
    assert.equal((await s.submit(kEmail, { at: kAt, locale: "ko" })).status, "pending");
    assert.equal((await s.confirm(kEmail, kAt + MIN)).status, "verified");
  } finally {
    env.WATCHDIVE_SENDER_PHONE = SENDER_PHONE;
  }
  const kPage = net.notion.pageByEmail(kEmail)!.id;
  if (on) {
    assert.equal(s.welcomeOf(kEmail).length, 0, "no Korean guide without the sender phone");
    assert.equal(net.notion.pages.get(kPage)!.properties["Welcome email"], undefined);
    assert.equal((await s.confirm(kEmail, kAt + 2 * MIN)).status, "already_verified");
    const [kGuide, ...extra] = s.welcomeOf(kEmail);
    assert.ok(kGuide, "the next click sends the guide once the phone is set");
    assert.equal(extra.length, 0);
    assertKoreanAdMail(kGuide);
    assert.ok(net.notion.pages.get(kPage)!.properties["Welcome email"]);
  } else {
    const [kWelcome, ...extra] = s.welcomeOf(kEmail);
    assert.ok(kWelcome, "OFF: the legacy Korean welcome goes out without the phone");
    assert.equal(extra.length, 0);
    assert.equal(kWelcome.body.subject.startsWith("(광고)"), false);
    assert.equal(/buddy/i.test(kWelcome.raw), false);
  }

  // ---- 8. The close (ON): friends confirmed at or after it count for nobody.
  if (on) {
    env.WATCHDIVE_REFERRAL_CLOSES_AT = new Date(realNow - 60 * MIN).toISOString();
    s.advance(301 * 1000);
    const closed = await getReferralStatusService(aStatusToken, "en", s.referralDeps());
    assert.ok(closed.status === "ok");
    assert.deepEqual([closed.referral.credited, closed.referral.closed], [11, true]);
    const lb = await leaderboardResponse(true, async () => s.referralDeps());
    const body = (await lb.json()) as LeaderboardSnapshot;
    assert.deepEqual([body.closed, body.entries.map((e) => e.credited)], [true, [11, 1]]);
    assertNoPii(s, "closed board", body, { refCodes: [A_CODE, bCode] });
  }

  assert.deepEqual(net.unexpected, [], "no request left for any other host");
}

test("Buddy Invite end to end with the master switch ON", async () => {
  await runStory(true);
});

test("Buddy Invite end to end with the master switch OFF: legacy mail, no notices, no surfaces", async () => {
  await runStory(false);
});
