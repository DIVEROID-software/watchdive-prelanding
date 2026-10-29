import {
  MARKET_LOCALE,
  META_ID,
  WEBSITE_CAMPAIGN_IDS,
  registryNames,
  type Market,
  type SignupLocale,
} from "./constants.ts";

export type AdSegment = "scuba" | "freediving";

/** One paid ad. The ad, ad set, and campaign must be one registered triple. */
export type RegisteredAd = {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  segment: AdSegment;
};

export type AllowlistForm = {
  form_id: string;
  market: Market;
  locale: SignupLocale;
  campaign_id: string;
  campaign_name: string;
  utm_campaign: string;
  adset_id: string;
  adset_name: string;
  landing_path: string;
  test: boolean;
  ads: readonly RegisteredAd[];
};

const SEGMENTS = new Set<AdSegment>(["scuba", "freediving"]);

function landingMatches(locale: SignupLocale, path: string): boolean {
  if (!path.startsWith("/") || path.includes("://") || path.includes("\\") || path.includes(" ")) {
    return false;
  }
  if (locale === "ko") return path === "/ko" || path.startsWith("/ko/") || path.startsWith("/ko?");
  if (locale === "ja") return path === "/ja" || path.startsWith("/ja/") || path.startsWith("/ja?");
  if (locale === "zh-TW") {
    return path === "/zh-tw" || path.startsWith("/zh-tw/") || path.startsWith("/zh-tw?");
  }
  if (locale === "nl") return path === "/nl" || path.startsWith("/nl/") || path.startsWith("/nl?");
  const first = path.split(/[/?#]/).filter(Boolean)[0] ?? "";
  return !["ko", "ja", "zh-tw", "zh-cn", "es", "fr", "de", "pt-br", "en", "nl"].includes(first);
}

function parseAd(value: unknown, form: { campaign_id: string; adset_id: string }): RegisteredAd | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const adId = String(row.ad_id ?? "");
  const adsetId = String(row.adset_id ?? "");
  const campaignId = String(row.campaign_id ?? "");
  const segment = String(row.segment ?? "");
  if (!META_ID.test(adId) || !META_ID.test(adsetId) || !META_ID.test(campaignId)) return null;
  if (adsetId !== form.adset_id || campaignId !== form.campaign_id) return null;
  if (!SEGMENTS.has(segment as AdSegment)) return null;
  if ((WEBSITE_CAMPAIGN_IDS as readonly string[]).includes(campaignId)) return null;
  return { ad_id: adId, adset_id: adsetId, campaign_id: campaignId, segment: segment as AdSegment };
}

export function parseAllowlist(value: unknown): { ok: true; forms: AllowlistForm[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  const forms: AllowlistForm[] = [];
  const seenForms = new Set<string>();
  const seenAds = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return { ok: false };
    const row = entry as Record<string, unknown>;
    const market = String(row.market ?? "");
    const locale = String(row.locale ?? "");
    if (!Object.hasOwn(MARKET_LOCALE, market)) return { ok: false };
    if (MARKET_LOCALE[market as Market] !== locale) return { ok: false };
    const names = registryNames(market as Market);
    if (String(row.campaign_name ?? "") !== names.campaign_name) return { ok: false };
    if (String(row.adset_name ?? "") !== names.adset_name) return { ok: false };
    if (String(row.utm_campaign ?? "") !== names.utm_campaign) return { ok: false };
    const formId = String(row.form_id ?? "");
    if (!META_ID.test(formId) || seenForms.has(formId)) return { ok: false };
    seenForms.add(formId);
    const campaignId = String(row.campaign_id ?? "");
    const adsetId = String(row.adset_id ?? "");
    if (!META_ID.test(campaignId) || !META_ID.test(adsetId)) return { ok: false };
    if ((WEBSITE_CAMPAIGN_IDS as readonly string[]).includes(campaignId)) return { ok: false };
    const landing = String(row.landing_path ?? "");
    if (!landingMatches(locale as SignupLocale, landing)) return { ok: false };
    const ads = Array.isArray(row.ads)
      ? row.ads.map((ad) => parseAd(ad, { campaign_id: campaignId, adset_id: adsetId }))
      : [];
    if (ads.some((ad) => ad == null)) return { ok: false };
    const registered = ads as RegisteredAd[];
    if (row.test !== true && registered.length === 0) return { ok: false };
    for (const ad of registered) {
      if (seenAds.has(ad.ad_id)) return { ok: false };
      seenAds.add(ad.ad_id);
    }
    forms.push({
      form_id: formId,
      market: market as Market,
      locale: locale as SignupLocale,
      campaign_id: campaignId,
      campaign_name: names.campaign_name,
      utm_campaign: names.utm_campaign,
      adset_id: adsetId,
      adset_name: names.adset_name,
      landing_path: landing,
      test: row.test === true,
      ads: registered,
    });
  }
  return { ok: true, forms };
}

export function parseAllowlistJson(raw: string): { ok: true; forms: AllowlistForm[] } | { ok: false } {
  if (!raw.trim()) return { ok: true, forms: [] };
  try {
    return parseAllowlist(JSON.parse(raw) as unknown);
  } catch {
    return { ok: false };
  }
}

export function productionForms(forms: readonly AllowlistForm[]): AllowlistForm[] {
  return forms.filter((form) => !form.test);
}
