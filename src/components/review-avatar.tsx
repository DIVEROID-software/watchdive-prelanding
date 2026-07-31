import type { BetaReview } from "@/data/beta-reviews";
import { avatarSrc, avatarTone, initials } from "@/lib/reviewAvatar";

/**
 * The small circle beside a reviewer's name.
 *
 * Decorative in both forms: the name it belongs to is the next thing in the
 * caption, so `alt=""` keeps a screen reader from reading every reviewer twice.
 *
 * One component for both the hero proof cards and the ticker, because the two
 * differ only in diameter and the rule about which faces may appear is not a
 * thing to state twice.
 */
export function ReviewAvatar({ review, px = 28 }: { review: BetaReview; px?: number }) {
  const src = avatarSrc(review);
  // Tailwind cannot build a class from a runtime number, and this is the one
  // property that genuinely varies per placement.
  const size = { width: px, height: px };

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        style={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-white/15"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ ...size, backgroundColor: avatarTone(review.name), fontSize: Math.round(px * 0.36) }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold leading-none tracking-[0.02em] text-white/85 ring-1 ring-white/15"
    >
      {initials(review.name)}
    </span>
  );
}
