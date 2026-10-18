// Reservation-invite HTML and text. Rendering is a pure function of its
// inputs so a resumed send stays byte-identical for the provider idempotency
// key. Inline CSS only. The only image is the official wordmark on our origin.
// No script, no third-party image, no recipient address.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import { LABEL_SEPARATOR } from "../launchMail/copy.ts";
import { RESERVATION_COPY, RESERVATION_TAGLINE, copyParagraphs } from "./copy.ts";
import {
  RESERVATION_COMPANY_NUMBER,
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
  resolveReservationMerchant,
} from "./merchant.ts";

export type ReservationMailInput = {
  locale: Locale;
  inviteUrl: string;
  unsubscribeUrl: string;
  privacyUrl: string;
  termsUrl: string;
  /**
   * Optional confirmation of the registered office. Omit it to use the
   * verified office. A different address is rejected.
   */
  postalAddress?: string;
  /**
   * Optional confirmation of DIVEROID LTD. Omit it to use that name.
   * A different name is rejected. The company number is not an input.
   */
  legalName?: string;
};

export type RenderedReservationMail = { subject: string; html: string; text: string };

const FONT =
  "'Pangram Sans','Spoqa Han Sans Neo','Helvetica Neue',Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
const DEEP = "#201748";
const MID = "#3D2683";
const FOAM = "#EEF9FF";
const INK = "#10212E";
const CANVAS = "#F6FAFC";
const PAPER = "#FFFFFF";
const LINE = "#D5E3EA";
const MUTED = "#526B7A";
const WORDMARK_PATH = "/brand/reservation/diveroid-wordmark-white-transparent.png";

const FORBIDDEN: readonly RegExp[] = [
  /\b100\s+backers\b/i,
  /\$299\b/,
  /USD\s*\$299\b/,
  /\bDecember\b/,
  /12월/,
  /12月/,
  /\bdécembre\b/i,
  /\bdiciembre\b/i,
  /\bdezembro\b/i,
  /\bDezember\b/,
  /\bstock\b/i,
  /재고/,
  /在庫/,
  /库存/,
  /庫存/,
  /(?<!not )credited toward/i,
  /free shipping/i,
  /only\s+\d+\s+left/i,
  /not itself a reservation/i,
  /not a receipt/i,
  /영수증/,
  /체크아웃/,
  /크레딧/,
  /チェックアウト/,
];

function withoutUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requireHttps(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Reservation mail link is not a URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Reservation mail link must be https and carry no credentials");
  }
  return url.toString();
}

function requireInviteUrl(value: string, locale: Locale): string {
  const href = requireHttps(value);
  const url = new URL(href);
  if (url.pathname !== "/reservation") throw new Error("Reservation mail link");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "lang") throw new Error("Reservation mail link");
  const lang = url.searchParams.get("lang");
  if (lang !== locale) throw new Error("Reservation mail link");
  if (!url.hash.startsWith("#invite=")) throw new Error("Reservation mail link");
  if (
    url.searchParams.has("inviteToken") ||
    url.searchParams.has("invite") ||
    url.searchParams.has("token")
  ) {
    throw new Error("Reservation mail link");
  }
  const token = decodeURIComponent(url.hash.slice("#invite=".length));
  if (!token || url.search.includes(token)) throw new Error("Reservation mail link");
  return href;
}

export function assertReservationMailSafe(
  mail: RenderedReservationMail,
  locale: Locale,
  postalAddress?: string,
  legalName?: string,
): void {
  let html = mail.html;
  let text = mail.text;
  for (const value of [
    postalAddress,
    legalName,
    RESERVATION_LEGAL_NAME,
    RESERVATION_REGISTERED_OFFICE,
    RESERVATION_COMPANY_NUMBER,
  ]) {
    if (!value) continue;
    html = html.replaceAll(escapeHtml(value), "");
    text = text.replaceAll(value, "");
  }
  const copy = RESERVATION_COPY[locale];
  const prose = withoutUrls(`${mail.subject}\n${html}\n${text}`);
  if (mail.subject !== copy.subject || !prose.includes(copy.disclosure)) {
    throw new Error("Reservation mail is missing the required fee disclosure");
  }
  for (const phrase of Object.values(copy.anchors)) {
    if (!prose.includes(phrase)) {
      throw new Error("Reservation mail is missing the required fee disclosure");
    }
  }
  if (locale !== "en" && prose.includes(RESERVATION_COPY.en.disclosure)) {
    throw new Error("Reservation mail is missing the required fee disclosure");
  }
  // Signed links are removed first. A token can spell a forbidden word by chance,
  // and that must not block the send or hide a real claim in the prose.
  for (const pattern of FORBIDDEN) {
    if (pattern.test(prose)) throw new Error("Reservation mail contains a forbidden claim");
  }
}

