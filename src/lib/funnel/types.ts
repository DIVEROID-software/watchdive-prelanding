export const FUNNEL_SCHEMA_VERSION = "2026-07-29.v1";
export const MAX_CLIENT_FUNNEL_EVENTS_PER_REQUEST = 10;

export const FUNNEL_EVENT_NAMES = [
  "landing_view",
  "cta_view",
  "cta_click",
  "video_play",
  "video_25",
  "video_50",
  "video_75",
  "video_complete",
  "form_view",
  "form_start",
  "form_submit_attempt",
  "form_submit_success",
  "form_submit_error",
  "meta_browser_lead_dispatched",
  "meta_browser_contact_dispatched",
  "instant_form_webhook",
  "instant_form_crm_saved",
  "lead_validated",
  "lead_verified",
] as const;

export type FunnelEventName = (typeof FUNNEL_EVENT_NAMES)[number];

export const CLIENT_FUNNEL_EVENT_NAMES = [
  "landing_view",
  "cta_view",
  "cta_click",
  "video_play",
  "video_25",
  "video_50",
  "video_75",
  "video_complete",
  "form_view",
  "form_start",
  "form_submit_attempt",
  "form_submit_success",
  "form_submit_error",
  "meta_browser_lead_dispatched",
  "meta_browser_contact_dispatched",
] as const satisfies readonly FunnelEventName[];
export type ClientFunnelEventName = (typeof CLIENT_FUNNEL_EVENT_NAMES)[number];

export const CLIENT_FUNNEL_SOURCES = [
  "landing",
  "launch_banner",
  "sticky_banner",
  "hero",
  "offer",
  "functions",
  "compatibility",
  "connected_app",
] as const;
export type ClientFunnelSource = (typeof CLIENT_FUNNEL_SOURCES)[number];
export type AcquisitionPath = "website" | "instant_form";
export type FunnelPropertyValue = string | number | boolean | null;
export type ClientFunnelProperties = {
  viewport_width?: number;
  viewport_height?: number;
  duplicate?: boolean;
  error_code?: "join_waitlist_failed";
  autoplay?: boolean;
  viewable?: boolean;
};

export type FunnelAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  metaCampaignId?: string;
  metaAdSetId?: string;
  metaAdId?: string;
  metaCampaignName?: string;
  metaAdSetName?: string;
  metaAdName?: string;
  publisherPlatform?: string;
  placement?: string;
  fbclid?: string;
};

export type FunnelEventInput = {
  eventId: string;
  sessionId: string;
  visitorId?: string;
  eventName: FunnelEventName;
  occurredAt: string;
  acquisitionPath: AcquisitionPath;
  source?: string;
  pagePath?: string;
  referrerHost?: string;
  attribution?: FunnelAttribution;
  properties?: Record<string, FunnelPropertyValue>;
  schemaVersion: typeof FUNNEL_SCHEMA_VERSION;
};

export type ClientFunnelEventInput = Omit<
  FunnelEventInput,
  "eventName" | "acquisitionPath" | "properties" | "source" | "pagePath"
> & {
  eventName: ClientFunnelEventName;
  acquisitionPath: "website";
  source?: ClientFunnelSource;
  pagePath?: "/";
  properties?: ClientFunnelProperties;
};

export type FunnelLeadStatus = "new" | "duplicate" | "suspect" | "invalid";

export type FunnelLeadOutcome = {
  leadId: string;
  eventId?: string;
  sessionId?: string;
  visitorId?: string;
  acquisitionPath: AcquisitionPath;
  source?: string;
  pagePath?: string;
  country?: string;
  status: FunnelLeadStatus;
  valid: boolean;
  verified?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  measurementConsent?: boolean;
  metaEligible?: boolean;
  metaCapiState?: "sent" | "skipped" | "failed";
  metaEventsReceived?: number;
  notionPageId?: string;
  attribution?: FunnelAttribution;
  signedUpAt: string;
  flags?: string[];
  schemaVersion: typeof FUNNEL_SCHEMA_VERSION;
};

const QUERY_FIELD_MAP = {
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content: "utmContent",
  utm_term: "utmTerm",
  campaign_id: "metaCampaignId",
  adset_id: "metaAdSetId",
  ad_id: "metaAdId",
  campaign_name: "metaCampaignName",
  adset_name: "metaAdSetName",
  ad_name: "metaAdName",
  site_source_name: "publisherPlatform",
  publisher_platform: "publisherPlatform",
  placement: "placement",
  fbclid: "fbclid",
} as const satisfies Record<string, keyof FunnelAttribution>;

function cleanAttributionValue(value: string | null): string | undefined {
  const cleaned = value
    ? Array.from(value)
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code > 31 && code !== 127;
        })
        .join("")
        .trim()
    : "";
  return cleaned ? cleaned.slice(0, 300) : undefined;
}

export function parseFunnelAttribution(search: string): FunnelAttribution {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const attribution: FunnelAttribution = {};

  for (const [queryKey, field] of Object.entries(QUERY_FIELD_MAP)) {
    const value = cleanAttributionValue(params.get(queryKey));
    if (value) attribution[field] = value;
  }

  return attribution;
}

export function hasFunnelAttribution(attribution?: FunnelAttribution): boolean {
  return Boolean(attribution && Object.values(attribution).some(Boolean));
}

export function attributionForMeasurementConsent(
  attribution: FunnelAttribution,
  measurementConsent: boolean,
): FunnelAttribution {
  if (measurementConsent) return attribution;
  const { fbclid: _fbclid, ...anonymousAttribution } = attribution;
  return anonymousAttribution;
}

export function attributionCompleteness(
  attribution?: FunnelAttribution,
): "complete" | "partial" | "none" {
  if (!hasFunnelAttribution(attribution)) return "none";
  if (
    attribution?.utmSource &&
    attribution.utmMedium &&
    (attribution.utmCampaign || attribution.metaCampaignId)
  ) {
    return "complete";
  }
  return "partial";
}

export function isHalfVisibleIntersection(entry: {
  isIntersecting: boolean;
  intersectionRatio: number;
}): boolean {
  return entry.isIntersecting && entry.intersectionRatio >= 0.5;
}
