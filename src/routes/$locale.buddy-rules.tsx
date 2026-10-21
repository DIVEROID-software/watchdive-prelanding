import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { BuddyRulesRoute, buddyRulesHead } from "@/routes/buddy-rules";

export const Route = createFileRoute("/$locale/buddy-rules")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    if (locale === "en") throw redirect({ to: "/buddy-rules" });
    return { locale };
  },
  head: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    return locale ? buddyRulesHead(locale) : {};
  },
  component: BuddyRulesRoute,
});
