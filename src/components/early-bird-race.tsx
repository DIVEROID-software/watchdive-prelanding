import { earlyBirdRace, earlyBirdRaceHighlight } from "@/lib/earlyBirdRace";
import {
  useCurrentLocale,
  useFrozenLandingMessages,
} from "@/lib/i18n/use-current-locale";

/** Owner-approved 2026-10-23: the same first-100/next-tier line in both switches. */
export function EarlyBirdRace() {
  const m = useFrozenLandingMessages();
  const locale = useCurrentLocale();
  const line = earlyBirdRace(locale, m.hero.nowPrice);
  const highlight = earlyBirdRaceHighlight[locale];
  const start = line.indexOf(highlight);
  return (
    <p className="wd-experiment-copy wd-race">
      {line.slice(0, start)}
      <mark className="wd-race-marker">{highlight}</mark>
      {line.slice(start + highlight.length)}
    </p>
  );
}
