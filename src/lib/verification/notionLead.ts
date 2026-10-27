import { COMPATIBILITY_NOTION_PROPERTY, prepareCompatibilityRequest, compatibilityNotionProperties } from "../compatibility/context.ts";
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
// A new signup may also store a coarse country (`Signup country`,
// `Signup country source`, `Signup country observed`): the trusted edge ISO,
// the sensor name, and the time it was read. No IP. Existing rows are not
// backfilled. If those columns are not on the database yet, the create is
// retried without them so the signup itself is not lost.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { coerceSignupCountryObservation, persistableSignupCountry } from "../attribution.ts";
import {
  canonicalEmailFilters,
  canonicalEmailProperties,
  withCanonicalEmailShape,
} from "../api/notionCanonicalEmail.ts";
import {
  encodeLeadExperiment,
  FIELD_CONVERSION_EXPERIMENT,
} from "../conversionExperimentContract.ts";
import type { ReminderStore } from "./reminder.ts";
import { FIELD_PRESS_EVENT, FIELD_PRESS_SYNC, PRESS_SYNC_HELD } from "../press/pressAttribution.server.ts";
import type {
  CreatePendingInput,
  LeadAttribution,
  LeadRecord,
  LeadStore,
  MarkSentInput,
  MarkVerifiedInput,
  SignupCountryObservation,
  StartAttemptInput,
  VerificationStatus,
} from "./contracts.ts";
import {
  FIELD_APPLE_SUBJECT,
  FIELD_AUTH_VERIFICATION_PROVENANCE,
  FIELD_EMAIL_VERIFIED,
  FIELD_GOOGLE_SUBJECT,
  FIELD_LANDING_PATH,
  FIELD_LEAD_ID,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_META_EVENT_ID,
  FIELD_SIGNUP_COUNTRY,
  FIELD_SIGNUP_LOCALE,
  FIELD_SIGNUP_METHOD,
  FIELD_SIGNUP_COUNTRY_OBSERVED,
  FIELD_SIGNUP_COUNTRY_SOURCE,
  FIELD_UTM_CAMPAIGN,
  FIELD_UTM_CONTENT,
  FIELD_UTM_MEDIUM,
  FIELD_UTM_SOURCE,
  FIELD_UTM_TERM,
  FIELD_WELCOME_EMAIL,
  FIELD_VERIFICATION_EXPIRES,
  FIELD_VERIFICATION_SENDS,
  FIELD_VERIFICATION_SENT,
  FIELD_SIGNED_UP,
  FIELD_SUSPECT,
  FIELD_VERIFICATION_REMINDER,
  FIELD_VERIFICATION_STATUS,
  FIELD_VERIFIED_AT,
  FLAG_MEASUREMENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHDRAWN,
  SIGNUP_COUNTRY_SOURCE_UNKNOWN,
  SIGNUP_COUNTRY_SOURCE_VERCEL,
  STATUS_PENDING,
  STATUS_UNSUBSCRIBED,
  STATUS_VERIFIED,
} from "./contracts.ts";

/**
 * The opt-in column holding the Meta click cookie of a lead that allowed
 * measurement. Unset = the value is never written or read: an unknown property
 * would make Notion reject the whole write, and on `createPending` that would
 * lose the signup itself.
 */
export function metaFbcColumn(
  value: string | undefined = process.env.NOTION_META_FBC_PROPERTY,
): string | undefined {
  const column = value?.trim();
  return column ? column : undefined;
}

/** `fb.1.<ms>.<fbclid>` — anything else is not stored. */
export function isMetaFbc(value: unknown): value is string {
  return (
    typeof value === "string" && /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_.-]{8,500}$/.test(value)
  );
}

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

/**
 * Notion's own error message with everything identifying taken out: quoted
 * values, ids, email addresses, URLs and long digit runs. What is left is the
 * sentence Notion wrote, e.g. "Could not find database with ID: <id>. Make
 * sure the relevant pages and databases are shared with your integration."
 */
