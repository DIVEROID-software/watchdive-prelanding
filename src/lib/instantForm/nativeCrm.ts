import {
  FIELD_ACQUISITION_PATH,
  FIELD_LEADGEN_ID,
  FIELD_META_AD_ID,
  FIELD_META_ADSET_ID,
  FIELD_META_CAMPAIGN_ID,
} from "../verification/contracts.ts";

/**
 * Cells a native Instant Form create must write in the same Notion request.
 * Phone and SMS consent are intentionally absent. A missing property must
 * fail the create. These names are not in the optional-column retry list.
 */
export const NATIVE_CRM_PROPERTY_NAMES = [
  FIELD_LEADGEN_ID,
  FIELD_ACQUISITION_PATH,
  FIELD_META_AD_ID,
  FIELD_META_ADSET_ID,
  FIELD_META_CAMPAIGN_ID,
] as const;

export type NativeCrmWrite = {
  leadgenId: string;
  adId?: string;
  adsetId?: string;
  campaignId?: string;
};

function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] };
}

export function nativeCrmProperties(input: NativeCrmWrite): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [FIELD_LEADGEN_ID]: richText(input.leadgenId),
    [FIELD_ACQUISITION_PATH]: { select: { name: "instant_form" } },
  };
  // Empty ids are omitted. A paid lead still writes the ids Meta returned.
  if (input.adId) properties[FIELD_META_AD_ID] = richText(input.adId);
  if (input.adsetId) properties[FIELD_META_ADSET_ID] = richText(input.adsetId);
  if (input.campaignId) properties[FIELD_META_CAMPAIGN_ID] = richText(input.campaignId);
  return properties;
}

export function nativeCrmRejected(named: ReadonlySet<string>): boolean {
  return NATIVE_CRM_PROPERTY_NAMES.some((name) => named.has(name));
}
