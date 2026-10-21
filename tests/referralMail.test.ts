// Buddy Invite mails: the welcome guide (only with the master switch on), the
// unchanged legacy welcome (switch off), and the friend-joined notice.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { BUDDY_GUIDE_DELAY_MS, WELCOME_DELAY_MS } from "../src/lib/verification/contracts.ts";
import {
  createResendMailer,
  createResendReferralMailer,
  KR_AD_SUBJECT_PREFIX,
  KR_OPT_OUT_LINE,
  readSenderPhone,
  referralNoticeBody,
  type AdFooter,
  type WelcomeMail,
} from "../src/lib/verification/resend.ts";
import { toLeadRecord } from "../src/lib/verification/notionLead.ts";
import { toReferralRow } from "../src/lib/referral/store.ts";
import { confirmVerificationService } from "../src/lib/verification/service.ts";
import { createVerificationToken } from "../src/lib/verification/token.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import type { ReferralNoticeMail } from "../src/lib/referral/contract.ts";
import { FakeLeadStore, FakeMailer, TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const BASE_ENV = {
  RESEND_API_KEY: "re_test_key",
  WATCHDIVE_EMAIL_FROM: "hello@watchdive.example",
  WATCHDIVE_EMAIL_REPLY_TO: "help@diveroid.com",
};
const ON_ENV = {
  ...BASE_ENV,
  WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1",
  // Signs the guide's opt-out link (launch-mail unsubscribe token).
  WATCHDIVE_VERIFICATION_SECRET: "s".repeat(40),
  WATCHDIVE_SENDER_PHONE: "+82 2-0000-0000",
};
const PHONE = ON_ENV.WATCHDIVE_SENDER_PHONE;
const UNSUB = new RegExp(
  `^https://watchdive\\.example/unsubscribe/u1\\.${"aaaaaaaa-bbbb-4ccc-8ddd-000000000001"}\\.[a-z-]+\\.[A-Za-z0-9_-]{43}$`,
);
const LEAD_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const ORIGIN = "https://watchdive.example";
const SCHEDULED = "2026-08-02T00:00:00.000Z";

// Parsed Resend request JSON; tests read nested fields freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Captured = { url: string; init: RequestInit; body: Record<string, any> };

function capture(status = 200) {
  const calls: Captured[] = [];
  const impl = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(status === 200 ? { id: "msg_1" } : {}), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function welcome(locale: Locale, extra: Partial<WelcomeMail> = {}): WelcomeMail {
  return {
    to: "diver@example.com",
    refCode: "abc12345",
    leadId: LEAD_ID,
    publicOrigin: ORIGIN,
    scheduledAt: SCHEDULED,
    locale,
    ...extra,
  };
}

function guideLinks(locale: Locale) {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return {
    statusUrl: `${ORIGIN}${prefix}/buddy/abc12345.v1.Zm9vYmFy`,
    rulesUrl: `${ORIGIN}${prefix}/buddy-rules`,
  };
}

// --- Switch off: nothing changes for anyone --------------------------------

// sha256 of the nine request bodies (one per locale, joined by "\n") produced
// by createResendMailer().sendWelcome at commit b364429, before any Buddy
// Invite mail work. Recomputed from that commit's resend.ts on 2026-10-22.
const LEGACY_WELCOME_BODIES_SHA256 =
  "a4e3cf6c955cf6ceb2a0bb95a6d02b8cd5ec401f4dec9558d085f632a573d2e7";

test("switch off: the welcome request bodies are byte-identical to the pre-program mail", async () => {
  for (const withLinks of [false, true]) {
    const { calls, impl } = capture();
    const mailer = createResendMailer(BASE_ENV, impl, async () => {});
    for (const locale of SUPPORTED_LOCALES) {
      // Even if a caller passes the guide links, the switch decides.
      await mailer.sendWelcome(welcome(locale, withLinks ? guideLinks(locale) : {}));
    }
    const joined = calls.map((c) => String(c.init.body)).join("\n");
    assert.equal(createHash("sha256").update(joined).digest("hex"), LEGACY_WELCOME_BODIES_SHA256);
    for (const call of calls) {
      assert.equal(
        (call.init.headers as Record<string, string>)["Idempotency-Key"],
        `watchdive-welcome-${LEAD_ID}`,
      );
      assert.equal(call.body.html.includes("buddy"), false);
    }
  }
});

test("switch on but a link missing: still the legacy welcome", async () => {
  const off = capture();
  const on = capture();
  await createResendMailer(BASE_ENV, off.impl, async () => {}).sendWelcome(welcome("en"));
  await createResendMailer(ON_ENV, on.impl, async () => {}).sendWelcome(
    welcome("en", { statusUrl: guideLinks("en").statusUrl }),
  );
  assert.equal(on.calls[0]!.init.body, off.calls[0]!.init.body);
});

function confirmable(env: Record<string, string>, signupLocale?: Locale) {
  const confirmedAt = new Date("2026-10-22T03:00:00.000Z");
  const store = new FakeLeadStore();
  store.seed({
    email: "diver@example.com",
    canonical: "diver@example.com",
    status: "pending",
    refCode: "abc12345",
    leadId: LEAD_ID,
    expiresAt: new Date(confirmedAt.getTime() + 60_000).toISOString(),
  });
  const mailer = new FakeMailer();
  const token = createVerificationToken(
    LEAD_ID,
    confirmedAt.getTime() + 60_000,
    false,
    TEST_SECRET,
    signupLocale,
  );
  return { mailer, token, confirmedAt, deps: { store, mailer, env, now: () => confirmedAt } };
}

test("switch off: confirmation schedules the legacy welcome 24 hours out with no guide links", async () => {
  const { mailer, token, confirmedAt, deps } = confirmable(TEST_ENV);
  assert.equal((await confirmVerificationService(token, deps)).status, "verified");
  assert.equal(mailer.welcomes.length, 1);
  const sent = mailer.welcomes[0]!;
  assert.equal(sent.scheduledAt, new Date(confirmedAt.getTime() + WELCOME_DELAY_MS).toISOString());
  assert.equal(WELCOME_DELAY_MS, 24 * 60 * 60 * 1000);
  assert.equal("statusUrl" in sent, false);
  assert.equal("rulesUrl" in sent, false);
});

test("switch on: confirmation schedules the guide 30 minutes out with signed status and rules links", async () => {
  const env = { ...TEST_ENV, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" };
  const { mailer, token, confirmedAt, deps } = confirmable(env, "ko");
  assert.equal((await confirmVerificationService(token, deps)).status, "verified");
  const sent = mailer.welcomes[0]!;
  assert.equal(BUDDY_GUIDE_DELAY_MS, 30 * 60 * 1000);
  assert.equal(
    sent.scheduledAt,
    new Date(confirmedAt.getTime() + BUDDY_GUIDE_DELAY_MS).toISOString(),
  );
  // After the ~3-minute reservation invite, well before the old 24 hours.
  assert.ok(BUDDY_GUIDE_DELAY_MS > 3 * 60 * 1000);
  assert.match(sent.statusUrl ?? "", new RegExp(`^${TEST_ORIGIN}/ko/buddy/[^/?#=]+$`));
  assert.equal(sent.rulesUrl, `${TEST_ORIGIN}/ko/buddy-rules`);
});

// --- Switch on: the guide ----------------------------------------------------

const EXPECTED_REWARD_FRAGMENTS: Record<"en" | "ko", string[]> = {
  en: [
    "First invite · 1 friend",
    "1 hour before the general list",
    "Buddy · 3 friends",
    "2 hours before the general list",
    "Dive Team · 5 friends",
    "$149 early-bird price",
    "first 100 backers",
    "Dive Leader · 10 friends",
    "30 in stock",
    "Top 3 inviters",
    "The 3 people with the most verified friends",
  ],
  ko: [
    "첫 초대 · 1명",
    "1시간 먼저",
    "버디 · 3명",
    "2시간 먼저",
    "다이브 팀 · 5명",
    "선착순 100명",
    "$149",
    "다이브 리더 · 10명",
    "30개",
    "초대 랭킹 Top 3",
    "3명에게 WatchDive",
  ],
};

for (const locale of ["en", "ko"] as const) {
  test(`switch on (${locale}): the guide carries the share, status and rules links and all five reward lines`, async () => {
    const { calls, impl } = capture();
    const links = guideLinks(locale);
    await createResendMailer(ON_ENV, impl, async () => {}).sendWelcome(welcome(locale, links));
    const { body, init } = calls[0]!;
    // Unprefixed, like core `shareUrl`: the friend's language picks the page.
    const share = `${ORIGIN}/r/abc12345`;
    for (const part of [body.html, body.text]) {
      assert.ok(part.includes(share), "share link");
      assert.ok(part.includes(links.statusUrl), "status link");
      assert.ok(part.includes(links.rulesUrl), "rules link");
      for (const fragment of EXPECTED_REWARD_FRAGMENTS[locale]) {
        assert.ok(part.includes(fragment), `${locale}: ${fragment}`);
      }
      // Every placeholder was filled.
      assert.equal(/\{\w+\}/.test(part), false);
      // No `=` in any link: quoted-printable cannot mangle them.
      for (const link of [share, links.statusUrl, links.rulesUrl])
        assert.equal(link.includes("="), false);
    }
    // Five reward blocks (four tiers + top prize).
    assert.equal(body.text.split("\n").filter((line: string) => line.startsWith("- ")).length, 5);
    assert.equal((body.html.match(/<strong[ >]/g) ?? []).length, 5);
    assert.ok(body.html.includes(`lang="${locale}"`));
    assert.ok(body.html.includes(`href="${share}"`), "primary button points at the share link");
    assert.equal(body.scheduled_at, SCHEDULED);
    assert.deepEqual(body.to, ["diver@example.com"]);
    const [oneClick, mailto] = body.headers["List-Unsubscribe"].split(", ");
    assert.match(oneClick.slice(1, -1), UNSUB);
    assert.equal(mailto, "<mailto:help@diveroid.com?subject=unsubscribe>");
    assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    for (const part of [body.html, body.text]) assert.ok(part.includes(oneClick.slice(1, -1)));
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["Idempotency-Key"], `watchdive-welcome-${LEAD_ID}`);
    assert.equal(
      body.subject,
      locale === "en"
        ? "You’re on the WatchDive waitlist — invite your buddies"
        : "(광고) WatchDive 출시 알림 신청 완료 · 버디를 초대하세요",
    );
    assert.equal(/guarantee|certified|approved/i.test(body.html + body.text), false);
  });
}

test("switch on: every interpolated value is escaped in the guide HTML", async () => {
  const { calls, impl } = capture();
  const hostile = `${ORIGIN}/buddy/x"><script>alert(1)</script>`;
  await createResendMailer(ON_ENV, impl, async () => {}).sendWelcome(
    welcome("en", { statusUrl: hostile, rulesUrl: `${ORIGIN}/buddy-rules?a=1&b=<i>` }),
  );
  const { html } = calls[0]!.body;
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes('x"><script'), false);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("a=1&amp;b=&lt;i&gt;"));
});

