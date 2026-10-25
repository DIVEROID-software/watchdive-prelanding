import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/freediving')({
  loader: () => loadSegmentLanding('en'),
  head: () => segmentHead('en', 'freediving'),
  component: () => <SegmentLanding segment="freediving" />,
});
