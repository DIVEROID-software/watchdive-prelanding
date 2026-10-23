// Direct email entry point. All Stripe decisions still belong to checkout.ts;
// every unsuccessful decision returns to the existing reservation page.
// The query invite is a bearer credential: access-log infrastructure must redact
// `invite`. no-store/no-referrer prevent caching and onward Referer disclosure;
// they cannot remove a query already received by the server or mail provider.
import { randomBytes } from "node:crypto";

import { isLocale } from "../i18n/locale.ts";
import { isHostedCheckoutUrl, startReservationCheckout } from "./checkout.ts";
import { readReservationConfig, type EnvSource } from "./config.ts";
import { verifyReservationInvite } from "./invite.ts";
import { createStripeClient } from "./stripeApi.ts";

export type ReservationDirectDeps = {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
  nowMs?: number;
};

const MAX_INVITE_LENGTH = 4096;
const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

function fallbackUrl(url: URL): string {
  const lang = url.searchParams.get("lang");
  const token = url.searchParams.get("invite") ?? "";
  const fallback = new URL("https://reservation.invalid/reservation");
  fallback.searchParams.set("lang", isLocale(lang) ? lang : "en");
  // Preserve invalid links for the page's existing invalid-invite state, but
  // never reflect an unbounded query into a Location header.
  fallback.hash = new URLSearchParams({
    invite: token.length <= MAX_INVITE_LENGTH ? token : "invalid",
  }).toString();
  return fallback.pathname + fallback.search + fallback.hash;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...PRIVATE_HEADERS, location },
  });
}

function scriptJson(value: string): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function storageBridge(url: URL, token: string, fallback: string): Response {
  const requestedLang = url.searchParams.get("lang");
  const lang = isLocale(requestedLang) ? requestedLang : "en";
  const next = new URL("https://reservation.invalid/api/reservation/direct");
  next.searchParams.set("lang", lang);
  next.searchParams.set("invite", token);
  next.searchParams.set("redirect", "1");
  const nonce = randomBytes(18).toString("base64");
  // These are the existing reservation/query.ts sessionStorage keys. Reading
  // back both values prevents leaving for Checkout when storage is unavailable.
  const script = `(function(){var token=${scriptJson(token)},lang=${scriptJson(lang)};try{
sessionStorage.setItem("watchdive.reservation.invite",token);
sessionStorage.setItem("watchdive.reservation.lang",lang);
sessionStorage.removeItem("watchdive.reservation.inviteInvalid");
if(sessionStorage.getItem("watchdive.reservation.invite")!==token||sessionStorage.getItem("watchdive.reservation.lang")!==lang)throw new Error("storage");
history.replaceState(null,"","/api/reservation/direct");
location.replace(${scriptJson(next.pathname + next.search)});
}catch(e){location.replace(${scriptJson(fallback)});}})();`;
  const href = fallback
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive"><title>WatchDive</title></head><body><script nonce="${nonce}">${script}</script><noscript><a href="${href}">Continue</a></noscript></body></html>`,
    {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function handleReservationDirect(
  request: Request,
  deps: ReservationDirectDeps = {},
): Promise<Response> {
  // Mail scanners commonly issue HEAD. It must never touch Stripe, even if
  // the framework routes HEAD to the GET handler.
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...PRIVATE_HEADERS, allow: "GET" },
    });
  }

  const url = new URL(request.url);
  const fallback = fallbackUrl(url);
  const token = url.searchParams.get("invite") ?? "";
  if (
    !token ||
    token.length > MAX_INVITE_LENGTH ||
    url.searchParams.getAll("invite").length !== 1 ||
    url.searchParams.getAll("lang").length > 1 ||
    url.searchParams.getAll("redirect").length > 1 ||
    (url.searchParams.has("redirect") && url.searchParams.get("redirect") !== "1") ||
    [...url.searchParams.keys()].some((key) => !["lang", "invite", "redirect"].includes(key))
  ) {
    return redirect(fallback);
  }

  const config = readReservationConfig(deps.env ?? process.env, {
    webhookSecret: true,
    tokenSecret: true,
    origin: true,
  });
  if (!config.ok) return redirect(fallback);
  const nowMs = deps.nowMs ?? Date.now();
  try {
    if (
      !config.value.tokenSecret ||
      !verifyReservationInvite(token, config.value.tokenSecret, nowMs)
    ) {
      return redirect(fallback);
    }

    // A server 303 cannot write sessionStorage. The first, provider-free GET
    // saves the existing return-page credential, then the second GET redirects.
    if (!url.searchParams.has("redirect")) return storageBridge(url, token, fallback);

    const decision = await startReservationCheckout({
      inviteToken: token,
      config: config.value,
      stripe: createStripeClient({
        secretKey: config.value.secretKey,
        allowLive: config.value.livemode,
        fetchImpl: deps.fetchImpl,
      }),
      nowMs,
    });
    return redirect(
      decision.kind === "url" && isHostedCheckoutUrl(decision.url) ? decision.url : fallback,
    );
  } catch {
    // Do not log request URLs, signed invites, or provider error payloads.
    return redirect(fallback);
  }
}
