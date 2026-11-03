import { createFileRoute } from '@tanstack/react-router';
import { SegmentLanding } from '@/components/segments/SegmentLanding';
import { localeFromPathSegment } from '@/lib/i18n/locale';
import { LocalizedBetaReviewBodiesProvider } from '@/lib/i18n/use-current-locale';
import { loadSegmentLanding, segmentHead } from '@/lib/segments/route';

export const Route = createFileRoute('/$locale/freediving')({
  loader: ({ params }) => loadSegmentLanding(localeFromPathSegment(params.locale) ?? 'en'),
  head: ({ params, match }) => segmentHead(localeFromPathSegment(params.locale) ?? 'en', 'freediving', match.context.messages),
  component: LocaleFreedivingSegmentPage,
});

function LocaleFreedivingSegmentPage() {
  const { reviewBodies } = Route.useLoaderData();
  return <LocalizedBetaReviewBodiesProvider reviewBodies={reviewBodies}>
    <SegmentLanding segment="freediving" />
  </LocalizedBetaReviewBodiesProvider>;
}
