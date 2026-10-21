import { createFileRoute, notFound } from "@tanstack/react-router";

import { getReferralProgramState } from "@/lib/api/referral.functions";
import { RulesPage } from "@/components/referral/RulesPage";
import { localizePath, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/locale";
import { absoluteWatchDivePath } from "@/lib/i18n/seo";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
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

/** The rules page is part of the program: 404 until the owner turns it on. */
export async function requireReferralProgram() {
  const state = await getReferralProgramState().catch(() => ({ enabled: false }));
  if (!state.enabled) throw notFound();
}

export const Route = createFileRoute("/buddy-rules")({
  beforeLoad: requireReferralProgram,
  head: () => buddyRulesHead("en"),
  component: BuddyRulesRoute,
});

export function BuddyRulesRoute() {
  // The back link goes home, so it carries the site's reviewed home label (the
  // status page uses the same one), not the program name.
  const back = useFrozenLandingMessages().verify.back;
  return <RulesPage locale={useCurrentLocale()} back={back} />;
}
