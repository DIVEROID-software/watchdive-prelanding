// Reservation-invite HTML and text. Rendering is a pure function of its
// inputs so a resumed send stays byte-identical for the provider idempotency
// key. Inline CSS only. Images are the official wordmark and approved real pool photo on our origin.
// No script, no third-party image, no recipient address.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import { RESERVATION_PRESENTATION } from "../../components/reservation/presentation.ts";
import {
  MAIL_CANVAS,
  MAIL_CYAN,
  MAIL_FOAM,
  MAIL_FONT,
  MAIL_INK,
  MAIL_MID,
  MAIL_PAPER,
  MAIL_TEXT,
  MAIL_VIOLET,
  MAIL_YELLOW,
  watchdiveLogoImg,
} from "../mail/brutal.ts";
import { LABEL_SEPARATOR } from "../launchMail/copy.ts";
import { RESERVATION_COPY, RESERVATION_TAGLINE, copyParagraphs } from "./copy.ts";
import {
  RESERVATION_COMPANY_NUMBER,
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
  resolveReservationMerchant,
} from "./merchant.ts";
import type { DripStage } from "../reservation-drip/policy.ts";
import {
  STAGE_LAYOUT,
  isReservationEmailSegment,
  segmentedHeroPath,
  type ReservationEmailSegment,
  type StageLayout,
} from "../reservation-drip/media.ts";
import { D1_DEMAND_COPY, personalizedStageCopy } from "../reservation-drip/personalized-copy.ts";

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
  /**
   * Signup landing. Omit it and the legacy general invite stays byte-compatible.
   * Pass `general`, `scuba` or `freediving` for the segmented sequence.
   * The union matches the backend `ReservationEmailSegment`.
   */
  segment?: ReservationEmailSegment;
};

export type RenderedReservationMail = { subject: string; html: string; text: string };

const FONT = MAIL_FONT;
const DEEP = MAIL_VIOLET;
const MID = MAIL_MID;
const FOAM = MAIL_FOAM;
const INK = "#10212E";
const CANVAS = MAIL_CANVAS;
const PAPER = MAIL_PAPER;
const MUTED = "#526B7A";

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

export type MarketingMailLines = {
  subject: string;
  preheader: string;
  headline: string;
  sentence1: string;
  sentence2: string;
  feeNote: string;
  cta: string;
  /** Optional last body paragraph, rendered once above the button. */
  demand?: string;
};

export type MarketingMailChrome = {
  layout: StageLayout;
  heroPath: string;
  imageAlt: string;
  eyebrow: string;
  chip: string;
};

export type { ReservationEmailSegment };

export function assertReservationMailSafe(
  mail: RenderedReservationMail,
  locale: Locale,
  postalAddress?: string,
  legalName?: string,
): void {
  const copy = RESERVATION_COPY[locale];
  assertMarketingMailSafe(
    mail,
    locale,
    {
      subject: copy.subject,
      preheader: copy.preheader,
      headline: copy.heading,
      sentence1: copy.intro,
      sentence2: copy.detail,
      feeNote: copy.feeNote,
      cta: copy.button,
    },
    postalAddress,
    legalName,
  );
}