// --- Friend-joined notice ---------------------------------------------------

const EN_FOOTER: AdFooter = {
  unsubscribeUrl: `${ORIGIN}/unsubscribe/u1.${LEAD_ID}.en.${"A".repeat(43)}`,
  korean: false,
};
const KO_FOOTER: AdFooter = {
  unsubscribeUrl: `${ORIGIN}/unsubscribe/u1.${LEAD_ID}.ko.${"A".repeat(43)}`,
  korean: true,
  senderPhone: PHONE,
};

function notice(overrides: Partial<ReferralNoticeMail> = {}): ReferralNoticeMail {
  return {
    to: "referrer@example.com",
    locale: "en",
    credited: 3,
    crossed: ["buddy"],
    nextTier: "team",
    remainingToNext: 2,
    statusUrl: `${ORIGIN}/buddy/abc12345.v1.Zm9vYmFy`,
    unsubscribeUrl: `${ORIGIN}/unsubscribe/u1.${LEAD_ID}.en.${"A".repeat(43)}`,
    idempotencyKey: "wd-buddy-invite-20261022-notice-abc12345-3",
    ...overrides,
  };
}

test("notice: count in subject, crossed tier with its reward, next tier, status button, footer", async () => {
  const { calls, impl } = capture();
  await createResendReferralMailer(ON_ENV, impl, async () => {}).sendReferralNotice(notice());
  const { body, init } = calls[0]!;
  assert.equal(body.subject, "A buddy joined through your link (3 so far)");
  for (const part of [body.html, body.text]) {
    assert.ok(part.includes("Friends who joined through your link and confirmed their email: 3."));
    assert.ok(
      part.includes(
        "You reached Buddy · 3 friends: Get the Kickstarter launch email 2 hours before",
      ),
    );
    assert.ok(part.includes("2 more for Dive Team · 5 friends."));
    assert.ok(part.includes(notice().statusUrl));
    assert.ok(part.includes("You can turn these emails off on your invite page."));
    assert.equal(/\{\w+\}/.test(part), false);
  }
  assert.ok(body.html.includes(`href="${notice().statusUrl}"`));
  assert.ok(body.html.includes("See my invites"));
  assert.ok(body.html.includes('lang="en"'));
  assert.deepEqual(body.to, ["referrer@example.com"]);
  assert.equal(
    (init.headers as Record<string, string>)["Idempotency-Key"],
    notice().idempotencyKey,
  );
  assert.equal(
    body.headers["List-Unsubscribe"],
    `<${notice().unsubscribeUrl}>, <mailto:help@diveroid.com?subject=unsubscribe>`,
  );
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(body.html.includes(`href="${notice().unsubscribeUrl}"`));
  assert.equal(body.scheduled_at, undefined);
});

