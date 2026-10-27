// One reservation invite message. The signer, template, and unsubscribe link
// are the existing ones. The idempotency key and jti stay fixed for the rate
// window, so a replay is the same provider body. The campaign key is not reused.
import { createHash } from "node:crypto";

import type { Locale } from "../i18n/locale.ts";
import { privacyPath, termsPath } from "../i18n/locale.ts";
import { createUnsubscribeToken, unsubscribeUrl } from "../launchMail/unsubscribeToken.ts";
import type { ReservationMessage } from "../reservation-mail/run.ts";
import { renderReservationMail } from "../reservation-mail/render.ts";
import { resolveReservationEmailSegment } from "../reservation-mail/segment.ts";
import {
  INVITE_LINK_TTL_MS,
  buildReservationInviteUrl,
  readReservationTokenSecret,
} from "../reservation-mail/inviteLink.ts";
import { requirePublicOrigin, requireSecret, type TokenEnvironment } from "../verification/token.ts";
import { issueReservationInvite } from "./invite.ts";
import {
  reservationReturnIdempotencyKey,
  returnMailLocale,
  returnWindowStartMs,
  type ReturnAccount,
} from "./returnEligibility.ts";

const MAILTO = "help@diveroid.com";
const JTI_LABEL = "wd-reservation-return-jti:v1";

export type ReturnMailEnv = TokenEnvironment & {
  WATCHDIVE_RESERVATION_TOKEN_SECRET?: string;
  WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET?: string;
};

export function reservationReturnJti(leadId: string, bucket: number): string {
  return createHash("sha256")
    .update(`${JTI_LABEL}:${leadId.trim().toLowerCase()}:${bucket}`)
    .digest("base64url");
}

export function buildReservationReturnMessage(input: {
  account: ReturnAccount;
  bucket: number;
  nowMs: number;
  env: ReturnMailEnv;
}): ReservationMessage {
  const locale = returnMailLocale(input.account);
  const origin = requirePublicOrigin(input.env);
  const tokenSecret = readReservationTokenSecret(input.env);
  const unsubscribeSecret = (input.env.WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET ?? "").trim();
  const version = unsubscribeSecret ? "u2" : "u1";
  const secret = unsubscribeSecret || requireSecret(input.env);
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("Reservation unsubscribe secret is too short");
  const firstIntentAtMs = returnWindowStartMs(input.bucket);
  const expiresAtMs = firstIntentAtMs + INVITE_LINK_TTL_MS;
  if (expiresAtMs <= input.nowMs) throw new Error("Return invite expired");
  const token = issueReservationInvite({
    leadId: input.account.leadId,
    email: input.account.email,
    emailVerified: true,
    expiresAtMs,
    secret: tokenSecret,
    jti: reservationReturnJti(input.account.leadId, input.bucket),
    nowMs: input.nowMs,
  });
  const inviteUrl = buildReservationInviteUrl(origin, locale, token);
  if (inviteUrl.includes("inviteToken=") || !inviteUrl.includes("#invite=")) {
    throw new Error("Return invite url");
  }
  const mail = renderReservationMail({
    locale,
    inviteUrl,
    unsubscribeUrl: unsubscribeUrl(
      origin,
      createUnsubscribeToken(input.account.leadId, locale, secret, version),
    ),
    privacyUrl: new URL(privacyPath(locale), origin).toString(),
    termsUrl: new URL(termsPath(locale), origin).toString(),
    segment: resolveReservationEmailSegment(input.account.landingPath),
  });
  return {
    to: input.account.email.trim(),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: listUnsubscribe(locale, origin, input.account.leadId, secret, version),
    tags: [
      { name: "campaign", value: "wd-reservation-return-v1" },
      { name: "locale", value: locale },
    ],
    idempotencyKey: reservationReturnIdempotencyKey(input.account.leadId, input.bucket),
  };
}

function listUnsubscribe(
  locale: Locale,
  origin: string,
  leadId: string,
  secret: string,
  version: "u1" | "u2",
): Record<string, string> {
  const href = unsubscribeUrl(origin, createUnsubscribeToken(leadId, locale, secret, version));
  return {
    "List-Unsubscribe": `<${href}>, <mailto:${MAILTO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
