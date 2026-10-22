import { createHash } from "node:crypto";
import { normalizeRefCode } from "./eligibility.ts";
import { optedOutAddresses, optOutAddressKey, rowOptedOut } from "./notices.ts";
import { REFERRAL_PROGRAM_ID, referralProgramEnabled } from "./program.ts";
import { DEFAULT_LOCALE, localeFromPathname, matchLocale, type Locale } from "../i18n/locale.ts";
// The announcement IS the welcome guide: one renderer, one footer, one set of
// opt-out and Korean advertising rules (src/lib/verification/resend.ts).
import {
  buddyAdFooter,
  buddyGuideBody,
  buddyListUnsubscribeHeaders,
  koreanAdRulesApply,
  readSenderPhone,
} from "../verification/resend.ts";
import { conversionBlocked } from "../verification/contracts.ts";

export const ANNOUNCE_CAMPAIGN = `${REFERRAL_PROGRAM_ID}-announce`;

export type AnnounceRow = {
  announceMarker?: string;
  pageId: string;
  leadId: string;
  email: string;
  status: string;
  emailVerified: boolean;
  suspect: boolean;
  duplicate: boolean;
  verifiedAt?: string;
  refCode: string;
  signupLocale?: string;
  landingPath?: string;
  /** Abuse flags on the row (`Flags`). */
  flags?: string[];
  /** Coarse signup country; `KR` applies the Korean advertising rules. */
  signupCountry?: string;
  /** Raw opt-out cells (`unsubscribed …` markers). */
  launchMail?: string;
  reservationMail?: string;
};

export type SkipReason =
  | "not_verified"
  | "unsubscribed"
  | "suspect"
  | "blocked_flag"
  | "duplicate"
  | "verified_after_release"
  | "verified_at_missing"
  | "no_ref_code"
  | "no_email"
  | "no_opt_out"
  | "unsubscribed_address"
  | "duplicate_address"
  | "not_selected";

/** Null means eligible. `ignoreRelease` is only for the --only self-test. */
export function announceSkipReason(
  row: AnnounceRow,
  releasedAt: Date,
  ignoreRelease = false,
): SkipReason | null {
  if (rowOptedOut(row)) return "unsubscribed";
  if (row.status !== "verified" || !row.emailVerified) return "not_verified";
  if (row.suspect) return "suspect";
  if (conversionBlocked(row.flags ?? [])) return "blocked_flag";
  if (row.duplicate) return "duplicate";
  if (!row.email.includes("@")) return "no_email";
  if (!normalizeRefCode(row.refCode)) return "no_ref_code";
  // The opt-out link is signed over the Lead ID; without one, no compliant mail.
  if (!LEAD_ID.test(row.leadId)) return "no_opt_out";
  if (!ignoreRelease) {
    const at = Date.parse(row.verifiedAt ?? "");
    if (!Number.isFinite(at)) return "verified_at_missing";
    if (at >= releasedAt.getTime()) return "verified_after_release";
  }
  return null;
}

const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function announceKey(row: Pick<AnnounceRow, "leadId" | "pageId">, selfTest = false): string {
  return `${REFERRAL_PROGRAM_ID}-announce-${row.leadId || row.pageId}${selfTest ? "-selftest" : ""}`;
}

export function rowLocale(row: Pick<AnnounceRow, "signupLocale" | "landingPath">): Locale {
  return matchLocale(row.signupLocale) ?? (row.landingPath ? localeFromPathname(row.landingPath) : DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

export type AnnounceLinks = { share: string; status: string; rules: string; unsubscribe?: string };

/** Whether this row's mail falls under the Korean advertising rules. */
export function rowIsKorean(row: Pick<AnnounceRow, "signupCountry">, locale: Locale): boolean {
  return koreanAdRulesApply(locale, row.signupCountry);
}

/**
 * The welcome guide, byte for byte the renderer the new welcome mail uses.
 * Throws (nothing is sent) without an https unsubscribe link, or for a Korean
 * reader without WATCHDIVE_SENDER_PHONE.
 */
export function renderAnnouncement(
  locale: Locale,
  links: AnnounceLinks,
  options: { signupCountry?: string; env: Record<string, string | undefined> },
): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const footer = buddyAdFooter({
    locale,
    signupCountry: options.signupCountry,
    unsubscribeUrl: links.unsubscribe,
    env: options.env,
  });
  const mail = buddyGuideBody(
    { shareUrl: links.share, statusUrl: links.status, rulesUrl: links.rules },
    locale,
    footer,
  );
  return { ...mail, headers: buddyListUnsubscribeHeaders(footer.unsubscribeUrl) };
}

export type AnnounceMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
};

export type AnnounceOptions = {
  apply: boolean;
  confirm?: string;
  releasedAt: Date;
  limit?: number;
  only?: string;
  budgetMs?: number;
};

