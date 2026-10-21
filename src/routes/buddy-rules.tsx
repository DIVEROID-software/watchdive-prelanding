import { createFileRoute } from "@tanstack/react-router";

import { RulesPage } from "@/components/referral/RulesPage";
import { localizePath, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locale";
import { absoluteWatchDivePath } from "@/lib/i18n/seo";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import { referralCopy } from "@/lib/referral/copy";

const rulesPath = (locale: Locale) => localizePath("/buddy-rules", locale);

/** Rules are indexable. Titles come from the referral copy, not the frozen landing catalog. */
export function buddyRulesHead(locale: Locale) {
  const copy = referralCopy(locale);
  const canonical = absoluteWatchDivePath(rulesPath(locale));
  return {
    meta: [
      { title: copy.rules.title },
      { name: "description", content: copy.card.body },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: copy.rules.title },
      { property: "og:description", content: copy.card.body },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
    ],
    links: [
      { rel: "canonical", href: canonical },
      ...SUPPORTED_LOCALES.map((alternate) => ({
        rel: "alternate" as const,
        hrefLang: alternate,
        href: absoluteWatchDivePath(rulesPath(alternate)),
      })),
      { rel: "alternate" as const, hrefLang: "x-default", href: absoluteWatchDivePath(rulesPath("en")) },
    ],
  };
}

export const Route = createFileRoute("/buddy-rules")({
  head: () => buddyRulesHead("en"),
  component: BuddyRulesRoute,
});

export function BuddyRulesRoute() {
  return <RulesPage locale={useCurrentLocale()} />;
}
