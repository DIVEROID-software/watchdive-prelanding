import { earlyBirdRace } from "@/lib/earlyBirdRace";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

/**
 * "$149 for the first 100 Kickstarter backers at launch."
 *
 * Form-first only: sits directly above the hero email field in place of the
 * benefit line. Control is left as on production, where an added line pushed
 * the desktop submit button below a 900px fold.
 */
export function EarlyBirdRace() {
  const m = useFrozenLandingMessages();
  const locale = useCurrentLocale();
  return <p className="wd-experiment-copy wd-race">{earlyBirdRace(locale, m.hero.nowPrice)}</p>;
}
