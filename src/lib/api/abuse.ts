// Anti-abuse helpers for the waitlist form.
// Goal: collect lots of real leads while stopping one person from padding the
// list (and the "X of 30 spots left" scarcity counter) with many signups.
// Strategy: normalize + flag, never hard-lose a real lead. Suspect rows are
// still stored for review but excluded from public counts.

// ---------------------------------------------------------------------------
// Email canonicalization — the single biggest lever.
// `me+kickstarter@gmail.com`, `m.e@gmail.com`, `me@googlemail.com` are all the
// same inbox but slip past an exact-string dedupe. Collapse them to one key.
// ---------------------------------------------------------------------------
export function canonicalEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;

  let local = email.slice(0, at);
  let domain = email.slice(at + 1);

  // Subaddressing (`+tag`) routes to the same inbox on most major providers.
  local = local.split("+")[0];

  // Google treats dots in the local part as insignificant; unify the domain too.
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");

  return `${local}@${domain}`;
}

// ---------------------------------------------------------------------------
// Disposable / throwaway email domains. Not exhaustive, but covers the common
// temp-mail services people reach for to farm referral rewards.
// ---------------------------------------------------------------------------
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "grr.la",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "tmpmail.org",
  "throwawaymail.com",
  "getnada.com",
  "nada.email",
  "trashmail.com",
  "trashmail.de",
  "yopmail.com",
  "yopmail.fr",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "fakemail.net",
  "fakeinbox.com",
  "spam4.me",
  "mytemp.email",
  "mohmal.com",
  "emailondeck.com",
  "moakt.com",
  "mailcatch.com",
  "inboxkitten.com",
  "burnermail.io",
  "33mail.com",
  "tempail.com",
  "tempinbox.com",
  "mailtemp.net",
  "mail-temp.com",
  "1secmail.com",
  "1secmail.net",
  "1secmail.org",
  "vjuum.com",
  "laafd.com",
  "dropmail.me",
  "emltmp.com",
  "minuteinbox.com",
  "temp-inbox.com",
  "luxusmail.org",
]);

export function isDisposableEmail(email: string): boolean {
  const at = (email ?? "").lastIndexOf("@");
  if (at < 1) return false;
  return DISPOSABLE_DOMAINS.has(
    email
      .slice(at + 1)
      .trim()
      .toLowerCase(),
  );
}

// ---------------------------------------------------------------------------
// Bot / automation user-agents. Real early-bird backers use real browsers.
// ---------------------------------------------------------------------------
const HEADLESS_UA =
  /headlesschrome|phantomjs|puppeteer|playwright|selenium|python-requests|scrapy|curl\/|wget\/|node-fetch|axios\/|go-http-client|httpclient|bot\b|crawler|spider/i;

export function isHeadlessUA(ua: string | undefined | null): boolean {
  const s = (ua ?? "").trim();
  if (!s) return true; // no UA at all is itself a red flag
  return HEADLESS_UA.test(s);
}

// First public IP from an x-forwarded-for chain (Vercel/edge put the client first).
export function firstIp(xff: string | undefined | null): string {
  if (!xff) return "";
  return xff.split(",")[0]?.trim() ?? "";
}
