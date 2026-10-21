// Which friends may count toward a Buddy Invite referrer, decided per row.
//
// The rules page promises exactly this list: only confirmed emails (a friend
// who confirmed and later unsubscribed keeps counting), never your own address, never a repeat sign-up, never a disposable address, never a
// sign-up flagged as abusive, never after the close. Each refusal has its own
// reason so the ops report can say how many were dropped and why, without
// naming anybody. Cross-row rules (one person counted once, the daily cap) need
// the whole list and live in ledger.ts.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { conversionBlocked } from "../verification/contracts.ts";
import type { ExclusionReason, ReferralRow } from "./contract.ts";
import { DISPOSABLE_DOMAIN_LIST } from "./disposableDomains.ts";
import { referralIdentityKey } from "./identity.ts";

/**
 * Throwaway inbox services: a vendored snapshot of the CC0
 * disposable-email-domains list (source, commit and refresh steps in
 * ./disposableDomains.ts). Built on first use, so modules that only need the
 * other helpers do not pay for the Set. Every parent domain is checked,
 * because several services hand out `<anything>.<service>` addresses. The
 * signup form's own short list (src/lib/api/abuse.ts) is unchanged: there a
 * hit blocks the confirmation mail, so a false positive costs a real lead.
 * Here the ledger re-evaluates on every read, so a domain added at the next
 * refresh still removes friends farmed before it.
 */
let disposableDomains: ReadonlySet<string> | null = null;

function disposableSet(): ReadonlySet<string> {
  disposableDomains ??= new Set(DISPOSABLE_DOMAIN_LIST.split("\n"));
  return disposableDomains;
}

/**
 * Alias and forwarding services that mint unlimited real, working addresses.
 * They are privacy tools many real people use, so a friend on one of them
 * counts; scripts/referral-report.ts surfaces a referrer with many of them
 * for review. Never on the disposable list (the generator subtracts these).
 * iCloud Hide My Email addresses end in @icloud.com and cannot be told apart
 * from ordinary iCloud addresses, so they are not listed.
 */
export const ALIAS_SERVICE_DOMAINS: ReadonlySet<string> = new Set([
  // DuckDuckGo Email Protection
  "duck.com",
  // Firefox Relay (masks are `x@mozmail.com` or `x@<name>.mozmail.com`)
  "mozmail.com",
  // SimpleLogin (Proton)
  "simplelogin.com",
  "simplelogin.fr",
  "slmail.me",
  "aleeas.com",
  // addy.io, formerly AnonAddy (shared and `x@<user>.anonaddy.com` aliases)
  "addy.io",
  "anonaddy.com",
  "anonaddy.me",
  // Proton Pass aliases
  "passmail.net",
  "passmail.com",
  "passinbox.com",
  // Sign in with Apple private relay
  "privaterelay.appleid.com",
  // 33mail and Burner Mail forwarding aliases
  "33mail.com",
  "burnermail.io",
]);

/** The address's domain, then each parent down to two labels: `a.b.c.com` → `b.c.com` → `c.com`. */
function domainAndParents(email: string): string[] {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return [];
  const labels = value
    .slice(at + 1)
    .replace(/\.+$/, "")
    .split(".");
  // A bare TLD is never on a list, so stop at two labels.
  const out: string[] = [];
  for (let i = 0; i + 1 < labels.length; i++) out.push(labels.slice(i).join("."));
  return out;
}

/** True for an address on a known disposable domain or any of its subdomains. */
export function isDisposableEmail(email: string): boolean {
  const set = disposableSet();
  return domainAndParents(email).some((domain) => set.has(domain));
}

/** True for an address at an alias/forwarding service or any of its subdomains. */
export function isAliasServiceEmail(email: string): boolean {
  return domainAndParents(email).some((domain) => ALIAS_SERVICE_DOMAINS.has(domain));
}

/**
 * Two rows reach the same mailbox: the referral identity key (documented
 * provider aliases, ./identity.ts) or the signup's own canonical email
 * matches. Using both keeps the ledger at least as strict as signup dedupe.
 */
