import { createFileRoute } from "@tanstack/react-router";

import { StatusPage } from "@/components/referral/StatusPage";
import { BUDDY_PAGE_META, requireReferralProgram } from "@/lib/api/referral.functions";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import { referralCopy } from "@/lib/referral/copy";

// The private Buddy Invite page. The signed token is in the URL fragment
// (`/buddy#<token>`), which the browser never sends, so the path the server,
// CDN and analytics see carries nothing personal. The page still sets
// no-referrer and noindex. Until the owner switches the program on, the page
// does not exist (404).

export const Route = createFileRoute("/buddy")({
  loader: () => requireReferralProgram(),
  head: () => ({ meta: [{ title: referralCopy("en").status.title }, ...BUDDY_PAGE_META] }),
  component: BuddyStatusRoute,
});

export function BuddyStatusRoute() {
  return <StatusPage locale={useCurrentLocale()} />;
}
