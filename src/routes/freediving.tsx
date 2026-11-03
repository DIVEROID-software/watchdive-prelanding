import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { LocalizedBetaReviewBodiesProvider } from '@/lib/i18n/use-current-locale';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/freediving')({
  loader: () => loadSegmentLanding('en'),
  head: () => segmentHead('en', 'freediving'),
  component: FreedivingSegmentPage,
});

function FreedivingSegmentPage() {
  const { reviewBodies } = Route.useLoaderData();
  return <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
    <SegmentLanding segment="freediving" />
  </LocalizedBetaReviewBodiesProvider>;
}