export function samePerson(
  a: Pick<ReferralRow, "email" | "canonicalEmail">,
  b: Pick<ReferralRow, "email" | "canonicalEmail">,
): boolean {
  if (a.canonicalEmail !== "" && a.canonicalEmail === b.canonicalEmail) return true;
  const key = referralIdentityKey(a.email);
  return key.includes("@") && key === referralIdentityKey(b.email);
}

/** Lowercased, trimmed ref code; the share link and the signup both store `[a-z0-9]{8}`. */
export function normalizeRefCode(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Verified at, as epoch ms, or null when absent or unparseable. */
export function verifiedAtMs(row: Pick<ReferralRow, "verifiedAt">): number | null {
  if (!row.verifiedAt) return null;
  const ms = Date.parse(row.verifiedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A row this flow confirmed: verified status, the checkbox, and a usable
 * `Verified at` (the credit order and the daily cap are keyed on it). Legacy
 * single opt-in rows have no `Verified at` and so do not count as friends.
 */
export function isConfirmed(row: ReferralRow): boolean {
  return row.status === "verified" && row.emailVerified && verifiedAtMs(row) !== null;
}

/**
 * Confirmed at some point, even if the person unsubscribed since. Legal
 * review D7 (2026-10-22): unsubscribing stops our mail, it does not undo a
 * confirmation. A friend who confirmed and later unsubscribed still counts,
 * and a referrer who unsubscribes keeps the standing they reached. A credit
 * is never taken back because the friend left the list: a falling count
 * would tell the referrer that this friend unsubscribed, and the friend did
 * join. The `Email verified` checkbox and `Verified at` stay on an
 * unsubscribed row, so the confirmation is still provable. Review removals
 * (Suspect, Duplicate, blocking flags) still drop a friend.
 */
export function wasConfirmed(row: ReferralRow): boolean {
  return (
    (row.status === "verified" || row.status === "unsubscribed") &&
    row.emailVerified &&
    verifiedAtMs(row) !== null
  );
}

/**
 * A referrer may hold a standing (and so a reward) only while their own row is
 * a confirmed (possibly since unsubscribed), unflagged single sign-up whose
 * reward review was not rejected. Their friends' credits are still computed,
 * so a referrer whose row is later cleared by ops gets them back.
 */
export function referrerEligible(row: ReferralRow): boolean {
  return (
    wasConfirmed(row) &&
    !row.suspect &&
    !row.duplicate &&
    !conversionBlocked(row.flags) &&
    row.rewardReview !== "rejected"
  );
}

/**
 * Why `friend` cannot count for `referrer`, or null when it may (subject to the
 * cross-row rules in the ledger). `referrer` is the row whose `Ref code`
 * equals the friend's `Referred by`; undefined when there is none.
 *
 * The order matters only for which single reason the ops count records: link
 * problems first, then the friend's own state, then the close.
 */
export function excludeReason(
  friend: ReferralRow,
  referrer: ReferralRow | undefined,
  options: { closesAt: Date | null },
): ExclusionReason | null {
  const code = normalizeRefCode(friend.referredBy);
  if (!referrer || !code || normalizeRefCode(referrer.refCode) !== code) return "unknown_referrer";
  if (
    referrer.pageId === friend.pageId ||
    code === normalizeRefCode(friend.refCode) ||
    samePerson(friend, referrer)
  ) {
    return "self_referral";
  }
  if (!wasConfirmed(friend)) {
    // Left before ever confirming: never a friend, recorded under its own reason.
    return friend.status === "unsubscribed" ? "unsubscribed" : "not_verified";
  }
  if (friend.suspect) return "suspect";
  if (friend.duplicate) return "duplicate";
  if (isDisposableEmail(friend.email) || friend.flags.includes("disposable")) {
    return "disposable_domain";
  }
  if (conversionBlocked(friend.flags)) return "blocked_flag";
  const at = verifiedAtMs(friend);
  if (options.closesAt && at !== null && at >= options.closesAt.getTime()) return "after_close";
  return null;
}
