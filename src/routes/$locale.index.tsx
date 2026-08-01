import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadLocalizedBetaReviewBodies } from "@/data/beta-reviews.loader";
import { localeFromPathSegment } from "@/lib/i18n/locale";
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
    if (!locale || locale === "en") return { reviewBodies: undefined };
    try {
      return { reviewBodies: await loadLocalizedBetaReviewBodies(locale) };
    } catch (error) {
      console.error(`Unable to load ${locale} beta-review translations`, error);
      return { reviewBodies: undefined };
    }
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? landingHead(locale, match.context.messages) : {};
  },
  component: LocalizedDesignFrozenLanding,
});

function LocalizedDesignFrozenLanding() {
  const { reviewBodies } = Route.useLoaderData();
  return (
    <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
      <DesignFrozenLanding />
    </LocalizedBetaReviewBodiesProvider>
  );
}
