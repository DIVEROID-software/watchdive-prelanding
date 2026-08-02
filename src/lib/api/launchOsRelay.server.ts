import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { canonicalEmail } from "./abuse.ts";
import {
  launchOsConsentChoiceSchema,
  launchOsMeasurementContextSchema,
  launchOsWebEventSchema,
  type LaunchOsBrowserRequestFacts,
  type LaunchOsPostDependencies,
  type LaunchOsStreamDiagnostic,
  type LaunchOsStreamStatus,
  type LaunchOsWebEventInput,
} from "./launchOsRelay.contract.ts";
import {
  OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
  OPTIONAL_MEASUREMENT_CONSENT_VERSION,
} from "../measurementConsentContract.ts";
import {
  LAUNCHOS_REPLAY_METADATA_MAX_LENGTH,
  type LaunchOsAuthorizedMeasurementContext,
  type LaunchOsMeasurementContext,
  type LaunchOsReplaySeed,
} from "../verification/contracts.ts";

const EVENTS_PATH = "/api/events";
const HMAC_DOMAIN = "launchos-ingress-v2";
const REPLAY_DOMAIN = "watchdive-launchos-replay-v3";
export const LAUNCHOS_REPLAY_CONTRACT_VERSION = "watchdive_launchos_replay_v3" as const;
const CONSENT_COOKIE_DOMAIN = "watchdive-launchos-consent-cookie-v1";
export const LAUNCHOS_CONSENT_COOKIE_NAME = "watchdive_launchos_authority_v1";
const CONSENT_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const DIRECT_RELAY_MODE = "bounded_direct_partial" as const;
const DEFAULT_TIMEOUT_MS = 1_200;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SITES_HOST_SUFFIX = ".chatgpt.site";
const META_ID = /^[0-9]{4,32}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/;
const EMAIL_CANONICAL = /^[^\s@]+@[^\s@]+$/;
const AUTHORITY_REFERENCE_HASH = /^[a-f0-9]{64}$/;
const CANONICAL_LEAD_ID = /^lead_hmacv1_[a-f0-9]{64}$/;

export const WEBSITE_CONSENT_AUTHORITY_TYPE = "website_consent" as const;

const launchOsAuthorizedMeasurementContextSchema = launchOsMeasurementContextSchema
  .extend({
    authorityReferenceHash: z.string().regex(AUTHORITY_REFERENCE_HASH),
    attributionAuthority: z.literal("approved_meta_identity_snapshot_v1"),
  })
  .strict();

const replayAttributionSchema = z
  .object({
    campaignId: z.string().regex(META_ID).optional(),
    adsetId: z.string().regex(META_ID).optional(),
    targetId: z.string().regex(META_ID).optional(),
    adId: z.string().regex(META_ID).optional(),
    contentId: z.string().regex(META_ID).optional(),
  })
  .strict();

const launchOsReplaySnapshotSchema = z
  .object({
    contractVersion: z.literal(LAUNCHOS_REPLAY_CONTRACT_VERSION),
    projectId: z.string().regex(PROJECT_ID),
    funnelVersion: z.string().regex(VERSION_ID),
    environment: z.enum(["production", "preview", "development"]),
    path: z.literal("website"),
    signedUpAt: z.string().datetime({ offset: true }),
    suspect: z.boolean(),
    qualityRuleVersion: z.string().regex(VERSION_ID),
    verificationPolicyVersion: z.string().regex(VERSION_ID),
    funnelInstanceId: z.string().regex(/^fi_v1_[A-Za-z0-9_-]{32}$/),
    canonicalLeadId: z.string().regex(CANONICAL_LEAD_ID),
    identityReasonCode: z.literal("canonical_email_hmac_v1"),
    channel: z.enum(["meta", "attribution_unknown"]),
    attribution: replayAttributionSchema,
    attributionAuthority: z.literal("approved_meta_identity_snapshot_v1"),
    attributionIdentityReasonCode: z.enum([
      "approved_meta_identity_registry_match_v1",
      "no_approved_meta_identity_v1",
    ]),
    measurementConsent: z
      .object({
        purpose: z.literal(OPTIONAL_MEASUREMENT_CONSENT_PURPOSE),
        state: z.literal("granted"),
        version: z.literal(OPTIONAL_MEASUREMENT_CONSENT_VERSION),
      })
      .strict(),
    authorityType: z.literal(WEBSITE_CONSENT_AUTHORITY_TYPE),
    authorityReferenceHash: z.string().regex(AUTHORITY_REFERENCE_HASH),
  })
  .strict()
  .superRefine((value, context) => {
    const attributed = Object.keys(value.attribution).length > 0;
    const complete = Boolean(
      value.attribution.campaignId &&
      value.attribution.adsetId &&
      value.attribution.adId &&
      value.attribution.targetId === value.attribution.adsetId &&
      value.attribution.contentId === value.attribution.adId,
    );
    const consistent = attributed
      ? complete &&
        value.channel === "meta" &&
        value.attributionIdentityReasonCode === "approved_meta_identity_registry_match_v1"
      : value.channel === "attribution_unknown" &&
        value.attributionIdentityReasonCode === "no_approved_meta_identity_v1";
    if (!consistent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attribution"],
        message: "inconsistent approved attribution snapshot",
      });
    }
  });

export type LaunchOsReplaySnapshot = z.infer<typeof launchOsReplaySnapshotSchema>;

