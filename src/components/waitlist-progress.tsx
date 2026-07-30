import { useQuery } from "@tanstack/react-query";

import { getWaitlistCount } from "@/lib/api/waitlist.functions";
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
  const scarce = progress.remaining <= LOW_REMAINING_THRESHOLD;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-white">
          <span className="text-[color:var(--color-cyan-glow)]">{formatCount(progress.total)}</span>
          <span className="text-white/60"> / {formatCount(progress.cap)} divers</span>
        </p>
        <p
          className={`text-xs font-semibold ${
            scarce ? "text-[color:var(--color-cyan-glow)]" : "text-white/55"
          }`}
        >
          {progress.full ? "List closed" : `${formatCount(progress.remaining)} spots left`}
        </p>
      </div>

      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/12"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.cap}
        aria-valuenow={progress.total}
        aria-label="Pre-launch waitlist places taken"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[color:var(--color-cyan)] to-[color:var(--color-cyan-glow)] transition-[width] duration-700 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
        The waitlist is capped at {formatCount(progress.cap)} divers and closes when it is full.
      </p>
    </div>
  );
}
