import { useMemo } from "react";

import {
  BETA_REVIEWS,
  COUNTRY_LABEL,
  PUBLISHABLE_REVIEWS,
  type BetaReview,
} from "@/data/beta-reviews";

// Two lanes drifting in opposite directions read as motion rather than as one
// long list scrolling past. Each lane renders its reviews twice and translates
// by exactly half the track, so the loop closes with no visible seam.
const LANES = 2;

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-xs tracking-[0.12em] text-[color:var(--color-cyan-glow)]">
      {"★".repeat(rating)}
      <span className="text-white/20">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function Card({ review }: { review: BetaReview }) {
  return (
    <figure className="flex w-[19rem] shrink-0 flex-col gap-3 rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur sm:w-[22rem]">
      <Stars rating={review.rating} />
      <blockquote className="text-sm leading-relaxed text-white/85">{review.en}</blockquote>
      <figcaption className="mt-auto text-xs text-white/50">
        <span className="font-semibold text-white/75">{review.name}</span>
        {" · "}
        {review.city}, {COUNTRY_LABEL[review.country]}
      </figcaption>
    </figure>
  );
}

function Lane({ reviews, reverse }: { reviews: BetaReview[]; reverse: boolean }) {
  // Duration scales with the number of cards so lanes of different lengths move
  // at the same apparent speed rather than the same lap time.
  const seconds = reviews.length * 9;

  return (
    <div className="group relative overflow-hidden">
      <div
        className="flex w-max gap-4 motion-safe:animate-[wd-marquee_var(--wd-marquee-duration)_linear_infinite] group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
        style={
          {
            "--wd-marquee-duration": `${seconds}s`,
            animationDirection: reverse ? "reverse" : "normal",
          } as React.CSSProperties
        }
      >
        {[...reviews, ...reviews].map((review, index) => (
          <Card key={`${review.id}-${index}`} review={review} />
        ))}
      </div>
    </div>
  );
}

/**
 * Beta tester reviews, drifting.
 *
 * The motion is decorative: `motion-safe` drops it entirely for anyone who asks
 * for reduced motion, and hovering or tabbing into a lane pauses it so a card
 * can actually be read. The reviews themselves stay in the document either way,
 * so a screen reader gets the list rather than an animation.
 */
export function ReviewTicker() {
  const lanes = useMemo(() => {
    const size = Math.ceil(PUBLISHABLE_REVIEWS.length / LANES);
    return Array.from({ length: LANES }, (_, lane) =>
      PUBLISHABLE_REVIEWS.slice(lane * size, (lane + 1) * size),
    ).filter((lane) => lane.length > 0);
  }, []);

  if (lanes.length === 0) return null;

  return (
    <section
      id="beta-reviews"
      className="relative overflow-hidden bg-[color:var(--color-deep-2)] py-16 sm:py-20"
      aria-labelledby="beta-reviews-heading"
    >
      <div className="mx-auto max-w-6xl px-5">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-cyan-glow)]">
          From our beta testers
        </p>
        <h2
          id="beta-reviews-heading"
          className="mt-3 text-center text-2xl font-bold text-white sm:text-3xl"
        >
          {PUBLISHABLE_REVIEWS.length} divers have already been in the water with it
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed text-white/60">
          Reviews from the beta programme, translated from each tester&rsquo;s own language.
        </p>
        {/* Saying what is missing is what makes the rest believable, and keeps
            the set honestly representative rather than curated for praise. */}
        <p className="mx-auto mt-2 max-w-xl text-center text-xs leading-relaxed text-white/40">
          Showing {PUBLISHABLE_REVIEWS.length} of {BETA_REVIEWS.length}. The rest mention product
          details we have not finished verifying, so we are holding them back until we have.
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-4">
        {lanes.map((lane, index) => (
          <Lane key={index} reviews={lane} reverse={index % 2 === 1} />
        ))}
      </div>

      {/* Fades the lanes into the section edges instead of cutting cards dead. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[color:var(--color-deep-2)] to-transparent sm:w-28" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[color:var(--color-deep-2)] to-transparent sm:w-28" />
    </section>
  );
}
