import { createHmac, timingSafeEqual } from "node:crypto";

import {
  FIELD_ACQUISITION_PATH,
  FIELD_EMAIL_VERIFIED,
  FIELD_ENVIRONMENT,
  FIELD_LANDING_PATH,
  FIELD_LAUNCHOS_REPLAY_METADATA,
  FIELD_LEAD_ID,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_META_ADSET_ID,
  FIELD_META_AD_ID,
  FIELD_META_CAMPAIGN_ID,
  FIELD_QUALIFICATION_RULE_VERSION,
  FIELD_SOURCE_SCHEMA_VERSION,
  FIELD_UTM_CAMPAIGN,
  FIELD_UTM_CONTENT,
  FIELD_UTM_MEDIUM,
  FIELD_UTM_SOURCE,
  FIELD_UTM_TERM,
  FIELD_VERIFICATION_STATUS,
  MEASUREMENT_CONSENT_WITHDRAWN,
  STATUS_SUPPRESSED,
} from "./contracts.ts";
import type { NotionRequest } from "./notionLead.ts";

const AUTHORITY_REFERENCE_HASH = /^[a-f0-9]{64}$/;
const WITHDRAWAL_REQUEST_ID = /^pwr_v1_[A-Za-z0-9_-]{22,120}$/;
const REGISTRY_DOMAIN = "watchdive-source-measurement-revocation-v1";
const REGISTRY_PREFIX = "wd_privacy_v1_";
const MAX_SCAN_PAGES = 10;
const PAGE_SIZE = 100;
export const SOURCE_MEASUREMENT_TOMBSTONE_SOURCE = "privacy_withdrawal" as const;

type ReplayAuthorityReader = (envelope: string) => string | undefined;

type QueryPage = {
  results?: Record<string, unknown>[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export type SourceMeasurementRevocationRegistry = {
  isRevoked: (authorityReferenceHash: string) => Promise<boolean>;
  revoke: (input: {
    authorityReferenceHash: string;
    requestId: string;
    occurredAt: string;
  }) => Promise<{ matchedRows: number }>;
};

function titleText(value: string) {
  return { title: [{ text: { content: value } }] };
}

function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] };
}

function clearedMeasurementProperties() {
  return {
    [FIELD_LAUNCHOS_REPLAY_METADATA]: { rich_text: [] },
    [FIELD_UTM_SOURCE]: { rich_text: [] },
    [FIELD_UTM_MEDIUM]: { rich_text: [] },
    [FIELD_UTM_CAMPAIGN]: { rich_text: [] },
    [FIELD_UTM_CONTENT]: { rich_text: [] },
    [FIELD_UTM_TERM]: { rich_text: [] },
    [FIELD_LANDING_PATH]: { rich_text: [] },
    [FIELD_ENVIRONMENT]: { select: null },
    [FIELD_ACQUISITION_PATH]: { select: null },
    [FIELD_QUALIFICATION_RULE_VERSION]: { rich_text: [] },
    [FIELD_SOURCE_SCHEMA_VERSION]: { rich_text: [] },
    [FIELD_META_CAMPAIGN_ID]: { rich_text: [] },
    [FIELD_META_ADSET_ID]: { rich_text: [] },
    [FIELD_META_AD_ID]: { rich_text: [] },
  };
}

function readRichText(property: unknown) {
  return (
    (property as { rich_text?: Array<{ plain_text?: string }> } | undefined)?.rich_text?.[0]
      ?.plain_text ?? ""
  );
}

function safeEqual(left: string, right: string) {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
}

function registryKey(authorityReferenceHash: string, secret: string) {
  if (!AUTHORITY_REFERENCE_HASH.test(authorityReferenceHash)) {
    throw new TypeError("Measurement authority reference is invalid.");
  }
  const digest = createHmac("sha256", secret)
    .update(`${REGISTRY_DOMAIN}\n${authorityReferenceHash}`)
    .digest("hex");
  return `${REGISTRY_PREFIX}${digest}`;
}

