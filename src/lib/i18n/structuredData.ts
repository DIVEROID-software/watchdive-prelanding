import type { FrozenLandingMessages } from "./frozen-landing-en.ts";
import { SUPPORTED_LOCALES, type Locale } from "./locale.ts";
import { absoluteWatchDivePath, WATCHDIVE_PUBLIC_ORIGIN } from "./publicOrigin.ts";

const ORGANIZATION_ID = `${WATCHDIVE_PUBLIC_ORIGIN}/#organization`;
const WEBSITE_ID = `${WATCHDIVE_PUBLIC_ORIGIN}/#website`;
const PRODUCT_FACT_ID = `${WATCHDIVE_PUBLIC_ORIGIN}/#watchdive`;

/**
 * JSON-LD is embedded in the first HTML response. `<` is escaped so a translated
 * string cannot close the script element.
 *
 * The product facts use schema.org/Thing on purpose. Google Product snippets
 * require a review, an aggregate rating, or an offer. This page has no reviewed
 * rating and no offer that can be marked without inventing a price, so those
 * fields are omitted. The visible FAQ answers are copied through unchanged.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function organizationNode() {
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "DIVEROID LTD",
    legalName: "DIVEROID LTD",
    url: absoluteWatchDivePath("/"),
    email: "help@diveroid.com",
    identifier: "16343651",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Office 12146, 182-184 High Street North, East Ham",
      addressLocality: "London",
      postalCode: "E6 2JA",
      addressCountry: "GB",
    },
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "WatchDive",
    url: absoluteWatchDivePath("/"),
    inLanguage: [...SUPPORTED_LOCALES],
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function landingStructuredData(
  locale: Locale,
  messages: FrozenLandingMessages,
  canonical: string,
  socialImage: string,
) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(),
      websiteNode(),
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: messages.meta.title,
        description: messages.meta.description,
        inLanguage: locale,
        isPartOf: { "@id": WEBSITE_ID },
        publisher: { "@id": ORGANIZATION_ID },
        primaryImageOfPage: socialImage,
        about: { "@id": PRODUCT_FACT_ID },
      },
      {
        "@type": "Thing",
        "@id": PRODUCT_FACT_ID,
        name: "WatchDive",
        description: messages.faq.a1,
        disambiguatingDescription: messages.faq.a2,
        image: socialImage,
      },
    ],
  };
}

export function legalStructuredData(
  locale: Locale,
  document: "privacy" | "terms",
  messages: FrozenLandingMessages,
  canonical: string,
) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationNode(),
      websiteNode(),
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: messages[document].metaTitle,
        description: messages[document].metaDescription,
        inLanguage: locale,
        isPartOf: { "@id": WEBSITE_ID },
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

export function structuredDataScript(value: { "@graph": readonly Record<string, unknown>[] }) {
  return {
    type: "application/ld+json",
    children: jsonLdScript({
      "@context": "https://schema.org",
      "@graph": value["@graph"],
    }),
  };
}
