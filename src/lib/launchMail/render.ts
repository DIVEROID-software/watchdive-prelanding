// Launch-mail HTML and text.
//
// Brutal frame, official WatchDive primary PNG, one cyan action, plain-link
// fallback, legal name only in the footer. Inline CSS and presentation tables.
// No web font, no script. Rendering is a pure function of its inputs: Resend
// refuses a reused idempotency key whose payload differs.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import {
  MAIL_CYAN,
  MAIL_FONT,
  MAIL_FOAM,
  MAIL_INK,
  MAIL_PAGE,
  MAIL_PAPER,
  MAIL_TEXT,
  MAIL_VIOLET,
  MAIL_YELLOW,
  watchdiveLogoImg,
} from "../mail/brutal.ts";
import type { LaunchWave } from "./audience.ts";
import { LABEL_SEPARATOR, LAUNCH_COPY, LAUNCH_TIME_ZONE, launchWaveCopy } from "./copy.ts";

export type LaunchMailInput = {
  wave: LaunchWave;
  locale: Locale;
  kickstarterUrl: string;
  launchAt: Date;
  unsubscribeUrl: string;
  /** Sender's postal address for the footer (CAN-SPAM). Omitted only in previews. */
  postalAddress?: string;
  /**
   * Buddy Invite is switched on for this run: the price lines name the
   * price-reservation and Dive Team exceptions (LAUNCH_REFERRAL_PRICE).
   * Absent or false renders exactly the mail this module always rendered.
   */
  referralProgram?: boolean;
};

export type RenderedLaunchMail = { subject: string; html: string; text: string };

const FONT = MAIL_FONT;
const DEEP = MAIL_VIOLET;
const CYAN = MAIL_CYAN;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withZoneLabel(locale: Locale, time: string, label: string): string {
  if (locale === "en") return `${time} ${label}`;
  // Full-width brackets where the script expects them.
  if (locale === "ja" || locale.startsWith("zh")) return `${time}（${label}）`;
  return `${time} (${label})`;
}

/**
 * The launch moment in the reader's language: in the zone most of its readers
 * live in, named the way they name it, and in UTC.
 */
export function formatLaunchTime(launchAt: Date, locale: Locale): { local: string; utc: string } {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const { zone, label } = LAUNCH_TIME_ZONE[locale];
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(launchAt);
  return {
    local: withZoneLabel(locale, format(zone), label),
    utc: withZoneLabel(locale, format("UTC"), "UTC"),
  };
}

