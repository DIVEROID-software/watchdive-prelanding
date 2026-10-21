// Referral-only identity key: "is this the same mailbox?" for the Buddy Invite
// self-referral and duplicate-friend checks.
//
// It is deliberately separate from `canonicalEmail` (src/lib/api/abuse.ts),
// which keys signup dedupe and the stored `Canonical email` column and must not
// change under existing rows. The ledger treats two rows as one person when
// either key matches, so it is never laxer than the signup.
//
// Only rules a provider documents are applied. Anything undocumented stays
// distinct: wrongly merging two real people would silently take a friend away
// from someone, while a missed alias is still caught by the review signals in
// scripts/referral-report.ts and by the manual review before any reward.
//
// Sources (checked 2026-10-22):
//   Gmail dots      https://support.google.com/mail/answer/7436150
//                   "Dots don't matter in Gmail addresses" (personal accounts
//                   only; Workspace addresses keep their dots, so a custom
//                   domain is never dot-folded).
//   Gmail +tag      https://support.google.com/mail/answer/12096
//                   "messages sent to the following aliases will all go to
//                   janedoe@gmail.com" (janedoe+school@gmail.com …).
//   googlemail.com  No current Google help page states it; kept because the
//                   signup's canonicalEmail already folds it to gmail.com, so
//                   the referral key must not be stricter than the signup.
//   Apple           https://support.apple.com/en-us/118230 (HT201771): an
//                   older iCloud account "has both @me.com and @icloud.com
//                   email addresses" and eligible ones "can use @icloud.com,
//                   @me.com, and @mac.com email addresses with your iCloud
//                   account". The same user name across the three domains is
//                   from Apple's Nov 2012 notice ("receive email to the same
//                   user name at icloud.com"), as reported by TidBITS:
//                   https://tidbits.com/2012/11/07/apple-enables-icloud-com-addresses-for-me-com-and-mac-com-users/
//   Proton +tag     https://proton.me/support/creating-aliases
//                   "All mail sent to a plus alias arrives in your regular
//                   inbox." Proton's domains are NOT folded into each other:
//                   https://proton.me/support/pm-me-addresses shows
//                   name@protonmail.com and name@pm.me for one user, but no
//                   Proton page says whether name@proton.me is the same
//                   account, so a single folded domain cannot be chosen.
//   Fastmail        https://www.fastmail.help/hc/en-us/articles/360060591053
//                   `alias+anything@domain` and `anything@alias.domain` reach
//                   the same account (one subdomain level).
//
// Not folded, on purpose: Outlook/Hotmail plus addressing (no Microsoft page
// for consumer Outlook.com was found; Exchange Online's is an admin opt-in),
// Yahoo `base-keyword` disposable addresses (`-` is also legal in ordinary
// Yahoo IDs), Daum/Hanmail and Naver (no equivalence documented), and Gmail's
// address-change aliases (not detectable from the address).
//
// Kept free of path-alias imports so `npm test` can load it directly.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);
const APPLE_DOMAINS = new Set(["icloud.com", "me.com", "mac.com"]);
const PROTON_DOMAINS = new Set(["proton.me", "protonmail.com", "protonmail.ch", "pm.me"]);
const FASTMAIL_DOMAIN = "fastmail.com";

function withoutPlusTag(local: string): string {
  const plus = local.indexOf("+");
  // `+tag` with nothing before it is not an alias of an empty mailbox.
  return plus > 0 ? local.slice(0, plus) : local;
}

/**
 * The mailbox an address reaches, as far as the provider documents it.
 * Lowercased and trimmed for every domain; anything that does not look like
 * `local@domain` is returned lowercased and trimmed, unchanged otherwise.
 */
export function referralIdentityKey(email: string): string {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return value;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1).replace(/\.+$/, "");

  if (GMAIL_DOMAINS.has(domain)) {
    return `${withoutPlusTag(local).replace(/\./g, "")}@gmail.com`;
  }
  if (APPLE_DOMAINS.has(domain)) return `${local}@icloud.com`;
  if (PROTON_DOMAINS.has(domain)) return `${withoutPlusTag(local)}@${domain}`;
  if (domain === FASTMAIL_DOMAIN || domain.endsWith(`.${FASTMAIL_DOMAIN}`)) {
    const sub = domain.slice(0, -FASTMAIL_DOMAIN.length - 1);
    // `anything@alias.fastmail.com` is `alias@fastmail.com`; Fastmail
    // supports one subdomain level and an alias without dots.
    if (sub) {
      if (sub.includes(".")) return `${local}@${domain}`;
      local = sub;
      domain = FASTMAIL_DOMAIN;
    }
    return `${withoutPlusTag(local)}@${FASTMAIL_DOMAIN}`;
  }
  return `${local}@${domain}`;
}
