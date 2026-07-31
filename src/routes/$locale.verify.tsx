import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { VerifyPage } from "@/routes/verify";

export const Route = createFileRoute("/$locale/verify")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    if (locale === "en") throw redirect({ to: "/verify" });
    return { locale };
  },
  head: ({ match, params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) return {};
    const copy = match.context.messages.verify;
    return {
      meta: [
        { title: copy.metaTitle },
        { name: "description", content: copy.metaDescription },
        { name: "referrer", content: "no-referrer" },
        { name: "robots", content: "noindex, nofollow, noarchive" },
      ],
    };
  },
  component: VerifyPage,
});