test("notice: several crossed tiers each get a line; at the top the max line replaces next", () => {
  const content = referralNoticeBody(
    notice({
      locale: "ko",
      credited: 10,
      crossed: ["team", "leader"],
      nextTier: null,
      remainingToNext: null,
    }),
    KO_FOOTER,
  );
  assert.equal(content.subject, "(광고) 내 링크로 버디가 참여했어요 (지금까지 10명)");
  assert.ok(content.text.includes("다이브 팀 · 5명 달성!"));
  assert.ok(content.text.includes("다이브 리더 · 10명 달성!"));
  assert.ok(content.text.includes("모든 단계를 달성했어요. 랭킹 Top 3에 계속 도전해 보세요."));
  assert.equal(content.text.includes("남았어요"), false);
});

test("notice: no tier crossed means no reached line", () => {
  const content = referralNoticeBody(
    notice({ credited: 2, crossed: [], nextTier: "buddy", remainingToNext: 1 }),
    EN_FOOTER,
  );
  assert.equal(content.text.includes("You reached"), false);
  assert.ok(content.text.includes("1 more for Buddy · 3 friends."));
});

test("notice: never carries an address or any identity, only counts", async () => {
  const { calls, impl } = capture();
  await createResendReferralMailer(ON_ENV, impl, async () => {}).sendReferralNotice(notice());
  const { html, text, subject } = calls[0]!.body;
  for (const part of [html, text, subject]) {
    // The only address is the sender's own help inbox in the footer.
    assert.equal(
      part.replaceAll("help@diveroid.com", "").includes("@"),
      false,
      "no recipient or friend address",
    );
    assert.equal(part.includes("referrer@example.com"), false);
  }
});

