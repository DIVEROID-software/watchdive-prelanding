import { createFileRoute, useParams } from "@tanstack/react-router";

import { StatusPage } from "@/components/referral/StatusPage";
import { BUDDY_PAGE_META, requireReferralProgram } from "@/lib/api/referral.functions";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import { referralCopy } from "@/lib/referral/copy";

// The private Buddy Invite page. The signed token is a path segment, so the
// page must never be indexed and must never hand its URL on as a Referer.
// Until the owner switches the program on, the page does not exist (404).

export const Route = createFileRoute("/buddy/$token")({
  loader: () => requireReferralProgram(),
  head: () => ({ meta: [{ title: referralCopy("en").status.title }, ...BUDDY_PAGE_META] }),
  component: BuddyStatusRoute,
});

export function BuddyStatusRoute() {
  const locale = useCurrentLocale();
  // Not strict: the same component serves /buddy/$token and /$locale/buddy/$token.
  const { token } = useParams({ strict: false }) as { token?: string };
  return <StatusPage token={token ?? ""} locale={locale} />;
}