export function sanitizeNotionMessage(message: string): string {
  return message
    .slice(0, 1000)
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[^\s@"'`]+@[^\s@"'`]+/g, "<email>")
    .replace(/"[^"]*"|`[^`]*`|“[^”]*”/g, "<value>")
    .replace(/\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b(?:ntn|secret)_\w+/gi, "<token>")
    .replace(/\d{6,}/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * Thrown for a non-2xx Notion answer. `message` is exactly
 * `describeNotionFailure` (the waitlist flow and its alerts read only that);
 * `status`, `code` and the sanitized `detail` are there for callers that want
 * to log why a write failed.
 */
export class NotionRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  /**
   * Optional column names Notion's raw 400 named. Only names this server itself
   * might write are kept. The body is not stored.
   */
  readonly rejectedOptionalColumns: readonly string[];

  constructor(status: number, rawBody: string) {
    super(describeNotionFailure(status, rawBody));
    this.name = "NotionRequestError";
    this.status = status;
    let code = "";
    let detail = "";
    const bounded = rawBody.slice(0, 4096);
    try {
      const parsed = JSON.parse(bounded) as { code?: unknown; message?: unknown };
      if (typeof parsed.code === "string" && /^[a-z_]{1,64}$/.test(parsed.code)) code = parsed.code;
      if (typeof parsed.message === "string") detail = sanitizeNotionMessage(parsed.message);
    } catch {
      // An unparseable body contributes nothing at all.
    }
    this.code = code;
    this.detail = detail;
    this.rejectedOptionalColumns =
      status === 400 && code === "validation_error" ? optionalColumnsMentioned(bounded) : [];
  }
}

const SIGNUP_COUNTRY_FIELDS = [
  FIELD_SIGNUP_COUNTRY,
  FIELD_SIGNUP_COUNTRY_SOURCE,
  FIELD_SIGNUP_COUNTRY_OBSERVED,
] as const;

/** Same live checkbox the reservation mail audience already skips. */
const FIELD_DUPLICATE = "Duplicate";
const SUBJECT_PATTERN = /^[A-Za-z0-9._-]{1,255}$/;

/**
 * The provider subject column is missing or rejected. A social create must not
 * continue without it: the page could not be matched on the next login.
 */
export class SocialAuthSchemaError extends Error {
  constructor() {
    super("social_auth_schema");
    this.name = "SocialAuthSchemaError";
  }
}

function optionalColumnsMentioned(rawBody: string): string[] {
  const names = [
    FIELD_CONVERSION_EXPERIMENT,
    ...SIGNUP_COUNTRY_FIELDS,
    FIELD_SIGNUP_METHOD,
    FIELD_GOOGLE_SUBJECT,
    FIELD_APPLE_SUBJECT,
    FIELD_AUTH_VERIFICATION_PROVENANCE,
    FIELD_SIGNUP_LOCALE,
    FIELD_DUPLICATE,
    FIELD_PRESS_EVENT,
    FIELD_PRESS_SYNC,
    process.env.NOTION_META_FBC_PROPERTY?.trim() ?? "",
    process.env.NOTION_FBCLID_PROPERTY?.trim() ?? "",
  ].filter((name) => name.length > 0);
  return names.filter((name) => rawBody.includes(name));
}

export type NotionRequest = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

/**
 * The page-behaviour store can be given a data-source id instead of a
 * database id; only that path asks for the newer API version.
 */
export const NOTION_DATA_SOURCE_VERSION = "2025-09-03";

export function createNotionRequest(
  fetchImpl: typeof fetch = fetch,
  env: { NOTION_API_KEY?: string } = process.env,
  notionVersion: string = NOTION_VERSION,
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
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new NotionRequestError(response.status, await response.text());
    }
    return (await response.json()) as Record<string, unknown>;
  };
}

