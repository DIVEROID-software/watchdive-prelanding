import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { legalHead } from "@/lib/i18n/seo";
import { PrivacyPage } from "@/routes/privacy";

export const Route = createFileRoute("/$locale/privacy")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    if (locale === "en") throw redirect({ to: "/privacy" });
    return { locale };
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? legalHead(locale, "privacy", match.context.messages) : {};
  },
  component: PrivacyPage,
});