/**
 * Durable, PII-free source registry over the existing Notion waitlist store.
 * A synthetic `suppressed` row is deliberately excluded by public-count
 * filters. Its title is a one-way HMAC, never an address or browser identifier.
 */
export function createNotionMeasurementRevocationRegistry(input: {
  request: NotionRequest;
  databaseId: string;
  replaySecret: string;
  readReplayAuthority: ReplayAuthorityReader;
}): SourceMeasurementRevocationRegistry {
  const { request, databaseId, replaySecret, readReplayAuthority } = input;
  if (!databaseId || replaySecret.length < 32) {
    throw new TypeError("Measurement revocation registry configuration is invalid.");
  }

  const findRegistryRow = async (key: string) => {
    const result = (await request("POST", `databases/${databaseId}/query`, {
      filter: { property: "Email", title: { equals: key } },
      page_size: 1,
    })) as QueryPage;
    return result.results?.[0];
  };

  const isRevoked = async (authorityReferenceHash: string) => {
    const key = registryKey(authorityReferenceHash, replaySecret);
    return Boolean(await findRegistryRow(key));
  };

  const scanAndClear = async (authorityReferenceHash: string) => {
    let cursor: string | null = null;
    const matchedPageIds: string[] = [];
    for (let pageNumber = 0; pageNumber < MAX_SCAN_PAGES; pageNumber += 1) {
      const page = (await request("POST", `databases/${databaseId}/query`, {
        filter: {
          property: FIELD_LAUNCHOS_REPLAY_METADATA,
          rich_text: { is_not_empty: true },
        },
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      })) as QueryPage;
      for (const row of page.results ?? []) {
        const pageId = typeof row.id === "string" ? row.id : "";
        const properties = (row.properties ?? {}) as Record<string, unknown>;
        const envelope = readRichText(properties[FIELD_LAUNCHOS_REPLAY_METADATA]);
        const candidate = envelope ? readReplayAuthority(envelope) : undefined;
        if (!pageId || !candidate || !safeEqual(candidate, authorityReferenceHash)) continue;
        matchedPageIds.push(pageId);
      }
      if (!page.has_more) {
        for (const pageId of matchedPageIds) {
          await request("PATCH", `pages/${pageId}`, {
            properties: {
              ...clearedMeasurementProperties(),
              [FIELD_MEASUREMENT_CONSENT]: richText(MEASUREMENT_CONSENT_WITHDRAWN),
            },
          });
        }
        return matchedPageIds.length;
      }
      if (!page.next_cursor || pageNumber === MAX_SCAN_PAGES - 1) {
        throw new Error("Measurement revocation scan bound was exceeded.");
      }
      cursor = page.next_cursor;
    }
    return matchedPageIds.length;
  };

  return {
    isRevoked,
    async revoke({ authorityReferenceHash, requestId, occurredAt }) {
      if (!WITHDRAWAL_REQUEST_ID.test(requestId) || !Number.isFinite(Date.parse(occurredAt))) {
        throw new TypeError("Measurement revocation request is invalid.");
      }
      const key = registryKey(authorityReferenceHash, replaySecret);
      // The tombstone is committed before scanning lead rows. A lead created by
      // a concurrent signup is therefore still blocked by the mandatory
      // pre-dispatch isRevoked check even if this scan did not see it.
      if (!(await findRegistryRow(key))) {
        await request("POST", "pages", {
          parent: { database_id: databaseId },
          properties: {
            Email: titleText(key),
            Source: { select: { name: SOURCE_MEASUREMENT_TOMBSTONE_SOURCE } },
            "Signed up": { date: { start: new Date(occurredAt).toISOString() } },
            Suspect: { checkbox: true },
            [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_SUPPRESSED } },
            [FIELD_EMAIL_VERIFIED]: { checkbox: false },
            [FIELD_LEAD_ID]: richText(requestId),
            [FIELD_MEASUREMENT_CONSENT]: richText(MEASUREMENT_CONSENT_WITHDRAWN),
          },
        });
      }
      return { matchedRows: await scanAndClear(authorityReferenceHash) };
    },
  };
}