const FORBIDDEN_PII_KEYS = new Set([
  "email",
  "emailaddress",
  "rawemail",
  "phone",
  "phonenumber",
  "telephone",
  "mobile",
  "ip",
  "ipaddress",
  "clientipaddress",
  "useragent",
  "clientuseragent",
  "firstname",
  "lastname",
  "fullname",
  "contact",
  "token",
  "fbp",
  "fbc",
  "fbclid",
]);

type LaunchOsEventName =
  | LaunchOsWebEventInput["eventName"]
  | "submit_succeeded"
  | "lead_created"
  | "lead_validated"
  | "lead_validation_failed"
  | "lead_verified"
  | "lead_verification_failed";

type LaunchOsEvent = {
  eventId: string;
  eventName: LaunchOsEventName;
  occurredAt: string;
  path: "website";
  environment: "production" | "preview" | "development";
  funnelVersion: string;
  funnelInstanceId: string;
  canonicalLeadId?: string;
  channel: string;
  campaignId?: string;
  adsetId?: string;
  targetId?: string;
  adId?: string;
  contentId?: string;
  consentPurpose: typeof OPTIONAL_MEASUREMENT_CONSENT_PURPOSE;
  consentState: "granted";
  consentVersion: typeof OPTIONAL_MEASUREMENT_CONSENT_VERSION;
  authorityType: typeof WEBSITE_CONSENT_AUTHORITY_TYPE;
  authorityReferenceHash: string;
  qualityRuleVersion?: string;
  verificationPolicyVersion?: string;
  statusReasonCode?: string;
  isTest: boolean;
};

type RelayStream = "web_events" | "lead_store" | "verification";
type RelayConfig = {
  baseUrl: URL;
  projectId: string;
  funnelVersion: string;
  environment: LaunchOsEvent["environment"];
  keyId: string;
  secret: string;
  source: "watchdive_landing" | "watchdive_lead_store" | "watchdive_verification";
  sitesAuthorization: string | null;
  timeoutMs: number;
  maxAttempts: number;
};

class RelayConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "RelayConfigError";
    this.code = code;
  }
}

function cleanEnv(env: NodeJS.ProcessEnv, name: string) {
  return (env[name] ?? "").trim();
}

function boundedInteger(raw: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacHex(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function launchOsHmacCanonicalString(
  keyId: string,
  timestamp: string,
  nonce: string,
  pathname: string,
  rawBody: string,
) {
  return [HMAC_DOMAIN, keyId, timestamp, nonce, "POST", pathname, sha256Hex(rawBody)].join("\n");
}

function freshNonce() {
  return `n_${randomBytes(24).toString("base64url")}`;
}

function diagnostic(
  status: LaunchOsStreamStatus,
  code: string,
  attempts = 0,
): LaunchOsStreamDiagnostic {
  return {
    status,
    code,
    attempts,
    evidenceState: "event_observation_only",
    coveragePublished: false,
    decisionReady: false,
  };
}

function normalizePiiKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertLaunchOsPiiFree(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertLaunchOsPiiFree(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PII_KEYS.has(normalizePiiKey(key))) {
      throw new Error(`${path}.${key} is a forbidden PII field`);
    }
    assertLaunchOsPiiFree(child, `${path}.${key}`);
  }
}

function exactOrigin(raw: string | null | undefined, requireHttps: boolean) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.origin !== raw ||
      url.username ||
      url.password ||
      (requireHttps ? url.protocol !== "https:" : !["https:", "http:"].includes(url.protocol))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function authorizeLaunchOsBrowserRelayRequest(facts: LaunchOsBrowserRequestFacts) {
  if (facts.serverFnHeader !== "true")
    return { allowed: false as const, code: "SERVER_FN_HEADER_REQUIRED" };
  if (facts.secFetchSite !== null && facts.secFetchSite !== "same-origin") {
    return { allowed: false as const, code: "FETCH_SITE_REJECTED" };
  }
  const origin = exactOrigin(facts.origin, false);
  let requestUrl: URL;
  try {
    requestUrl = new URL(facts.requestUrl);
  } catch {
    return { allowed: false as const, code: "REQUEST_URL_INVALID" };
  }
  if (!origin || origin !== requestUrl.origin) {
    return { allowed: false as const, code: "ORIGIN_MISMATCH" };
  }
  const configuredOrigin = exactOrigin(facts.configuredPublicOrigin, true);
  if (facts.nodeEnv === "production") {
    if (!configuredOrigin || configuredOrigin !== origin) {
      return { allowed: false as const, code: "PUBLIC_ORIGIN_REJECTED" };
    }
  } else if (!isLoopback(requestUrl.hostname) && configuredOrigin !== origin) {
    return { allowed: false as const, code: "DEVELOPMENT_ORIGIN_REJECTED" };
  }
  if (facts.secGpc?.trim() === "1") {
    return { allowed: false as const, code: "GLOBAL_PRIVACY_CONTROL_REJECTED" };
  }
  return { allowed: true as const, code: "BROWSER_REQUEST_ACCEPTED" };
}

function currentBrowserRequestFacts(): LaunchOsBrowserRequestFacts {
  const request = getRequest();
  return {
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    secGpc: request.headers.get("sec-gpc"),
    serverFnHeader: request.headers.get("x-tsr-serverfn"),
    consentCookie: getCookie(LAUNCHOS_CONSENT_COOKIE_NAME) ?? null,
    configuredPublicOrigin: process.env.WATCHDIVE_PUBLIC_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
  };
}

function resolveBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = cleanEnv(env, "LAUNCHOS_BASE_URL");
  if (!raw) throw new RelayConfigError("BASE_URL_MISSING");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayConfigError("BASE_URL_INVALID");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !isLoopback(url.hostname))
  ) {
    throw new RelayConfigError("BASE_URL_INVALID");
  }
  return url;
}

