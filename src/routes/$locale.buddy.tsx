import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { referralCopy } from "@/lib/referral/copy";
import { BUDDY_PAGE_META, requireReferralProgram } from "@/lib/api/referral.functions";
import { BuddyStatusRoute } from "@/routes/buddy";

export const Route = createFileRoute("/$locale/buddy")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    // A redirect Location without a fragment keeps the request's fragment
    // (RFC 9110 §10.2.2), so `/en/buddy#<token>` still lands with its token.
    if (locale === "en") throw redirect({ to: "/buddy" });
    return { locale };
  },
  loader: () => requireReferralProgram(),
  head: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    return {
      meta: [{ title: referralCopy(locale ?? "en").status.title }, ...BUDDY_PAGE_META],
    };
  },
  component: BuddyStatusRoute,
});
