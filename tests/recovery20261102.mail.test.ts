import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyPath } from "../src/lib/i18n/locale.ts";
import { isVerificationTokenShape, verificationTokenLocale } from "../src/lib/verification/tokenShape.ts";
import {
  escapeHtml,
  RECOVERY_20261102_INVALID_INPUT,
  RECOVERY_20261102_LOCALES,
  RECOVERY_20261102_ORIGIN,
  renderRecovery20261102,
  renderRecovery20261102Preview,
  type Recovery20261102Locale,
} from "../src/lib/verification/recovery20261102.mail.ts";

const ORIGIN = RECOVERY_20261102_ORIGIN;
const LEAD = "00000000-0000-4000-8000-000000000000";
const MAC = "A".repeat(43);
const SOURCE = readFileSync(new URL("../src/lib/verification/recovery20261102.mail.ts", import.meta.url), "utf8");

const HISTORICAL_SUBJECTS = [
  "Confirm your WatchDive waitlist email",
  "WatchDive 대기 명단 이메일을 인증해 주세요",
  "请确认您的 WatchDive 候补名单邮箱",
  "請確認您的 WatchDive 等候名單電子郵件",
  "WatchDiveウェイトリストのメールアドレスをご確認ください",
  "Confirma tu correo para la lista de espera de WatchDive",
  "Confirmez votre adresse e-mail pour la liste d’attente WatchDive",
  "Bestätige deine E-Mail für die WatchDive-Warteliste",
  "Confirme seu e-mail para a lista de espera do WatchDive",
  "Bevestig je e-mail voor de WatchDive-wachtlijst",
  "WatchDive: Forgot to confirm your email?",
  "WatchDive, 이메일 인증을 깜빡하셨나요?",
  "WatchDive：忘记确认邮箱了吗？",
  "WatchDive：忘記確認電子郵件了嗎？",
  "WatchDive：メールアドレスの確認をお忘れですか？",
  "WatchDive: ¿Olvidaste confirmar tu correo?",
  "WatchDive : avez-vous oublié de confirmer votre e-mail ?",
  "WatchDive: E-Mail-Bestätigung vergessen?",
  "WatchDive: Esqueceu de confirmar seu e-mail?",
  "WatchDive: vergeten je e-mail te bevestigen?",
];

const DENY = [
  "149",
  "299",
  "discount",
  "offer",
  "reward",
  "kickstarter",
  "무료",
  "할인",
  "혜택",
  "친구",
  "expired",
  "만료",
  "오류",
  "에러",
  "실패",
  "technical",
  "錯誤",
  "失敗",
  "エラー",
  "不具合",
  "DRY RUN",
  "Reply-To",
  "From:",
];

function v2(locale: string): string {
  return `v2.${LEAD}.1893456000.0.${locale}.${MAC}`;
}

function legacy(): string {
  return `${LEAD}.1893456000.0.${MAC}`;
}

function urlFor(locale: Recovery20261102Locale, token: string): string {
  return `${ORIGIN}${verifyPath(locale)}#${token}`;
}

function render(locale: Recovery20261102Locale, token = v2(locale)) {
  return renderRecovery20261102({
    locale,
    verificationUrl: urlFor(locale, token),
    publicOrigin: ORIGIN,
  });
}

function assertRejected(input: unknown): void {
  assert.throws(() => renderRecovery20261102(input as never), {
    message: RECOVERY_20261102_INVALID_INPUT,
  });
}

test("escapeHtml encodes the four markup characters and nothing else", () => {
  assert.equal(escapeHtml(`a&b<c>d"e`), "a&amp;b&lt;c&gt;d&quot;e");
  assert.equal(escapeHtml("plain"), "plain");
});

