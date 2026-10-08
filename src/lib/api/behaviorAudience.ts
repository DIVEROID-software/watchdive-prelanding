// Who may be written into the page-behavior database.
//
// The raw user-agent is an argument only. It is not returned, logged, or stored.
// Facebook and Instagram in-app browsers are visitors and stay in. The existing
// crawler expression also matches WhatsApp's in-app browser, so those visits
// are omitted with the link unfurlers. Ordinary browser strings can still be
// bots; dropping the obvious ones does not make the denominator human.
import { isHeadlessUA } from "./abuse.ts";
import { isCrawlerUserAgent } from "../i18n/auto-locale.ts";

const IN_APP_BROWSER = /(?:FBAN|FBAV|FB_IAB|Instagram)/i;

export function shouldDiscardBehaviorUserAgent(userAgent: string | null | undefined): boolean {
  const value = (userAgent ?? "").trim().slice(0, 1_024);
  if (IN_APP_BROWSER.test(value)) return false;
  if (isHeadlessUA(value)) return true;
  return isCrawlerUserAgent(value);
}
