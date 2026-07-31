import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from "./frozen-landing-en";
import { homePath, privacyPath, SUPPORTED_LOCALES, termsPath, type Locale } from "./locale";

export const WATCHDIVE_PUBLIC_ORIGIN = "https://watchdive.diveroid.com";

const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  ko: "ko_KR",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
  ja: "ja_JP",
  es: "es_ES",
  fr: "fr_FR",
  de: "de_DE",
  "pt-BR": "pt_BR",
};

export function absoluteWatchDivePath(pathname: string): string {
  return new URL(pathname, WATCHDIVE_PUBLIC_ORIGIN).toString();
}

export function landingHead(
  locale: Locale,
  messages: FrozenLandingMessages = EN_FROZEN_LANDING_MESSAGES,
) {
  const copy = messages.meta;
  const canonical = absoluteWatchDivePath(homePath(locale));

  return {
    meta: [
      { title: copy.title },
      { name: "description", content: copy.description },
      { property: "og:title", content: copy.ogTitle },
      { property: "og:description", content: copy.ogDescription },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:locale", content: OG_LOCALE[locale] },
      { property: "og:image", content: `${WATCHDIVE_PUBLIC_ORIGIN}/og-image.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: copy.twitterTitle },
      { name: "twitter:description", content: copy.twitterDescription },
      { name: "twitter:image", content: `${WATCHDIVE_PUBLIC_ORIGIN}/og-image.png` },
    ],
    links: [
      { rel: "canonical", href: canonical },
      ...SUPPORTED_LOCALES.map((alternate) => ({
        rel: "alternate",
        hrefLang: alternate,
        href: absoluteWatchDivePath(homePath(alternate)),
      })),
      {
        rel: "alternate",
        hrefLang: "x-default",
        href: absoluteWatchDivePath(homePath("en")),
      },
    ],
  };
}

export function legalHead(
  locale: Locale,
  document: "privacy" | "terms",
  messages: FrozenLandingMessages = EN_FROZEN_LANDING_MESSAGES,
) {
  const copy = messages[document];
  const pathFor = document === "privacy" ? privacyPath : termsPath;
  const canonical = absoluteWatchDivePath(pathFor(locale));
  return {
    meta: [{ title: copy.metaTitle }, { name: "description", content: copy.metaDescription }],
    links: [
      { rel: "canonical", href: canonical },
      ...SUPPORTED_LOCALES.map((alternate) => ({
        rel: "alternate",
        hrefLang: alternate,
        href: absoluteWatchDivePath(pathFor(alternate)),
      })),
      {
        rel: "alternate",
        hrefLang: "x-default",
        href: absoluteWatchDivePath(pathFor("en")),
      },
    ],
  };
}