/** Marketing mail stays short. Checkout `disclosure` is a fact source, not a second essay. */
export function assertMarketingMailSafe(
  mail: RenderedReservationMail,
  locale: Locale,
  lines: MarketingMailLines,
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
  if (mail.subject !== lines.subject || /[\r\n]/.test(mail.subject)) {
    throw new Error("Reservation mail subject does not match the approved line");
  }
  for (const phrase of [
    lines.preheader,
    lines.headline,
    lines.sentence1,
    lines.sentence2,
    ...(lines.demand ? [lines.demand] : []),
    lines.cta,
    copy.fallback,
    copy.reason,
    copy.unsubscribe,
  ]) {
    if (!prose.includes(phrase)) throw new Error("Reservation mail dropped a required line");
  }
  if (!mail.html.includes(`>${escapeHtml(copy.unsubscribe)}</a>`)) {
    throw new Error("Reservation mail is missing the unsubscribe link");
  }
  if (prose.includes(copy.feeNote)) throw new Error("Reservation mail printed the checkout fee note");
  if (prose.includes(copy.disclosure) || (locale !== "en" && prose.includes(RESERVATION_COPY.en.disclosure))) {
    throw new Error("Reservation mail printed the checkout disclosure");
  }
  if (mail.html.includes("<script") || mail.html.includes("font-size:64px")) {
    throw new Error("Reservation mail layout rejected");
  }
  // Signed links are removed first. A token can spell a forbidden word by chance,
  // and that must not block the send or hide a real claim in the prose.
  // The owner-approved D1 paragraph names "100 backers" on purpose. Only that
  // exact sentence is removed before the scan, so any other wording still fails.
  let claimProse = prose;
  for (const line of Object.values(D1_DEMAND_COPY)) claimProse = claimProse.replaceAll(line, "");
  for (const pattern of FORBIDDEN) {
    if (pattern.test(claimProse)) throw new Error("Reservation mail contains a forbidden claim");
  }
}

export function renderReservationMail(input: ReservationMailInput): RenderedReservationMail {
  if (input.segment) return renderSegmentedReservationMail(input, "d0");
  const copy = RESERVATION_COPY[input.locale];
  const rendered = renderMarketingMail(input, {
    subject: copy.subject,
    preheader: copy.preheader,
    headline: copy.heading,
    sentence1: copy.intro,
    sentence2: copy.detail,
    feeNote: copy.feeNote,
    cta: copy.button,
  });
  for (const paragraph of copyParagraphs(copy)) {
    if (!rendered.text.includes(paragraph)) throw new Error("Reservation mail dropped a required paragraph");
  }
  return rendered;
}

export function renderMarketingMail(
  input: ReservationMailInput,
  lines: MarketingMailLines,
  chrome?: MarketingMailChrome,
): RenderedReservationMail {
  if (chrome) return renderVariedMarketingMail(input, lines, chrome);
  const resolved = resolveReservationMerchant(input.legalName, input.postalAddress);
  if (!resolved.ok) throw new Error("Reservation mail merchant identity mismatch");
  const merchant = resolved.merchant;
  const copy = RESERVATION_COPY[input.locale];
  const presentation = RESERVATION_PRESENTATION[input.locale];
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
    `<p style="margin:0;font-family:${FONT};word-break:${wordBreak};overflow-wrap:break-word;${style}">${content}</p>`;
  const hero = `${new URL(inviteUrl).origin}/brand/reservation/watchdive-underwater.jpg`;
  const tagline = RESERVATION_TAGLINE[input.locale];
  const tracking = input.locale === "ko" ? "-0.6px" : "-0.3px";
  const headline = escapeHtml(lines.headline).replaceAll("\n", "<br>");

  const html = [
    "<!doctype html>",
    `<html lang="${input.locale}" dir="ltr">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(lines.subject)}</title>`,
    "<style>@media only screen and (max-width:480px){.wd-shell{padding:16px 8px!important}.wd-pad{padding-left:16px!important;padding-right:16px!important}.wd-title{font-size:24px!important;line-height:1.35!important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${CANVAS};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;color:${CANVAS};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(lines.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="width:100%;border-collapse:collapse;"><tr><td class="wd-shell" align="center" style="padding:24px 12px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">',
    `<tr><td bgcolor="${MAIL_INK}" style="padding:0 6px 6px 0;background-color:${MAIL_INK};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:3px solid ${DEEP};border-collapse:separate;background-color:${PAPER};">`,
    `<tr><td class="wd-pad" bgcolor="${PAPER}" align="left" style="padding:34px!important;background-color:${PAPER};border-bottom:3px solid ${DEEP};">`,
    watchdiveLogoImg(),
    "</td></tr>",
    `<tr><td bgcolor="${MAIL_YELLOW}" height="8" style="height:8px;font-size:0;line-height:8px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${DEEP};">&nbsp;</td></tr>`,
    `<tr><td bgcolor="${PAPER}" style="padding:0;background-color:${PAPER};font-size:0;line-height:0;border-bottom:3px solid ${DEEP};">`,
    `<img src="${hero}" width="600" alt="${escapeHtml(presentation.imageAlt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;">`,
    "</td></tr>",
    `<tr><td bgcolor="${FOAM}" style="height:8px;background-color:${FOAM};font-size:0;line-height:8px;border-bottom:3px solid ${DEEP};">&nbsp;</td></tr>`,
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:22px 22px 28px;background-color:${PAPER};">`,
    `<h1 class="wd-title" style="margin:0 0 16px;color:${DEEP};font-family:${FONT};font-size:28px;font-weight:700;line-height:1.3;letter-spacing:${tracking};word-break:${wordBreak};overflow-wrap:break-word;">${headline}</h1>`,
    p(`margin:0 0 10px;color:${INK};font-size:16px;line-height:1.6;`, escapeHtml(lines.sentence1)),
    p(`margin:0 0 18px;color:${INK};font-size:16px;line-height:1.6;`, escapeHtml(lines.sentence2)),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${MAIL_CYAN}" style="background-color:${MAIL_CYAN};border:3px solid ${MAIL_INK};mso-padding-alt:16px 20px;">`,
    `<a href="${invite}" rel="noreferrer noopener" style="display:block;padding:16px 20px;color:${MAIL_TEXT};font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(lines.cta)}</a>`,
    "</td></tr></table>",
    `<p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;text-align:center;word-break:break-all;overflow-wrap:anywhere;"><a href="${invite}" rel="noreferrer noopener" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.fallback)}</a></p>`,
    "</td></tr></table></td></tr>",
    '<tr><td style="padding:20px 12px 0;text-align:center;">',
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
    p(`margin:4px 0 0;color:${MUTED};font-size:12px;line-height:20px;`, escapeHtml(merchant.postalAddress)),
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
    lines.headline.replaceAll("\n", " "),
    tagline,
    "",
    lines.sentence1,
    lines.sentence2,
    "",
    `${lines.cta}${sep}${inviteUrl}`,
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
    "help@diveroid.com",
  ].join("\n");

  const rendered = { subject: lines.subject, html, text };
  assertMarketingMailSafe(rendered, input.locale, lines, merchant.postalAddress, merchant.legalName);
  return rendered;
}