export type AnnounceDeps = {
  rows: AnnounceRow[];
  mark: (row: AnnounceRow, marker: string) => Promise<void>;
  clock?: () => number;
  env: Record<string, string | undefined>;
  links: (row: AnnounceRow, locale: Locale) => AnnounceLinks;
  send: (message: AnnounceMessage) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type AnnounceResult = {
  mode: "dry-run" | "send";
  aborted?:
    | "switch_off"
    | "confirm_missing"
    | "invalid_input"
    | "sender_phone_missing";
  /** Queued Korean-rule recipients while WATCHDIVE_SENDER_PHONE is unset (send refused). */
  senderPhoneMissing?: number;
  rowsScanned: number;
  eligible: number;
  skipped: Partial<Record<SkipReason, number>>;
  byLocale: Partial<Record<Locale, number>>;
  alreadySent: number;
  heldUnresolved: number;
  planned: number;
  sent: number;
  failed: number;
  deferred: number;
};

export async function runAnnounce(options: AnnounceOptions, deps: AnnounceDeps): Promise<AnnounceResult> {
  const result: AnnounceResult = {
    mode: options.apply ? "send" : "dry-run",
    rowsScanned: deps.rows.length, eligible: 0, skipped: {}, byLocale: {},
    alreadySent: 0, heldUnresolved: 0, planned: 0, sent: 0, failed: 0, deferred: 0,
  };
  {
    if (!referralProgramEnabled(deps.env)) return { ...result, aborted: "switch_off" };
    if (options.confirm !== REFERRAL_PROGRAM_ID) return { ...result, aborted: "confirm_missing" };
  }
  if (!Number.isFinite(options.releasedAt.getTime()) || !Number.isInteger(options.limit ?? 20) || (options.limit ?? 20) < 1 || (options.limit ?? 20) > 200) return { ...result, aborted: "invalid_input" };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const only = options.only?.trim().toLowerCase();
  const selfTest = Boolean(only);
  const queue: { row: AnnounceRow; locale: Locale; key: string }[] = [];
  // An opt-out on any row of an address holds every row of it.
  const optedOut = optedOutAddresses(deps.rows);
  // One announcement per address, not one per row of a repeat sign-up.
  const queuedAddresses = new Set<string>();
  // Markers cover every duplicate row of an inbox, including ineligible rows.
  const marked = new Map<string, string>();
  for (const row of deps.rows) if (row.announceMarker?.trim()) {
    const address = optOutAddressKey(row.email);
    if (!marked.has(address) || !row.announceMarker.startsWith("sent ")) marked.set(address, row.announceMarker);
  }
  for (const row of deps.rows) {
    if (only && row.email.trim().toLowerCase() !== only) {
      result.skipped.not_selected = (result.skipped.not_selected ?? 0) + 1;
      continue;
    }
    const why = announceSkipReason(row, options.releasedAt, selfTest);
    if (why) {
      result.skipped[why] = (result.skipped[why] ?? 0) + 1;
      continue;
    }
    if (optedOut.has(optOutAddressKey(row.email))) {
      result.skipped.unsubscribed_address = (result.skipped.unsubscribed_address ?? 0) + 1;
      continue;
    }
    if (queuedAddresses.has(optOutAddressKey(row.email))) {
      result.skipped.duplicate_address = (result.skipped.duplicate_address ?? 0) + 1;
      continue;
    }
    queuedAddresses.add(optOutAddressKey(row.email));
    if (!selfTest && marked.has(optOutAddressKey(row.email))) {
      if (marked.get(optOutAddressKey(row.email))!.startsWith("sent ")) result.alreadySent++;
      else result.heldUnresolved++;
      continue;
    }
    const locale = rowLocale(row);
    result.eligible += 1;
    result.byLocale[locale] = (result.byLocale[locale] ?? 0) + 1;
    queue.push({ row, locale, key: announceKey(row, selfTest) });
  }

  // Korean advertising mail must name a sender phone. Refuse the whole run
  // before any send rather than mail part of the list non-compliant.
  const phoneMissing = readSenderPhone(deps.env)
    ? 0
    : queue.filter((item) => rowIsKorean(item.row, item.locale)).length;
  if (phoneMissing > 0) {
    result.senderPhoneMissing = phoneMissing;
    if (options.apply) return { ...result, aborted: "sender_phone_missing" };
  }

  const batch = queue.slice(0, options.limit ?? 20);
  result.planned = batch.length;
  result.deferred = queue.length - batch.length;
  if (!options.apply) return result;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < batch.length; i++) {
    if (clock() - started >= (options.budgetMs ?? 35_000)) {
      result.deferred += batch.length - i;
      break;
    }
    const { row, locale, key } = batch[i];
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
    let claimed = false;
    try {
      const mail = renderAnnouncement(locale, deps.links(row, locale), { signupCountry: row.signupCountry, env: deps.env });
      // An uncertain write/send is never cleared or automatically retried.
      if (!selfTest) {
        await deps.mark(row, `intent ${now().toISOString()} ${hash}`);
        claimed = true;
      }
      await deps.send({ to: row.email, ...mail, idempotencyKey: key });
      result.sent++;
      if (!selfTest) await deps.mark(row, `sent ${now().toISOString()} ${hash}`);
    } catch {
      result.failed++;
      if (claimed) result.heldUnresolved++;
    }
    await sleep(500);
  }
  return result;
}
