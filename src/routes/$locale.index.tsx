import { createFileRoute, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { landingHead } from "@/lib/i18n/seo";
import { DesignFrozenLanding } from "@/routes/index";

export const Route = createFileRoute("/$locale/")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (locale === "en") throw redirect({ to: "/" });
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? landingHead(locale, match.context.messages) : {};
  },
  component: DesignFrozenLanding,
});
