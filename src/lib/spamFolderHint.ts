/**
 * Gmail and Naver addresses confirm 78–92% of signups; Yahoo, iCloud and
 * Outlook addresses confirmed 3 of 12 (2026-09-01 to 2026-10-07) although SPF,
 * DKIM and DMARC pass, so the mail most likely sits in their spam folders.
 * The check-your-inbox card gives those addresses one line on where to look.
 *
 * The address is matched in the browser, against the domain only, and is not
 * logged or sent anywhere by this check.
 */
export type SpamFolderHint = "providerYahoo" | "providerApple" | "providerOutlook";

const SPAM_FOLDER_HINTS: readonly { match: RegExp; hint: SpamFolderHint }[] = [
  // AOL, ymail and rocketmail are Yahoo mailboxes with the same Spam folder.
  { match: /@(?:yahoo|ymail|rocketmail|aol)\.[a-z.]+$/i, hint: "providerYahoo" },
  { match: /@(?:icloud|me|mac)\.com$/i, hint: "providerApple" },
  { match: /@(?:outlook|hotmail|live|msn)\.[a-z.]+$/i, hint: "providerOutlook" },
];

export function spamFolderHintFor(email: string): SpamFolderHint | undefined {
  const address = email.trim();
  return SPAM_FOLDER_HINTS.find((provider) => provider.match.test(address))?.hint;
}
