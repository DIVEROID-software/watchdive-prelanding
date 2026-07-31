/**
 * Locale and URL primitives shared by routes, client components and email code.
 *
 * English remains the canonical, unprefixed experience. Every other locale
 * gets a stable lowercase URL prefix, while the values carried through the
 * application stay valid BCP 47 language tags for `lang` and `Intl`.
 */
export const SUPPORTED_LOCALES = [
  "en",
  "ko",
  "zh-CN",
  "zh-TW",
  "ja",
  "es",
  "fr",
  "de",
  "pt-BR",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_PATH_SEGMENTS = {
  en: "en",
  ko: "ko",
  "zh-CN": "zh-cn",
  "zh-TW": "zh-tw",
  ja: "ja",
  es: "es",
  fr: "fr",
  de: "de",
  "pt-BR": "pt-br",
} as const satisfies Record<Locale, string>;

export type LanguageOption = {
  locale: Locale;
  /** The language name as its speakers expect to see it in a picker. */
  label: string;
  /** All currently supported WatchDive writing systems run left-to-right. */
  dir: "ltr";
};

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { locale: "en", label: "English", dir: "ltr" },
  { locale: "ko", label: "한국어", dir: "ltr" },
  { locale: "zh-CN", label: "简体中文", dir: "ltr" },
  { locale: "zh-TW", label: "繁體中文", dir: "ltr" },
  { locale: "ja", label: "日本語", dir: "ltr" },
  { locale: "es", label: "Español", dir: "ltr" },
  { locale: "fr", label: "Français", dir: "ltr" },
  { locale: "de", label: "Deutsch", dir: "ltr" },
  { locale: "pt-BR", label: "Português (Brasil)", dir: "ltr" },
] as const;

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);
const LOCALE_BY_PATH_SEGMENT = new Map<string, Locale>(
  Object.entries(LOCALE_PATH_SEGMENTS).map(([locale, segment]) => [segment, locale as Locale]),
);

/** Resolve only the exact slugs accepted in public localized URLs. */
export function localeFromPathSegment(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;
  return LOCALE_BY_PATH_SEGMENT.get(value.trim().toLowerCase());
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALE_SET.has(value);
}

/**
 * Match a browser/HTTP language tag to one of the translations we ship.
 * Unknown tags return `undefined`, which lets callers continue through a
 * preference list instead of prematurely falling back to English.
 */
export function matchLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) return undefined;

  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-sg") {
    return "zh-CN";
  }
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo") {
    return "zh-TW";
  }
  if (normalized.startsWith("zh-hans")) return "zh-CN";
  if (normalized.startsWith("zh-hant")) return "zh-TW";
  if (normalized === "pt" || normalized.startsWith("pt-br")) return "pt-BR";

  const language = normalized.split("-", 1)[0];
  switch (language) {
    case "en":
    case "ko":
    case "ja":
    case "es":
    case "fr":
    case "de":
      return language;
    default:
      return undefined;
  }
}

export function resolveLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return matchLocale(value) ?? fallback;
}

export function resolvePreferredLocale(
  languageTags: readonly string[] | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  for (const tag of languageTags ?? []) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return fallback;
}

export type ParsedLocalePath = {
  locale: Locale;
  /** The path with a recognized locale prefix removed; always starts with `/`. */
  pathname: string;
  hasLocalePrefix: boolean;
};

function splitPathReference(value: string): {
  pathname: string;
  search: string;
  hash: string;
} {
  const input = value || "/";
  if (input.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(input)) {
    throw new TypeError("Expected an application-relative path");
  }

  const hashIndex = input.indexOf("#");
  const beforeHash = hashIndex === -1 ? input : input.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : input.slice(hashIndex);
  const searchIndex = beforeHash.indexOf("?");
  const rawPathname = searchIndex === -1 ? beforeHash : beforeHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : beforeHash.slice(searchIndex);
  const pathname = rawPathname || "/";

  if (!pathname.startsWith("/")) {
    throw new TypeError("Expected an application-relative path beginning with `/`");
  }

  return { pathname, search, hash };
}

export function parseLocalePath(pathname: string): ParsedLocalePath {
  const { pathname: cleanPathname } = splitPathReference(pathname);
  const match = /^\/([^/]+)(\/.*)?$/.exec(cleanPathname);
  if (!match) {
    return { locale: DEFAULT_LOCALE, pathname: "/", hasLocalePrefix: false };
  }

  const locale = LOCALE_BY_PATH_SEGMENT.get(match[1].toLowerCase());
  if (!locale) {
    return { locale: DEFAULT_LOCALE, pathname: cleanPathname, hasLocalePrefix: false };
  }

  return {
    locale,
    pathname: match[2] || "/",
    hasLocalePrefix: true,
  };
}

export function localeFromPathname(pathname: string): Locale {
  return parseLocalePath(pathname).locale;
}

export function stripLocalePrefix(pathname: string): string {
  return parseLocalePath(pathname).pathname;
}

/** English intentionally returns an empty prefix because `/` is canonical. */
export function localePathPrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${LOCALE_PATH_SEGMENTS[locale]}`;
}

export type LocalizePathOptions = {
  preserveSearch?: boolean;
  preserveHash?: boolean;
};

/**
 * Add or replace a locale prefix on an app-local URL reference.
 *
 * Query parameters and fragments are retained by default so attribution and
 * in-progress verification links survive an explicit language change. Callers
 * can deliberately drop either part at a boundary where it is not appropriate.
 */
export function localizePath(
  path: string,
  locale: Locale,
  options: LocalizePathOptions = {},
): string {
  const { pathname, search, hash } = splitPathReference(path);
  const basePathname = stripLocalePrefix(pathname);
  const prefix = localePathPrefix(locale);
  const localizedPathname = prefix
    ? basePathname === "/"
      ? prefix
      : `${prefix}${basePathname}`
    : basePathname;

  return `${localizedPathname}${options.preserveSearch === false ? "" : search}${options.preserveHash === false ? "" : hash}`;
}

/** A name that makes language-picker intent explicit at call sites. */
export const switchLocalePath = localizePath;

export function homePath(locale: Locale): string {
  return localizePath("/", locale);
}

export function verifyPath(locale: Locale, token?: string): string {
  const pathname = localizePath("/verify", locale);
  return token ? `${pathname}#${encodeURIComponent(token)}` : pathname;
}

export function privacyPath(locale: Locale): string {
  return localizePath("/privacy", locale);
}

export function termsPath(locale: Locale): string {
  return localizePath("/terms", locale);
}

export function referralPath(locale: Locale, code: string): string {
  return localizePath(`/r/${encodeURIComponent(code)}`, locale);
}

export function getNumberFormatter(
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, options);
}

export function formatNumber(
  value: number | bigint,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return getNumberFormatter(locale, options).format(value);
}

export function getDateTimeFormatter(
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, options);
}

export function formatDate(
  value: Date | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return getDateTimeFormatter(locale, options).format(value);
}
