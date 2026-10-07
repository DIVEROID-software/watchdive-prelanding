// Who gets a launch mail, in which language, and what the `Launch mail` cell
// says about them.
//
// The audience is people who confirmed: `Verification status` = verified AND
// `Email verified` checked, never Suspect, never Duplicate, never unsubscribed.
// Pending rows, legacy single opt-in rows (no status) and anything else are out.
// The Notion query already filters on most of this; every condition is checked
// again here because this is the one place a mis-filtered row turns into a
// real message to a real inbox.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { DEFAULT_LOCALE, matchLocale, parseLocalePath, type Locale } from "../i18n/locale.ts";
import { isLeadId } from "../verification/token.ts";

export const LAUNCH_WAVES = ["t-1d", "t-1h", "t-0"] as const;
export type LaunchWave = (typeof LAUNCH_WAVES)[number];

export function isLaunchWave(value: unknown): value is LaunchWave {
  return typeof value === "string" && (LAUNCH_WAVES as readonly string[]).includes(value);
}

/** Later waves rank higher. A row is never sent a wave at or below what it already got. */
const WAVE_RANK: Record<LaunchWave, number> = { "t-1d": 1, "t-1h": 2, "t-0": 3 };

/**
 * The ONE new waitlist property (rich_text). NOT yet provisioned: the lead adds
 * it by hand. Until it exists the job refuses to send. Values it holds:
 *   `<wave> sent <iso>`             the provider accepted that wave's mail
 *   `<wave> failed <reason> <iso>`  that wave was tried and refused
 *   `unsubscribed <iso>`            written by /unsubscribe; final
 * Anything else is treated as "do not mail" until a human looks at it.
 */
export const FIELD_LAUNCH_MAIL = "Launch mail";

/** Existing columns the job reads. `Duplicate` and `Browser language` are optional. */
export const FIELD_DUPLICATE = "Duplicate";
export const FIELD_BROWSER_LANGUAGE = "Browser language";

export type LaunchMarker =
  | { kind: "none" }
  | { kind: "unsubscribed" }
  | { kind: "sent"; wave: LaunchWave }
  | { kind: "failed"; wave: LaunchWave }
  | { kind: "unknown" };

export function parseLaunchMarker(raw: string | undefined): LaunchMarker {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "none" };
  // Generous on purpose: a hand-typed "Unsubscribe" in the cell must also stop mail.
  if (/unsub/i.test(value)) return { kind: "unsubscribed" };
  const match = /^(t-1d|t-1h|t-0) (sent|failed)\b/.exec(value);
  if (!match) return { kind: "unknown" };
  return { kind: match[2] as "sent" | "failed", wave: match[1] as LaunchWave };
}

export function sentMarker(wave: LaunchWave, at: Date): string {
  return `${wave} sent ${at.toISOString()}`;
}

export function failedMarker(wave: LaunchWave, reason: string, at: Date): string {
  return `${wave} failed ${reason} ${at.toISOString()}`;
}

export function unsubscribedMarker(at: Date): string {
  return `unsubscribed ${at.toISOString()}`;
}

/** One waitlist row, reduced to what the launch mail needs. */
export type LaunchRow = {
  pageId: string;
  email: string;
  leadId: string;
  status: string;
  emailVerified: boolean;
  suspect: boolean;
  /** `undefined` when the database has no `Duplicate` column. */
  duplicate?: boolean;
  landingPath?: string;
  browserLanguage?: string;
  launchMail?: string;
};

export type LaunchSkipReason =
  | "not_verified"
  | "suspect"
  | "duplicate"
  | "unsubscribed"
  | "already_sent"
  | "later_wave_recorded"
  | "unrecognised_marker"
  | "no_address"
  | "no_lead_id"
  | "duplicate_address";

const EMAIL_SHAPE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Why this row must not get `wave`, or undefined when it should. */
export function launchSkipReason(row: LaunchRow, wave: LaunchWave): LaunchSkipReason | undefined {
  if (row.status !== "verified" || !row.emailVerified) return "not_verified";
  if (row.suspect) return "suspect";
  if (row.duplicate) return "duplicate";
  const marker = parseLaunchMarker(row.launchMail);
  if (marker.kind === "unsubscribed") return "unsubscribed";
  if (marker.kind === "unknown") return "unrecognised_marker";
  if (marker.kind === "sent") {
    if (marker.wave === wave) return "already_sent";
    if (WAVE_RANK[marker.wave] > WAVE_RANK[wave]) return "later_wave_recorded";
  }
  // A failure of this same wave may be retried: the idempotency key is the
  // same, so a retry can never become a second copy. A failure of a later wave
  // means that wave was already being sent — an earlier one is out of date.
  if (marker.kind === "failed" && WAVE_RANK[marker.wave] > WAVE_RANK[wave]) {
    return "later_wave_recorded";
  }
  if (!EMAIL_SHAPE.test(row.email.trim())) return "no_address";
  // The unsubscribe link and the idempotency key both hang off the Lead ID.
  if (!isLeadId(row.leadId)) return "no_lead_id";
  return undefined;
}

/**
 * The language the person used. Same first choice as the confirmation
 * reminder: the locale prefix of the first-touch landing path. A path without
 * a prefix is the English page, but it may also be a first touch from before
 * the auto-locale redirect, so a recorded browser language breaks the tie when
 * the database has one. Anything unknown is English.
 */
export function launchLocale(row: Pick<LaunchRow, "landingPath" | "browserLanguage">): Locale {
  if (row.landingPath) {
    try {
      const parsed = parseLocalePath(row.landingPath);
      if (parsed.hasLocalePrefix) return parsed.locale;
    } catch {
      // A malformed path says nothing about language.
    }
  }
  return matchLocale(row.browserLanguage) ?? DEFAULT_LOCALE;
}

export type Recipient = { row: LaunchRow; locale: Locale };

export type AudienceResult = {
  recipients: Recipient[];
  skipped: Partial<Record<LaunchSkipReason, number>>;
};

/** Reasons that speak for the person, not just the row they sit on. */
const ADDRESS_WIDE: ReadonlySet<LaunchSkipReason> = new Set([
  "unsubscribed",
  "already_sent",
  "later_wave_recorded",
  "unrecognised_marker",
]);

/**
 * Filters, de-duplicates by address (first row wins) and assigns a language.
 *
 * Two rows can carry one address. Each has its own Lead ID and so its own
 * idempotency key, which means the provider would NOT collapse them — so an
 * unsubscribe or a recorded send on either row holds back the address as a
 * whole.
 */
export function selectAudience(rows: readonly LaunchRow[], wave: LaunchWave): AudienceResult {
  const recipients: Recipient[] = [];
  const skipped: Partial<Record<LaunchSkipReason, number>> = {};
  const bump = (reason: LaunchSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const addressOf = (row: LaunchRow) => row.email.trim().toLowerCase();
  const reasons = rows.map((row) => launchSkipReason(row, wave));
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const reason = reasons[index];
    if (reason && ADDRESS_WIDE.has(reason)) seen.add(addressOf(row));
  });
  for (const [index, row] of rows.entries()) {
    const reason = reasons[index];
    if (reason) {
      bump(reason);
      continue;
    }
    const address = addressOf(row);
    if (seen.has(address)) {
      bump("duplicate_address");
      continue;
    }
    seen.add(address);
    recipients.push({ row, locale: launchLocale(row) });
  }
  return { recipients, skipped };
}
