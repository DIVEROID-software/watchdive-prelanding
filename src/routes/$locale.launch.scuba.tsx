import { createFileRoute } from '@tanstack/react-router';
import { AirySegmentLanding } from '@/components/segments/AirySegmentLanding';
import { localeFromPathSegment } from '@/lib/i18n/locale';
import { LocalizedBetaReviewBodiesProvider } from '@/lib/i18n/use-current-locale';
import { loadSegmentLanding, launchSegmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/$locale/launch/scuba')({
  loader: ({ params }) => loadSegmentLanding(localeFromPathSegment(params.locale) ?? 'en'),
  head: ({ params, match }) => launchSegmentHead(localeFromPathSegment(params.locale) ?? 'en', 'scuba', match.context.messages),
  component: LaunchSegmentPage,
});

function LaunchSegmentPage() {
  const { reviewBodies } = Route.useLoaderData();
  return <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
    <AirySegmentLanding segment="scuba" />
  </LocalizedBetaReviewBodiesProvider>;
}