function resolveSitesAuthorization(env: NodeJS.ProcessEnv, baseUrl: URL) {
  const raw = env.LAUNCHOS_SITES_BEARER_TOKEN;
  const token = raw?.trim() ?? "";
  const isSites = baseUrl.protocol === "https:" && baseUrl.hostname.endsWith(SITES_HOST_SUFFIX);
  if (!isSites) {
    if (token) throw new RelayConfigError("SITES_BEARER_DESTINATION_MISMATCH");
    return null;
  }
  if (
    !token ||
    token !== raw ||
    token.length < 24 ||
    token.length > 1_024 ||
    !/^[A-Za-z0-9._~-]+$/.test(token)
  ) {
    throw new RelayConfigError("SITES_BEARER_INVALID");
  }
  return `Bearer ${token}`;
}

function streamPrefix(stream: RelayStream) {
  if (stream === "web_events") return "LAUNCHOS_WEB_EVENTS";
  if (stream === "lead_store") return "LAUNCHOS_LEAD_STORE";
  return "LAUNCHOS_VERIFICATION";
}

function resolveRelayConfig(stream: RelayStream, env: NodeJS.ProcessEnv): RelayConfig {
  if (cleanEnv(env, "LAUNCHOS_MEASUREMENT_ENABLED") !== "true") {
    throw new RelayConfigError("MEASUREMENT_DISABLED");
  }
  const baseUrl = resolveBaseUrl(env);
  const projectId = cleanEnv(env, "LAUNCHOS_PROJECT_ID");
  const funnelVersion = cleanEnv(env, "LAUNCHOS_FUNNEL_VERSION");
  const environment = cleanEnv(env, "LAUNCHOS_ENVIRONMENT");
  const prefix = streamPrefix(stream);
  const keyId = cleanEnv(env, `${prefix}_INGRESS_KEY_ID`);
  const rawSecret = env[`${prefix}_INGRESS_SECRET`] ?? "";
  const secret = rawSecret.trim();
  const otherSecrets = (
    ["LAUNCHOS_WEB_EVENTS", "LAUNCHOS_LEAD_STORE", "LAUNCHOS_VERIFICATION"] as const
  )
    .filter((candidate) => candidate !== prefix)
    .map((candidate) => env[`${candidate}_INGRESS_SECRET`] ?? "")
    .filter(Boolean);
  const otherKeyIds = (
    ["LAUNCHOS_WEB_EVENTS", "LAUNCHOS_LEAD_STORE", "LAUNCHOS_VERIFICATION"] as const
  )
    .filter((candidate) => candidate !== prefix)
    .map((candidate) => cleanEnv(env, `${candidate}_INGRESS_KEY_ID`))
    .filter(Boolean);

  if (
    !PROJECT_ID.test(projectId) ||
    !VERSION_ID.test(funnelVersion) ||
    !["production", "preview", "development"].includes(environment) ||
    (cleanEnv(env, "VERCEL_ENV") === "production" && environment !== "production") ||
    !KEY_ID.test(keyId) ||
    secret !== rawSecret ||
    secret.length < 24 ||
    secret.length > 512 ||
    otherSecrets.includes(secret) ||
    otherKeyIds.includes(keyId)
  ) {
    throw new RelayConfigError(`${stream.toUpperCase()}_CONFIG_INVALID`);
  }
  return {
    baseUrl,
    projectId,
    funnelVersion,
    environment: environment as RelayConfig["environment"],
    keyId,
    secret,
    source:
      stream === "web_events"
        ? "watchdive_landing"
        : stream === "lead_store"
          ? "watchdive_lead_store"
          : "watchdive_verification",
    sitesAuthorization: resolveSitesAuthorization(env, baseUrl),
    timeoutMs: boundedInteger(
      cleanEnv(env, "LAUNCHOS_RELAY_TIMEOUT_MS"),
      DEFAULT_TIMEOUT_MS,
      250,
      10_000,
    ),
    maxAttempts: boundedInteger(
      cleanEnv(env, "LAUNCHOS_RELAY_MAX_ATTEMPTS"),
      DEFAULT_MAX_ATTEMPTS,
      1,
      3,
    ),
  };
}

const approvedMetaIdentitySchema = z
  .array(
    z
      .object({
        campaignId: z.string().regex(META_ID),
        adsetId: z.string().regex(META_ID),
        adId: z.string().regex(META_ID),
      })
      .strict(),
  )
  .max(10_000);

