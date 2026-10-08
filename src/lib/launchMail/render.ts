// Launch-mail HTML and text.
//
// The layout follows the approved confirmation-mail design
// (outputs/email-design-20260920): deep-navy brand header with the cyan rule,
// one white rounded card, a full-width cyan CTA, a plain-link fallback and a
// quiet footer. Inline CSS and presentation tables only — no web font, no
// script, no remote image (the design's header photo is not served by the
// current site, so it is left out rather than shipped broken).
//
// Rendering is a pure function of its inputs. That matters: Resend refuses a
// reused idempotency key whose payload differs, so a re-run of the same wave
// with the same arguments must produce byte-identical mail.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import type { LaunchWave } from "./audience.ts";
import { LABEL_SEPARATOR, LAUNCH_COPY, LAUNCH_TIME_ZONE } from "./copy.ts";

export type LaunchMailInput = {
  wave: LaunchWave;
  locale: Locale;
  kickstarterUrl: string;
  launchAt: Date;
  unsubscribeUrl: string;
  /** Sender's postal address for the footer (CAN-SPAM). Omitted only in previews. */
  postalAddress?: string;
};

export type RenderedLaunchMail = { subject: string; html: string; text: string };

const FONT =
  "'Work Sans',Arial,'Apple SD Gothic Neo','Malgun Gothic','Hiragino Sans','Microsoft YaHei',sans-serif";
const NAVY = "#08021f";
const DEEP = "#180d3c";
const CYAN = "#6dcaf8";

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
  const wave = copy.waves[input.wave];
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
    "<style>@media only screen and (max-width:480px){.wd-shell{padding:20px 12px!important}.wd-pad{padding-left:24px!important;padding-right:24px!important}.wd-brand{font-size:30px!important;letter-spacing:-1px!important}.wd-title{font-size:26px!important;line-height:1.3!important}}</style>",
    "</head>",
    `<body style="margin:0;padding:0;width:100%;background-color:#f1f4f8;font-family:${FONT};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;font-size:1px;line-height:1px;color:#f1f4f8;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(wave.preheader)}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f4f8" style="width:100%;border-collapse:collapse;"><tr><td class="wd-shell" align="center" style="padding:40px 16px;">',
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-spacing:0;">',
    // Brand header
    `<tr><td class="wd-pad" bgcolor="${NAVY}" style="padding:32px 40px 30px;background-color:${NAVY};border-radius:24px 24px 0 0;border-bottom:3px solid ${CYAN};">`,
    p(
      `margin:0 0 14px;color:${CYAN};font-size:11px;font-weight:700;letter-spacing:2.4px;line-height:16px;`,
      "DIVEROID · KICKSTARTER",
    ),
    `<p class="wd-brand" style="margin:0;color:#ffffff;font-family:${FONT};font-size:36px;font-weight:800;letter-spacing:-1.3px;line-height:42px;">WatchDive<span style="color:${CYAN};">.</span></p>`,
    "</td></tr>",
    // Card
    '<tr><td class="wd-pad" bgcolor="#ffffff" style="padding:36px 40px 32px;background-color:#ffffff;">',
    `<h1 class="wd-title" style="margin:0 0 18px;color:${NAVY};font-family:${FONT};font-size:30px;font-weight:700;line-height:1.3;letter-spacing:${cjk ? "0" : "-0.7px"};word-break:${wordBreak};overflow-wrap:break-word;">${escapeHtml(wave.heading)}</h1>`,
    p("margin:0 0 22px;color:#49566a;font-size:16px;line-height:1.75;", escapeHtml(body)),
    // Launch time
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 22px;"><tr>',
    `<td style="padding:16px 18px;border:1px solid #e5eaf0;border-left:4px solid ${CYAN};border-radius:10px;background-color:#f7f9fc;">`,
    p(
      "margin:0 0 6px;color:#64748b;font-size:11px;font-weight:700;letter-spacing:1.2px;line-height:16px;text-transform:uppercase;",
      escapeHtml(copy.timeLabel),
    ),
    p(
      `margin:0 0 4px;color:${DEEP};font-size:16px;font-weight:700;line-height:24px;`,
      escapeHtml(time.local),
    ),
    p("color:#64748b;font-size:13px;line-height:20px;", escapeHtml(time.utc)),
    "</td></tr></table>",
    p(
      `margin:0 0 28px;color:${DEEP};font-size:16px;font-weight:600;line-height:1.6;`,
      escapeHtml(wave.price),
    ),
    // CTA
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${CYAN}" style="background-color:${CYAN};border:1px solid ${CYAN};border-radius:12px;mso-padding-alt:18px 20px;">`,
    `<a href="${ks}" rel="noreferrer noopener" style="display:block;padding:18px 20px;border-radius:12px;color:${NAVY};font-family:${FONT};font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;mso-padding-alt:0;">${escapeHtml(wave.button)}</a>`,
    "</td></tr></table>",
    `<p style="margin:16px 0 0;padding:12px 14px;border:1px solid #e5eaf0;border-radius:10px;background-color:#f7f9fc;word-break:break-all;overflow-wrap:anywhere;text-align:center;"><a href="${ks}" rel="noreferrer noopener" style="color:#35627e;font-family:Consolas,monospace;font-size:12px;line-height:20px;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${ks}</a></p>`,
    "</td></tr>",
    `<tr><td bgcolor="#ffffff" style="padding:0;background-color:#ffffff;border-radius:0 0 24px 24px;font-size:0;line-height:24px;">&nbsp;</td></tr>`,
    // Footer
    '<tr><td style="padding:24px 20px 0;text-align:center;">',
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