function textProp(value: string) {
  return { rich_text: [{ text: { content: value.slice(0, 1900) } }] };
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

/** Raw `Launch mail` / `Reservation mail` cells, present only when non-empty. */
function optOutCells(
  properties: Record<string, unknown>,
): Pick<LeadRecord, "launchMail" | "reservationMail"> {
  const launchMail = readText(properties["Launch mail"]);
  const reservationMail = readText(properties["Reservation mail"]);
  return {
    ...(launchMail ? { launchMail } : {}),
    ...(reservationMail ? { reservationMail } : {}),
  };
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
  const reminder = readText(properties[FIELD_VERIFICATION_REMINDER]);
  const landingPath = readText(properties[FIELD_LANDING_PATH]);
  const measurementConsent = readText(properties[FIELD_MEASUREMENT_CONSENT]);
  const fbcColumn = metaFbcColumn();
  const metaFbc = fbcColumn ? readText(properties[fbcColumn]) : "";
  const utm = {
    source: readText(properties[FIELD_UTM_SOURCE]),
    medium: readText(properties[FIELD_UTM_MEDIUM]),
    campaign: readText(properties[FIELD_UTM_CAMPAIGN]),
    content: readText(properties[FIELD_UTM_CONTENT]),
    term: readText(properties[FIELD_UTM_TERM]),
  };
  const hasUtm = Object.values(utm).some(Boolean);
  const pressOutbox = readText(properties[FIELD_PRESS_EVENT]);
  const pressSync = readText(properties[FIELD_PRESS_SYNC]);

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
    ...readSignupCountryFields(properties),
    suspect: Boolean((properties.Suspect as { checkbox?: boolean } | undefined)?.checkbox),
    flags:
      (properties.Flags as { multi_select?: { name?: string }[] } | undefined)?.multi_select
        ?.map((option) => option.name ?? "")
        .filter(Boolean) ?? [],
    phone: readText(properties.Phone),
    smsConsent: readText(properties["SMS consent"]),
    leadId: readText(properties[FIELD_LEAD_ID]),
    metaEventId: readText(properties[FIELD_META_EVENT_ID]),
    sends: typeof sends === "number" && Number.isFinite(sends) ? sends : 0,
    ...(sentAt ? { sentAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(welcomeAt ? { welcomeAt } : {}),
    // Opt-out markers only (launchMail/audience.ts, reservation-mail/campaign.ts).
    ...optOutCells(properties),
    ...(reminder ? { reminder } : {}),
    ...(landingPath ? { landingPath } : {}),
    ...(measurementConsent ? { measurementConsent } : {}),
    ...(isMetaFbc(metaFbc) ? { metaFbc } : {}),
    ...(hasUtm ? { utm } : {}),
    ...readSocialIdentity(properties),
    ...(() => {
      try { const context = prepareCompatibilityRequest(JSON.parse(readText(properties[COMPATIBILITY_NOTION_PROPERTY]) || 'null')); return context ? { compatibility: context } : {}; }
      catch { return {}; }
    })(),
    ...(pressOutbox ? { pressOutbox } : {}),
    ...(pressSync ? { pressSync } : {}),
  };
}

function readSocialIdentity(
  properties: Record<string, unknown>,
): Pick<
  LeadRecord,
  | "signupMethod"
  | "googleSubject"
  | "appleSubject"
  | "authVerificationProvenance"
  | "signupLocale"
  | "signedUpAt"
  | "duplicate"
> {
  const methodName = (properties[FIELD_SIGNUP_METHOD] as { select?: { name?: string } } | undefined)?.select
    ?.name;
  const signupMethod =
    methodName === "email" || methodName === "google" || methodName === "apple" ? methodName : undefined;
  const googleSubject = readText(properties[FIELD_GOOGLE_SUBJECT]);
  const appleSubject = readText(properties[FIELD_APPLE_SUBJECT]);
  const provenance = readText(properties[FIELD_AUTH_VERIFICATION_PROVENANCE]);
  const signupLocale = readText(properties[FIELD_SIGNUP_LOCALE]);
  const signedUpAt = readDate(properties[FIELD_SIGNED_UP]);
  const duplicate = Boolean(
    (properties[FIELD_DUPLICATE] as { checkbox?: boolean } | undefined)?.checkbox,
  );
  return {
    ...(signupMethod ? { signupMethod } : {}),
    ...(SUBJECT_PATTERN.test(googleSubject) ? { googleSubject } : {}),
    ...(SUBJECT_PATTERN.test(appleSubject) ? { appleSubject } : {}),
    ...(provenance ? { authVerificationProvenance: provenance } : {}),
    ...(signupLocale ? { signupLocale } : {}),
    ...(signedUpAt ? { signedUpAt } : {}),
    ...(duplicate ? { duplicate: true } : {}),
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
  fbclidProperty: string | undefined = process.env.NOTION_FBCLID_PROPERTY,
): Record<string, ReturnType<typeof textProp>> {
  if (!attribution) return {};
  const fbclidColumn = fbclidProperty?.trim();
  const pairs: [string, string | undefined][] = [
    [FIELD_UTM_SOURCE, attribution.utmSource],
    [FIELD_UTM_MEDIUM, attribution.utmMedium],
    [FIELD_UTM_CAMPAIGN, attribution.utmCampaign],
    [FIELD_UTM_CONTENT, attribution.utmContent],
    [FIELD_UTM_TERM, attribution.utmTerm],
    [FIELD_LANDING_PATH, attribution.landingPath],
    // Opt-in column: see LeadAttribution.fbclid.
    ...(fbclidColumn
      ? ([[fbclidColumn, attribution.fbclid]] as [string, string | undefined][])
      : []),
  ];
  return Object.fromEntries(
    pairs
      .filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()))
      .map(([name, value]) => [name, textProp(value)]),
  );
}

/**
 * All three cells, or none. `unknown` is written on purpose: an empty cell
 * would be indistinguishable from a row that predates the columns. UTM blanks
 * stay omitted; this observation does not.
 */
export function signupCountryProperties(
  observation: SignupCountryObservation | undefined,
): Record<string, ReturnType<typeof textProp> | { date: { start: string } }> {
  const clean = coerceSignupCountryObservation(observation);
  if (!clean) return {};
  return {
    [FIELD_SIGNUP_COUNTRY]: textProp(clean.country),
    [FIELD_SIGNUP_COUNTRY_SOURCE]: textProp(clean.countrySource),
    [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: { start: clean.countryObservedAt } },
  };
}

/**
 * Additive property patch for the live waitlist database. Not applied by this
 * process. Notion's database update merges the keys it is given, so this
 * object must be sent alone — never as a full replacement of `properties`.
 */
export function signupCountryNotionPropertyPatch(): {
  properties: {
    [FIELD_SIGNUP_COUNTRY]: { rich_text: Record<string, never> };
    [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: Record<string, never> };
    [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: Record<string, never> };
  };
} {
  return {
    properties: {
      [FIELD_SIGNUP_COUNTRY]: { rich_text: {} },
      [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: {} },
      [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: {} },
    },
  };
}

function readSignupCountryFields(
  properties: Record<string, unknown>,
): Pick<LeadRecord, "signupCountry" | "signupCountrySource" | "signupCountryObservedAt"> {
  const country = persistableSignupCountry(readText(properties[FIELD_SIGNUP_COUNTRY]));
  const sourceText = readText(properties[FIELD_SIGNUP_COUNTRY_SOURCE]);
  const source =
    sourceText === SIGNUP_COUNTRY_SOURCE_VERCEL || sourceText === SIGNUP_COUNTRY_SOURCE_UNKNOWN
      ? sourceText
      : undefined;
  const observed = readDate(properties[FIELD_SIGNUP_COUNTRY_OBSERVED]);
  const observedMs = observed ? Date.parse(observed) : Number.NaN;
  return {
    ...(country ? { signupCountry: country } : {}),
    ...(source ? { signupCountrySource: source } : {}),
    ...(Number.isFinite(observedMs)
      ? { signupCountryObservedAt: new Date(observedMs).toISOString() }
      : {}),
  };
}

type OptionalLeadWrite = {
  fbc: boolean;
  experiment: boolean;
  fbclid: boolean;
  country: boolean;
  method: boolean;
  provenance: boolean;
  locale: boolean;
  subject: boolean;
  press: boolean;
};

type LeadWriteContext = {
  fbcColumn?: string;
  fbclidColumn?: string;
  requireProviderSubject: boolean;
  subjectField?: string;
};

function mentionsSignupCountryColumn(named: ReadonlySet<string>): boolean {
  return SIGNUP_COUNTRY_FIELDS.some((name) => named.has(name));
}

function omitFbclid(attribution: LeadAttribution): LeadAttribution {
  const { fbclid: _ignored, ...rest } = attribution;
  return rest;
}

/**
 * A missing optional column is a validation 400 that names that column. Retry
 * only then, and only by dropping the named column. A timeout or a 5xx is not
 * retried: the first request may already have created the row.
 */
async function createLeadPage(
  create: (options: OptionalLeadWrite) => Promise<Record<string, unknown>>,
  options: OptionalLeadWrite,
  columns: LeadWriteContext,
): Promise<Record<string, unknown>> {
  try {
    return await create(options);
  } catch (error) {
    const named =
      error instanceof NotionRequestError &&
      error.status === 400 &&
      error.code === "validation_error"
        ? new Set(error.rejectedOptionalColumns)
        : new Set<string>();
    if (
      options.subject &&
      columns.requireProviderSubject &&
      columns.subjectField &&
      named.has(columns.subjectField)
    ) {
      throw new SocialAuthSchemaError();
    }
    const next: OptionalLeadWrite = { ...options };
    if (options.experiment && named.has(FIELD_CONVERSION_EXPERIMENT)) next.experiment = false;
    if (options.fbc && columns.fbcColumn && named.has(columns.fbcColumn)) next.fbc = false;
    if (options.fbclid && columns.fbclidColumn && named.has(columns.fbclidColumn))
      next.fbclid = false;
    if (options.country && mentionsSignupCountryColumn(named)) next.country = false;
    if (options.method && named.has(FIELD_SIGNUP_METHOD)) next.method = false;
    if (options.provenance && named.has(FIELD_AUTH_VERIFICATION_PROVENANCE)) next.provenance = false;
    if (options.locale && named.has(FIELD_SIGNUP_LOCALE)) next.locale = false;
    if (options.subject && columns.subjectField && named.has(columns.subjectField)) next.subject = false;
    if (options.press && (named.has(FIELD_PRESS_EVENT) || named.has(FIELD_PRESS_SYNC))) next.press = false;
    const dropped =
      next.experiment !== options.experiment ||
      next.fbc !== options.fbc ||
      next.fbclid !== options.fbclid ||
      next.country !== options.country ||
      next.method !== options.method ||
      next.provenance !== options.provenance ||
      next.locale !== options.locale ||
      next.subject !== options.subject ||
      next.press !== options.press;
    if (dropped) {
      if (options.experiment && !next.experiment) {
        console.error("[conversion-experiment] optional context omitted", {
          status: error instanceof NotionRequestError ? error.status : 0,
          code: error instanceof NotionRequestError ? error.code : "",
        });
      }
      if (options.country && !next.country) {
        console.error("[signup-country] optional columns omitted", {
          status: error instanceof NotionRequestError ? error.status : 0,
          code: error instanceof NotionRequestError ? error.code : "",
        });
      }
      if (options.press && !next.press) {
        console.error("[press-attribution] optional columns omitted", {
          status: error instanceof NotionRequestError ? error.status : 0,
          code: error instanceof NotionRequestError ? error.code : "",
        });
      }
      return createLeadPage(create, next, columns);
    }
    throw error;
  }
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
    async recordCompatibility(pageId, context) {
      // Required context only; no retry without it and no verification/profile writes.
      await request("PATCH", `pages/${pageId}`, { properties: compatibilityNotionProperties(context) });
    },
    async recordPhoneOptIn(pageId, phone, consent) {
      // Narrow PATCH: never change email status, attribution, dates, or measurement consent.
      await request("PATCH", `pages/${pageId}`, {
        properties: { Phone: textProp(phone), "SMS consent": textProp(consent) },
      });
    },
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

    async listByAddress(canonical, email) {
      // A handful of rows per address at most; more than this many pages is
      // not a person, and a partial list could miss the opt-out, so it throws.
      const rows: LeadRecord[] = [];
      let cursor: string | undefined;
      for (let page = 0; ; page++) {
        if (page >= 3) throw new Error("Too many rows for one address");
        const result = await withCanonicalEmailShape(() =>
          request("POST", `databases/${databaseId}/query`, {
            filter: {
              or: [
                ...canonicalEmailFilters(canonical),
                { property: "Email", title: { equals: email } },
              ],
            },
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        );
        for (const raw of (result.results as Record<string, unknown>[] | undefined) ?? []) {
          const row = toLeadRecord(raw);
          if (row) rows.push(row);
        }
        if (!result.has_more || typeof result.next_cursor !== "string") break;
        cursor = result.next_cursor;
      }
      return rows;
    },

    async findByLeadId(leadId) {
      return queryOne({ property: FIELD_LEAD_ID, rich_text: { equals: leadId } });
    },

    async listByProviderSubject(provider, sub) {
      if (!SUBJECT_PATTERN.test(sub)) return [];
      const field = provider === "google" ? FIELD_GOOGLE_SUBJECT : FIELD_APPLE_SUBJECT;
      try {
        const result = await request("POST", `databases/${databaseId}/query`, {
          filter: { property: field, rich_text: { equals: sub } },
          page_size: 100,
          sorts: [{ property: FIELD_SIGNED_UP, direction: "ascending" }],
        });
        if (result.has_more) throw new SocialAuthSchemaError();
        return ((result.results as Record<string, unknown>[] | undefined) ?? [])
          .map((page) => toLeadRecord(page))
          .filter((row): row is LeadRecord => Boolean(row));
      } catch (error) {
        if (error instanceof SocialAuthSchemaError) throw error;
        if (
          error instanceof NotionRequestError &&
          error.status === 400 &&
          error.code === "validation_error" &&
          error.rejectedOptionalColumns.includes(field)
        ) {
          throw new SocialAuthSchemaError();
        }
        throw error;
      }
    },

    async attachProviderSubject(pageId, provider, sub, provenance) {
      if (!SUBJECT_PATTERN.test(sub)) return "conflict";
      const field = provider === "google" ? FIELD_GOOGLE_SUBJECT : FIELD_APPLE_SUBJECT;
      const current = toLeadRecord(await request("GET", `pages/${pageId}`));
      if (!current) return "conflict";
      const stored = provider === "google" ? current.googleSubject : current.appleSubject;
      if (stored === sub) return "present";
      if (stored) return "conflict";
      const properties: Record<string, unknown> = { [field]: textProp(sub) };
      if (!current.authVerificationProvenance && provenance.length > 0 && provenance.length <= 200) {
        properties[FIELD_AUTH_VERIFICATION_PROVENANCE] = textProp(provenance);
      }
      try {
        await request("PATCH", `pages/${pageId}`, { properties });
      } catch (error) {
        const named =
          error instanceof NotionRequestError && error.status === 400
            ? error.rejectedOptionalColumns
            : [];
        if (named.includes(field)) throw new SocialAuthSchemaError();
        if (named.includes(FIELD_AUTH_VERIFICATION_PROVENANCE)) {
          await request("PATCH", `pages/${pageId}`, { properties: { [field]: textProp(sub) } });
          return "attached";
        }
        throw error;
      }
      return "attached";
    },

    async markDuplicate(pageId) {
      try {
        await request("PATCH", `pages/${pageId}`, {
          properties: { [FIELD_DUPLICATE]: { checkbox: true } },
        });
      } catch (error) {
        if (
          error instanceof NotionRequestError &&
          error.status === 400 &&
          error.rejectedOptionalColumns.includes(FIELD_DUPLICATE)
        ) {
          throw new SocialAuthSchemaError();
        }
        throw error;
      }
    },

    async noteVerificationSend(pageId, input) {
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [FIELD_VERIFICATION_SENDS]: { number: input.sends },
          [FIELD_VERIFICATION_SENT]: { date: { start: input.sentAt } },
        },
      });
    },

    async createPending(input: CreatePendingInput) {
      const fbcColumn = input.metaFbc && isMetaFbc(input.metaFbc) ? metaFbcColumn() : undefined;
      const fbclidColumn = process.env.NOTION_FBCLID_PROPERTY?.trim() || undefined;
      const experimentJson = input.experiment ? encodeLeadExperiment(input.experiment) : null;
      const subjectField = input.googleSubject
        ? FIELD_GOOGLE_SUBJECT
        : input.appleSubject
          ? FIELD_APPLE_SUBJECT
          : undefined;
      if (input.requireProviderSubject && !subjectField) throw new SocialAuthSchemaError();
      const base: OptionalLeadWrite = {
        fbc: Boolean(fbcColumn),
        experiment: Boolean(experimentJson),
        fbclid: Boolean(fbclidColumn && input.attribution?.fbclid),
        country: Boolean(input.signupCountry),
        method: Boolean(input.signupMethod),
        provenance: Boolean(input.authVerificationProvenance),
        locale: Boolean(input.signupLocale),
        subject: Boolean(subjectField),
        press: Boolean(input.pressOutbox),
      };
      const create = (options: OptionalLeadWrite) => {
        const attribution = input.attribution
          ? options.fbclid
            ? input.attribution
            : omitFbclid(input.attribution)
          : undefined;
        return withCanonicalEmailShape(() =>
          request("POST", "pages", {
            parent: { database_id: databaseId },
            properties: {
              Email: { title: [{ text: { content: input.email } }] },
              ...canonicalEmailProperties(input.canonical),
              ...(input.phone?.trim() ? { Phone: textProp(input.phone.trim()) } : {}),
              Source: { select: { name: input.source } },
              ...(input.compatibility ? compatibilityNotionProperties(input.compatibility) : {}),
              ...(options.method && input.signupMethod
                ? { [FIELD_SIGNUP_METHOD]: { select: { name: input.signupMethod } } }
                : {}),
              ...(options.subject && input.googleSubject
                ? { [FIELD_GOOGLE_SUBJECT]: textProp(input.googleSubject) }
                : {}),
              ...(options.subject && input.appleSubject
                ? { [FIELD_APPLE_SUBJECT]: textProp(input.appleSubject) }
                : {}),
              ...(options.provenance && input.authVerificationProvenance
                ? { [FIELD_AUTH_VERIFICATION_PROVENANCE]: textProp(input.authVerificationProvenance) }
                : {}),
              ...(options.locale && input.signupLocale
                ? { [FIELD_SIGNUP_LOCALE]: textProp(input.signupLocale) }
                : {}),
              "Signed up": { date: { start: input.signedUpAt } },
              "Ref code": textProp(input.refCode),
              ...(input.referredBy && input.referredBy !== input.refCode
                ? { "Referred by": textProp(input.referredBy) }
                : {}),
              ...(input.flags.length
                ? { Flags: { multi_select: input.flags.map((name) => ({ name })) } }
                : {}),
              Suspect: { checkbox: input.suspect },
              ...attributionProperties(attribution),
              ...(options.country ? signupCountryProperties(input.signupCountry) : {}),
              [FIELD_VERIFICATION_STATUS]: { select: { name: STATUS_PENDING } },
              [FIELD_EMAIL_VERIFIED]: { checkbox: false },
              [FIELD_LEAD_ID]: textProp(input.leadId),
              [FIELD_VERIFICATION_EXPIRES]: { date: { start: input.expiresAt } },
              [FIELD_VERIFICATION_SENDS]: { number: 1 },
              ...(input.measurementState
                ? { [FIELD_MEASUREMENT_CONSENT]: textProp(input.measurementState) }
                : {}),
              ...(options.fbc && fbcColumn && input.metaFbc
                ? { [fbcColumn]: textProp(input.metaFbc) }
                : {}),
              ...(options.experiment && experimentJson
                ? { [FIELD_CONVERSION_EXPERIMENT]: textProp(experimentJson) }
                : {}),
              ...(options.press && input.pressOutbox
                ? {
                    [FIELD_PRESS_EVENT]: textProp(input.pressOutbox),
                    [FIELD_PRESS_SYNC]: textProp(input.pressSync ?? PRESS_SYNC_HELD),
                  }
                : {}),
            },
          }),
        );
      };
      const page = await createLeadPage(create, base, {
        fbcColumn,
        fbclidColumn,
        requireProviderSubject: Boolean(input.requireProviderSubject),
        ...(subjectField ? { subjectField } : {}),
      });
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

    async recordMeasurementState(pageId: string, state: string) {
      // The consent cell on its own: an optional column can never take it down.
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_MEASUREMENT_CONSENT]: textProp(state) },
      });
    },

    async recordMeasurementFbc(pageId: string, metaFbc: string) {
      const column = metaFbcColumn();
      if (!column || !isMetaFbc(metaFbc)) return;
      await request("PATCH", `pages/${pageId}`, {
        properties: { [column]: textProp(metaFbc) },
      });
    },

    async recordMeasurementWithdrawal(pageId: string) {
      // The flag first: a grant never writes Flags, so once it is there every
      // grant's confirming read restores the refusal and every send stops —
      // even a grant that read the row before this call started. Read-merge-
      // write keeps the abuse flags already there.
      const flagged = await (async () => {
        const current = toLeadRecord(await request("GET", `pages/${pageId}`));
        const flags = new Set([...(current?.flags ?? []), FLAG_MEASUREMENT_WITHDRAWN]);
        await request("PATCH", `pages/${pageId}`, {
          properties: { Flags: { multi_select: [...flags].map((name) => ({ name })) } },
        });
      })().then(
        () => true,
        () => false,
      );
      // Then the cell, on its own and regardless: a Flags write Notion rejects
      // (an option it will not create, say) must not take the refusal with it.
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [FIELD_MEASUREMENT_CONSENT]: textProp(MEASUREMENT_CONSENT_WITHDRAWN),
        },
      });
      const column = metaFbcColumn();
      if (column) {
        await request("PATCH", `pages/${pageId}`, {
          properties: { [column]: { rich_text: [] } },
        }).catch(() => {
          // The click cookie is never sent once withdrawn either way.
        });
      }
      // The experiment cell is optional measurement context. Clearing it must
      // not undo the consent withdrawal above when the column is absent.
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_CONVERSION_EXPERIMENT]: { rich_text: [] } },
      }).catch(() => {});
      if (!flagged) throw new Error("measurement-withdrawn flag not written");
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

