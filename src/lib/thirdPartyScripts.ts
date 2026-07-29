// Which routes may run third-party JavaScript.
//
// /verify receives the confirmation token in its URL fragment. Any third-party
// script on that page could read it out of location.hash before the route
// strips it, so the support widget, Vercel Analytics and the Meta pixel are all
// gated on the route rather than mounted globally. External CSS and fonts are
// unaffected — a stylesheet cannot read a fragment.
const TOKEN_BEARING_ROUTES = new Set(["/verify"]);

export const SUPPORT_WIDGET_SRC =
  "https://web-production-2bc5f.up.railway.app/widget.js?v=20260712b&pos=left&label=Questions%3F";

export function allowsThirdPartyScripts(pathname: string): boolean {
  return !TOKEN_BEARING_ROUTES.has(pathname.replace(/\/+$/, "") || "/");
}