export function renderReservationMail(input: ReservationMailInput): RenderedReservationMail {
  const resolved = resolveReservationMerchant(input.legalName, input.postalAddress);
  if (!resolved.ok) throw new Error("Reservation mail merchant identity mismatch");
  const merchant = resolved.merchant;
  const copy = RESERVATION_COPY[input.locale];
  const inviteUrl = requireInviteUrl(input.inviteUrl, input.locale);
  const unsubscribeUrl = requireHttps(input.unsubscribeUrl);
  const privacyUrl = requireHttps(input.privacyUrl);
  const termsUrl = requireHttps(input.termsUrl);
  const wordBreak = input.locale === "ko" ? "keep-all" : "normal";
  const invite = escapeHtml(inviteUrl);
  const unsub = escapeHtml(unsubscribeUrl);
  const privacy = escapeHtml(privacyUrl);
  const terms = escapeHtml(termsUrl);
  const p = (style: string, content: string) =>
    `<p style="margin:0 0 14px;font-family:${FONT};word-break:${wordBreak};overflow-wrap:break-word;${style}">${content}</p>`;
  const body = (content: string) =>
    p("color:#10212E;font-size:15px;line-height:1.6;font-weight:400;", escapeHtml(content));
  const wordmark = `${new URL(inviteUrl).origin}${WORDMARK_PATH}`;
  const tagline = RESERVATION_TAGLINE[input.locale];
  const tracking = input.locale === "ko" ? "-0.6px" : "-0.3px";

  const html = [
    "<!doctype html>",
    `<html lang="${input.locale}" dir="ltr">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(copy.subject)}</title>`,
    "<style>@media only screen and (max-width:480px){.wd-shell{padding:20px 12px!important}.wd-pad{padding-left:24px!important;padding-right:24px!important}.wd-title{font-size:24px!important;line-height:1.35!important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${CANVAS};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;color:${CANVAS};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(copy.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="width:100%;border-collapse:collapse;"><tr><td class="wd-shell" align="center" style="padding:40px 16px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-spacing:0;">',
    `<tr><td class="wd-pad" bgcolor="${DEEP}" align="left" style="padding:32px 40px;background-color:${DEEP};border-radius:24px 24px 0 0;">`,
    `<img src="${wordmark}" width="160" height="24" alt="DIVEROID" style="display:block;width:160px;height:auto;border:0;outline:none;text-decoration:none;">`,
    "</td></tr>",
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:36px 40px 32px;background-color:${PAPER};">`,
    `<h1 class="wd-title" style="margin:0 0 18px;color:${INK};font-family:${FONT};font-size:28px;font-weight:500;line-height:1.35;letter-spacing:${tracking};word-break:${wordBreak};overflow-wrap:break-word;">${escapeHtml(copy.heading)}</h1>`,
    body(copy.intro),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;"><tr>`,
    `<td style="padding:16px 18px;border:1px solid ${LINE};border-left:4px solid ${MID};border-radius:10px;background-color:${FOAM};">`,
    p(
      "margin:0;color:#10212E;font-size:15px;font-weight:400;line-height:1.6;",
      escapeHtml(copy.disclosure),
    ),
    "</td></tr></table>",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${MID}" style="background-color:${MID};border:1px solid ${MID};border-radius:12px;mso-padding-alt:18px 20px;">`,
    `<a href="${invite}" rel="noreferrer noopener" style="display:block;padding:18px 20px;border-radius:12px;color:#FFFFFF;font-family:${FONT};font-size:16px;font-weight:600;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(copy.button)}</a>`,
    "</td></tr></table>",
    `<p style="margin:16px 0 0;padding:12px 14px;border:1px solid ${LINE};border-radius:10px;background-color:${FOAM};word-break:break-all;overflow-wrap:anywhere;text-align:center;"><a href="${invite}" rel="noreferrer noopener" style="color:${MID};font-family:${FONT};font-size:13px;line-height:20px;text-decoration:underline;">${escapeHtml(copy.fallback)}</a></p>`,
    "</td></tr>",
    `<tr><td bgcolor="${PAPER}" style="padding:0;background-color:${PAPER};border-radius:0 0 24px 24px;font-size:0;line-height:24px;">&nbsp;</td></tr>`,
    '<tr><td style="padding:24px 20px 0;text-align:center;">',
    p("margin:0 auto 8px;color:#526B7A;font-size:13px;line-height:20px;", escapeHtml(tagline)),
    p("margin:0 auto 10px;color:#526B7A;font-size:12px;line-height:20px;", escapeHtml(copy.reason)),
    p(
      "margin:0 auto 10px;font-size:12px;line-height:20px;",
      `<a href="${unsub}" rel="noreferrer noopener" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.unsubscribe)}</a>`,
    ),
    p(
      "margin:0 auto 16px;font-size:12px;line-height:20px;",
      `<a href="${privacy}" rel="noreferrer noopener" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.privacy)}</a>` +
        ` &nbsp;·&nbsp; ` +
        `<a href="${terms}" rel="noreferrer noopener" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.terms)}</a>`,
    ),
    p(
      `color:${INK};font-size:12px;font-weight:500;line-height:20px;`,
      `${escapeHtml(merchant.legalName)} &nbsp;·&nbsp; ${escapeHtml(merchant.companyNumber)} &nbsp;·&nbsp; WatchDive`,
    ),
    p(
      `margin:4px 0 0;color:${MUTED};font-size:12px;line-height:20px;`,
      escapeHtml(merchant.postalAddress),
    ),
    p(
      "margin:6px 0 0;font-size:12px;line-height:20px;",
      `<a href="mailto:help@diveroid.com" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.help)}</a>`,
    ),
    "</td></tr></table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");

  const sep = LABEL_SEPARATOR[input.locale];
  const text = [
    copy.heading,
    tagline,
    "",
    copy.intro,
    "",
    copy.disclosure,
    "",
    `${copy.button}${sep}${inviteUrl}`,
    copy.fallback,
    inviteUrl,
    "",
    "—",
    copy.reason,
    `${copy.unsubscribe}${sep}${unsubscribeUrl}`,
    `${copy.privacy}${sep}${privacyUrl}`,
    `${copy.terms}${sep}${termsUrl}`,
    `${merchant.legalName} · ${merchant.companyNumber} · WatchDive`,
    merchant.postalAddress,
    `help@diveroid.com`,
  ].join("\n");

  const rendered = { subject: copy.subject, html, text };
  for (const paragraph of copyParagraphs(copy)) {
    if (!text.includes(paragraph)) throw new Error("Reservation mail dropped a required paragraph");
  }
  assertReservationMailSafe(rendered, input.locale, merchant.postalAddress, merchant.legalName);
  return rendered;
}
