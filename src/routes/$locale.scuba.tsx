import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';
import { localeFromPathSegment } from '@/lib/i18n/locale';

export const Route = createFileRoute('/$locale/scuba')({
  loader: ({ params }) => loadSegmentLanding(localeFromPathSegment(params.locale) ?? 'en'),
  head: ({ params, match }) => segmentHead(localeFromPathSegment(params.locale) ?? 'en', 'scuba', match.context.messages),
  component: () => <SegmentLanding segment="scuba" />,
});