test("notice: the mailer refuses to send with the master switch off", async () => {
  const { calls, impl } = capture();
  await assert.rejects(
    createResendReferralMailer(BASE_ENV, impl, async () => {}).sendReferralNotice(notice()),
    /switched off/,
  );
  assert.equal(calls.length, 0);
});

test("notice: provider failures are logged under their own operation, with no payload", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const { impl } = capture(403);
  await assert.rejects(
    createResendReferralMailer(ON_ENV, impl, async () => {}).sendReferralNotice(notice()),
  );
  assert.deepEqual(log.mock.calls[0]!.arguments, [
    "[watchdive] email_delivery_failed",
    { provider: "resend", operation: "referral_notice", status: 403, reason: "provider_rejected" },
  ]);
});

// --- Advertising rules: opt-out on every mail, Korean law for ko / KR --------

const KR_SENDER_BLOCK = `보내는 곳: DIVEROID LTD · help@diveroid.com · ${PHONE} · Office 12146, 182-184 High Street North, East Ham, London E6 2JA, United Kingdom`;

function assertKoreanAdMail(body: Captured["body"]) {
  assert.ok(body.subject.startsWith(KR_AD_SUBJECT_PREFIX), body.subject);
  assert.equal(KR_AD_SUBJECT_PREFIX, "(광고) ");
  // Tags stripped: the phone number sits in a no-wrap span in the HTML.
  for (const part of [body.html.replace(/<[^>]+>/g, ""), body.text]) {
    assert.ok(part.includes(KR_SENDER_BLOCK), "sender block");
    assert.ok(part.includes(KR_OPT_OUT_LINE), "bilingual opt-out line");
    assert.ok(
      KR_OPT_OUT_LINE ===
        "수신을 원하지 않으시면 수신거부를 눌러 주세요. If you do not wish to receive these emails, click Unsubscribe.",
    );
  }
  // The opt-out sits after the content: the sender block ends the mail.
  assert.ok(body.text.lastIndexOf(KR_SENDER_BLOCK) > body.text.indexOf("http"));
  const oneClick = body.headers["List-Unsubscribe"].split(", ")[0].slice(1, -1);
  assert.match(oneClick, /^https:\/\/[^=]*\/unsubscribe\/u1\./);
  assert.ok(body.html.includes(`href="${oneClick}"`), "working unsubscribe link in the body");
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
}

