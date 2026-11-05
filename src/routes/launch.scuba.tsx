import { createFileRoute } from '@tanstack/react-router';
import { AirySegmentLanding } from '@/components/segments/AirySegmentLanding';
import { LocalizedBetaReviewBodiesProvider } from '@/lib/i18n/use-current-locale';
import { loadSegmentLanding, launchSegmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/launch/scuba')({
  loader: () => loadSegmentLanding('en'),
  head: () => launchSegmentHead('en', 'scuba'),
  component: LaunchSegmentPage,
});

function LaunchSegmentPage() {
  const { reviewBodies } = Route.useLoaderData();
  return <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
    <AirySegmentLanding segment="scuba" />
  </LocalizedBetaReviewBodiesProvider>;
}
