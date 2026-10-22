import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadLocalizedBetaReviewBodies } from "@/data/beta-reviews.loader";
import { loadWaitlistCount } from "@/lib/api/waitlist.functions";
import { localeFromPathSegment, type Locale } from "@/lib/i18n/locale";
import { applyPriceClaim, priceClaimFromLoaderData } from "@/lib/i18n/price-claim";
import { loadReferralPriceClaim } from "@/lib/i18n/price-claim-loader";
import { landingHead } from "@/lib/i18n/seo";
import { readLiteMediaHint } from "@/lib/liteMedia";
import { LocalizedBetaReviewBodiesProvider } from "@/lib/i18n/use-current-locale";
import { DesignFrozenLanding } from "@/routes/index";

export const Route = createFileRoute("/$locale/")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (locale === "en") throw redirect({ to: "/" });
  },
  loader: async ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    const [reviewBodies, waitlistCount, claim] = await Promise.all([
      loadReviewBodies(locale),
      // Rendered on the server so the list figure does not change after load.
      loadWaitlistCount(),
      // Present only while Buddy Invite is on (price-claim.ts).
      loadReferralPriceClaim(locale),
    ]);
    return { reviewBodies, waitlistCount, liteMedia: readLiteMediaHint(), ...claim };
  },
  head: ({ match, params, loaderData }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) return {};
    const claim = priceClaimFromLoaderData(loaderData);
    if (!claim) return landingHead(locale, match.context.messages);
    return landingHead(locale, applyPriceClaim(match.context.messages, claim));
  },
  component: LocalizedDesignFrozenLanding,
});

async function loadReviewBodies(locale: Locale | undefined) {
  if (!locale || locale === "en") return undefined;
  try {
    return await loadLocalizedBetaReviewBodies(locale);
  } catch (error) {
    console.error(`Unable to load ${locale} beta-review translations`, error);
    return undefined;
  }
}

function LocalizedDesignFrozenLanding() {
  const { reviewBodies } = Route.useLoaderData();
  return (
    <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
      <DesignFrozenLanding />
    </LocalizedBetaReviewBodiesProvider>
  );
}