export function resolveApprovedMetaAttribution(
  attribution: LaunchOsMeasurementContext["attribution"],
  rawRegistry: string | undefined,
): LaunchOsMeasurementContext["attribution"] {
  if (Object.keys(attribution).length === 0) return {};
  if (
    !attribution.campaignId ||
    !attribution.adsetId ||
    !attribution.adId ||
    attribution.targetId !== attribution.adsetId ||
    attribution.contentId !== attribution.adId
  ) {
    return {};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawRegistry ?? "");
  } catch {
    return {};
  }
  const registry = approvedMetaIdentitySchema.safeParse(raw);
  if (!registry.success) return {};
  const approved = registry.data.some(
    (candidate) =>
      candidate.campaignId === attribution.campaignId &&
      candidate.adsetId === attribution.adsetId &&
      candidate.adId === attribution.adId,
  );
  return approved
    ? {
        campaignId: attribution.campaignId,
        adsetId: attribution.adsetId,
        targetId: attribution.adsetId,
        adId: attribution.adId,
        contentId: attribution.adId,
      }
    : {};
}

function baseEvent(
  context: LaunchOsAuthorizedMeasurementContext,
  config: RelayConfig,
): Omit<LaunchOsEvent, "eventId" | "eventName" | "occurredAt"> {
  // This context crossed a server-only binding or an HMAC-sealed replay
  // envelope. Never re-run a later registry against it: doing so would mutate
  // the payload under a deterministic event id and make retries conflict.
  const attribution = context.attribution;
  return {
    path: "website",
    environment: config.environment,
    funnelVersion: config.funnelVersion,
    funnelInstanceId: context.funnelInstanceId,
    channel: Object.keys(attribution).length ? "meta" : "attribution_unknown",
    ...(attribution.campaignId ? { campaignId: attribution.campaignId } : {}),
    ...(attribution.adsetId ? { adsetId: attribution.adsetId, targetId: attribution.adsetId } : {}),
    ...(attribution.adId ? { adId: attribution.adId, contentId: attribution.adId } : {}),
    consentPurpose: context.measurementConsent.purpose,
    consentState: context.measurementConsent.state,
    consentVersion: context.measurementConsent.version,
    authorityType: WEBSITE_CONSENT_AUTHORITY_TYPE,
    authorityReferenceHash: context.authorityReferenceHash,
    isTest: config.environment !== "production",
  };
}

function replayBaseEvent(
  snapshot: LaunchOsReplaySnapshot,
): Omit<LaunchOsEvent, "eventId" | "eventName" | "occurredAt"> {
  return {
    path: snapshot.path,
    environment: snapshot.environment,
    funnelVersion: snapshot.funnelVersion,
    funnelInstanceId: snapshot.funnelInstanceId,
    channel: snapshot.channel,
    ...(snapshot.attribution.campaignId ? { campaignId: snapshot.attribution.campaignId } : {}),
    ...(snapshot.attribution.adsetId
      ? {
          adsetId: snapshot.attribution.adsetId,
          targetId: snapshot.attribution.targetId,
        }
      : {}),
    ...(snapshot.attribution.adId
      ? { adId: snapshot.attribution.adId, contentId: snapshot.attribution.contentId }
      : {}),
    consentPurpose: snapshot.measurementConsent.purpose,
    consentState: snapshot.measurementConsent.state,
    consentVersion: snapshot.measurementConsent.version,
    authorityType: snapshot.authorityType,
    authorityReferenceHash: snapshot.authorityReferenceHash,
    isTest: snapshot.environment !== "production",
  };
}

function eventRunId(stream: RelayStream, events: LaunchOsEvent[]) {
  return `wd_${stream}_${sha256Hex(
    events
      .map((event) => event.eventId)
      .sort()
      .join("\n"),
  ).slice(0, 48)}`;
}

function validOccurredAt(value: string, nowMs: number) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= Date.UTC(2020, 0, 1) && parsed <= nowMs + 5 * 60_000;
}

