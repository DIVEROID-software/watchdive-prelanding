import { useEffect, useMemo, useRef, useState } from "react";

import {
  BETA_REVIEWS,
  COUNTRY_LABEL,
  PUBLISHABLE_REVIEWS,
  type BetaReview,
} from "@/data/beta-reviews";
import { ReviewAvatar } from "@/components/review-avatar";

// Two lanes drifting in opposite directions read as motion rather than as one
// long list scrolling past. Each lane renders its reviews twice and translates
// by exactly half the track, so the loop closes with no visible seam.
const LANES = 2;

/**
 * How many cards each lane renders before the section is anywhere near the
 * viewport.
 *
 * Every card is server-rendered HTML on a page paid traffic lands on, and the
 * loop needs each lane duplicated, so the full set was tripling the document
 * for a section most visitors never scroll to. Meta only counts a landing page
 * view once the page actually loads, so that weight was being paid for in the
 * exact metric this section exists to improve. Enough to fill a wide lane, then
 * the rest arrives on approach.
 */
const SEED_PER_LANE = 6;

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
      <figcaption className="mt-auto flex items-center gap-2.5 text-xs text-white/50">
        <ReviewAvatar review={review} />
        <span className="min-w-0">
          <span className="font-semibold text-white/75">{review.name}</span>
          {" · "}
          {review.city}, {COUNTRY_LABEL[review.country]}
        </span>
      </figcaption>
    </figure>
  );
}

function Lane({
  reviews,
  reverse,
  running,
}: {
  reviews: BetaReview[];
  reverse: boolean;
  running: boolean;
}) {
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
            // Each lane is a composited layer many screens wide. Left running
            // off-screen it costs GPU and battery on a mid-range phone for
            // something nobody is looking at, so it holds its position instead.
            animationPlayState: running ? "running" : "paused",
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
  const [showAll, setShowAll] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = section.current;
    if (!element || showAll) return;
    // No IntersectionObserver (or an immediate hit) simply means everyone gets
    // the full set — degrading to the previous behaviour, never to less.
    if (typeof IntersectionObserver === "undefined") {
      setShowAll(true);
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        setOnScreen(visible);
        if (visible) setShowAll(true);
      },
      { rootMargin: "600px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lanes = useMemo(() => {
    const source = showAll
      ? PUBLISHABLE_REVIEWS
      : PUBLISHABLE_REVIEWS.slice(0, SEED_PER_LANE * LANES);
    const size = Math.ceil(source.length / LANES);
    return Array.from({ length: LANES }, (_, lane) =>
      source.slice(lane * size, (lane + 1) * size),
    ).filter((lane) => lane.length > 0);
  }, [showAll]);

  if (lanes.length === 0) return null;

  return (
    <section
      ref={section}
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
          <Lane key={index} reviews={lane} reverse={index % 2 === 1} running={onScreen} />
        ))}
      </div>

      {/* Fades the lanes into the section edges instead of cutting cards dead. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[color:var(--color-deep-2)] to-transparent sm:w-28" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[color:var(--color-deep-2)] to-transparent sm:w-28" />
    </section>
  );
}
