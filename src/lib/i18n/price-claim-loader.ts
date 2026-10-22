import { getReferralProgramState } from "@/lib/api/referral.functions";

import type { Locale } from "./locale";
import type { PriceClaimLoaderData } from "./price-claim";

/**
 * Route-loader half of the early-bird claim switch (see price-claim.ts).
 *
 * Runs in the server render, so the first HTML already has the right claim
 * and hydration reads the same strings back from the loader data. On a client
 * navigation it asks the same per-request server switch the rules page uses.
 *
 * Off, unreadable or failing: an empty object, so the loader data of every
 * route that spreads this in is exactly what it was before Buddy Invite.
 * The copy module is only fetched once the switch is on.
 */
export async function loadReferralPriceClaim(
  locale: Locale | undefined,
): Promise<PriceClaimLoaderData> {
  if (!locale) return {};
  try {
    const { enabled } = await getReferralProgramState();
    if (enabled !== true) return {};
    const { referralPriceClaim } = await import("./referral-price-claim-copy");
    return { priceClaim: referralPriceClaim(locale) };
  } catch (error) {
    console.error("Unable to resolve the Buddy Invite price claim", error);
    return {};
  }
}

/**
 * For a route that had no loader before Buddy Invite (verify): `undefined`
 * while off, because the router leaves an undefined loader result out of the
 * dehydrated state entirely, so that page's HTML stays byte for byte the same.
 */
export async function loadReferralPriceClaimOnly(
  locale: Locale | undefined,
): Promise<PriceClaimLoaderData | undefined> {
  const data = await loadReferralPriceClaim(locale);
  return data.priceClaim ? data : undefined;
}