test("Korean rules: a ko guide has (광고), the sender block and the bilingual opt-out", async () => {
  const { calls, impl } = capture();
  await createResendMailer(ON_ENV, impl, async () => {}).sendWelcome(
    welcome("ko", guideLinks("ko")),
  );
  assertKoreanAdMail(calls[0]!.body);
});

test("Korean rules: a KR signup reading English gets them too; a non-KR English mail does not", async () => {
  const kr = capture();
  await createResendMailer(ON_ENV, kr.impl, async () => {}).sendWelcome(
    welcome("en", { ...guideLinks("en"), signupCountry: "kr" }),
  );
  assertKoreanAdMail(kr.calls[0]!.body);
  assert.ok(kr.calls[0]!.body.subject.startsWith("(광고) You’re on the WatchDive waitlist"));

  const us = capture();
  await createResendMailer(ON_ENV, us.impl, async () => {}).sendWelcome(
    welcome("en", { ...guideLinks("en"), signupCountry: "US" }),
  );
  const body = us.calls[0]!.body;
  assert.equal(body.subject.startsWith("(광고)"), false);
  assert.equal(body.html.includes("보내는 곳"), false);
  assert.ok(body.text.includes("DIVEROID LTD · Office 12146, 182-184 High Street North"));
  assert.ok(body.text.includes("Unsubscribe: https://watchdive.example/unsubscribe/u1."));
});

