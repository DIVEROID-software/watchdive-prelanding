// The numbers every Buddy Invite string interpolates, taken only from
// program.ts, so copy can never state a threshold the ledger does not enforce.
//
// Per-call placeholders ({count} {remaining} {tier} {nickname} {time}
// {reward}) are filled by the caller. `{hours}` defaults to the first tier's
// lead time; a tier-specific string (the Buddy reward line, the status page's
// early-notice line) must override it — use `tierValues` for tier lines.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";
import {
  CLOSE_NOTICE_DAYS,
  DAILY_CREDIT_CAP,
  EARLY_BIRD_SEATS,
  EARLY_NOTICE_HOURS,
  GUARANTEED_PRICE_USD_CENTS,
  KR_PRIZE_TAX_FREE_KRW,
  KR_PRIZE_WITHHOLDING_RATE,
  LIGHT_VALUE_USD,
  MIN_AGE_KR,
  MIN_AGE_OTHER,
  PRIZE_DELIVERY_BY,
  PRIZE_VALUE_USD,
  LEADER_LIGHT_STOCK,
  NICKNAME_MAX,
  NICKNAME_MIN,
  TOP_PRIZE_WINNERS,
  type ReferralTierId,
} from "./program.ts";

export type CopyValues = {
  hours: number;
  hoursFirst: number;
  hoursBuddy: number;
  price: string;
  seats: number;
  stock: number;
  winners: number;
  cap: number;
  noticeDays: number;
  min: number;
  max: number;
  /** Prize and eligibility facts for the rules (program.ts). */
  lightValue: string;
  prizeValue: string;
  ageKr: number;
  ageOther: number;
  /** Long-stop close, e.g. "2027-01-31 23:59 KST" — locale-neutral on purpose. */
  longStop: string;
  /** "2027-03" — the rules phrase it as "before March 2027" per locale. */
  deliveryBy: string;
  taxFree: string;
  taxRate: number;
};

/**
 * The early-bird price exactly as the landing already writes it in each
 * locale's offer line (`conversionCopy[locale].benefit`): `$149` for en, ko,
 * zh-CN, zh-TW, ja and es; `149 $` for fr and de; `US$ 149` for pt-BR. USD
 * everywhere — the reward is the Kickstarter USD price, never a local estimate.
 */
export function formatOfferPrice(
  locale: Locale,
  cents: number = GUARANTEED_PRICE_USD_CENTS,
): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("USD cents must be a non-negative integer");
  const amount = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  switch (locale) {
    case "fr":
    case "de":
      return `${amount} $`;
    case "pt-BR":
      return `US$ ${amount}`;
    default:
      return `$${amount}`;
  }
}

export function copyValues(locale: Locale): CopyValues {
  return {
    hours: EARLY_NOTICE_HOURS.first,
    hoursFirst: EARLY_NOTICE_HOURS.first,
    hoursBuddy: EARLY_NOTICE_HOURS.buddy,
    price: formatOfferPrice(locale),
    seats: EARLY_BIRD_SEATS,
    stock: LEADER_LIGHT_STOCK,
    winners: TOP_PRIZE_WINNERS,
    cap: DAILY_CREDIT_CAP,
    noticeDays: CLOSE_NOTICE_DAYS,
    min: NICKNAME_MIN,
    max: NICKNAME_MAX,
    lightValue: formatOfferPrice(locale, LIGHT_VALUE_USD * 100),
    prizeValue: formatOfferPrice(locale, PRIZE_VALUE_USD * 100),
    ageKr: MIN_AGE_KR,
    ageOther: MIN_AGE_OTHER,
    longStop: "2027-01-31 23:59 KST",
    deliveryBy: PRIZE_DELIVERY_BY,
    taxFree: `KRW ${KR_PRIZE_TAX_FREE_KRW.toLocaleString("en-US")}`,
    taxRate: Math.round(KR_PRIZE_WITHHOLDING_RATE * 100),
  };
}

/** copyValues with `{hours}` set to that tier's lead time, for a tier's reward line. */
export function tierValues(locale: Locale, tier: ReferralTierId): CopyValues {
  return { ...copyValues(locale), hours: EARLY_NOTICE_HOURS[tier] };
}
