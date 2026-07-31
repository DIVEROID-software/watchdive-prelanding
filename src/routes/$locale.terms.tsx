import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { legalHead } from "@/lib/i18n/seo";
import { TermsPage } from "@/routes/terms";

export const Route = createFileRoute("/$locale/terms")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    if (locale === "en") throw redirect({ to: "/terms" });
    return { locale };
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? legalHead(locale, "terms", match.context.messages) : {};
  },
  component: TermsPage,
});
