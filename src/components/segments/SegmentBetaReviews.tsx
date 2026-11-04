import { ReviewAvatar } from '@/components/review-avatar';
import { PUBLISHABLE_REVIEWS, type BetaReview } from '@/data/beta-reviews';
import { betaReviewBody } from '@/data/beta-reviews.loader';
import { useCurrentLocale, useFrozenLandingMessages, useLocalizedBetaReviewBodies } from '@/lib/i18n/use-current-locale';
import { segmentBetaCopy } from '@/lib/segments/beta-review-copy';

/** Four notes stay open. The other approved notes are in the page once, behind the disclosure. */
const VISIBLE_REVIEW_COUNT = 4;

function Quote({ review, body, country }: { review: BetaReview; body: string; country: string }) {
  return <figure data-review-id={review.id}>
    <blockquote>{body}</blockquote>
    <figcaption>
      <ReviewAvatar review={review} />
      <span>{review.name} · {review.city}, {country}</span>
    </figcaption>
  </figure>;
}

/** Approved beta-test notes. No average score, and no unpublished review. */
export function SegmentBetaReviews() {
  const beta = segmentBetaCopy(useCurrentLocale());
  const messages = useFrozenLandingMessages();
  const reviews = messages.reviews;
  const bodies = useLocalizedBetaReviewBodies();
  const country = {
    US: reviews.countryUS,
    UK: reviews.countryUK,
    KR: reviews.countryKR,
    SG: reviews.countrySG,
  };
  const visible = PUBLISHABLE_REVIEWS.slice(0, VISIBLE_REVIEW_COUNT);
  const rest = PUBLISHABLE_REVIEWS.slice(VISIBLE_REVIEW_COUNT);
  const quote = (review: BetaReview) => <Quote key={review.id} review={review} body={betaReviewBody(review, bodies)} country={country[review.country]} />;
  return <section id="beta-reviews" className="wd-segment-reviews wd-segment-shell" aria-labelledby="beta-reviews-heading">
    <h2 id="beta-reviews-heading">{beta.title}</h2>
    <p className="wd-segment-review-note">{beta.context}</p>
    <p className="wd-segment-review-note">{reviews.sub}</p>
    <div className="wd-segment-review-list">{visible.map(quote)}</div>
    {rest.length > 0 && <details className="wd-segment-review-more">
      <summary>{beta.more}<span aria-hidden="true">+</span></summary>
      <div className="wd-segment-review-list">{rest.map(quote)}</div>
    </details>}
  </section>;
}