async function postEventBatch(
  stream: RelayStream,
  eventsFactory: (config: RelayConfig, env: NodeJS.ProcessEnv) => LaunchOsEvent[],
  dependencies: LaunchOsPostDependencies = {},
  replayProjectId?: string,
) {
  const env = dependencies.env ?? process.env;
  let config: RelayConfig;
  try {
    config = resolveRelayConfig(stream, env);
  } catch (error) {
    return diagnostic(
      "disabled",
      error instanceof RelayConfigError ? error.code : "CONFIG_INVALID",
    );
  }
  let rawBody: string;
  try {
    const events = eventsFactory(config, env);
    const payload = {
      projectId: replayProjectId ?? config.projectId,
      source: config.source,
      runId: eventRunId(stream, events),
      events,
    };
    assertLaunchOsPiiFree(payload);
    rawBody = JSON.stringify(payload);
  } catch {
    return diagnostic("invalid", "PAYLOAD_REJECTED");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nowImpl = dependencies.nowImpl ?? (() => Date.now());
  const nonceFactory = dependencies.nonceFactory ?? freshNonce;
  const sleepImpl =
    dependencies.sleepImpl ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const timestamp = String(Math.floor(nowImpl() / 1_000));
    const nonce = nonceFactory();
    if (!NONCE.test(nonce)) return diagnostic("failed", "NONCE_INVALID", attempt - 1);
    const signature = hmacHex(
      config.secret,
      launchOsHmacCanonicalString(config.keyId, timestamp, nonce, EVENTS_PATH, rawBody),
    );
    try {
      const response = await fetchImpl(new URL(EVENTS_PATH, config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LaunchOS-Key-Id": config.keyId,
          "X-LaunchOS-Timestamp": timestamp,
          "X-LaunchOS-Nonce": nonce,
          "X-LaunchOS-Signature": signature,
          ...(config.sitesAuthorization
            ? { "OAI-Sites-Authorization": config.sitesAuthorization }
            : {}),
        },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (response.ok) {
        const acknowledgement = await response.json().catch(() => null);
        return acknowledgement &&
          typeof acknowledgement === "object" &&
          "ok" in acknowledgement &&
          acknowledgement.ok === true
          ? diagnostic("accepted", "INGRESS_ACCEPTED", attempt)
          : diagnostic("failed", "INGRESS_ACK_INVALID", attempt);
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt === config.maxAttempts) {
        return diagnostic("failed", `INGRESS_HTTP_${response.status}`, attempt);
      }
    } catch {
      if (attempt === config.maxAttempts)
        return diagnostic("failed", "INGRESS_TRANSPORT_FAILED", attempt);
    }
    await sleepImpl(Math.min(1_000, 150 * 2 ** (attempt - 1)));
  }
  return diagnostic("failed", "INGRESS_ATTEMPTS_EXHAUSTED", config.maxAttempts);
}

export async function relayLaunchOsWebEvent(
  input: LaunchOsWebEventInput,
  authorityReferenceHash: string,
  dependencies: LaunchOsPostDependencies = {},
) {
  const parsed = launchOsWebEventSchema.safeParse(input);
  const nowMs = dependencies.nowImpl?.() ?? Date.now();
  if (
    !parsed.success ||
    !AUTHORITY_REFERENCE_HASH.test(authorityReferenceHash) ||
    !validOccurredAt(parsed.data.occurredAt, nowMs)
  ) {
    return diagnostic("invalid", "WEB_EVENT_INPUT_REJECTED");
  }
  const authorizedContext: LaunchOsAuthorizedMeasurementContext = {
    funnelInstanceId: parsed.data.funnelInstanceId,
    attribution: {},
    measurementConsent: parsed.data.measurementConsent,
    authorityReferenceHash,
    attributionAuthority: "approved_meta_identity_snapshot_v1",
  };
  return postEventBatch(
    "web_events",
    (config, env) => {
      const trustedContext = {
        ...authorizedContext,
        attribution: resolveApprovedMetaAttribution(
          parsed.data.attribution,
          env.LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON,
        ),
      };
      return [
        {
          ...baseEvent(trustedContext, config),
          eventId: parsed.data.eventId,
          eventName: parsed.data.eventName,
          occurredAt: new Date(parsed.data.occurredAt).toISOString(),
        },
      ];
    },
    dependencies,
  );
}

export async function relayLaunchOsWebEventFromBrowser(
  input: LaunchOsWebEventInput,
  facts: LaunchOsBrowserRequestFacts,
  dependencies: LaunchOsPostDependencies = {},
) {
  const decision = authorizeLaunchOsBrowserRelayRequest(facts);
  if (!decision.allowed) return diagnostic("invalid", decision.code);
  const authorityReferenceHash = launchOsConsentAuthorityReferenceHash(
    facts.consentCookie,
    dependencies.env ?? process.env,
    dependencies.nowImpl?.() ?? Date.now(),
  );
  if (!authorityReferenceHash) {
    return diagnostic("invalid", "SIGNED_CONSENT_AUTHORITY_REQUIRED");
  }
  return relayLaunchOsWebEvent(input, authorityReferenceHash, dependencies);
}

export async function relayLaunchOsWebEventFromCurrentRequest(input: LaunchOsWebEventInput) {
  try {
    return await relayLaunchOsWebEventFromBrowser(input, currentBrowserRequestFacts());
  } catch {
    return diagnostic("invalid", "REQUEST_CONTEXT_UNAVAILABLE");
  }
}

function identitySecret(env: NodeJS.ProcessEnv) {
  const raw = env.LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET ?? "";
  const ingressSecrets = [
    env.LAUNCHOS_WEB_EVENTS_INGRESS_SECRET,
    env.LAUNCHOS_LEAD_STORE_INGRESS_SECRET,
    env.LAUNCHOS_VERIFICATION_INGRESS_SECRET,
    env.WAITLIST_REPLAY_HMAC_SECRET,
  ].filter(Boolean);
  if (raw !== raw.trim() || raw.length < 32 || raw.length > 512 || ingressSecrets.includes(raw)) {
    throw new RelayConfigError("LEAD_IDENTITY_SECRET_INVALID");
  }
  return raw;
}

export function deriveCanonicalLeadId(projectId: string, normalizedEmail: string, secret: string) {
  if (
    !PROJECT_ID.test(projectId) ||
    !EMAIL_CANONICAL.test(normalizedEmail) ||
    normalizedEmail !== normalizedEmail.trim().toLowerCase() ||
    secret.length < 32
  ) {
    throw new Error("canonical lead identity input is invalid");
  }
  return `lead_hmacv1_${hmacHex(secret, `launchos-canonical-lead-v1\n${projectId}\n${normalizedEmail}`)}`;
}

function deterministicReplayEventId(
  snapshot: LaunchOsReplaySnapshot,
  eventName: LaunchOsEventName,
  occurredAt = snapshot.signedUpAt,
) {
  // Every input is HMAC-sealed in the CRM envelope. Including occurredAt keeps
  // the identifier/payload pair immutable even when two non-atomic Notion
  // verification writes race with different timestamps.
  return `wd_evt_${sha256Hex(
    [
      LAUNCHOS_REPLAY_CONTRACT_VERSION,
      snapshot.projectId,
      eventName === "submit_succeeded" ? snapshot.funnelInstanceId : snapshot.canonicalLeadId,
      eventName,
      eventName.startsWith("lead_validation") ? snapshot.qualityRuleVersion : "",
      eventName.startsWith("lead_verification") || eventName === "lead_verified"
        ? snapshot.verificationPolicyVersion
        : "",
      occurredAt,
    ].join("\n"),
  )}`;
}

function replaySecret(env: NodeJS.ProcessEnv) {
  const raw = env.WAITLIST_REPLAY_HMAC_SECRET ?? "";
  const forbidden = [
    env.LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET,
    env.LAUNCHOS_WEB_EVENTS_INGRESS_SECRET,
    env.LAUNCHOS_LEAD_STORE_INGRESS_SECRET,
    env.LAUNCHOS_VERIFICATION_INGRESS_SECRET,
  ].filter(Boolean);
  if (raw !== raw.trim() || raw.length < 32 || raw.length > 512 || forbidden.includes(raw)) {
    throw new RelayConfigError("REPLAY_SECRET_INVALID");
  }
  return raw;
}

export function createLaunchOsConsentCookie(nowMs: number, env: NodeJS.ProcessEnv = process.env) {
  if (!Number.isSafeInteger(nowMs) || nowMs < Date.UTC(2020, 0, 1)) {
    throw new Error("Consent cookie time is invalid");
  }
  const issuedAt = String(Math.floor(nowMs / 1_000));
  const payload = [
    CONSENT_COOKIE_DOMAIN,
    issuedAt,
    OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
    OPTIONAL_MEASUREMENT_CONSENT_VERSION,
  ].join("\n");
  return `wdac_v1.${issuedAt}.${hmacHex(replaySecret(env), payload)}`;
}

export function verifyLaunchOsConsentCookie(
  cookie: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
) {
  const match = /^wdac_v1\.([0-9]{10})\.([a-f0-9]{64})$/.exec(cookie ?? "");
  if (!match) return false;
  const issuedAtMs = Number(match[1]) * 1_000;
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs > nowMs + 5 * 60_000 ||
    nowMs - issuedAtMs > CONSENT_COOKIE_MAX_AGE_SECONDS * 1_000
  ) {
    return false;
  }
  let secret: string;
  try {
    secret = replaySecret(env);
  } catch {
    return false;
  }
  const payload = [
    CONSENT_COOKIE_DOMAIN,
    match[1],
    OPTIONAL_MEASUREMENT_CONSENT_PURPOSE,
    OPTIONAL_MEASUREMENT_CONSENT_VERSION,
  ].join("\n");
  return safeEqual(match[2], hmacHex(secret, payload));
}

