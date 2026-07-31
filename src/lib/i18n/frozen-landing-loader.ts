import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from "./frozen-landing-en";
import type { Locale } from "./locale";

/**
 * Keep translated copy behind a real module boundary. The canonical English
 * route synchronously uses its small default catalog; only a matched localized
 * route downloads the review-gated translation catalog.
 */
export async function loadFrozenLandingMessages(locale: Locale): Promise<FrozenLandingMessages> {
  if (locale === "en") return EN_FROZEN_LANDING_MESSAGES;

  const { FROZEN_LANDING_MESSAGES } = await import("./frozen-landing-messages");
  return FROZEN_LANDING_MESSAGES[locale];
}
