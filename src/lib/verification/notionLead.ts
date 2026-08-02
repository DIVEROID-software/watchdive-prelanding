// Notion projection for the verification flow, over the exact live columns.
//
// What is persisted is deliberately thin: an opaque `Lead ID` naming the
// current attempt, the two timestamps that bound it, a send counter, and the
// outcome. The token, its signature, and the confirmation URL are all absent —
// they are derivable from `Lead ID` only with the server secret.
//
// The legacy `IP` and `User agent` columns are untouched: not read, not
// written, not even as a digest. What this flow needed from the client address
// is a repeat-signup count, and that lives in process memory instead — see
// `networkGate.ts`. The user agent survives only as a `headless` flag.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import {
  canonicalEmailFilters,
  canonicalEmailProperties,
  withCanonicalEmailShape,
} from "../api/notionCanonicalEmail.ts";
import type {
  CreatePendingInput,
  LeadAttribution,
  LeadRecord,
  LeadStore,
  MarkSentInput,
  MarkVerifiedInput,
  StartAttemptInput,
  VerificationStatus,
} from "./contracts.ts";
import {
  FIELD_EMAIL_VERIFIED,
  FIELD_LANDING_PATH,
  FIELD_LAUNCHOS_REPLAY_METADATA,
  FIELD_LEAD_ID,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_META_EVENT_ID,
  FIELD_UTM_CAMPAIGN,
  FIELD_UTM_CONTENT,
  FIELD_UTM_MEDIUM,
  FIELD_UTM_SOURCE,
  FIELD_UTM_TERM,
  FIELD_WELCOME_EMAIL,
  FIELD_VERIFICATION_EXPIRES,
  FIELD_VERIFICATION_SENDS,
  FIELD_VERIFICATION_SENT,
  FIELD_VERIFICATION_STATUS,
  FIELD_VERIFIED_AT,
  LAUNCHOS_REPLAY_METADATA_MAX_LENGTH,
  MEASUREMENT_CONSENT_GRANTED,
  STATUS_PENDING,
  STATUS_UNSUBSCRIBED,
  STATUS_VERIFIED,
} from "./contracts.ts";

const NOTION_VERSION = "2022-06-28";
const NOTION_TIMEOUT_MS = 10_000;

// The only property names a failure message may ever name. The dual-shape
// helper recognises its column mismatch by reading the message, so that one
// signal has to survive — but nothing else from the body does.
const REPORTABLE_PROPERTIES = ["Canonical email"];

/**
 * Builds a failure message from a Notion error body without echoing it.
 *
 * A Notion 400 can quote the value it rejected, which for this database means
 * an email address. So the body is parsed, and only two things are carried out
 * of it: the machine-readable `code`, and — when the message names one — a
 * property name drawn from a fixed list. Everything else is dropped.
 */
export function describeNotionFailure(status: number, rawBody: string): string {
  let code = "";
  let property = "";
  try {
    const parsed = JSON.parse(rawBody.slice(0, 4096)) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === "string" && /^[a-z_]{1,64}$/.test(parsed.code)) code = parsed.code;
    const message = parsed.message;
    if (typeof message === "string") {
      property = REPORTABLE_PROPERTIES.find((name) => message.includes(name)) ?? "";
    }
  } catch {
    // An unparseable body contributes nothing at all.
  }
  return `Notion request failed (${status})${code ? `: ${code}` : ""}${property ? ` [${property}]` : ""}`;
}

export type NotionRequest = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export function createNotionRequest(
  fetchImpl: typeof fetch = fetch,
  env: { NOTION_API_KEY?: string } = process.env,
): NotionRequest {
  return async (method, path, body) => {
    const key = env.NOTION_API_KEY;
    if (!key) throw new Error("NOTION_API_KEY is not set");
    const response = await fetchImpl(`https://api.notion.com/v1/${path}`, {
      method,
      // A hung CRM must not hold a request open until the platform kills it.
      signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${key}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(describeNotionFailure(response.status, await response.text()));
    }
    return (await response.json()) as Record<string, unknown>;
  };
}

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
}

/** The sealed envelope must never be silently truncated into an unreplayable row. */
function launchOsReplayMetadataProp(value: string) {
  if (value.length > LAUNCHOS_REPLAY_METADATA_MAX_LENGTH) {
    throw new Error("LaunchOS replay metadata exceeds the CRM field bound");
  }
  return { rich_text: [{ text: { content: value } }] };
}

