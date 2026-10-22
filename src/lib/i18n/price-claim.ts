// The early-bird price claim while Buddy Invite is switched on.
//
// With the program off, the page says "$149 for the first 100 Kickstarter
// backers". With it on, a Dive Team member keeps $149 through a private
// Kickstarter link after those 100 are gone (program.ts), so the bare "first
// 100" line would be a false limited-availability claim (claims review,
// BLOCKER 1; owner decision D1(a), 2026-10-22). The switched-on page therefore
// names the exceptions wherever it states the limit, and its short labels
// drop the number instead.
//
// The replacement strings travel as route loader data, resolved on the server
// for the request (see price-claim-loader.ts). That keeps three things true:
//   - switch off: no loader key, no new string, the same catalog objects, so
//     every page renders and serializes exactly as before;
//   - switch on: the server render already carries the disclosed copy, so
//     there is no hydration mismatch and no text swap after load;
//   - the translations stay out of the initial JavaScript bundle.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { FrozenLandingMessages } from "./frozen-landing-en.ts";

type Pick2<S extends keyof FrozenLandingMessages, K extends keyof FrozenLandingMessages[S]> = Pick<
  FrozenLandingMessages[S],
  K
>;

/** Every catalog string the landing renders that states or implies "first 100". */
export type LandingPriceClaim = {
  meta: Pick2<"meta", "description" | "ogDescription" | "twitterDescription">;
  cta: Pick2<"cta", "label">;
  referral: Pick2<"referral", "shareText">;
  usp: Pick2<"usp", "priceTitle">;
  hero: Pick2<"hero", "offNote">;
  value: Pick2<"value", "h2">;
  offer: Pick2<"offer", "kicker" | "lead">;
};

export type PriceClaim = {
  landing: LandingPriceClaim;
  /** Replaces `conversionCopy[locale].terms` (under both experiment forms). */
  conversionTerms: string;
  /** Replaces `earlyBirdRaceCopy[locale]`; keeps the `{price}` placeholder. */
  earlyBirdRace: string;
  /** Replaces `phoneOptInCopy[locale].terms` on the post-signup SMS card. */
  phoneTerms: string;
};

/**
 * The catalog with the switched-on claim laid over it. Without a claim the
 * very same object comes back, so the switched-off page cannot drift.
 */
export function applyPriceClaim(
  messages: FrozenLandingMessages,
  claim: PriceClaim | undefined,
): FrozenLandingMessages {
  if (!claim) return messages;
  const { landing } = claim;
  return {
    ...messages,
    meta: { ...messages.meta, ...landing.meta },
    cta: { ...messages.cta, ...landing.cta },
    referral: { ...messages.referral, ...landing.referral },
    usp: { ...messages.usp, ...landing.usp },
    hero: { ...messages.hero, ...landing.hero },
    value: { ...messages.value, ...landing.value },
    offer: { ...messages.offer, ...landing.offer },
  };
}

/** A copy record whose `terms` line is replaced while the claim is on. */
export function withClaimTerms<T extends { terms: string }>(copy: T, terms: string | undefined): T {
  return terms === undefined ? copy : { ...copy, terms };
}

/** The loader-data shape: the key is absent, not null, while the switch is off. */
export type PriceClaimLoaderData = { priceClaim?: PriceClaim };

/** Reads a loader's claim without trusting the shape of unrelated loader data. */
export function priceClaimFromLoaderData(data: unknown): PriceClaim | undefined {
  if (!data || typeof data !== "object" || !("priceClaim" in data)) return undefined;
  const claim = (data as PriceClaimLoaderData).priceClaim;
  return claim && typeof claim === "object" && "landing" in claim ? claim : undefined;
}
