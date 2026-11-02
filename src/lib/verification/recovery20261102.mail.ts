// One-off recovery mail for the reviewed 2026-11-02 website pool.
// Copy is the neutral draft: the signup is still unconfirmed, here is one new
// link. This module does not sign, send, log, or read a secret.
//
// The href must be the canonical https verify URL for the same locale, with
// the token only in the fragment. Presentation is the existing brutalist
// table shell: white card, 3px black border, large cyan CTA.

import { verifyPath } from "../i18n/locale.ts";
import {
  MAIL_CYAN,
  MAIL_FONT,
  MAIL_INK,
  MAIL_MID,
  MAIL_MUTED,
  MAIL_PAGE,
  MAIL_PAPER,
  MAIL_TEXT,
  MAIL_YELLOW,
  watchdiveLogoImg,
} from "../mail/brutal.ts";
import { isVerificationTokenShape, verificationTokenLocale } from "./tokenShape.ts";

export const RECOVERY_20261102_LOCALES = ["en", "ko", "ja", "zh-TW"] as const;
export type Recovery20261102Locale = (typeof RECOVERY_20261102_LOCALES)[number];

export const RECOVERY_20261102_ORIGIN = "https://watchdive.diveroid.com";
export const RECOVERY_20261102_INVALID_INPUT = "recovery20261102: invalid input";

const LOGO_PATH = "/brand/mail/watchdive-primary.png";
const MAX_URL_LENGTH = 512;
const FOOTER_NAME = "WatchDive";
const FOOTER_MAILBOX = "help@diveroid.com";
const SYNTHETIC_LEAD = "00000000-0000-4000-8000-000000000000";
const SYNTHETIC_EXPIRY = "1893456000";
const SYNTHETIC_MAC = "A".repeat(43);

const LOCALE_SET = new Set<string>(RECOVERY_20261102_LOCALES);

export type Recovery20261102Input = {
  locale: Recovery20261102Locale;
  verificationUrl: string;
  publicOrigin: string;
};

export type Recovery20261102Mail = {
  subject: string;
  html: string;
  text: string;
};

type Copy = {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  button: string;
  fallback: string;
  ignore: string;
};

const COPY = {
  en: {
    subject: "WatchDive: please confirm your email",
    preheader: "Your WatchDive launch-alert signup is not yet confirmed.",
    headline: "Confirm your email address",
    body: "Your WatchDive launch-alert signup is not yet confirmed. Please use the new verification link below to complete it. If you received an earlier link, use this one instead.",
    button: "Confirm my email",
    fallback: "If the button does not open, paste this address into your browser:",
    ignore: "If you did not sign up, ignore this message. Nothing else happens.",
  },
  ko: {
    subject: "WatchDive: 이메일 인증을 다시 부탁드립니다",
    preheader: "WatchDive 출시 알림 신청의 이메일 인증이 아직 완료되지 않았습니다.",
    headline: "이메일 인증을 완료해 주세요",
    body: "WatchDive 출시 알림 신청의 이메일 인증이 아직 완료되지 않았습니다. 아래 새 인증 링크로 신청을 완료해 주세요. 기존에 받으신 링크가 있다면 이 링크를 대신 이용해 주세요.",
    button: "이메일 인증하기",
    fallback: "버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣어 주세요.",
    ignore: "신청한 적이 없으면 이 메일을 지워 주세요. 다른 절차는 없습니다.",
  },
  ja: {
    subject: "WatchDive：メールアドレスをもう一度ご確認ください",
    preheader: "WatchDiveの発売通知のお申し込みは、メールアドレスの確認がまだ完了していません。",
    headline: "メールアドレスをご確認ください",
    body: "WatchDiveの発売通知のお申し込みは、メールアドレスの確認がまだ完了していません。下の新しい確認リンクから手続きを完了してください。以前の確認リンクをお持ちの場合も、こちらをご利用ください。",
    button: "メールアドレスを確認する",
    fallback: "ボタンが開かない場合は、次のURLをブラウザに貼り付けてください。",
    ignore: "心当たりがなければ、このメールは破棄してください。手続きは進みません。",
  },
  "zh-TW": {
    subject: "WatchDive：請重新確認您的電子郵件",
    preheader: "您的 WatchDive 上市通知申請尚未完成電子郵件驗證。",
    headline: "電子郵件尚未確認",
    body: "您的 WatchDive 上市通知申請尚未完成電子郵件驗證。請使用下方的新驗證連結完成申請。如果您先前曾收到驗證連結，請改用這封信中的連結。",
    button: "確認電子郵件",
    fallback: "如果按鈕無法開啟，請將下面的網址貼到瀏覽器：",
    ignore: "若您沒有申請，請忽略這封信。不會進行其他程序。",
  },
} as const satisfies Record<Recovery20261102Locale, Copy>;