function readText(property: unknown): string {
  const rich = (property as { rich_text?: { plain_text?: string }[] } | undefined)?.rich_text;
  return rich?.[0]?.plain_text ?? "";
}

function readTitle(property: unknown): string {
  const title = (property as { title?: { plain_text?: string }[] } | undefined)?.title;
  return title?.[0]?.plain_text ?? "";
}

function readDate(property: unknown): string | undefined {
  return (property as { date?: { start?: string } } | undefined)?.date?.start ?? undefined;
}

export function readStatus(property: unknown): VerificationStatus {
  const name = (property as { select?: { name?: string } } | undefined)?.select?.name;
  if (name === STATUS_PENDING) return "pending";
  if (name === STATUS_VERIFIED) return "verified";
  if (name === STATUS_UNSUBSCRIBED) return "unsubscribed";
  return "legacy";
}

export function toLeadRecord(page: Record<string, unknown>): LeadRecord | undefined {
  const pageId = typeof page.id === "string" ? page.id : "";
  if (!pageId) return undefined;
  const properties = (page.properties ?? {}) as Record<string, unknown>;
  const sends = (properties[FIELD_VERIFICATION_SENDS] as { number?: number } | undefined)?.number;
  const sentAt = readDate(properties[FIELD_VERIFICATION_SENT]);
  const expiresAt = readDate(properties[FIELD_VERIFICATION_EXPIRES]);
  const verifiedAt = readDate(properties[FIELD_VERIFIED_AT]);
  const welcomeAt = readDate(properties[FIELD_WELCOME_EMAIL]);
  const launchOsReplayMetadata = readText(properties[FIELD_LAUNCHOS_REPLAY_METADATA]);

  return {
    pageId,
    email: readTitle(properties.Email),
    status: readStatus(properties[FIELD_VERIFICATION_STATUS]),
    emailVerified: Boolean(
      (properties[FIELD_EMAIL_VERIFIED] as { checkbox?: boolean } | undefined)?.checkbox,
    ),
    refCode: readText(properties["Ref code"]),
    source:
      (properties.Source as { select?: { name?: string } } | undefined)?.select?.name ?? "unknown",
    suspect: Boolean((properties.Suspect as { checkbox?: boolean } | undefined)?.checkbox),
    flags:
      (properties.Flags as { multi_select?: { name?: string }[] } | undefined)?.multi_select
        ?.map((option) => option.name ?? "")
        .filter(Boolean) ?? [],
    phone: readText(properties.Phone),
    leadId: readText(properties[FIELD_LEAD_ID]),
    metaEventId: readText(properties[FIELD_META_EVENT_ID]),
    sends: typeof sends === "number" && Number.isFinite(sends) ? sends : 0,
    ...(sentAt ? { sentAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(welcomeAt ? { welcomeAt } : {}),
    ...(launchOsReplayMetadata ? { launchOsReplayMetadata } : {}),
  };
}

/**
 * Rows the public numbers may include: confirmations from this flow, plus
 * legacy single opt-in rows that have no status at all. Pending and
 * unsubscribed never count.
 */
/**
 * Attribution over the six live columns. Only values that exist become
 * properties, so a partly-tagged URL leaves the rest of the row's cells empty
 * rather than filling them with blanks that read as "measured, and it was none".
 */
export function attributionProperties(
  attribution: LeadAttribution | undefined,
): Record<string, ReturnType<typeof textProp>> {
  if (!attribution) return {};
  const pairs: [string, string | undefined][] = [
    [FIELD_UTM_SOURCE, attribution.utmSource],
    [FIELD_UTM_MEDIUM, attribution.utmMedium],
    [FIELD_UTM_CAMPAIGN, attribution.utmCampaign],
    [FIELD_UTM_CONTENT, attribution.utmContent],
    [FIELD_UTM_TERM, attribution.utmTerm],
    [FIELD_LANDING_PATH, attribution.landingPath],
  ];
  return Object.fromEntries(
    pairs
      .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
      .map(([name, value]) => [name, textProp(value)]),
  );
}

export const COUNTABLE_STATUS_FILTER = {
  or: [
    { property: FIELD_VERIFICATION_STATUS, select: { equals: STATUS_VERIFIED } },
    { property: FIELD_VERIFICATION_STATUS, select: { is_empty: true } },
  ],
} as const;

export function createNotionLeadStore(request: NotionRequest, databaseId: string): LeadStore {
  async function queryOne(filter: unknown): Promise<LeadRecord | undefined> {
    const result = await request("POST", `databases/${databaseId}/query`, {
      filter,
      page_size: 1,
    });
    const first = (result.results as Record<string, unknown>[] | undefined)?.[0];
    return first ? toLeadRecord(first) : undefined;
  }

  return {
    async findByEmail(canonical, email) {
      // The dual-shape helper stays in the path: the live `Canonical email`
      // column has been both rich_text and email, and pinning either shape is
      // what broke signups before.
      return withCanonicalEmailShape(() =>
        queryOne({
          or: [
            ...canonicalEmailFilters(canonical),
            { property: "Email", title: { equals: email } },
          ],
        }),
      );
    },

    async findByLeadId(leadId) {
      return queryOne({ property: FIELD_LEAD_ID, rich_text: { equals: leadId } });
    },

    async createPending(input: CreatePendingInput) {
      const page = await withCanonicalEmailShape(() =>
        request("POST", "pages", {
          parent: { database_id: databaseId },
          properties: {
            Email: { title: [{ text: { content: input.email } }] },
            ...canonicalEmailProperties(input.canonical),
            ...(input.phone?.trim() ? { Phone: textProp(input.phone.trim()) } : {}),
            Source: { select: { name: input.source } },
            "Signed up": { date: { start: input.signedUpAt } },
            "Ref code": textProp(input.refCode),
            ...(input.referredBy && input.referredBy !== input.refCode
              ? { "Referred by": textProp(input.referredBy) }
              : {}),
            ...(input.flags.length
              ? { Flags: { multi_select: input.flags.map((name) => ({ name })) } }
              : {}),
            Suspect: { checkbox: input.suspect },
            ...attributionProperties(input.attribution),
            ...(input.launchOsReplayMetadata
              ? {
                  [FIELD_LAUNCHOS_REPLAY_METADATA]: launchOsReplayMetadataProp(
                    input.launchOsReplayMetadata,
                  ),
                  [FIELD_MEASUREMENT_CONSENT]: textProp(MEASUREMENT_CONSENT_GRANTED),
                }
              : {}),
            [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_PENDING } },
            [FIELD_EMAIL_VERIFIED]: { checkbox: false },
            [FIELD_LEAD_ID]: textProp(input.leadId),
            [FIELD_VERIFICATION_EXPIRES]: { date: { start: input.expiresAt } },
            [FIELD_VERIFICATION_SENDS]: { number: 1 },
          },
        }),
      );
      const record = toLeadRecord(page);
      if (!record) throw new Error("Notion page create returned no usable row");
      return record;
    },

    async startAttempt(pageId: string, input: StartAttemptInput) {
      // Replacing `Lead ID` is the revocation: the previous token names an
      // attempt id that no row carries any more, so its link is dead.
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [FIELD_LEAD_ID]: textProp(input.leadId),
          [FIELD_VERIFICATION_EXPIRES]: { date: { start: input.expiresAt } },
          [FIELD_VERIFICATION_SENDS]: { number: input.sends },
          [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_PENDING } },
          // The previous attempt's send time belongs to a link that no longer
          // exists. Leaving it would make the cooldown for this attempt run
          // from a message about a different one.
          [FIELD_VERIFICATION_SENT]: { date: null },
        },
      });
    },

    async markSent(pageId: string, input: MarkSentInput) {
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_VERIFICATION_SENT]: { date: { start: input.sentAt } } },
      });
    },

    async markVerified(pageId: string, input: MarkVerifiedInput) {
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_VERIFIED } },
          [FIELD_EMAIL_VERIFIED]: { checkbox: true },
          [FIELD_VERIFIED_AT]: { date: { start: input.verifiedAt } },
          [FIELD_META_EVENT_ID]: textProp(input.metaEventId),
        },
      });
    },

    async markWelcomeScheduled(pageId: string, input) {
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_WELCOME_EMAIL]: { date: { start: input.scheduledAt } } },
      });
    },

    async reread(pageId: string) {
      return toLeadRecord(await request("GET", `pages/${pageId}`));
    },
  };
}
