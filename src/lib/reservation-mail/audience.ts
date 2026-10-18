// Who may receive the reservation invitation.
//
// A signup row is not enough. The address must be a confirmed waitlist email:
// Verification status verified AND Email verified, not suspect, not duplicate,
// not suppressed, not unsubscribed. Pending rows and legacy single opt-in rows
// stay out. Phone, SMS consent, and measurement consent are not inputs.
// Signup country is a language hint only, and only after path and browser
// language. It is never eligibility and it is never inferred from a phone
// number or an IP. Locale is a language, never a country.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { localeFromCountry } from "../i18n/auto-locale.ts";
import { DEFAULT_LOCALE, matchLocale, parseLocalePath, type Locale } from "../i18n/locale.ts";
import { parseLaunchMarker } from "../launchMail/audience.ts";
import { reservationCanonicalEmail } from "../reservation/emailIdentity.ts";
import { isLeadId } from "../verification/token.ts";
import { parseReservationMarker } from "./campaign.ts";

const EMAIL_SHAPE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export type ReservationRow = {
  pageId: string;
  email: string;
  leadId: string;
  status: string;
  emailVerified: boolean;
  suspect: boolean;
  /** `undefined` when the database has no Duplicate column. */
  duplicate?: boolean;
  landingPath?: string;
  browserLanguage?: string;
  /**
   * Explicit saved locale, only when a real cell supplied a supported value.
   * The waitlist has no such column today. A landing path is not this field.
   */
  locale?: string;
  /**
   * Saved `Signup country` cell. Not eligibility. Not backfilled. `unknown`
   * and unmapped codes do not choose a language.
   */
  signupCountry?: string;
  /** Raw Launch mail cell, when that column exists. */
  launchMail?: string;
  /** Raw Reservation mail cell, when that column exists. */
  reservationMail?: string;
};

export type SkipReason =
  | "not_verified"
  | "suspect"
  | "suspect_address"
  | "duplicate"
  | "duplicate_address"
  | "suppressed"
  | "suppressed_address"
  | "unsubscribed"
  | "unsubscribed_address"
  | "already_sent"
  | "already_sent_address"
  | "held"
  | "held_address"
  | "unrecognised_marker"
  | "unrecognised_address"
  | "no_address"
  | "no_lead_id";

export type Recipient = { row: ReservationRow; locale: Locale };

export type AudienceResult = {
  recipients: Recipient[];
  skipped: Partial<Record<SkipReason, number>>;
};

const ADDRESS_POISON: Partial<Record<SkipReason, SkipReason>> = {
  suspect: "suspect_address",
  suppressed: "suppressed_address",
  unsubscribed: "unsubscribed_address",
  already_sent: "already_sent_address",
  held: "held_address",
  unrecognised_marker: "unrecognised_address",
};

const POISON_RANK: Partial<Record<SkipReason, number>> = {
  unsubscribed: 6,
  suppressed: 5,
  suspect: 4,
  unrecognised_marker: 3,
  held: 2,
  already_sent: 1,
};

/** Why this row itself cannot be mailed, before address-wide holds. */
export function reservationSkipReason(row: ReservationRow): SkipReason | undefined {
  if (!EMAIL_SHAPE.test(row.email.trim())) return "no_address";
  if (row.status === "suppressed") return "suppressed";
  if (row.status === "unsubscribed") return "unsubscribed";
  if (row.status !== "verified" || !row.emailVerified) return "not_verified";
  if (row.suspect) return "suspect";
  if (row.duplicate) return "duplicate";
  const launch = parseLaunchMarker(row.launchMail);
  const reservation = parseReservationMarker(row.reservationMail);
  if (launch.kind === "unsubscribed" || reservation.kind === "unsubscribed") return "unsubscribed";
  if (launch.kind === "unknown" || reservation.kind === "unknown") return "unrecognised_marker";
  if (reservation.kind === "hold") return "held";
  if (reservation.kind === "sent") return "already_sent";
  if (!isLeadId(row.leadId)) return "no_lead_id";
  return undefined;
}

/**
 * Language only. An explicit saved locale wins when the cell matches a
 * supported locale. Otherwise a localized landing-path prefix wins, so
 * `/en` beats a KR country. A supported browser language is next. Signup
 * country is used only when those are absent and the code maps to one
 * language. Anything else is English.
 *
 * An unprefixed path is not an explicit English choice. Country is not
 * eligibility, is not inferred from phone or IP, and is not read back from
 * the chosen language.
 */
export function reservationLocale(
  row: Pick<ReservationRow, "locale" | "landingPath" | "browserLanguage" | "signupCountry">,
): Locale {
  const explicit = matchLocale(row.locale);
  if (explicit) return explicit;
  if (row.landingPath) {
    try {
      const parsed = parseLocalePath(row.landingPath);
      if (parsed.hasLocalePrefix) return parsed.locale;
    } catch {
      // A malformed path says nothing about language.
    }
  }
  const browser = matchLocale(row.browserLanguage);
  if (browser) return browser;
  return localeFromCountry(row.signupCountry ?? null) ?? DEFAULT_LOCALE;
}

function addressOf(row: ReservationRow): string {
  return reservationCanonicalEmail(row.email);
}

export type AudienceSelection = {
  /**
   * True when this lead already has any receipt. Among eligible rows of one
   * inbox, the oldest row with a receipt is the one that may resume. The
   * callback receives the lead id as stored.
   */
  leadHasReceipt?: (leadId: string) => boolean;
};

/**
 * Oldest row first (the store's order). One reservation inbox produces one
 * recipient. Gmail and googlemail.com aliases share an inbox. A plus-tag on
 * any other domain stays a different inbox. A suppression, unsubscribe, hold,
 * unknown marker, or recorded send on any alias holds that inbox. When a
 * receipt exists, the oldest eligible alias that owns one is selected so an
 * in-window intent is retried by that lead. Queue order follows the oldest
 * eligible alias, so a later receipt owner does not jump behind another inbox.
 */
export function selectAudience(
  rows: readonly ReservationRow[],
  selection: AudienceSelection = {},
): AudienceResult {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const bump = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const own = rows.map((row) => reservationSkipReason(row));
  const poison = new Map<string, SkipReason>();
  rows.forEach((row, index) => {
    const reason = own[index];
    if (!reason || ADDRESS_POISON[reason] === undefined) return;
    const address = addressOf(row);
    const current = poison.get(address);
    if (!current || (POISON_RANK[reason] ?? 0) > (POISON_RANK[current] ?? 0)) {
      poison.set(address, reason);
    }
  });

  const groups = new Map<string, ReservationRow[]>();
  const order: string[] = [];
  rows.forEach((row, index) => {
    const reason = own[index];
    if (reason) {
      bump(reason);
      return;
    }
    const address = addressOf(row);
    const held = poison.get(address);
    if (held) {
      bump(ADDRESS_POISON[held] ?? "unrecognised_address");
      return;
    }
    const group = groups.get(address);
    if (group) group.push(row);
    else {
      groups.set(address, [row]);
      order.push(address);
    }
  });

  const recipients: Recipient[] = [];
  for (const address of order) {
    const group = groups.get(address) ?? [];
    const withReceipt = selection.leadHasReceipt
      ? group.filter((row) => selection.leadHasReceipt?.(row.leadId) === true)
      : [];
    const winner = (withReceipt.length > 0 ? withReceipt : group)[0];
    if (!winner) continue;
    for (const row of group) {
      if (row !== winner) bump("duplicate_address");
    }
    recipients.push({ row: winner, locale: reservationLocale(winner) });
  }
  return { recipients, skipped };
}
