import { LOCALE_PATH_SEGMENTS, localizePath, type Locale } from "../i18n/locale.ts";

/** Presentation routing only; never a credential, CRM Source, or purchase signal. */
export type LandingSegment = "freediving" | "scuba";
export type LandingVariant = "control" | "launch";

export function isLandingVariant(value: unknown): value is LandingVariant {
  return value === "control" || value === "launch";
}

export function isLandingSegment(value: unknown): value is LandingSegment {
  return value === "freediving" || value === "scuba";
}

/** Recognize only complete app paths, not query values, lookalikes or arbitrary next URLs. */
export function segmentFromPathname(pathname: string): LandingSegment | undefined {
  const match = /^\/(?:(en|ko|zh-cn|zh-tw|ja|es|fr|de|pt-br|nl)\/)?(?:launch\/)?(freediving|scuba)\/?$/.exec(pathname);
  if (!match || match[0] !== pathname) return undefined;
  const prefix = match[1];
  if (prefix && prefix !== "en" && !Object.values(LOCALE_PATH_SEGMENTS).some((value) => value === prefix)) return undefined;
  return isLandingSegment(match[2]) ? match[2] : undefined;
}

/** A strict page-path variant; never read a query or accept a free-form return URL. */
export function landingVariantFromPathname(pathname: string): LandingVariant | undefined {
  if (!segmentFromPathname(pathname)) return undefined;
  return /(?:^|\/)launch\//.test(pathname) ? "launch" : "control";
}

export function segmentPath(segment: LandingSegment, locale: Locale, variant: LandingVariant = "control"): string {
  return localizePath(`${variant === "launch" ? "/launch" : ""}/${segment}`, locale);
}

/** Keep state in its existing URL component and on the same locale-independent route.
 * In particular, verification/buddy bearer fragments never become query parameters
 * or move to a landing page. localizePath rejects absolute/protocol-relative URLs.
 */
export function languageSwitchPath(
  location: { pathname: string; search: string; hash: string },
  locale: Locale,
): string {
  return localizePath(`${location.pathname}${location.search}${location.hash}`, locale);
}