/**
 * The reminder job's view of the same database. Every query and write names
 * `Verification reminder`, so until that property exists Notion rejects them
 * all with `validation_error` and the job sends nothing.
 */
export function createNotionReminderStore(
  request: NotionRequest,
  databaseId: string,
): ReminderStore {
  const pendingNotSuspect = [
    { property: FIELD_VERIFICATION_STATUS, select: { equals: STATUS_PENDING } },
    { property: FIELD_EMAIL_VERIFIED, checkbox: { equals: false } },
    { property: FIELD_SUSPECT, checkbox: { equals: false } },
  ];

  return {
    async findReminderCandidates(query) {
      const result = await request("POST", `databases/${databaseId}/query`, {
        filter: {
          and: [
            ...pendingNotSuspect,
            { property: FIELD_VERIFICATION_REMINDER, rich_text: { is_empty: true } },
            { property: FIELD_VERIFICATION_SENT, date: { on_or_before: query.sentOnOrBefore } },
            { property: FIELD_VERIFICATION_SENT, date: { on_or_after: query.sentOnOrAfter } },
          ],
        },
        sorts: [{ property: FIELD_VERIFICATION_SENT, direction: "ascending" }],
        page_size: Math.min(Math.max(query.limit, 1), 100),
      });
      return ((result.results as Record<string, unknown>[] | undefined) ?? [])
        .map(toLeadRecord)
        .filter((record): record is LeadRecord => Boolean(record));
    },

    async claimReminder(pageId, claim) {
      // One PATCH: the claim, the widened window for the new link, and the
      // send counter. If Notion rejects any of it, none of it applies and the
      // caller sends nothing.
      await request("PATCH", `pages/${pageId}`, {
        properties: {
          [FIELD_VERIFICATION_REMINDER]: textProp(claim.marker),
          [FIELD_VERIFICATION_EXPIRES]: { date: { start: claim.expiresAt } },
          [FIELD_VERIFICATION_SENDS]: { number: claim.sends },
        },
      });
    },

    async recordReminderOutcome(pageId, outcome) {
      if (!outcome.trim()) throw new Error("A reminder outcome must never clear the claim");
      await request("PATCH", `pages/${pageId}`, {
        properties: { [FIELD_VERIFICATION_REMINDER]: textProp(outcome) },
      });
    },

    async reread(pageId) {
      return toLeadRecord(await request("GET", `pages/${pageId}`));
    },

    async countUnsentPending(window) {
      let count = 0;
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await request("POST", `databases/${databaseId}/query`, {
          filter: {
            and: [
              ...pendingNotSuspect,
              { property: FIELD_VERIFICATION_SENT, date: { is_empty: true } },
              { property: FIELD_SIGNED_UP, date: { on_or_after: window.signedUpOnOrAfter } },
              { property: FIELD_SIGNED_UP, date: { before: window.signedUpBefore } },
            ],
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        count += (result.results as unknown[] | undefined)?.length ?? 0;
        if (!result.has_more || typeof result.next_cursor !== "string") break;
        cursor = result.next_cursor;
      }
      return count;
    },
  };
}
