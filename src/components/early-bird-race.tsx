import { earlyBirdRace } from "@/lib/earlyBirdRace";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

/**
 * "$149 for the first 100 Kickstarter backers at launch."
 *
 * Sits directly above the hero email field in both layouts. In form-first it
 * replaces the benefit line; in control it follows the price block.
 */
export function EarlyBirdRace() {
  const m = useFrozenLandingMessages();
  const locale = useCurrentLocale();
  return <p className="wd-race">{earlyBirdRace(locale, m.hero.nowPrice)}</p>;
}
