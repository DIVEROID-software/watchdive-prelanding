import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadLocalizedBetaReviewBodies } from "@/data/beta-reviews.loader";
import { loadWaitlistCount } from "@/lib/api/waitlist.functions";
import { localeFromPathSegment, type Locale } from "@/lib/i18n/locale";
import { landingHead } from "@/lib/i18n/seo";
import { LocalizedBetaReviewBodiesProvider } from "@/lib/i18n/use-current-locale";
import { DesignFrozenLanding } from "@/routes/index";

export const Route = createFileRoute("/$locale/")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (locale === "en") throw redirect({ to: "/" });
  },
  loader: async ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    const [reviewBodies, waitlistCount] = await Promise.all([
      loadReviewBodies(locale),
      // Rendered on the server so the list figure does not change after load.
      loadWaitlistCount(),
    ]);
    return { reviewBodies, waitlistCount };
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? landingHead(locale, match.context.messages) : {};
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
