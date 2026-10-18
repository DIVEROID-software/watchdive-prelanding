// Reservation page link. The signed invite is the URL fragment, never a query
// parameter, so access logs do not store it. The only query parameter is lang.
// Korean mail uses lang=ko. Every other supported site locale uses its own
// lang value on /reservation. A missing lang is English on the page.
//
// Signing is issueReservationInvite from src/lib/reservation/invite.ts.
// The caller passes the verified row email, emailVerified true, and an expiry
// measured from the frozen first intent. jti is deterministic so a resume
// inside the provider window is the same bytes. The lifetime is not a launch
// date and is not written in the mail.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHash } from "node:crypto";

import type { Locale } from "../i18n/locale.ts";
import { assertTokenSecret } from "../reservation/config.ts";
import { ENV_RESERVATION_TOKEN_SECRET } from "../reservation/constants.ts";
import { issueReservationInvite, type IssueReservationInviteInput } from "../reservation/invite.ts";
import { requirePublicOrigin } from "../verification/token.ts";
import { RESERVATION_CAMPAIGN_ID } from "./campaign.ts";

/** Page language query. Not a token. */
export const RESERVATION_LANG_QUERY = "lang";

/** Fragment name. The browser does not send this to the server. */
export const RESERVATION_INVITE_FRAGMENT = "invite";

/**
 * Technical lifetime of a mailed link, from the frozen first intent.
 * Not a customer deadline and not a sentence in the mail.
 */
export const INVITE_LINK_TTL_MS = 366 * 24 * 60 * 60 * 1000;

/** Obvious placeholder. Not a signature. Never used when mode is send. */
export const UNSIGNED_PREVIEW_TOKEN = "preview-not-a-signed-token";

const TOKEN_MAX_LENGTH = 4096;

export type ReservationInviteSigner = (input: IssueReservationInviteInput) => string;

export function reservationMailLang(locale: Locale): Locale {
  return locale;
}

export function reservationInviteJti(leadId: string): string {
  return createHash("sha256")
    .update(`wd-reservation-invite-jti:${RESERVATION_CAMPAIGN_ID}:${leadId.trim().toLowerCase()}`)
    .digest("base64url");
}

export function readReservationTokenSecret(env: {
  WATCHDIVE_RESERVATION_TOKEN_SECRET?: string;
}): string {
  return assertTokenSecret((env[ENV_RESERVATION_TOKEN_SECRET] ?? "").trim());
}

export function buildReservationInviteUrl(
  publicOrigin: string,
  locale: Locale,
  token: string,
): string {
  if (!isTokenShape(token)) throw new Error("Invalid invite token");
  const origin = requirePublicOrigin({ WATCHDIVE_PUBLIC_ORIGIN: publicOrigin });
  const url = new URL("/reservation", origin);
  url.searchParams.set(RESERVATION_LANG_QUERY, reservationMailLang(locale));
  url.hash = `${RESERVATION_INVITE_FRAGMENT}=${token}`;
  return assertInviteUrl(url.toString(), publicOrigin, locale);
}

function isTokenShape(token: string): boolean {
  return (
    typeof token === "string" &&
    token.length >= 20 &&
    token.length <= TOKEN_MAX_LENGTH &&
    !/[@\s<>#?&]/.test(token) &&
    !token.includes("://")
  );
}

/**
 * Accept only /reservation on our origin, with exactly one query parameter
 * (`lang` = the signup locale) and the invite in the fragment. A token in the query,
 * an email, or an extra parameter is refused.
 */
export function assertInviteUrl(raw: string, publicOrigin: string, locale: Locale): string {
  const origin = requirePublicOrigin({ WATCHDIVE_PUBLIC_ORIGIN: publicOrigin });
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid invite url");
  }
  if (url.origin !== origin || url.username || url.password) {
    throw new Error("Invalid invite url");
  }
  if (url.pathname !== "/reservation") throw new Error("Invalid invite url");
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== RESERVATION_LANG_QUERY) {
    throw new Error("Invalid invite url");
  }
  if (url.searchParams.get(RESERVATION_LANG_QUERY) !== reservationMailLang(locale)) {
    throw new Error("Invalid invite url");
  }
  const prefix = `#${RESERVATION_INVITE_FRAGMENT}=`;
  if (!url.hash.startsWith(prefix)) throw new Error("Invalid invite url");
  const token = decodeURIComponent(url.hash.slice(prefix.length));
  if (!isTokenShape(token)) throw new Error("Invalid invite url");
  if (url.search.includes(token) || raw.includes("@")) throw new Error("Invalid invite url");
  if (url.searchParams.has("inviteToken") || url.searchParams.has("invite")) {
    throw new Error("Invalid invite url");
  }
  return url.toString();
}

export function mintReservationInviteUrl(input: {
  leadId: string;
  email: string;
  locale: Locale;
  publicOrigin: string;
  secret: string;
  firstIntentAtMs: number;
  nowMs: number;
  sign?: ReservationInviteSigner;
}): string {
  const email = input.email.trim();
  if (!email) throw new Error("email is required");
  if (!Number.isFinite(input.firstIntentAtMs) || !Number.isFinite(input.nowMs)) {
    throw new Error("Invite expiry is missing");
  }
  const sign = input.sign ?? issueReservationInvite;
  const token = sign({
    leadId: input.leadId,
    email,
    emailVerified: true,
    expiresAtMs: input.firstIntentAtMs + INVITE_LINK_TTL_MS,
    secret: input.secret,
    jti: reservationInviteJti(input.leadId),
    nowMs: input.nowMs,
  });
  if (typeof token !== "string" || token.includes("@")) throw new Error("Invalid invite token");
  return buildReservationInviteUrl(input.publicOrigin, input.locale, token);
}
