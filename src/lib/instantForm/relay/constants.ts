// Closed production gate for native Instant Form confirmation.
// Weights are the existing stage-score labels. They are not a currency.

export const EMAIL_VERIFIED_CUSTOM_CONVERSION_ID = "1080978008182811";
export const STAGE_SCORE_WEIGHTS = Object.freeze([1, 3, 5, 10, 30]);
export const PAGE_ID = "102850088374205";
export const PRODUCTION_SENDER = "help@diveroid.com";
export const SIGNATURE_HEADER = "x-watchdive-instant-form-signature";
export const BODY_LIMIT = 8192;
export const MAX_SKEW_PAST_MS = 5 * 60 * 1000;
export const MAX_SKEW_FUTURE_MS = 60 * 1000;

export const MARKET_LOCALE = Object.freeze({
  KR: "ko",
  SG: "en",
  NL: "nl",
  HK: "zh-TW",
  JP: "ja",
  TW: "zh-TW",
  MY: "en",
} as const);

export type Market = keyof typeof MARKET_LOCALE;
export type SignupLocale = (typeof MARKET_LOCALE)[Market];

/** Website sales campaigns. A native confirmation must not be stored as one of these. */
export const WEBSITE_CAMPAIGN_IDS = Object.freeze([
  "120251732832820215",
  "120251732986720215",
  "120251732986870215",
  "120251732987650215",
  "120251795578870215",
  "120251795579300215",
  "120251829043020215",
  "120251745481990215",
  "120251627871060215",
]);

export const META_ID = /^[1-9][0-9]{5,19}$/;

/** Form checkbox and version strings. They match the ingester and scope proposal. */
export const EMAIL_CONSENT_KEY = "wd_email_confirmation_v1";
export const EMAIL_CONSENT_VERSION = "WD-EMAIL-CONFIRM-V1";
export const SMS_CONSENT_VERSION = "WD-SMS-CONSENT-V2";
export const PHONE_FIELD_KEY = "phone_optional";


const EXPLICIT_REGISTRY_NAMES: Partial<
  Record<
    Market,
    { campaign_name: string; adset_name: string; form_name: string; utm_campaign: string }
  >
> = Object.freeze({
  MY: Object.freeze({
    campaign_name: "WD_MY_NATIVE_INSTANT_20261031_TEST",
    adset_name: "WD_MY_NATIVE_20261031_TEST",
    form_name: "WD_MY_LAUNCH_NOTIFY_HIGHER_INTENT_NOPHONE_20261031",
    utm_campaign: "wd_my_native_instant",
  }),
});
export function registryNames(market: Market): {
  campaign_name: string;
  adset_name: string;
  form_name: string;
  utm_campaign: string;
} {
  const explicit = EXPLICIT_REGISTRY_NAMES[market];
  if (explicit) return explicit;
  return {
    campaign_name: `WD_${market}_INSTANT_FORM_20261030_PAUSED`,
    adset_name: `WD_${market}_SCUBA_FREE_INSTANT_FORM_20261030_PAUSED`,
    form_name: `WD_${market}_LAUNCH_NOTIFY_HIGHER_INTENT_NOPHONE_20261030`,
    utm_campaign: `wd_${market.toLowerCase()}_native_instant`,
  };
}
