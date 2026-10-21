// Which routes may run third-party JavaScript.
//
// /verify receives the confirmation token in its URL fragment. Any third-party
// script on that page could read it out of location.hash before the route
// strips it, so the support widget, Vercel Analytics and the Meta pixel are all
// gated on the route rather than mounted globally. External CSS and fonts are
// unaffected — a stylesheet cannot read a fragment.
//
// The Buddy Invite status page (/buddy#<token>, /<locale>/buddy#<token>)
// carries its signed token in the URL fragment, which any script on the page
// can read from location.hash just as on /verify. The token is the owner's
// only credential for their nickname and mail settings, and every tag here
// reports the page URL (Meta `dl`, Google `page_location`, Clarity, Vercel
// Analytics), so /buddy and everything under it stay isolated: that also
// covers the retired /buddy/<token> path links, should an old mail be opened.
import { stripLocalePrefix } from "./i18n/locale.ts";

const TOKEN_BEARING_ROUTES = new Set(["/verify", "/admin/behavior", "/reservation"]);
const TOKEN_BEARING_PREFIXES = ["/buddy/"];

export const SUPPORT_WIDGET_SRC =
  "https://web-production-2bc5f.up.railway.app/widget.js?v=20260801a&pos=left&label=Live%20chat";

export function allowsThirdPartyScripts(pathname: string): boolean {
  try {
    const path = stripLocalePrefix(pathname).replace(/\/+$/, "") || "/";
    if (TOKEN_BEARING_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))) return false;
    return !TOKEN_BEARING_ROUTES.has(path);
  } catch {
    // An application route must be relative. Any unexpected absolute or
    // malformed input stays isolated instead of widening the script surface.
    return false;
  }
}