export function renderLaunchMail(input: LaunchMailInput): RenderedLaunchMail {
  const copy = LAUNCH_COPY[input.locale];
  const wave = launchWaveCopy(input.locale, input.wave, input.referralProgram === true);
  const time = formatLaunchTime(input.launchAt, input.locale);
  const body = wave.body.replace("{time}", time.local);
  const cjk = input.locale === "ko" || input.locale === "ja" || input.locale.startsWith("zh");
  // Korean breaks between words, not inside them, as in the approved design.
  const wordBreak = input.locale === "ko" ? "keep-all" : "normal";
  const ks = escapeHtml(input.kickstarterUrl);
  const unsub = escapeHtml(input.unsubscribeUrl);
  const p = (style: string, content: string) =>
    `<p style="margin:0;font-family:${FONT};word-break:${wordBreak};overflow-wrap:break-word;${style}">${content}</p>`;

  const html = [
    "<!doctype html>",
    `<html lang="${input.locale}" dir="ltr">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(wave.subject)}</title>`,
    "<style>@media only screen and (max-width:480px){.wd-shell{padding:16px 8px!important}.wd-pad{padding-left:16px!important;padding-right:16px!important}.wd-title{font-size:24px!important;line-height:1.3!important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:${MAIL_PAGE};font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;color:${MAIL_PAGE};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(wave.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MAIL_PAGE}" style="width:100%;border-collapse:collapse;"><tr><td class="wd-shell" align="center" style="padding:24px 12px;">`,
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;">',
    `<tr><td bgcolor="${MAIL_INK}" style="padding:0 6px 6px 0;background-color:${MAIL_INK};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:3px solid ${MAIL_INK};border-collapse:separate;background-color:${MAIL_PAPER};">`,
    `<tr><td class="wd-pad" bgcolor="${MAIL_PAPER}" style="padding:34px!important;background-color:${MAIL_PAPER};border-bottom:3px solid ${MAIL_INK};">`,
    watchdiveLogoImg(),
    "</td></tr>",
    `<tr><td bgcolor="${MAIL_YELLOW}" height="8" style="height:8px;font-size:0;line-height:8px;background-color:${MAIL_YELLOW};border-bottom:3px solid ${MAIL_INK};">&nbsp;</td></tr>`,
    `<tr><td class="wd-pad" bgcolor="${MAIL_PAPER}" style="padding:22px 22px 28px;background-color:${MAIL_PAPER};">`,
    `<h1 class="wd-title" style="margin:0 0 18px;color:${DEEP};font-family:${FONT};font-size:28px;font-weight:700;line-height:1.3;letter-spacing:${cjk ? "0" : "-0.7px"};word-break:${wordBreak};overflow-wrap:break-word;">${escapeHtml(wave.heading)}</h1>`,
    p("margin:0 0 18px;color:#10212E;font-size:16px;line-height:1.65;", escapeHtml(body)),
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 18px;border-collapse:collapse;"><tr>',
    `<td bgcolor="${MAIL_FOAM}" style="padding:14px 16px;border:3px solid ${MAIL_INK};border-left:8px solid ${CYAN};background-color:${MAIL_FOAM};">`,
    p(
      `margin:0 0 6px;color:${DEEP};font-size:12px;font-weight:700;letter-spacing:1px;line-height:16px;`,
      escapeHtml(copy.timeLabel),
    ),
    p(
      `margin:0 0 4px;color:${MAIL_TEXT};font-size:16px;font-weight:700;line-height:24px;`,
      escapeHtml(time.local),
    ),
    p(`color:${DEEP};font-size:13px;line-height:20px;`, escapeHtml(time.utc)),
    "</td></tr></table>",
    p(
      `margin:0 0 22px;color:${DEEP};font-size:16px;font-weight:700;line-height:1.5;`,
      escapeHtml(wave.price),
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td align="center" bgcolor="${CYAN}" style="background-color:${CYAN};border:3px solid ${MAIL_INK};mso-padding-alt:16px 18px;">`,
    `<a href="${ks}" rel="noreferrer noopener" style="display:block;padding:16px 18px;color:${MAIL_TEXT};font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(wave.button)}</a>`,
    "</td></tr></table>",
    `<p style="margin:14px 0 0;word-break:break-all;overflow-wrap:anywhere;text-align:center;"><a href="${ks}" rel="noreferrer noopener" style="color:#35627e;font-family:Consolas,monospace;font-size:12px;line-height:20px;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${ks}</a></p>`,
    "</td></tr></table></td></tr>",
    '<tr><td style="padding:20px 12px 0;text-align:center;">',
    p("margin:0 auto 10px;color:#67758a;font-size:12px;line-height:20px;", escapeHtml(copy.reason)),
    p(
      "margin:0 auto 16px;font-size:12px;line-height:20px;",
      `<a href="${unsub}" rel="noreferrer noopener" style="color:#67758a;text-decoration:underline;">${escapeHtml(copy.unsubscribe)}</a>`,
    ),
    p(
      `color:${DEEP};font-size:12px;font-weight:700;line-height:20px;`,
      "DIVEROID LTD &nbsp;·&nbsp; WatchDive",
    ),
    ...(input.postalAddress
      ? [
          p(
            "margin:4px 0 0;color:#67758a;font-size:12px;line-height:20px;",
            escapeHtml(input.postalAddress),
          ),
        ]
      : []),
    p(
      "margin:6px 0 0;font-size:12px;line-height:20px;",
      `<a href="mailto:help@diveroid.com" style="color:#67758a;text-decoration:underline;">${escapeHtml(copy.help)}</a>`,
    ),
    "</td></tr></table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</body></html>",
  ].join("\n");

  const sep = LABEL_SEPARATOR[input.locale];
  const text = [
    wave.heading,
    "",
    body,
    "",
    `${copy.timeLabel}${sep}${time.local}`,
    time.utc,
    "",
    wave.price,
    "",
    `${wave.button}${sep}${input.kickstarterUrl}`,
    "",
    "—",
    copy.reason,
    `${copy.unsubscribe}${sep}${input.unsubscribeUrl}`,
    "DIVEROID LTD · WatchDive",
    ...(input.postalAddress ? [input.postalAddress] : []),
    copy.help,
  ].join("\n");

  return { subject: wave.subject, html, text };
}
