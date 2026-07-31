import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { getWaitlistCount } from "@/lib/api/waitlist.functions";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { formatCount, LOW_REMAINING_THRESHOLD, waitlistProgress } from "@/lib/waitlistProgress";

/**
 * How full the pre-launch list is.
 *
 * The live count comes from the server; the off-platform baseline is a recorded
 * constant. `justJoined` bumps the figure by one for the person who just
 * confirmed, so their own signup is visible immediately instead of waiting for
 * the next poll — the server figure catches up on its own.
 */
export function WaitlistProgress({
  justJoined = 0,
  className = "",
}: {
  justJoined?: number;
  className?: string;
}) {
  const messages = useFrozenLandingMessages().progress;
  const { data } = useQuery({
    queryKey: ["waitlist-count"],
    queryFn: () => getWaitlistCount(),
    // Social proof does not need to be to-the-second, and this query is served
    // from a rate-limited CRM. One fetch a minute is plenty.
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const progress = waitlistProgress((data?.count ?? 0) + justJoined);

  // The bar fills once, on arrival, so the number reads as something that grew
  // rather than as decoration. Every later refresh just moves it a little, and
  // the transition on the element handles that without a second reveal.
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (revealed) return;
    timer.current = window.setTimeout(() => setRevealed(true), 120);
    return () => window.clearTimeout(timer.current);
  }, [revealed]);
  const scarce = progress.remaining <= LOW_REMAINING_THRESHOLD;
  const countLineTail = messages.countLine
    .replace("{total}", "")
    .replace("{cap}", formatCount(progress.cap));

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          <span className="text-[color:var(--color-cyan-glow)]">{formatCount(progress.total)}</span>
          <span className="text-white/60">{countLineTail}</span>
        </p>
        <p
          className={`text-xs font-semibold ${
            scarce ? "text-[color:var(--color-cyan-glow)]" : "text-white/55"
          }`}
        >
          {progress.full
            ? messages.closedLabel
            : messages.spotsLeft.replace("{remaining}", formatCount(progress.remaining))}
        </p>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/12"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.cap}
        aria-valuenow={progress.total}
        aria-label={messages.aria}
      >
        <div
          // scaleX rather than width: animating width relayouts and repaints
          // every frame, which is the cost this page just spent a day removing.
          // A transform stays on the compositor.
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[color:var(--color-cyan)] to-[color:var(--color-cyan-glow)] transition-transform duration-700 ease-out"
          style={{ transform: `scaleX(${revealed ? progress.percent / 100 : 0})` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
        {messages.capNote.replace("{cap}", formatCount(progress.cap))}
      </p>
    </div>
  );
}
