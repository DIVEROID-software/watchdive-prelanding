import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { LocalizedBetaReviewBodiesProvider } from '@/lib/i18n/use-current-locale';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/scuba')({
  loader: () => loadSegmentLanding('en'),
  head: () => segmentHead('en', 'scuba'),
  component: ScubaSegmentPage,
});

function ScubaSegmentPage() {
  const { reviewBodies } = Route.useLoaderData();
  return <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
    <SegmentLanding segment="scuba" />
  </LocalizedBetaReviewBodiesProvider>;
}
