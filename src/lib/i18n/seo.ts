import localizedSocialImage from "../../assets/live/hero-background.webp";
import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from "./frozen-landing-en.ts";
import { homePath, privacyPath, SUPPORTED_LOCALES, termsPath, type Locale } from "./locale.ts";
import { absoluteWatchDivePath, WATCHDIVE_PUBLIC_ORIGIN as SOURCE_ORIGIN } from "./publicOrigin.ts";
import { landingStructuredData, legalStructuredData, structuredDataScript } from "./structuredData.ts";

// Read by reservation readiness. Keep this literal pinned to the production origin.
export const WATCHDIVE_PUBLIC_ORIGIN = "https://watchdive.diveroid.com";

if (WATCHDIVE_PUBLIC_ORIGIN !== SOURCE_ORIGIN) {
  throw new Error("WatchDive public origin constants diverged");
}

export { absoluteWatchDivePath };

// One og:locale per page. The rendered head keeps a single meta per property,
// so repeating og:locale:alternate would leave only the last locale. The
// hreflang links below are the full cluster, including x-default.
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

function hreflangLinks(pathFor: (locale: Locale) => string) {
  return [
    ...SUPPORTED_LOCALES.map((alternate) => ({
      rel: "alternate" as const,
      hrefLang: alternate,
      href: absoluteWatchDivePath(pathFor(alternate)),
    })),
    {
      rel: "alternate" as const,
      hrefLang: "x-default",
      href: absoluteWatchDivePath(pathFor("en")),
    },
  ];
}

export function landingHead(
  locale: Locale,
  messages: FrozenLandingMessages = EN_FROZEN_LANDING_MESSAGES,
) {
  const copy = messages.meta;
  const canonical = absoluteWatchDivePath(homePath(locale));
  // The legacy campaign card contains USD copy and claims that are not in the
  // current Product Truth. Every locale therefore shares the same text-free
  // underwater image until approved locale-specific cards exist.
  const socialImage = absoluteWatchDivePath(localizedSocialImage);

  return {
    meta: [
      { title: copy.title },
      { name: "description", content: copy.description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: copy.ogTitle },
      { property: "og:description", content: copy.ogDescription },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:locale", content: OG_LOCALE[locale] },
      { property: "og:image", content: socialImage },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "971" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: copy.twitterTitle },
      { name: "twitter:description", content: copy.twitterDescription },
      { name: "twitter:image", content: socialImage },
    ],
    links: [{ rel: "canonical", href: canonical }, ...hreflangLinks(homePath)],
    scripts: [
      structuredDataScript(landingStructuredData(locale, messages, canonical, socialImage)),
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
  const socialImage = absoluteWatchDivePath(localizedSocialImage);
  return {
    meta: [
      { title: copy.metaTitle },
      { name: "description", content: copy.metaDescription },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: copy.metaTitle },
      { property: "og:description", content: copy.metaDescription },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:locale", content: OG_LOCALE[locale] },
      { property: "og:image", content: socialImage },
    ],
    links: [{ rel: "canonical", href: canonical }, ...hreflangLinks(pathFor)],
    scripts: [structuredDataScript(legalStructuredData(locale, document, messages, canonical))],
  };
}
