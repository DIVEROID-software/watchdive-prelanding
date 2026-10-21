// Which friends may count toward a Buddy Invite referrer, decided per row.
//
// The rules page promises exactly this list: only confirmed emails, never your
// own address, never a repeat sign-up, never a disposable address, never a
// sign-up flagged as abusive, never after the close. Each refusal has its own
// reason so the ops report can say how many were dropped and why, without
// naming anybody. Cross-row rules (one person counted once, the daily cap) need
// the whole list and live in ledger.ts.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { conversionBlocked } from "../verification/contracts.ts";
import type { ExclusionReason, ReferralRow } from "./contract.ts";

/**
 * Throwaway inbox services. The signup form's own list (src/lib/api/abuse.ts)
 * only matches an exact domain and flags the row `disposable`; this list is a
 * superset and also matches subdomains, because several services hand out
 * `<anything>.<service>` addresses. Not exhaustive: ops review before any
 * physical reward is the backstop the rules describe.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "20minutemail.com",
  "33mail.com",
  "anonaddy.me",
  "burnermail.io",
  "byom.de",
  "discard.email",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "emailfake.com",
  "emltmp.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "grr.la",
  "harakirimail.com",
  "inboxkitten.com",
  "incognitomail.org",
  "jetable.org",
  "laafd.com",
  "luxusmail.org",
  "mail-temp.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailinator2.com",
  "mailnesia.com",
  "mailpoof.com",
  "mailsac.com",
  "mailtemp.net",
  "mintemail.com",
  "minuteinbox.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "mytrashmail.com",
  "nada.email",
  "spam4.me",
  "spamgourmet.com",
  "spambox.us",
  "sharklasers.com",
  "temp-inbox.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "tmail.ws",
  "tmpmail.net",
  "tmpmail.org",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "vjuum.com",
  "wegwerfmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/** True for an address on a known disposable domain or any of its subdomains. */
export function isDisposableEmail(email: string): boolean {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return false;
  const labels = value
    .slice(at + 1)
    .replace(/\.+$/, "")
    .split(".");
  // Walk `a.b.mailinator.com` → `b.mailinator.com` → `mailinator.com`; a bare
  // TLD is never on the list, so stop at two labels.
  for (let i = 0; i + 1 < labels.length; i++) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
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
 * and a referrer who unsubscribes keeps the standing they reached.
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
    (friend.canonicalEmail !== "" && friend.canonicalEmail === referrer.canonicalEmail)
  ) {
    return "self_referral";
  }
  // Never confirmed: an unsubscribe before confirming keeps its own reason.
  if (!wasConfirmed(friend))
    return friend.status === "unsubscribed" ? "unsubscribed" : "not_verified";
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