test("Korean rules: without WATCHDIVE_SENDER_PHONE the ko/KR guide and notice are refused, nothing sent", async () => {
  const { WATCHDIVE_SENDER_PHONE: _omit, ...noPhone } = ON_ENV;
  void _omit;
  const { calls, impl } = capture();
  const mailer = createResendMailer(noPhone, impl, async () => {});
  await assert.rejects(
    mailer.sendWelcome(welcome("ko", guideLinks("ko"))),
    /WATCHDIVE_SENDER_PHONE/,
  );
  await assert.rejects(
    mailer.sendWelcome(welcome("en", { ...guideLinks("en"), signupCountry: "KR" })),
    /WATCHDIVE_SENDER_PHONE/,
  );
  const notices = createResendReferralMailer(noPhone, impl, async () => {});
  await assert.rejects(
    notices.sendReferralNotice(notice({ locale: "ko" })),
    /WATCHDIVE_SENDER_PHONE/,
  );
  await assert.rejects(
    notices.sendReferralNotice(notice({ signupCountry: "KR" })),
    /WATCHDIVE_SENDER_PHONE/,
  );
  assert.equal(calls.length, 0);
  // A non-Korean reader is unaffected by the missing phone.
  await mailer.sendWelcome(welcome("en", guideLinks("en")));
  await notices.sendReferralNotice(notice());
  assert.equal(calls.length, 2);
});

test("Korean rules: a ko notice carries them with the phone set", async () => {
  const { calls, impl } = capture();
  await createResendReferralMailer(ON_ENV, impl, async () => {}).sendReferralNotice(
    notice({ locale: "ko", unsubscribeUrl: KO_FOOTER.unsubscribeUrl }),
  );
  assertKoreanAdMail(calls[0]!.body);
});

test("no https opt-out, no Buddy mail: guide without a signing secret and notice without a link are refused", async () => {
  const { WATCHDIVE_VERIFICATION_SECRET: _s, ...noSecret } = ON_ENV;
  void _s;
  const { calls, impl } = capture();
  await assert.rejects(
    createResendMailer(noSecret, impl, async () => {}).sendWelcome(welcome("en", guideLinks("en"))),
    /https unsubscribe/,
  );
  const notices = createResendReferralMailer(ON_ENV, impl, async () => {});
  await assert.rejects(
    notices.sendReferralNotice(notice({ unsubscribeUrl: undefined })),
    /https unsubscribe/,
  );
  await assert.rejects(
    notices.sendReferralNotice(
      notice({ unsubscribeUrl: "http://watchdive.example/unsubscribe/x" }),
    ),
    /https unsubscribe/,
  );
  assert.equal(calls.length, 0);
});

test("switch off: the legacy welcome keeps its mailto-only header and no Korean additions", async () => {
  const { calls, impl } = capture();
  const { WATCHDIVE_REFERRAL_PROGRAM_ENABLED: _p, ...off } = ON_ENV;
  void _p;
  await createResendMailer(off, impl, async () => {}).sendWelcome(
    welcome("ko", { ...guideLinks("ko"), signupCountry: "KR" }),
  );
  const { body } = calls[0]!;
  assert.deepEqual(body.headers, {
    "List-Unsubscribe": "<mailto:help@diveroid.com?subject=unsubscribe>",
  });
  assert.equal(body.subject, "WatchDive 출시 알림 신청이 완료되었습니다.");
});