/** Stable for one server-issued grant and opaque outside this service. */
export function launchOsConsentAuthorityReferenceHash(
  cookie: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
) {
  return verifyLaunchOsConsentCookie(cookie, env, nowMs) && cookie ? sha256Hex(cookie) : undefined;
}

export function resolveLaunchOsConsentAuthorityBinding(
  existingCookie: string | null | undefined,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  const existingReference = launchOsConsentAuthorityReferenceHash(existingCookie, env, nowMs);
  if (existingCookie && existingReference) {
    return {
      cookie: existingCookie,
      authorityReferenceHash: existingReference,
      fresh: false as const,
      code: "CONSENT_AUTHORITY_REUSED" as const,
    };
  }
  const cookie = createLaunchOsConsentCookie(nowMs, env);
  return {
    cookie,
    authorityReferenceHash: sha256Hex(cookie),
    fresh: true as const,
    code: "CONSENT_AUTHORITY_BOUND_FRESH" as const,
  };
}

export function currentRequestLaunchOsConsentAuthorityReference() {
  if (cleanEnv(process.env, "LAUNCHOS_MEASUREMENT_ENABLED") !== "true") return undefined;
  const facts = currentBrowserRequestFacts();
  const decision = authorizeLaunchOsBrowserRelayRequest(facts);
  return decision.allowed
    ? launchOsConsentAuthorityReferenceHash(facts.consentCookie, process.env)
    : undefined;
}

export function bindLaunchOsMeasurementContext(
  input: LaunchOsMeasurementContext,
  authorityReferenceHash: string,
  env: NodeJS.ProcessEnv = process.env,
): LaunchOsAuthorizedMeasurementContext | undefined {
  const parsed = launchOsMeasurementContextSchema.safeParse(input);
  if (!parsed.success || !AUTHORITY_REFERENCE_HASH.test(authorityReferenceHash)) return undefined;
  return {
    funnelInstanceId: parsed.data.funnelInstanceId,
    attribution: resolveApprovedMetaAttribution(
      parsed.data.attribution,
      env.LAUNCHOS_APPROVED_META_IDENTITY_REGISTRY_JSON,
    ),
    measurementConsent: parsed.data.measurementConsent,
    ...(parsed.data.placement ? { placement: parsed.data.placement } : {}),
    authorityReferenceHash,
    attributionAuthority: "approved_meta_identity_snapshot_v1",
  };
}

export function bindCurrentRequestLaunchOsMeasurementContext(input: LaunchOsMeasurementContext) {
  const authorityReferenceHash = currentRequestLaunchOsConsentAuthorityReference();
  return authorityReferenceHash
    ? bindLaunchOsMeasurementContext(input, authorityReferenceHash, process.env)
    : undefined;
}