function fail(): never {
  throw new Error(RECOVERY_20261102_INVALID_INPUT);
}

function isRecoveryLocale(value: unknown): value is Recovery20261102Locale {
  return typeof value === "string" && LOCALE_SET.has(value);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function canonicalVerificationUrl(locale: Recovery20261102Locale, token: string): string {
  return `${RECOVERY_20261102_ORIGIN}${verifyPath(locale)}#${token}`;
}

/**
 * Accept only the canonical localized verify URL. The token stays in the
 * fragment, the query stays empty, and the token locale matches the mail.
 * Failures carry a fixed message so the URL is not written to a log.
 */
function acceptedVerificationUrl(
  locale: Recovery20261102Locale,
  verificationUrl: string,
  publicOrigin: string,
): string {
  if (publicOrigin !== RECOVERY_20261102_ORIGIN) fail();
  if (typeof verificationUrl !== "string") fail();
  if (verificationUrl.length < 1 || verificationUrl.length > MAX_URL_LENGTH) fail();
  if (/[\u0000-\u0020\u007f\\@]/.test(verificationUrl) || /\s/u.test(verificationUrl)) fail();

  let parsed: URL;
  try {
    parsed = new URL(verificationUrl);
  } catch {
    fail();
  }
  if (parsed.protocol !== "https:") fail();
  if (parsed.origin !== RECOVERY_20261102_ORIGIN) fail();
  if (parsed.username !== "" || parsed.password !== "") fail();
  if (parsed.port !== "") fail();
  if (parsed.search !== "") fail();
  if (parsed.pathname !== verifyPath(locale)) fail();

  const hash = parsed.hash;
  if (!hash.startsWith("#") || hash.length < 2) fail();
  const token = hash.slice(1);
  if (token.includes("#") || token.includes("?") || token.includes("%") || token.includes("&")) fail();
  if (!isVerificationTokenShape(token)) fail();
  if (verificationTokenLocale(token) !== locale) fail();

  const expected = canonicalVerificationUrl(locale, token);
  if (verificationUrl !== expected || hash !== `#${token}`) fail();
  return expected;
}

function plainText(copy: Copy, href: string): string {
  return [
    copy.headline,
    "",
    copy.body,
    "",
    copy.button,
    href,
    "",
    copy.fallback,
    href,
    "",
    copy.ignore,
    "",
    FOOTER_NAME,
    FOOTER_MAILBOX,
  ].join("\n");
}

function htmlDocument(locale: Recovery20261102Locale, copy: Copy, href: string): string {
  const safeHref = escapeHtml(href);
  const font = MAIL_FONT;
  const bodyWrap =
    locale === "ko" ? "word-break:keep-all;overflow-wrap:break-word;" : "overflow-wrap:anywhere;";
  const preheaderPad = "&nbsp;&zwnj;".repeat(40);
  const logo = watchdiveLogoImg(`${RECOVERY_20261102_ORIGIN}${LOGO_PATH}`);

  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(locale)}" dir="ltr">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(copy.subject)}</title>`,
    "<style>",
    "@media only screen and (max-width:480px){",
    ".wd-shell{padding:12px 8px !important}",
    ".wd-pad{padding-left:16px !important;padding-right:16px !important}",
    ".wd-title{font-size:26px !important;line-height:34px !important}",
    "}",
    "</style>",
    "<!--[if mso]><style>body,table,td,p,a,h1{font-family:Arial,sans-serif !important;}</style><![endif]-->",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${MAIL_PAGE};font-family:${font};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${MAIL_PAGE};">${escapeHtml(copy.preheader)}${preheaderPad}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MAIL_PAGE}" style="width:100%;border-collapse:collapse;background-color:${MAIL_PAGE};">`,
    `<tr><td class="wd-shell" align="center" style="padding:24px 12px;">`,
    '<!--[if mso]><table role="presentation" width="576" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MAIL_PAPER}" style="width:100%;max-width:576px;border:3px solid ${MAIL_INK};border-collapse:separate;background-color:${MAIL_PAPER};">`,
    `<tr><td class="wd-pad" align="left" bgcolor="${MAIL_PAPER}" style="padding:28px 22px;background-color:${MAIL_PAPER};border-bottom:3px solid ${MAIL_INK};">`,
    logo,
    "</td></tr>",
    `<tr><td bgcolor="${MAIL_YELLOW}" height="8" style="height:8px;font-size:0;line-height:8px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${MAIL_INK};">&nbsp;</td></tr>`,
    `<tr><td class="wd-pad" bgcolor="${MAIL_CYAN}" style="padding:22px 22px 20px;background-color:${MAIL_CYAN};border-bottom:3px solid ${MAIL_INK};">`,
    `<h1 class="wd-title" style="margin:0;color:${MAIL_TEXT};font-family:${font};font-size:30px;font-weight:700;line-height:38px;${bodyWrap}">${escapeHtml(copy.headline)}</h1>`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${MAIL_PAPER}" style="padding:22px 22px 28px;background-color:${MAIL_PAPER};">`,
    `<p style="margin:0 0 22px;color:${MAIL_TEXT};font-family:${font};font-size:16px;font-weight:400;line-height:26px;${bodyWrap}">${escapeHtml(copy.body)}</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr>',
    `<td align="center" bgcolor="${MAIL_CYAN}" style="background-color:${MAIL_CYAN};border:3px solid ${MAIL_INK};mso-padding-alt:18px 12px;">`,
    `<a href="${safeHref}" rel="noreferrer noopener" style="display:block;padding:18px 12px;color:${MAIL_TEXT};font-family:${font};font-size:18px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(copy.button)}</a>`,
    "</td></tr></table>",
    `<p style="margin:18px 0 8px;color:${MAIL_TEXT};font-family:${font};font-size:14px;font-weight:400;line-height:22px;${bodyWrap}">${escapeHtml(copy.fallback)}</p>`,
    '<p style="margin:0;word-break:break-all;overflow-wrap:anywhere;">',
    `<a href="${safeHref}" rel="noreferrer noopener" style="color:${MAIL_MID};font-family:${font};font-size:13px;font-weight:400;line-height:20px;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeHref}</a>`,
    "</p>",
    `<p style="margin:22px 0 0;color:${MAIL_TEXT};font-family:${font};font-size:14px;font-weight:400;line-height:22px;${bodyWrap}">${escapeHtml(copy.ignore)}</p>`,
    `<p style="margin:18px 0 0;color:${MAIL_MUTED};font-family:${font};font-size:13px;font-weight:400;line-height:20px;">${escapeHtml(FOOTER_NAME)}<br>`,
    `<a href="mailto:${FOOTER_MAILBOX}" style="color:${MAIL_MID};text-decoration:underline;">${escapeHtml(FOOTER_MAILBOX)}</a></p>`,
    "</td></tr>",
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("");
}

export function renderRecovery20261102(input: Recovery20261102Input): Recovery20261102Mail {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail();
  const { locale, verificationUrl, publicOrigin } = input;
  if (!isRecoveryLocale(locale)) fail();
  if (typeof verificationUrl !== "string" || verificationUrl.length === 0) fail();
  const href = acceptedVerificationUrl(locale, verificationUrl, publicOrigin);
  const copy = COPY[locale];
  return {
    subject: copy.subject,
    html: htmlDocument(locale, copy, href),
    text: plainText(copy, href),
  };
}

/**
 * Local design preview. The fragment matches a token shape and is not a
 * signature. Do not send this URL.
 */
export function renderRecovery20261102Preview(
  locale: Recovery20261102Locale,
): Recovery20261102Mail & { verificationUrl: string } {
  if (!isRecoveryLocale(locale)) fail();
  const token = `v2.${SYNTHETIC_LEAD}.${SYNTHETIC_EXPIRY}.0.${locale}.${SYNTHETIC_MAC}`;
  const verificationUrl = canonicalVerificationUrl(locale, token);
  const mail = renderRecovery20261102({
    locale,
    verificationUrl,
    publicOrigin: RECOVERY_20261102_ORIGIN,
  });
  return { ...mail, verificationUrl };
}