test("every Buddy mail in every locale: email-safe HTML, absolute https links without =, no placeholders", async () => {
  const { calls, impl } = capture();
  const mailer = createResendMailer(ON_ENV, impl, async () => {});
  const notices = createResendReferralMailer(ON_ENV, impl, async () => {});
  for (const locale of SUPPORTED_LOCALES) {
    await mailer.sendWelcome(welcome(locale, guideLinks(locale)));
    await notices.sendReferralNotice(
      notice({
        locale,
        crossed: ["first", "buddy", "team"],
        credited: 5,
        nextTier: "leader",
        remainingToNext: 5,
      }),
    );
  }
  for (const { body } of calls) {
    const { html, text } = body;
    assert.equal(/display:\s*(flex|grid)/.test(html), false, "no flex/grid");
    assert.equal(
      /<style[\s>]/.test(html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "")),
      false,
      "no <style> outside Outlook conditionals",
    );
    assert.equal(/<(script|img|link)\b/.test(html), false);
    assert.ok(html.includes('role="presentation"'));
    assert.ok(html.includes('bgcolor="#0ea5e9"'), "bulletproof button cell");
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      assert.match(href, /^https:\/\//, href);
      assert.equal(new URL(href.replaceAll("&amp;", "&")).pathname.includes("="), false, href);
    }
    for (const part of [html, text, body.subject]) assert.equal(/\{\w+\}/.test(part), false);
    for (const line of text.split("\n")) assert.ok(line.length < 998, "RFC 5322 line length");
    assert.match(body.headers["List-Unsubscribe"], /^<https:\/\/[^>]+>, <mailto:/);
    assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    // No emoji or shouting in the subject.
    assert.equal(/\p{Extended_Pictographic}/u.test(body.subject), false);
    assert.equal(/\b[A-Z]{4,}\b/.test(body.subject.replace("WATCHDIVE", "")), false);
  }
});

// --- Opt-outs: the guide is not sent to an opted-out row ---------------------

test("switch on: a row opted out by a Launch/Reservation mail marker gets no guide", async () => {
  for (const cell of [
    { launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" },
    { reservationMail: "unsubscribed 2026-10-01T00:00:00.000Z" },
  ]) {
    const env = { ...TEST_ENV, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" };
    const { mailer, token, deps } = confirmable(env);
    const store = deps.store as FakeLeadStore;
    const [seeded] = [...store.rows.values()];
    store.rows.set(seeded!.pageId, { ...seeded!, ...cell });
    assert.equal((await confirmVerificationService(token, deps)).status, "verified");
    assert.equal(mailer.welcomes.length, 0, JSON.stringify(cell));
  }
});

test("the opt-out cells are parsed from Notion into the lead and the referral row", () => {
  const page = {
    id: "page-1",
    properties: {
      Email: { type: "email", email: "diver@example.com" },
      "Ref code": { rich_text: [{ plain_text: "abc12345" }] },
      "Lead ID": { rich_text: [{ plain_text: LEAD_ID }] },
      "Launch mail": { rich_text: [{ plain_text: "unsubscribed 2026-10-01T00:00:00.000Z" }] },
      "Reservation mail": { rich_text: [{ plain_text: "unsubscribed 2026-10-02T00:00:00.000Z" }] },
    },
  };
  const lead = toLeadRecord(page)!;
  assert.equal(lead.launchMail, "unsubscribed 2026-10-01T00:00:00.000Z");
  assert.equal(lead.reservationMail, "unsubscribed 2026-10-02T00:00:00.000Z");
  const row = toReferralRow(page)!;
  assert.equal(row.launchMail, lead.launchMail);
  assert.equal(row.reservationMail, lead.reservationMail);
  assert.equal(row.leadId, LEAD_ID);
  const empty = toLeadRecord({
    id: "page-2",
    properties: { Email: { type: "email", email: "a@b.example" } },
  })!;
  assert.equal("launchMail" in empty, false);
});

test("sender phone: the owner's number is accepted as written; junk or blank is not", () => {
  assert.equal(
    readSenderPhone({ WATCHDIVE_SENDER_PHONE: " +82 10-6517-6232 " }),
    "+82 10-6517-6232",
  );
  for (const bad of [undefined, "", "TBD", "<script>", "+82"]) {
    assert.equal(readSenderPhone({ WATCHDIVE_SENDER_PHONE: bad }), undefined, String(bad));
  }
});
