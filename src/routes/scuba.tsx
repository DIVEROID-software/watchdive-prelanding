import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/scuba')({
  loader: () => loadSegmentLanding('en'),
  head: () => segmentHead('en', 'scuba'),
  component: () => <SegmentLanding segment="scuba" />,
});
