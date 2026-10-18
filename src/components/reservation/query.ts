import {
  localeFromPreferenceCookie,
  localeFromCountry,
  localeFromAcceptLanguage,
} from "../../lib/i18n/auto-locale.ts";
import { SUPPORTED_LOCALES, matchLocale, type Locale } from "../../lib/i18n/locale.ts";

import { normalizeCheckoutSessionId, normalizeInviteToken } from "./contract.ts";

export const RESERVATION_LOCALES = SUPPORTED_LOCALES;
export type ReservationLocale = Locale;

export type ReservationQuery = {
  sessionId: string | null;
  lang: ReservationLocale | null;
  canceled: boolean;
  /** A session_id parameter was present but is not a Checkout Session id. */
  invalidSession: boolean;
};

function searchParams(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

export function parseReservationLang(value: string | null): ReservationLocale | null {
  if (!value) return null;
  return matchLocale(value) ?? null;
}

/**
 * The mailed link keeps the invite in the fragment `#invite=`, not in the query.
 * A query token is ignored here and stripped before the page asks for status.
 */
export function parseReservationQuery(search: string): ReservationQuery {
  const params = searchParams(search);
  const rawSession = params.get("session_id");
  const canceledValue = params.get("canceled");
  return {
    sessionId: normalizeCheckoutSessionId(rawSession),
    lang: parseReservationLang(params.get("lang")),
    canceled: canceledValue === "1" || canceledValue === "true",
    invalidSession: rawSession !== null && normalizeCheckoutSessionId(rawSession) === null,
  };
}

export const RESERVATION_INVITE_STORAGE_KEY = "watchdive.reservation.invite";
export const RESERVATION_LANG_STORAGE_KEY = "watchdive.reservation.lang";
/** Non-secret marker. It never stores the invite token or a query secret. */
export const RESERVATION_INVALID_INVITE_KEY = "watchdive.reservation.inviteInvalid";

export function parseInviteFragment(hash: string): { token: string | null; invalid: boolean } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return { token: null, invalid: false };
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (keys.length !== 1 || keys[0] !== "invite") return { token: null, invalid: true };
  const token = normalizeInviteToken(params.get("invite"));
  return token ? { token, invalid: false } : { token: null, invalid: true };
}

type InviteStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export function readStoredInvite(storage: Pick<InviteStorage, "getItem">): string | null {
  try {
    return normalizeInviteToken(storage.getItem(RESERVATION_INVITE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredInvite(storage: Pick<InviteStorage, "setItem">, token: string): void {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return;
  storage.setItem(RESERVATION_INVITE_STORAGE_KEY, normalized);
}

export function readStoredLang(storage: Pick<InviteStorage, "getItem">): ReservationLocale | null {
  try {
    return parseReservationLang(storage.getItem(RESERVATION_LANG_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredLang(
  storage: Pick<InviteStorage, "setItem">,
  lang: ReservationLocale,
): void {
  storage.setItem(RESERVATION_LANG_STORAGE_KEY, lang);
}

export function readInvalidInviteFlag(storage: Pick<InviteStorage, "getItem">): boolean {
  try {
    return storage.getItem(RESERVATION_INVALID_INVITE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInvalidInviteFlag(storage: InviteStorage, invalid: boolean): void {
  try {
    if (!invalid) {
      if (storage.removeItem) storage.removeItem(RESERVATION_INVALID_INVITE_KEY);
      else storage.setItem(RESERVATION_INVALID_INVITE_KEY, "0");
      return;
    }
    storage.setItem(RESERVATION_INVALID_INVITE_KEY, "1");
  } catch {
    return;
  }
}

/**
 * Store a valid fragment, or a non-secret invalid flag, then drop the hash
 * and any invite query. The token itself is never copied into the query.
 */
export function rememberReservationEntry(input: { href: string; storage: InviteStorage }): {
  replaceUrl: string | null;
  inviteToken: string | null;
  invalidInvite: boolean;
} {
  const url = new URL(input.href);
  const fragment = parseInviteFragment(url.hash);
  const leakedQuery = url.searchParams.has("inviteToken") || url.searchParams.has("token");
  const queryLang = parseReservationLang(url.searchParams.get("lang"));
  if (queryLang) writeStoredLang(input.storage, queryLang);
  const storedLang = queryLang ?? readStoredLang(input.storage);
  if (fragment.token) {
    writeStoredInvite(input.storage, fragment.token);
    writeInvalidInviteFlag(input.storage, false);
  } else if (fragment.invalid) {
    writeInvalidInviteFlag(input.storage, true);
  }
  if (fragment.token || fragment.invalid || leakedQuery || (!queryLang && storedLang)) {
    return {
      replaceUrl: reservationUrlWithoutSecret(input.href, storedLang ?? undefined),
      inviteToken: null,
      invalidInvite: readInvalidInviteFlag(input.storage),
    };
  }
  return {
    replaceUrl: null,
    inviteToken: readStoredInvite(input.storage),
    invalidInvite: readInvalidInviteFlag(input.storage),
  };
}

/**
 * Stripe's success and cancel URLs omit lang so one inbox keeps identical
 * Checkout parameters. Restore the language saved with the invite.
 * An explicit supported lang on the URL wins and this returns null.
 * The fragment stays intact so the page can store #invite before stripping it.
 */
export function reservationReturnUrl(href: string, storedLang: string | null): string | null {
  const url = new URL(href);
  if (parseReservationLang(url.searchParams.get("lang"))) return null;
  const stored = parseReservationLang(storedLang);
  if (!stored) return null;
  url.searchParams.delete("inviteToken");
  url.searchParams.delete("token");
  url.searchParams.set("lang", stored);
  return url.toString();
}

/**
 * Blocking head script. It mirrors matchLocale so a mailed lang is saved
 * before paint, and a Stripe return without lang is restored before the
 * English document is shown. It never copies the invite into the query.
 */
export function reservationLangBootstrapScript(): string {
  const key = JSON.stringify(RESERVATION_LANG_STORAGE_KEY);
  return `(function(){try{
    function match(value){
      if(typeof value!=="string")return null;
      var normalized=value.trim().replace(/_/g,"-").toLowerCase();
      if(!normalized)return null;
      if(normalized==="zh"||normalized==="zh-cn"||normalized==="zh-sg"||normalized.indexOf("zh-hans")===0)return "zh-CN";
      if(normalized==="zh-tw"||normalized==="zh-hk"||normalized==="zh-mo"||normalized.indexOf("zh-hant")===0)return "zh-TW";
      if(normalized==="pt"||normalized.indexOf("pt-br")===0)return "pt-BR";
      var language=normalized.split("-")[0];
      if(language==="en"||language==="ko"||language==="ja"||language==="es"||language==="fr"||language==="de")return language;
      return null;
    }
    var params=new URLSearchParams(location.search);
    var current=match(params.get("lang"));
    if(current){sessionStorage.setItem(${key},current);return;}
    var stored=match(sessionStorage.getItem(${key}));
    if(!stored)return;
    params.delete("inviteToken");
    params.delete("token");
    params.set("lang",stored);
    var search=params.toString();
    var next=location.pathname+(search?"?"+search:"")+location.hash;
    var now=location.pathname+location.search+location.hash;
    if(next!==now)location.replace(next);
  }catch(e){}})();`;
}

/** Drop the fragment and any invite query before a full reload. */
export function reservationUrlWithoutSecret(href: string, lang?: ReservationLocale): string {
  const url = new URL(href);
  url.hash = "";
  url.searchParams.delete("inviteToken");
  url.searchParams.delete("token");
  if (lang) url.searchParams.set("lang", lang);
  return url.toString();
}

/** Keep every current parameter, including attribution, and set only the language. */
export function withReservationLang(search: string, lang: ReservationLocale): string {
  const params = searchParams(search);
  params.delete("inviteToken");
  params.delete("token");
  params.set("lang", lang);
  const query = params.toString();
  return query ? `/reservation?${query}` : `/reservation?lang=${lang}`;
}

/**
 * Explicit cookie wins for English or Korean. Another explicit language is left
 * alone. Otherwise a Korean or English browser language may be used. Country is ignored.
 */
export function reservationLocaleHint(
  cookieHeader: string | null,
  languageTags: readonly string[] | null,
): ReservationLocale | null {
  const cookie = localeFromPreferenceCookie(cookieHeader);
  if (cookie === "en" || cookie === "ko") return cookie;
  if (cookie) return null;
  for (const tag of languageTags ?? []) {
    const match = matchLocale(tag);
    if (match === "ko" || match === "en") return match;
  }
  return null;
}

/** Automatic Korean selection never overrides an explicit lang parameter. */
export function shouldPreferKorean(search: string, hint: ReservationLocale | null): boolean {
  return parseReservationQuery(search).lang === null && hint === "ko";
}

/** Signup language in the mailed URL wins. Stripe returns restore session language in the head script. */
export function reservationInitialLocaleRedirect(
  request: Request,
  country: string | null,
): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (
    url.pathname !== "/reservation" ||
    url.searchParams.has("lang") ||
    url.searchParams.has("session_id") ||
    url.searchParams.has("canceled")
  )
    return null;
  const locale =
    localeFromPreferenceCookie(request.headers.get("cookie")) ??
    localeFromCountry(country) ??
    localeFromAcceptLanguage(request.headers.get("accept-language")) ??
    "en";
  url.searchParams.delete("inviteToken");
  url.searchParams.delete("token");
  url.searchParams.set("lang", locale);
  return url.pathname + url.search;
}
