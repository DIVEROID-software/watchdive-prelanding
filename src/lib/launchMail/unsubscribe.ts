// /unsubscribe/<token>: the one-click opt-out the launch mails carry.
//
// GET only shows a confirmation button. Link scanners and inbox previews fetch
// every URL in a message, so a GET that unsubscribed would quietly take real
// people off the list. POST does the work — that is what RFC 8058 one-click
// sends (`List-Unsubscribe=One-Click`), and what the button submits.
//
// The outcome is `unsubscribed <iso>` in the `Launch mail` cell, which every
// later launch run treats as final for that address. Nothing else on the row
// changes: `Verification status` stays as it is, so the confirmed-signup count
// is not touched by this.
//
// While Buddy Invite is switched on, that same marker also stops every Buddy
// Invite mail (guide, notices, announcement), so the page names both; with
// the switch off it reads exactly as before.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale.ts";
import { REFERRAL_COPY } from "../referral/copy.ts";
import { referralProgramEnabled } from "../referral/program.ts";
import { requireSecret, type TokenEnvironment } from "../verification/token.ts";
import { parseLaunchMarker, unsubscribedMarker } from "./audience.ts";
import { LAUNCH_COPY } from "./copy.ts";
import type { LaunchStore } from "./notionLaunchStore.ts";
import { parseUnsubscribeToken, unsubscribeTokenLocale } from "./unsubscribeToken.ts";

export type UnsubscribeDependencies = {
  /** Undefined when the database is not configured. */
  store?: LaunchStore;
  env?: TokenEnvironment & {
    WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET?: string;
    /** Buddy Invite master switch (referralProgramEnabled); widens the page wording. */
    WATCHDIVE_REFERRAL_PROGRAM_ENABLED?: string;
  };
  now?: () => Date;
};

type PageState = "confirm" | "done" | "invalid" | "unavailable";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function unsubscribePage(
  state: PageState,
  locale: Locale,
  options: { program?: boolean } = {},
): string {
  const launch = LAUNCH_COPY[locale];
  const program = REFERRAL_COPY[locale].programName;
  const copy = options.program
    ? {
        ...launch.page,
        ...Object.fromEntries(
          Object.entries(launch.programPage).map(([key, value]) => [
            key,
            value.replaceAll("{program}", program),
          ]),
        ),
      }
    : launch.page;
  const [heading, body] = {
    confirm: [copy.confirmHeading, copy.confirmBody],
    done: [copy.doneHeading, copy.doneBody],
    invalid: [copy.invalidHeading, copy.invalidBody],
    unavailable: [copy.unavailableHeading, copy.unavailableBody],
  }[state];
  // Posts back to this same URL; the hidden field matches the RFC 8058 body.
  const form =
    state === "confirm"
      ? `<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${escapeHtml(copy.confirmButton)}</button></form>`
      : "";
  return [
    "<!doctype html>",
    `<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">',
    `<title>${escapeHtml(copy.title)}</title>`,
    "<style>body{margin:0;background:#f1f4f8;font-family:'Work Sans',Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#08021f}",
    "main{max-width:520px;margin:48px auto;padding:0 16px}",
    "header{background:#08021f;color:#fff;border-radius:20px 20px 0 0;border-bottom:3px solid #6dcaf8;padding:24px 28px;font-size:28px;font-weight:800}",
    "header span{color:#6dcaf8}section{background:#fff;border-radius:0 0 20px 20px;padding:28px}",
    "h1{font-size:24px;line-height:1.3;margin:0 0 12px}p{color:#49566a;line-height:1.7;margin:0 0 20px}",
    "button{width:100%;min-height:52px;border:0;border-radius:12px;background:#6dcaf8;color:#08021f;font-size:16px;font-weight:700;cursor:pointer}",
    `${locale === "ko" ? "h1,p{word-break:keep-all}" : ""}</style></head>`,
    `<body><main><header>WatchDive<span>.</span></header><section><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p>${form}</section></main></body></html>`,
  ].join("");
}

function htmlResponse(
  status: number,
  state: PageState,
  locale: Locale,
  program = false,
): Response {
  return new Response(unsubscribePage(state, locale, { program }), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function handleUnsubscribe(
  method: string,
  token: string,
  dependencies: UnsubscribeDependencies,
): Promise<Response> {
  const fallbackLocale = unsubscribeTokenLocale(token) ?? DEFAULT_LOCALE;
  // Read once per request, so the wording follows the switch with no deploy.
  const program = referralProgramEnabled(dependencies.env ?? process.env);
  const respond = (status: number, state: PageState, locale: Locale) =>
    htmlResponse(status, state, locale, program);
  let secret: string;
  const version = token.startsWith("u2.") ? "u2" : "u1";
  try {
    const env = dependencies.env ?? process.env;
    secret = version === "u2"
      ? (env.WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET ?? "").trim()
      : requireSecret(env);
    if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("unsubscribe signing key unavailable");
  } catch {
    return respond(503, "unavailable", fallbackLocale);
  }
  const parsed = parseUnsubscribeToken(token, secret, version);
  if (!parsed) return respond(400, "invalid", fallbackLocale);
  const { locale } = parsed;

  if (method === "GET" || method === "HEAD") return respond(200, "confirm", locale);
  if (method !== "POST") return respond(405, "invalid", locale);

  const { store } = dependencies;
  if (!store) return respond(503, "unavailable", locale);
  try {
    const row = await store.findByLeadId(parsed.leadId);
    if (!row) return respond(404, "invalid", locale);
    // Already recorded: answer the same way, write nothing.
    if (parseLaunchMarker(row.launchMail).kind === "unsubscribed") {
      return respond(200, "done", locale);
    }
    await store.recordLaunchMail(
      row.pageId,
      unsubscribedMarker((dependencies.now ?? (() => new Date()))()),
    );
    return respond(200, "done", locale);
  } catch (error) {
    // Never the message: it can quote the row. Only whether the property is missing.
    console.error("[watchdive] launch_unsubscribe_failed", {
      reason:
        error instanceof Error && /validation_error/.test(error.message)
          ? "launch_mail_property_missing"
          : "store_error",
    });
    return respond(503, "unavailable", locale);
  }
}
