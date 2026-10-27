// Token-bearing routes may read an existing consented cookie, but must never
// import a tag loader or send a URL to an analytics SDK.
import { measurementAllowed } from "../consentRegion.ts";
import { validGoogleClientId } from "./contract.ts";

export function googleClientId(): string | undefined {
  if (typeof document === "undefined" || !measurementAllowed()) return;
  const raw = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("_ga="))
    ?.slice(4);
  const id = raw?.match(/^GA\d+\.\d+\.(\d+\.\d+)$/)?.[1];
  return validGoogleClientId(id) ? id : undefined;
}

export function googleBrowserContext() {
  const permitted = typeof window !== "undefined" && measurementAllowed();
  return {
    measurementConsent: permitted,
    ...(permitted && googleClientId() ? { googleClientId: googleClientId() } : {}),
  };
}
