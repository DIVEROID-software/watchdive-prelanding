import { earlyBirdRace } from "@/lib/earlyBirdRace";
import {
  useCurrentLocale,
  useFrozenLandingMessages,
  useLandingPriceClaim,
} from "@/lib/i18n/use-current-locale";

/**
 * "$149 for the first 100 Kickstarter backers at launch."
 *
 * Form-first only: sits directly above the hero email field in place of the
 * benefit line. Control is left as on production, where an added line pushed
 * the desktop submit button below a 900px fold.
 *
 * While Buddy Invite is on, the line also names the price-reservation and
 * Dive Team exceptions (price-claim.ts), so "first 100" stays true.
 */
export function EarlyBirdRace() {
  const m = useFrozenLandingMessages();
  const locale = useCurrentLocale();
  const claim = useLandingPriceClaim();
  return (
    <p className="wd-experiment-copy wd-race">
      {earlyBirdRace(locale, m.hero.nowPrice, claim?.earlyBirdRace)}
    </p>
  );
}