export function renderSegmentedReservationMail(
  input: ReservationMailInput,
  stage: DripStage,
): RenderedReservationMail {
  if (!isReservationEmailSegment(input.segment)) throw new Error("Reservation mail segment");
  const draft = personalizedStageCopy(input.segment, input.locale, stage);
  const base = RESERVATION_COPY[input.locale];
  return renderMarketingMail(
    input,
    {
      subject: draft.subject,
      preheader: draft.preheader,
      headline: draft.headline,
      sentence1: draft.sentence1,
      sentence2: draft.sentence2,
      ...(draft.demand ? { demand: draft.demand } : {}),
      feeNote: base.feeNote,
      cta: base.button,
    },
    {
      layout: STAGE_LAYOUT[stage],
      heroPath: segmentedHeroPath(input.segment, stage),
      imageAlt: draft.imageAlt,
      eyebrow: draft.eyebrow,
      chip: draft.chip,
    },
  );
}

function renderVariedMarketingMail(
  input: ReservationMailInput,
  lines: MarketingMailLines,
  chrome: MarketingMailChrome,
): RenderedReservationMail {
  const resolved = resolveReservationMerchant(input.legalName, input.postalAddress);
  if (!resolved.ok) throw new Error("Reservation mail merchant identity mismatch");
  const merchant = resolved.merchant;
  const copy = RESERVATION_COPY[input.locale];
  const inviteUrl = requireInviteUrl(input.inviteUrl, input.locale);
  const heroUrl = segmentedHeroUrl(inviteUrl, chrome.heroPath);
  const unsubscribeUrl = requireHttps(input.unsubscribeUrl);
  const privacyUrl = requireHttps(input.privacyUrl);
  const termsUrl = requireHttps(input.termsUrl);
  const wordBreak = input.locale === "ko" ? "keep-all" : "normal";
  const invite = escapeHtml(inviteUrl);
  const unsub = escapeHtml(unsubscribeUrl);
  const privacy = escapeHtml(privacyUrl);
  const terms = escapeHtml(termsUrl);
  const p = (style: string, content: string) =>
    `<p style="margin:0;font-family:${FONT};word-break:${wordBreak};overflow-wrap:break-word;${style}">${content}</p>`;
  const tagline = RESERVATION_TAGLINE[input.locale];
  const tracking = input.locale === "ko" ? "-0.6px" : "-0.3px";
  const headline = escapeHtml(lines.headline).replaceAll("\n", "<br>");
  const eyebrow = escapeHtml(chrome.eyebrow);
  const chip = escapeHtml(chrome.chip);
  const hero = `<img src="${escapeHtml(heroUrl)}" width="600" alt="${escapeHtml(chrome.imageAlt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;">`;
  const imageRow = `<tr><td bgcolor="${PAPER}" style="padding:0;background-color:${PAPER};font-size:0;line-height:0;border-bottom:3px solid ${DEEP};">${hero}</td></tr>`;
  const cta = [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${MAIL_CYAN}" style="background-color:${MAIL_CYAN};border:3px solid ${MAIL_INK};mso-padding-alt:16px 20px;">`,
    `<a href="${invite}" rel="noreferrer noopener" style="display:block;padding:16px 20px;color:${MAIL_TEXT};font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(lines.cta)}</a>`,
    "</td></tr></table>",
    `<p style="margin:14px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;text-align:center;word-break:break-all;overflow-wrap:anywhere;"><a href="${invite}" rel="noreferrer noopener" style="color:${MID};text-decoration:underline;">${escapeHtml(copy.fallback)}</a></p>`,
  ].join("");
  const title = `<h1 class="wd-title" style="margin:0 0 16px;color:${DEEP};font-family:${FONT};font-size:28px;font-weight:700;line-height:1.3;letter-spacing:${tracking};word-break:${wordBreak};overflow-wrap:break-word;">${headline}</h1>`;
  const sentences = [
    p(`margin:0 0 10px;color:${INK};font-size:16px;line-height:1.6;`, escapeHtml(lines.sentence1)),
    p(
      `margin:0 0 ${lines.demand ? "10" : "18"}px;color:${INK};font-size:16px;line-height:1.6;`,
      escapeHtml(lines.sentence2),
    ),
    ...(lines.demand
      ? [p(`margin:0 0 18px;color:${INK};font-size:16px;line-height:1.6;`, escapeHtml(lines.demand))]
      : []),
  ].join("");
  const copyCell = (inner: string) =>
    `<tr><td class="wd-pad" bgcolor="${PAPER}" style="padding:22px 22px 28px;background-color:${PAPER};">${inner}</td></tr>`;
  const label = (content: string, extra: string) =>
    p(`color:${DEEP};font-size:12px;font-weight:700;line-height:18px;letter-spacing:0.4px;${extra}`, content);

  let middle: string[];
  if (chrome.layout === "welcome") {
    middle = [
      `<tr><td bgcolor="${MAIL_YELLOW}" height="8" style="height:8px;font-size:0;line-height:8px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${DEEP};">&nbsp;</td></tr>`,
      imageRow,
      copyCell(`${label(eyebrow, "margin:0 0 8px;")}${label(chip, "margin:0 0 14px;color:${INK};font-size:14px;")}${title}${sentences}${cta}`),
    ];
  } else if (chrome.layout === "proof") {
    middle = [
      `<tr><td class="wd-pad" bgcolor="${FOAM}" style="padding:12px 22px;background-color:${FOAM};border-bottom:3px solid ${DEEP};">${label(eyebrow, "margin:0;")}</td></tr>`,
      imageRow,
      `<tr><td class="wd-pad" bgcolor="${MAIL_CYAN}" style="padding:10px 22px;background-color:${MAIL_CYAN};border-bottom:3px solid ${DEEP};">${p("margin:0;color:" + INK + ";font-size:14px;font-weight:700;line-height:20px;", chip)}</td></tr>`,
      copyCell(`${title}${sentences}${cta}`),
    ];
  } else if (chrome.layout === "urgency") {
    middle = [
      `<tr><td class="wd-pad" bgcolor="${MAIL_YELLOW}" style="padding:12px 22px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${DEEP};">${label(eyebrow, "margin:0 0 4px;")}${p("margin:0;color:" + INK + ";font-size:18px;font-weight:700;line-height:24px;", chip)}</td></tr>`,
      imageRow,
      copyCell(`${title}${sentences}${cta}`),
    ];
  } else {
    middle = [
      `<tr><td class="wd-pad" bgcolor="${FOAM}" style="padding:12px 22px;background-color:${FOAM};border-bottom:3px solid ${DEEP};">${label(eyebrow, "margin:0;")}</td></tr>`,
      copyCell(
        `${title}${sentences}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 18px;"><tr><td bgcolor="${FOAM}" style="background-color:${FOAM};border:2px solid ${DEEP};padding:8px 12px;">${p("margin:0;color:" + INK + ";font-size:13px;font-weight:700;line-height:18px;", chip)}</td></tr></table>`,
      ),
      imageRow,
      copyCell(cta),
    ];
  }

  const html = [
    "<!doctype html>",
    `<html lang="${input.locale}" dir="ltr">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(lines.subject)}</title>`,
    "<style>@media only screen and (max-width:480px){.wd-shell{padding:16px 8px!important}.wd-pad{padding-left:16px!important;padding-right:16px!important}.wd-title{font-size:24px!important;line-height:1.35!important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${CANVAS};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;color:${CANVAS};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(lines.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="width:100%;border-collapse:collapse;"><tr><td class="wd-shell" align="center" style="padding:24px 12px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" data-layout="${chrome.layout}" style="width:100%;max-width:600px;border-collapse:separate;">`,
    `<tr><td bgcolor="${MAIL_INK}" style="padding:0 6px 6px 0;background-color:${MAIL_INK};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:3px solid ${DEEP};border-collapse:separate;background-color:${PAPER};">`,
    `<tr><td class="wd-pad" bgcolor="${PAPER}" align="left" style="padding:34px!important;background-color:${PAPER};border-bottom:3px solid ${DEEP};">`,
    watchdiveLogoImg(),
    "</td></tr>",
    ...middle,
    "</table></td></tr>",
    '<tr><td style="padding:20px 12px 0;text-align:center;">',
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
    p(`margin:4px 0 0;color:${MUTED};font-size:12px;line-height:20px;`, escapeHtml(merchant.postalAddress)),
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
    chrome.eyebrow,
    chrome.chip,
    lines.headline.replaceAll("\n", " "),
    tagline,
    "",
    lines.sentence1,
    lines.sentence2,
    ...(lines.demand ? [lines.demand] : []),
    "",
    `${lines.cta}${sep}${inviteUrl}`,
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
    "help@diveroid.com",
  ].join("\n");

  const rendered = { subject: lines.subject, html, text };
  assertMarketingMailSafe(rendered, input.locale, lines, merchant.postalAddress, merchant.legalName);
  const prose = `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
  if (!prose.includes(chrome.eyebrow) || !prose.includes(chrome.chip) || !rendered.html.includes(escapeHtml(chrome.imageAlt))) {
    throw new Error("Reservation mail dropped a stage line");
  }
  if (!rendered.html.includes(`data-layout="${chrome.layout}"`) || !rendered.html.includes("padding:34px!important")) {
    throw new Error("Reservation mail layout rejected");
  }
  return rendered;
}

function segmentedHeroUrl(inviteUrl: string, heroPath: string): string {
  if (!heroPath.startsWith("/brand/reservation/segmented/") || heroPath.includes("..")) {
    throw new Error("Reservation mail image");
  }
  const invite = new URL(inviteUrl);
  const hero = new URL(heroPath, invite.origin);
  if (hero.origin !== invite.origin || hero.pathname !== heroPath || hero.search || hero.username) {
    throw new Error("Reservation mail image");
  }
  return hero.toString();
}
