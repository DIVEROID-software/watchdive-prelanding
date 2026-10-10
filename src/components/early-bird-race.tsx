import { useWaitlistCount } from "@/components/waitlist-progress";
import { earlyBirdRace } from "@/lib/earlyBirdRace";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { waitlistProgress } from "@/lib/waitlistProgress";

/**
 * "Only the first 100 backers get $149. · 26,372 divers already waiting"
 *
 * Sits directly above the hero email field in both layouts. The dot pulses
 * because the figure beside it is live (refreshed once a minute, the same
 * figure as the progress bar); it stays still for reduced motion. Without a
 * readable count only the price line shows.
 */
export function EarlyBirdRace({ className = "" }: { className?: string }) {
  const m = useFrozenLandingMessages();
  const locale = useCurrentLocale();
  const liveCount = useWaitlistCount();
  const total = liveCount === undefined ? undefined : waitlistProgress(liveCount).total;
  const { lead, waiting } = earlyBirdRace(locale, m.hero.nowPrice, total);
  return (
    <div className={`wd-race ${className}`}>
      <p className="wd-race-lead">{lead}</p>
      {waiting && (
        <p className="wd-race-waiting">
          <span className="wd-live-dot" aria-hidden />
          {waiting}
        </p>
      )}
    </div>
  );
}
