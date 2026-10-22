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
  CREDIT_DAY_TIME_ZONE,
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
  LONG_STOP_CLOSE,
  NICKNAME_MAX,
  NICKNAME_MIN,
  SHARE_CODE_MAX,
  SHARE_CODE_MIN,
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
  /** Share-code bounds (SHARE_CODE_MIN / SHARE_CODE_MAX). Not the nickname bounds. */
  codeMin: number;
  codeMax: number;
  /** Prize and eligibility facts for the rules (program.ts). */
  lightValue: string;
  prizeValue: string;
  ageKr: number;
  ageOther: number;
  /**
   * Long-stop close (LONG_STOP_CLOSE) in Korea Standard Time, written the
   * locale's way with its own time-zone label, e.g. ko "2027년 1월 31일 오후
   * 11시 59분(한국 시간)", en "31 January 2027, 23:59 Korea Standard Time".
   */
  longStop: string;
  /** Delivery month (PRIZE_DELIVERY_BY), e.g. en "March 2027", ko "2027년 3월". */
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

/** The time-zone label each locale's rules already use ("per day (Korea Standard Time)"). */
const KST_LABEL: Record<Locale, string> = {
  en: "Korea Standard Time",
  ko: "한국 시간",
  "zh-CN": "韩国标准时间",
  "zh-TW": "韓國標準時間",
  ja: "韓国標準時",
  es: "hora estándar de Corea",
  fr: "heure normale de Corée",
  de: "koreanische Standardzeit",
  "pt-BR": "horário padrão da Coreia",
};

/** Unpadded year, month, day and 24-hour hour; two-digit minute. */
type KstParts = {
  year: string;
  month: string;
  monthName: string;
  day: string;
  hour: string;
  minute: string;
};

/**
 * The calendar fields of `instant` in Asia/Seoul. Only the month name comes
 * from the locale's Intl data; digits are read in 24-hour form and assembled
 * per locale below, so the server render and the browser's hydration produce
 * the same text whatever spacing a given ICU version puts around times.
 */
function kstParts(locale: Locale, instant: Date): KstParts {
  const tag = locale === "en" ? "en-GB" : locale;
  const numeric = new Intl.DateTimeFormat("en-GB", {
    timeZone: CREDIT_DAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const named = new Intl.DateTimeFormat(tag, {
    timeZone: CREDIT_DAY_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(instant);
  const pick = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick(numeric, "year"),
    month: String(Number(pick(numeric, "month"))),
    monthName: pick(named, "month"),
    day: String(Number(pick(numeric, "day"))),
    hour: String(Number(pick(numeric, "hour"))),
    minute: pick(numeric, "minute"),
  };
}

function parseInstant(iso: string): Date {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) throw new Error(`not an instant: ${iso}`);
  return at;
}

/**
 * An instant as a date and minute in Korea Standard Time, the way the rules
 * of that locale write it (the label in brackets or after the time, as each
 * language does). Every rules sentence that takes {longStop} is phrased for it.
 */
export function formatKstDateTime(locale: Locale, iso: string): string {
  const p = kstParts(locale, parseInstant(iso));
  const h = Number(p.hour);
  const label = KST_LABEL[locale];
  switch (locale) {
    case "ko": {
      const minute = Number(p.minute) ? ` ${Number(p.minute)}분` : "";
      return `${p.year}년 ${p.month}월 ${p.day}일 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${minute}(${label})`;
    }
    case "zh-CN":
    case "zh-TW":
      return `${p.year} 年 ${p.month} 月 ${p.day} 日 ${p.hour}:${p.minute}（${label}）`;
    case "ja":
      return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}（${label}）`;
    case "es":
      return `${p.day} de ${p.monthName} de ${p.year}, ${h === 1 ? "a la" : "a las"} ${p.hour}:${p.minute} (${label})`;
    case "fr":
      return `${p.day} ${p.monthName} ${p.year} à ${p.hour} h ${p.minute} (${label})`;
    case "de":
      return `${p.day}. ${p.monthName} ${p.year}, ${p.hour}:${p.minute} Uhr (${label})`;
    case "pt-BR":
      return `${p.day} de ${p.monthName} de ${p.year}, ${h === 1 ? "à" : "às"} ${p.hour}h${p.minute} (${label})`;
    default:
      return `${p.day} ${p.monthName} ${p.year}, ${p.hour.padStart(2, "0")}:${p.minute} ${label}`;
  }
}

/** A `YYYY-MM` month (Korea Standard Time) as that locale writes it: "March 2027", "2027년 3월". */
export function formatKstMonth(locale: Locale, yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error(`not a YYYY-MM month: ${yearMonth}`);
  // Noon on the 1st in Seoul, so no offset can move it into another month.
  const p = kstParts(locale, parseInstant(`${yearMonth}-01T12:00:00+09:00`));
  switch (locale) {
    case "ko":
      return `${p.year}년 ${p.month}월`;
    case "zh-CN":
    case "zh-TW":
      return `${p.year} 年 ${p.month} 月`;
    case "ja":
      return `${p.year}年${p.month}月`;
    case "es":
    case "pt-BR":
      return `${p.monthName} de ${p.year}`;
    default:
      return `${p.monthName} ${p.year}`;
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
    codeMin: SHARE_CODE_MIN,
    codeMax: SHARE_CODE_MAX,
    lightValue: formatOfferPrice(locale, LIGHT_VALUE_USD * 100),
    prizeValue: formatOfferPrice(locale, PRIZE_VALUE_USD * 100),
    ageKr: MIN_AGE_KR,
    ageOther: MIN_AGE_OTHER,
    longStop: formatKstDateTime(locale, LONG_STOP_CLOSE),
    deliveryBy: formatKstMonth(locale, PRIZE_DELIVERY_BY),
    taxFree: `KRW ${KR_PRIZE_TAX_FREE_KRW.toLocaleString("en-US")}`,
    taxRate: Math.round(KR_PRIZE_WITHHOLDING_RATE * 100),
  };
}

/** copyValues with `{hours}` set to that tier's lead time, for a tier's reward line. */
export function tierValues(locale: Locale, tier: ReferralTierId): CopyValues {
  return { ...copyValues(locale), hours: EARLY_NOTICE_HOURS[tier] };
}