export function hasCurrentRequestLaunchOsConsentAuthority() {
  return Boolean(currentRequestLaunchOsConsentAuthorityReference());
}

export function setLaunchOsMeasurementAuthorityForCurrentRequest(input: unknown) {
  if (cleanEnv(process.env, "LAUNCHOS_MEASUREMENT_ENABLED") !== "true") {
    return { ok: false as const, state: "denied" as const, code: "MEASUREMENT_DISABLED" };
  }
  const parsed = launchOsConsentChoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, state: "denied" as const, code: "CONSENT_RECORD_INVALID" };
  }
  const facts = currentBrowserRequestFacts();
  const decision = authorizeLaunchOsBrowserRelayRequest(facts);
  if (!decision.allowed && decision.code !== "GLOBAL_PRIVACY_CONTROL_REJECTED") {
    return { ok: false as const, state: "denied" as const, code: decision.code };
  }
  if (parsed.data.state === "denied" || facts.secGpc?.trim() === "1") {
    deleteCookie(LAUNCHOS_CONSENT_COOKIE_NAME, { path: "/" });
    return {
      ok: true as const,
      state: "denied" as const,
      code:
        facts.secGpc?.trim() === "1"
          ? "GLOBAL_PRIVACY_CONTROL_APPLIED"
          : "CONSENT_AUTHORITY_REVOKED",
    };
  }
  const requestUrl = new URL(facts.requestUrl);
  const binding = resolveLaunchOsConsentAuthorityBinding(
    facts.consentCookie,
    Date.now(),
    process.env,
  );
  if (binding.fresh) {
    setCookie(LAUNCHOS_CONSENT_COOKIE_NAME, binding.cookie, {
      httpOnly: true,
      secure: requestUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return { ok: true as const, state: "granted" as const, code: binding.code };
}

export function sealLaunchOsReplayMetadata(
  input: LaunchOsReplaySeed,
  env: NodeJS.ProcessEnv = process.env,
) {
  const context = launchOsAuthorizedMeasurementContextSchema.safeParse(input.context);
  const signedUpAtMs = Date.parse(input.signedUpAt);
  if (
    !context.success ||
    !EMAIL_CANONICAL.test(input.canonicalEmail) ||
    canonicalEmail(input.canonicalEmail) !== input.canonicalEmail ||
    !Number.isFinite(signedUpAtMs) ||
    signedUpAtMs < Date.UTC(2020, 0, 1) ||
    signedUpAtMs > Date.now() + 5 * 60_000
  ) {
    throw new Error("LaunchOS replay seed is invalid");
  }

  const config = resolveRelayConfig("lead_store", env);
  const qualityRuleVersion = cleanEnv(env, "LAUNCHOS_QUALITY_RULE_VERSION");
  const verificationPolicyVersion = cleanEnv(env, "LAUNCHOS_VERIFICATION_POLICY_VERSION");
  if (!VERSION_ID.test(qualityRuleVersion) || !VERSION_ID.test(verificationPolicyVersion)) {
    throw new Error("LaunchOS replay policy is invalid");
  }
  const attribution = context.data.attribution;
  const attributed = Object.keys(attribution).length > 0;
  const candidate: LaunchOsReplaySnapshot = {
    contractVersion: LAUNCHOS_REPLAY_CONTRACT_VERSION,
    projectId: config.projectId,
    funnelVersion: config.funnelVersion,
    environment: config.environment,
    path: "website",
    signedUpAt: new Date(signedUpAtMs).toISOString(),
    suspect: input.suspect,
    qualityRuleVersion,
    verificationPolicyVersion,
    funnelInstanceId: context.data.funnelInstanceId,
    canonicalLeadId: deriveCanonicalLeadId(
      config.projectId,
      input.canonicalEmail,
      identitySecret(env),
    ),
    identityReasonCode: "canonical_email_hmac_v1",
    channel: attributed ? "meta" : "attribution_unknown",
    attribution,
    attributionAuthority: context.data.attributionAuthority,
    attributionIdentityReasonCode: attributed
      ? "approved_meta_identity_registry_match_v1"
      : "no_approved_meta_identity_v1",
    measurementConsent: context.data.measurementConsent,
    authorityType: WEBSITE_CONSENT_AUTHORITY_TYPE,
    authorityReferenceHash: context.data.authorityReferenceHash,
  };
  const parsed = launchOsReplaySnapshotSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("LaunchOS replay snapshot is invalid");
  const snapshot = parsed.data;
  assertLaunchOsPiiFree(snapshot);
  const encoded = Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64url");
  const mac = hmacHex(replaySecret(env), `${REPLAY_DOMAIN}\n${encoded}`);
  const envelope = `lorm_v3.${encoded}.${mac}`;
  if (envelope.length > LAUNCHOS_REPLAY_METADATA_MAX_LENGTH) {
    throw new Error("LaunchOS replay context is too large");
  }
  return envelope;
}

export function openLaunchOsReplayMetadata(
  envelope: string,
  env: NodeJS.ProcessEnv = process.env,
): LaunchOsReplaySnapshot | undefined {
  const match = /^lorm_v3\.([A-Za-z0-9_-]{20,1907})\.([a-f0-9]{64})$/.exec(envelope);
  if (!match) return undefined;
  let secret: string;
  try {
    secret = replaySecret(env);
  } catch {
    return undefined;
  }
  if (!safeEqual(match[2], hmacHex(secret, `${REPLAY_DOMAIN}\n${match[1]}`))) return undefined;
  try {
    const parsed = launchOsReplaySnapshotSchema.safeParse(
      JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function relayStoredWaitlistLead(input: {
  replayMetadata: string;
  dependencies?: LaunchOsPostDependencies;
}) {
  const dependencies = input.dependencies ?? {};
  const env = dependencies.env ?? process.env;
  const snapshot = openLaunchOsReplayMetadata(input.replayMetadata, env);
  if (!snapshot) {
    return {
      mode: DIRECT_RELAY_MODE,
      webEvents: diagnostic("invalid", "REPLAY_METADATA_REJECTED"),
      leadStore: diagnostic("invalid", "REPLAY_METADATA_REJECTED"),
    };
  }
  if (!dependencies.sourceMeasurementRevoked) {
    return {
      mode: DIRECT_RELAY_MODE,
      webEvents: diagnostic("disabled", "SOURCE_REVOCATION_CHECK_REQUIRED"),
      leadStore: diagnostic("disabled", "SOURCE_REVOCATION_CHECK_REQUIRED"),
    };
  }
  try {
    if (await dependencies.sourceMeasurementRevoked(snapshot.authorityReferenceHash)) {
      return {
        mode: DIRECT_RELAY_MODE,
        webEvents: diagnostic("disabled", "SOURCE_MEASUREMENT_REVOKED"),
        leadStore: diagnostic("disabled", "SOURCE_MEASUREMENT_REVOKED"),
      };
    }
  } catch {
    return {
      mode: DIRECT_RELAY_MODE,
      webEvents: diagnostic("disabled", "SOURCE_REVOCATION_CHECK_FAILED"),
      leadStore: diagnostic("disabled", "SOURCE_REVOCATION_CHECK_FAILED"),
    };
  }
  const occurredAt = snapshot.signedUpAt;
  const webEventsPromise = postEventBatch(
    "web_events",
    (config) => [
      {
        ...replayBaseEvent(snapshot),
        eventId: deterministicReplayEventId(snapshot, "submit_succeeded"),
        eventName: "submit_succeeded",
        occurredAt,
      },
    ],
    dependencies,
    snapshot.projectId,
  );

  const leadStorePromise = postEventBatch(
    "lead_store",
    () => {
      const validationEventName = snapshot.suspect ? "lead_validation_failed" : "lead_validated";
      const shared = replayBaseEvent(snapshot);
      return [
        {
          ...shared,
          eventId: deterministicReplayEventId(snapshot, "lead_created"),
          eventName: "lead_created",
          canonicalLeadId: snapshot.canonicalLeadId,
          occurredAt,
        },
        {
          ...shared,
          eventId: deterministicReplayEventId(snapshot, validationEventName),
          eventName: validationEventName,
          canonicalLeadId: snapshot.canonicalLeadId,
          qualityRuleVersion: snapshot.qualityRuleVersion,
          statusReasonCode: snapshot.suspect ? "suspect_yes" : "suspect_no",
          occurredAt,
        },
      ];
    },
    dependencies,
    snapshot.projectId,
  );
  const [webEvents, leadStore] = await Promise.all([webEventsPromise, leadStorePromise]);
  return { mode: DIRECT_RELAY_MODE, webEvents, leadStore };
}

export async function relayLaunchOsVerificationOutcome(input: {
  replayMetadata: string;
  outcome: "verified" | "failed";
  occurredAt: string;
  reasonCode?: "expired";
  dependencies?: LaunchOsPostDependencies;
}) {
  const dependencies = input.dependencies ?? {};
  const env = dependencies.env ?? process.env;
  const context = openLaunchOsReplayMetadata(input.replayMetadata, env);
  const nowMs = dependencies.nowImpl?.() ?? Date.now();
  if (
    !context ||
    !validOccurredAt(input.occurredAt, nowMs) ||
    Date.parse(input.occurredAt) < Date.parse(context.signedUpAt)
  ) {
    return diagnostic("invalid", "VERIFICATION_INPUT_REJECTED");
  }
  if (!dependencies.sourceMeasurementRevoked) {
    return diagnostic("disabled", "SOURCE_REVOCATION_CHECK_REQUIRED");
  }
  try {
    if (await dependencies.sourceMeasurementRevoked(context.authorityReferenceHash)) {
      return diagnostic("disabled", "SOURCE_MEASUREMENT_REVOKED");
    }
  } catch {
    return diagnostic("disabled", "SOURCE_REVOCATION_CHECK_FAILED");
  }
  if (
    (input.outcome === "verified" && input.reasonCode !== undefined) ||
    (input.outcome === "failed" && input.reasonCode !== "expired")
  ) {
    return diagnostic("invalid", "VERIFICATION_INPUT_REJECTED");
  }
  const eventName = input.outcome === "verified" ? "lead_verified" : "lead_verification_failed";
  const occurredAt = new Date(input.occurredAt).toISOString();
  return postEventBatch(
    "verification",
    () => [
      {
        ...replayBaseEvent(context),
        eventId: deterministicReplayEventId(context, eventName, occurredAt),
        eventName,
        canonicalLeadId: context.canonicalLeadId,
        verificationPolicyVersion: context.verificationPolicyVersion,
        ...(input.reasonCode ? { statusReasonCode: input.reasonCode } : {}),
        occurredAt,
      },
    ],
    dependencies,
    context.projectId,
  );
}