test("the module stays free of the sender, the signer, and raw interpolation", () => {
  assert.doesNotMatch(SOURCE, /resend\.ts|node:crypto|process\.env|fetch\(|WATCHDIVE_VERIFICATION_SECRET|createHmac/);
  assert.doesNotMatch(SOURCE, /\$\{href\}|\$\{verificationUrl\}|\$\{copy\./);
  for (const field of ["subject", "preheader", "headline", "body", "button", "fallback", "ignore"] as const) {
    assert.match(SOURCE, new RegExp(`escapeHtml\\(copy\\.${field}\\)`));
  }
  assert.match(SOURCE, /escapeHtml\(href\)/);
  assert.match(SOURCE, /escapeHtml\(locale\)/);
});

test("four reviewed locales render the neutral draft, one canonical link, and the customer footer", () => {
  for (const locale of RECOVERY_20261102_LOCALES) {
    const token = v2(locale);
    const href = urlFor(locale, token);
    const first = render(locale);
    const second = render(locale);
    assert.deepEqual(first, second, locale);
    assert.equal(isVerificationTokenShape(token), true, locale);
    assert.equal(verificationTokenLocale(token), locale, locale);
    assert.equal(first.subject.length > 0, true, locale);
    assert.equal(HISTORICAL_SUBJECTS.includes(first.subject), false, locale);
    assert.equal(first.html.includes(`<html lang="${locale}"`), true, locale);
    assert.equal(first.html.includes("<!doctype html>"), true, locale);
    assert.match(first.html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
    assert.match(first.html, /border:3px solid #111111/);
    assert.match(first.html, /mso-padding-alt:18px 12px/);
    assert.match(first.html, /<!--\[if mso\]>/);
    assert.match(first.html, /<h1\b/);
    assert.equal((first.html.match(/<h1\b/g) ?? []).length, 1, locale);
    assert.match(first.html, /width="237"/);
    assert.match(first.html, /height="35"/);
    assert.match(first.html, /alt="WatchDive"/);
    assert.match(first.html, /src="https:\/\/watchdive\.diveroid\.com\/brand\/mail\/watchdive-primary\.png"/);
    assert.equal(first.html.includes("hub.diveroid.ai"), false, locale);
    assert.equal(first.html.includes("watchdive-primary@1x"), false, locale);

    const anchors = [...first.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.equal(anchors.length, 3, locale);
    const verifyAnchors = anchors.filter(([, attrs]) => attrs.includes(`href="${href}"`));
    assert.equal(verifyAnchors.length, 2, locale);
    assert.equal(verifyAnchors.some(([, , label]) => label.includes("Confirm") || label.length > 0), true);
    assert.equal(anchors.filter(([, attrs]) => attrs.includes('href="mailto:help@diveroid.com"')).length, 1, locale);
    assert.equal(first.html.split(token).length - 1, 3, locale);
    assert.equal(first.text.split(href).length - 1, 2, locale);
    assert.equal(first.text.includes("<"), false, locale);
    assert.equal(first.html.includes(token.slice(0, 20)), true, locale);
    const logo = first.html.match(/<img\b[^>]*>/);
    assert.ok(logo, locale);
    assert.equal(logo[0].includes(token), false, locale);
    assert.equal(logo[0].includes("#"), false, locale);
    const preheader = first.html.match(/mso-hide:all;[^"]*">([\s\S]*?)<\/div>/);
    assert.ok(preheader, locale);
    assert.equal(preheader[1].includes("http"), false, locale);
    assert.equal(preheader[1].includes(token), false, locale);

    const combined = `${first.subject}\n${first.text}\n${first.html}`.toLowerCase();
    for (const fragment of DENY) {
      assert.equal(combined.includes(fragment.toLowerCase()), false, `${locale}:${fragment}`);
    }
    assert.match(first.text, /help@diveroid\.com/);
    assert.equal(first.html.includes("<script"), false, locale);
    assert.equal(first.html.includes("<form"), false, locale);
    assert.equal(first.html.includes("<iframe"), false, locale);
    assert.equal(first.html.includes("<link"), false, locale);
    assert.equal(first.html.includes("{{"), false, locale);
    assert.equal((first.html.match(/<img\b/g) ?? []).length, 1, locale);
    assert.ok(
      [...first.html.matchAll(/<table\b([^>]*)>/g)].every(([, attrs]) => attrs.includes('role="presentation"')),
      locale,
    );
    for (const [open, close] of [
      [/<table\b/g, /<\/table>/g],
      [/<tr\b/g, /<\/tr>/g],
      [/<td\b/g, /<\/td>/g],
    ] as const) {
      assert.equal((first.html.match(open) ?? []).length, (first.html.match(close) ?? []).length, locale);
    }
    const urls = first.html.match(/https?:\/\/[^"'\s<]+/g) ?? [];
    assert.ok(urls.length > 0, locale);
    assert.ok(urls.every((item) => item.startsWith(`${ORIGIN}/`)), locale);
    assert.ok(first.html.length < 30_000, locale);
    assert.ok(first.text.length < 8_000, locale);
  }
});

test("english accepts a legacy token on the unprefixed verify path", () => {
  const token = legacy();
  assert.equal(isVerificationTokenShape(token), true);
  assert.equal(verificationTokenLocale(token), "en");
  const mail = render("en", token);
  assert.equal(mail.html.includes(`${ORIGIN}/verify#${token}`), true);
  assert.equal(mail.html.includes("/en/verify"), false);
});

test("a hostile extra field is not interpolated", () => {
  const mail = renderRecovery20261102({
    locale: "en",
    verificationUrl: urlFor("en", v2("en")),
    publicOrigin: ORIGIN,
    sneaky: "<script>alert(1)</script>",
  } as never);
  assert.equal(mail.html.includes("<script>"), false);
  assert.equal(mail.html.includes("alert(1)"), false);
});

test("rendering does not mutate the input or write to the console", () => {
  const input = {
    locale: "ko" as const,
    verificationUrl: urlFor("ko", v2("ko")),
    publicOrigin: ORIGIN,
  };
  const snapshot = { ...input };
  const calls: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = new Map<(typeof methods)[number], (...args: unknown[]) => void>();
  for (const method of methods) {
    originals.set(method, console[method]);
    console[method] = ((...args: unknown[]) => {
      calls.push(`${method}:${args.map(String).join(" ")}`);
    }) as (typeof console)[typeof method];
  }
  try {
    renderRecovery20261102(input);
    assertRejected({ locale: "en", verificationUrl: input.verificationUrl, publicOrigin: ORIGIN });
  } finally {
    for (const method of methods) console[method] = originals.get(method) as (typeof console)[typeof method];
  }
  assert.deepEqual(input, snapshot);
  assert.deepEqual(calls, []);
});

test("the production renderer rejects a missing or non-canonical URL", () => {
  const token = v2("en");
  const href = urlFor("en", token);
  const rejected: unknown[] = [
    undefined,
    null,
    "en",
    [],
    {},
    { locale: "en", publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: "", publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: "   ", publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: "{{verification_url}}", publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href, publicOrigin: `${ORIGIN}/` },
    { locale: "en", verificationUrl: href, publicOrigin: "http://watchdive.diveroid.com" },
    { locale: "en", verificationUrl: href, publicOrigin: "https://preview.watchdive.diveroid.com" },
    { locale: "en", verificationUrl: href.replace("https://", "http://"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href.replace(ORIGIN, "https://evil.example"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href.replace(ORIGIN, "https://www.watchdive.diveroid.com"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href.replace(ORIGIN, "https://watchdive.diveroid.com:443"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href.replace(ORIGIN, "https://user:pass@watchdive.diveroid.com"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify?utm=1#${token}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify?${token}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify/?#${token}`.replace("?#", "#"), publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/en/verify#${token}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/ko/verify#${token}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/reservation#${token}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify#${token}&utm_source=ig`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${href} `, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `javascript:${token}`, publicOrigin: ORIGIN },
    { locale: "ko", verificationUrl: urlFor("ko", v2("en")), publicOrigin: ORIGIN },
    { locale: "ko", verificationUrl: `${ORIGIN}/ko/verify#${legacy()}`, publicOrigin: ORIGIN },
    { locale: "ja", verificationUrl: `${ORIGIN}/verify#${v2("ja")}`, publicOrigin: ORIGIN },
    { locale: "zh-TW", verificationUrl: `${ORIGIN}/zh-TW/verify#${v2("zh-TW")}`, publicOrigin: ORIGIN },
    { locale: "zh-TW", verificationUrl: `${ORIGIN}/zh-tw/verify#${v2("zh-tw")}`, publicOrigin: ORIGIN },
    { locale: "zh-CN", verificationUrl: `${ORIGIN}/zh-cn/verify#${v2("zh-CN")}`, publicOrigin: ORIGIN },
    { locale: "nl", verificationUrl: `${ORIGIN}/nl/verify#${v2("nl")}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify#${token.slice(0, -1)}`, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: `${ORIGIN}/verify#${token}A`, publicOrigin: ORIGIN },
    { locale: "EN", verificationUrl: href, publicOrigin: ORIGIN },
    { locale: "en", verificationUrl: href, publicOrigin: "https://watchdive.diveroid.com/verify" },
  ];
  for (const input of rejected) assertRejected(input);

  const thrown = (() => {
    try {
      renderRecovery20261102({
        locale: "en",
        verificationUrl: `${ORIGIN}/verify?secret=${token}#${token}`,
        publicOrigin: ORIGIN,
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  assert.equal(thrown, RECOVERY_20261102_INVALID_INPUT);
  assert.equal(thrown.includes(token), false);
  assert.equal(thrown.includes("http"), false);
});

test("the preview adapter uses an unsigned shape and the production renderer", () => {
  for (const locale of RECOVERY_20261102_LOCALES) {
    const preview = renderRecovery20261102Preview(locale);
    const token = new URL(preview.verificationUrl).hash.slice(1);
    assert.equal(token.endsWith(MAC), true, locale);
    assert.equal(token.includes(`.${locale}.`), true, locale);
    assert.equal(preview.verificationUrl.startsWith(`${ORIGIN}${verifyPath(locale)}#`), true, locale);
    assert.equal(preview.verificationUrl.includes("?"), false, locale);
    const again = renderRecovery20261102({
      locale,
      verificationUrl: preview.verificationUrl,
      publicOrigin: ORIGIN,
    });
    assert.equal(again.html, preview.html, locale);
    assert.equal(again.text, preview.text, locale);
    assert.equal(again.subject, preview.subject, locale);
    assert.equal(preview.html.includes("DRY RUN"), false, locale);
    assert.equal(preview.text.includes("Reply-To"), false, locale);
  }
  assert.throws(() => renderRecovery20261102Preview("zh-CN" as never), {
    message: RECOVERY_20261102_INVALID_INPUT,
  });
});

test("reviewed sentences stay intact in html and text", () => {
  const expected: Record<Recovery20261102Locale, { subject: string; headline: string; body: string; button: string; ignore: string }> = {
    en: {
      subject: "WatchDive: please confirm your email",
      headline: "Confirm your email address",
      body: "Your WatchDive launch-alert signup is not yet confirmed. Please use the new verification link below to complete it. If you received an earlier link, use this one instead.",
      button: "Confirm my email",
      ignore: "If you did not sign up, ignore this message. Nothing else happens.",
    },
    ko: {
      subject: "WatchDive: 이메일 인증을 다시 부탁드립니다",
      headline: "이메일 인증을 완료해 주세요",
      body: "WatchDive 출시 알림 신청의 이메일 인증이 아직 완료되지 않았습니다. 아래 새 인증 링크로 신청을 완료해 주세요. 기존에 받으신 링크가 있다면 이 링크를 대신 이용해 주세요.",
      button: "이메일 인증하기",
      ignore: "신청한 적이 없으면 이 메일을 지워 주세요. 다른 절차는 없습니다.",
    },
    ja: {
      subject: "WatchDive：メールアドレスをもう一度ご確認ください",
      headline: "メールアドレスをご確認ください",
      body: "WatchDiveの発売通知のお申し込みは、メールアドレスの確認がまだ完了していません。下の新しい確認リンクから手続きを完了してください。以前の確認リンクをお持ちの場合も、こちらをご利用ください。",
      button: "メールアドレスを確認する",
      ignore: "心当たりがなければ、このメールは破棄してください。手続きは進みません。",
    },
    "zh-TW": {
      subject: "WatchDive：請重新確認您的電子郵件",
      headline: "電子郵件尚未確認",
      body: "您的 WatchDive 上市通知申請尚未完成電子郵件驗證。請使用下方的新驗證連結完成申請。如果您先前曾收到驗證連結，請改用這封信中的連結。",
      button: "確認電子郵件",
      ignore: "若您沒有申請，請忽略這封信。不會進行其他程序。",
    },
  };
  for (const locale of RECOVERY_20261102_LOCALES) {
    const mail = render(locale);
    const copy = expected[locale];
    assert.equal(mail.subject, copy.subject, locale);
    for (const sentence of [copy.headline, copy.body, copy.button, copy.ignore]) {
      assert.equal(mail.html.includes(sentence), true, `${locale}:${sentence}`);
      assert.equal(mail.text.includes(sentence), true, `${locale}:${sentence}`);
    }
    assert.equal(mail.text.startsWith(copy.headline), true, locale);
  }
});
