import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { localeFromPathSegment } from "@/lib/i18n/locale";
import { referralCopy } from "@/lib/referral/copy";
import { BUDDY_PAGE_META, requireReferralProgram } from "@/lib/api/referral.functions";
import { BuddyStatusRoute } from "@/routes/buddy.$token";

export const Route = createFileRoute("/$locale/buddy/$token")({
  beforeLoad: ({ params }) => {
    const locale = localeFromPathSegment(params.locale);
    if (!locale) throw notFound();
    if (locale === "en") throw redirect({ to: "/buddy/$token", params: { token: params.token } });
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
