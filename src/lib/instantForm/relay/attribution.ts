import {
  FIELD_ACQUISITION_PATH,
  FIELD_LEADGEN_ID,
  FIELD_META_AD_ID,
  FIELD_META_ADSET_ID,
  FIELD_META_CAMPAIGN_ID,
} from "../../verification/contracts.ts";

export class NativeSchemaError extends Error {
  constructor() {
    super("native_schema_missing");
    this.name = "NativeSchemaError";
  }
}

export type NativeAttribution = {
  adId?: string | null;
  adsetId?: string | null;
  campaignId?: string | null;
  leadgenId: string;
};

function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] };
}

/**
 * Strict cells for a paid native ad. Leadgen ID is the Meta lead id.
 * Verification Lead ID stays a UUID minted by token.ts. Hero is never
 * written here. A missing select or property must fail the whole write.
 */
export function nativeAttributionProperties(input: NativeAttribution): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    [FIELD_LEADGEN_ID]: richText(input.leadgenId),
    [FIELD_ACQUISITION_PATH]: { select: { name: "instant_form" } },
  };
  if (input.adId) properties[FIELD_META_AD_ID] = richText(input.adId);
  if (input.adsetId) properties[FIELD_META_ADSET_ID] = richText(input.adsetId);
  if (input.campaignId) properties[FIELD_META_CAMPAIGN_ID] = richText(input.campaignId);
  return properties;
}

type NotionRequest = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export async function writeNativeAttribution(
  request: NotionRequest,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  try {
    await request("PATCH", `pages/${pageId}`, { properties });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "validation_error" || message.includes("validation_error")) {
      throw new NativeSchemaError();
    }
    throw error;
  }
}
