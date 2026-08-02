import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  launchOsMeasurementWithdrawalSchema,
  withdrawalResult,
  type LaunchOsMeasurementWithdrawalInput,
  type LaunchOsMeasurementWithdrawalResult,
} from "./launchOsWithdrawal.contract.ts";
import {
  authorizeLaunchOsBrowserRelayRequest,
  launchOsConsentAuthorityReferenceHash,
  launchOsHmacCanonicalString,
  LAUNCHOS_CONSENT_COOKIE_NAME,
  openLaunchOsReplayMetadata,
} from "./launchOsRelay.server.ts";
import type {
  LaunchOsBrowserRequestFacts,
  LaunchOsPostDependencies,
} from "./launchOsRelay.contract.ts";
import { createNotionRequest } from "../verification/notionLead.ts";
import { createNotionMeasurementRevocationRegistry } from "../verification/measurementRevocationRegistry.server.ts";

const WITHDRAWAL_PATH = "/api/privacy/withdrawals";
const WITHDRAWAL_SOURCE = "watchdive_landing" as const;
const SITES_HOST_SUFFIX = ".chatgpt.site";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const DEFAULT_TIMEOUT_MS = 1_200;
const DEFAULT_MAX_ATTEMPTS = 2;
const WITHDRAWAL_CAPABILITY_DOMAIN = "watchdive-withdrawal-retry-capability-v1";
const WITHDRAWAL_RETRY_COOKIE_NAME = "watchdive_launchos_withdrawal_retry_v1";
const WITHDRAWAL_RETRY_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTHORITY_REFERENCE_HASH = /^[a-f0-9]{64}$/;

const acknowledgementSchema = z
  .object({
    ok: z.literal(true),
    duplicate: z.boolean(),
    status: z.enum(["pending_purge", "purged"]),
    linkedCanonicalLeadCount: z.number().int().nonnegative(),
  })
  .passthrough();

type WithdrawalConfig = {
  baseUrl: URL;
  projectId: string;
  keyId: string;
  secret: string;
  sitesAuthorization: string | null;
  timeoutMs: number;
  maxAttempts: number;
};

export type LaunchOsWithdrawalDependencies = LaunchOsPostDependencies & {
  clearAuthority?: () => void;
  setRetryCapability?: (capability: string) => void;
  clearRetryCapability?: () => void;
  revokeSourceMeasurement?: (input: {
    authorityReferenceHash: string;
    requestId: string;
    occurredAt: string;
  }) => Promise<{ matchedRows: number }>;
};

export type LaunchOsWithdrawalBrowserRequestFacts = LaunchOsBrowserRequestFacts & {
  withdrawalRetryCapability?: string | null;
};

class WithdrawalConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "WithdrawalConfigError";
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

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function resolveBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = cleanEnv(env, "LAUNCHOS_BASE_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WithdrawalConfigError("WITHDRAWAL_BASE_URL_INVALID");
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
    throw new WithdrawalConfigError("WITHDRAWAL_BASE_URL_INVALID");
  }
  return url;
}

function resolveSitesAuthorization(env: NodeJS.ProcessEnv, baseUrl: URL) {
  const raw = env.LAUNCHOS_SITES_BEARER_TOKEN ?? "";
  const token = raw.trim();
  const sitesDestination =
    baseUrl.protocol === "https:" && baseUrl.hostname.endsWith(SITES_HOST_SUFFIX);
  if (!sitesDestination) {
    if (token) throw new WithdrawalConfigError("WITHDRAWAL_SITES_DESTINATION_MISMATCH");
    return null;
  }
  if (
    !token ||
    token !== raw ||
    token.length < 24 ||
    token.length > 1_024 ||
    !/^[A-Za-z0-9._~-]+$/.test(token)
  ) {
    throw new WithdrawalConfigError("WITHDRAWAL_SITES_BEARER_INVALID");
  }
  return `Bearer ${token}`;
}

function resolveWithdrawalConfig(env: NodeJS.ProcessEnv): WithdrawalConfig {
  if (
    cleanEnv(env, "LAUNCHOS_MEASUREMENT_ENABLED") !== "true" ||
    cleanEnv(env, "LAUNCHOS_WITHDRAWAL_ENABLED") !== "true"
  ) {
    throw new WithdrawalConfigError("WITHDRAWAL_DISABLED");
  }
  const baseUrl = resolveBaseUrl(env);
  const projectId = cleanEnv(env, "LAUNCHOS_PROJECT_ID");
  const keyId = cleanEnv(env, "LAUNCHOS_WITHDRAWAL_INGRESS_KEY_ID");
  const rawSecret = env.LAUNCHOS_WITHDRAWAL_INGRESS_SECRET ?? "";
  const secret = rawSecret.trim();
  const siblingKeyIds = [
    "LAUNCHOS_WEB_EVENTS_INGRESS_KEY_ID",
    "LAUNCHOS_LEAD_STORE_INGRESS_KEY_ID",
    "LAUNCHOS_VERIFICATION_INGRESS_KEY_ID",
  ]
    .map((name) => cleanEnv(env, name))
    .filter(Boolean);
  const siblingSecrets = [
    "LAUNCHOS_WEB_EVENTS_INGRESS_SECRET",
    "LAUNCHOS_LEAD_STORE_INGRESS_SECRET",
    "LAUNCHOS_VERIFICATION_INGRESS_SECRET",
    "LAUNCHOS_CANONICAL_LEAD_HMAC_SECRET",
    "WAITLIST_REPLAY_HMAC_SECRET",
  ]
    .map((name) => env[name] ?? "")
    .filter(Boolean);
  if (
    !PROJECT_ID.test(projectId) ||
    !KEY_ID.test(keyId) ||
    secret !== rawSecret ||
    secret.length < 24 ||
    secret.length > 512 ||
    siblingKeyIds.includes(keyId) ||
    siblingSecrets.includes(secret)
  ) {
    throw new WithdrawalConfigError("WITHDRAWAL_CONFIG_INVALID");
  }
  return {
    baseUrl,
    projectId,
    keyId,
    secret,
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

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  return (
    left.length === right.length &&
    timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
}

type WithdrawalRetryCapabilityPayload = {
  version: 1;
  requestId: string;
  funnelInstanceId: string;
  occurredAt: string;
  reason: LaunchOsMeasurementWithdrawalInput["reason"];
  authorityReferenceHash: string;
  issuedAt: string;
};

export function createLaunchOsWithdrawalRetryCapability(
  input: LaunchOsMeasurementWithdrawalInput,
  authorityReferenceHash: string,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  const parsed = launchOsMeasurementWithdrawalSchema.safeParse(input);
  if (
    !parsed.success ||
    !AUTHORITY_REFERENCE_HASH.test(authorityReferenceHash) ||
    !Number.isSafeInteger(nowMs)
  ) {
    throw new Error("Withdrawal retry capability input is invalid.");
  }
  const config = resolveWithdrawalConfig(env);
  const payload: WithdrawalRetryCapabilityPayload = {
    version: 1,
    ...parsed.data,
    authorityReferenceHash,
    issuedAt: new Date(nowMs).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", config.secret)
    .update(`${WITHDRAWAL_CAPABILITY_DOMAIN}\n${encoded}`)
    .digest("hex");
  return `wdwrc_v1.${encoded}.${mac}`;
}

export function openLaunchOsWithdrawalRetryCapability(
  capability: string | null | undefined,
  input: LaunchOsMeasurementWithdrawalInput,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): WithdrawalRetryCapabilityPayload | undefined {
  const match = /^wdwrc_v1\.([A-Za-z0-9_-]{80,900})\.([a-f0-9]{64})$/.exec(capability ?? "");
  if (!match) return undefined;
  let config: WithdrawalConfig;
  try {
    config = resolveWithdrawalConfig(env);
  } catch {
    return undefined;
  }
  const expected = createHmac("sha256", config.secret)
    .update(`${WITHDRAWAL_CAPABILITY_DOMAIN}\n${match[1]}`)
    .digest("hex");
  if (!safeEqual(match[2], expected)) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8"),
    ) as WithdrawalRetryCapabilityPayload;
    const parsedInput = launchOsMeasurementWithdrawalSchema.safeParse(input);
    const issuedAtMs = Date.parse(payload.issuedAt);
    if (
      !parsedInput.success ||
      payload.version !== 1 ||
      !AUTHORITY_REFERENCE_HASH.test(payload.authorityReferenceHash) ||
      !Number.isFinite(issuedAtMs) ||
      issuedAtMs > nowMs + 5 * 60_000 ||
      nowMs - issuedAtMs > WITHDRAWAL_RETRY_TTL_SECONDS * 1_000 ||
      payload.requestId !== parsedInput.data.requestId ||
      payload.funnelInstanceId !== parsedInput.data.funnelInstanceId ||
      payload.occurredAt !== parsedInput.data.occurredAt ||
      payload.reason !== parsedInput.data.reason
    ) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}

function requestSourceRunId(requestId: string) {
  return `withdrawal-${sha256Hex(requestId).slice(0, 48)}`;
}

function freshNonce() {
  return `n_${randomBytes(24).toString("base64url")}`;
}

function validOccurredAt(value: string, nowMs: number) {
  const occurredAt = Date.parse(value);
  return (
    Number.isFinite(occurredAt) &&
    occurredAt >= Date.UTC(2020, 0, 1) &&
    occurredAt <= nowMs + 5 * 60_000
  );
}

function currentWithdrawalRequestFacts(): LaunchOsWithdrawalBrowserRequestFacts {
  const request = getRequest();
  return {
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    secGpc: request.headers.get("sec-gpc"),
    serverFnHeader: request.headers.get("x-tsr-serverfn"),
    consentCookie: getCookie(LAUNCHOS_CONSENT_COOKIE_NAME) ?? null,
    withdrawalRetryCapability: getCookie(WITHDRAWAL_RETRY_COOKIE_NAME) ?? null,
    configuredPublicOrigin: process.env.WATCHDIVE_PUBLIC_ORIGIN,
    nodeEnv: process.env.NODE_ENV,
  };
}

/** Posts one idempotent withdrawal intent with fresh HMAC nonces per attempt. */
export async function postLaunchOsMeasurementWithdrawal(
  input: LaunchOsMeasurementWithdrawalInput,
  dependencies: LaunchOsWithdrawalDependencies = {},
): Promise<LaunchOsMeasurementWithdrawalResult> {
  const parsed = launchOsMeasurementWithdrawalSchema.safeParse(input);
  const nowMs = dependencies.nowImpl?.() ?? Date.now();
  if (!parsed.success || !validOccurredAt(parsed.data.occurredAt, nowMs)) {
    return withdrawalResult("invalid", "WITHDRAWAL_INPUT_REJECTED");
  }

  const env = dependencies.env ?? process.env;
  let config: WithdrawalConfig;
  try {
    config = resolveWithdrawalConfig(env);
  } catch (error) {
    const code = error instanceof WithdrawalConfigError ? error.code : "WITHDRAWAL_CONFIG_INVALID";
    return withdrawalResult(
      code === "WITHDRAWAL_DISABLED" ? "disabled" : "failed",
      code,
      0,
      code === "WITHDRAWAL_DISABLED",
    );
  }

  const payload = {
    projectId: config.projectId,
    source: WITHDRAWAL_SOURCE,
    sourceRunId: requestSourceRunId(parsed.data.requestId),
    requestId: parsed.data.requestId,
    funnelInstanceId: parsed.data.funnelInstanceId,
    occurredAt: new Date(parsed.data.occurredAt).toISOString(),
  };
  const rawBody = JSON.stringify(payload);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nonceFactory = dependencies.nonceFactory ?? freshNonce;
  const sleepImpl =
    dependencies.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const timestamp = String(Math.floor((dependencies.nowImpl?.() ?? Date.now()) / 1_000));
    const nonce = nonceFactory();
    const signature = createHmac("sha256", config.secret)
      .update(launchOsHmacCanonicalString(config.keyId, timestamp, nonce, WITHDRAWAL_PATH, rawBody))
      .digest("hex");
    try {
      const response = await fetchImpl(new URL(WITHDRAWAL_PATH, config.baseUrl), {
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
        const acknowledgement = acknowledgementSchema.safeParse(
          await response.json().catch(() => null),
        );
        if (
          !acknowledgement.success ||
          (response.status === 202 && acknowledgement.data.status !== "pending_purge") ||
          (response.status === 200 && acknowledgement.data.status !== "purged")
        ) {
          return withdrawalResult("failed", "WITHDRAWAL_ACK_INVALID", attempt, true);
        }
        return withdrawalResult(
          acknowledgement.data.status,
          acknowledgement.data.status === "purged"
            ? "WITHDRAWAL_PURGED"
            : "WITHDRAWAL_TOMBSTONE_RECORDED",
          attempt,
        );
      }
      if (!RETRYABLE_STATUS.has(response.status) || attempt === config.maxAttempts) {
        return withdrawalResult(
          "failed",
          `WITHDRAWAL_HTTP_${response.status}`,
          attempt,
          RETRYABLE_STATUS.has(response.status),
        );
      }
    } catch {
      if (attempt === config.maxAttempts) {
        return withdrawalResult("failed", "WITHDRAWAL_TRANSPORT_FAILED", attempt, true);
      }
    }
    await sleepImpl(Math.min(1_000, 150 * 2 ** (attempt - 1)));
  }
  return withdrawalResult("failed", "WITHDRAWAL_ATTEMPTS_EXHAUSTED", config.maxAttempts, true);
}

/**
 * Same-origin browser authority is checked before the source-scoped machine
 * credential is used. GPC is authoritative for the reason but is intentionally
 * allowed to initiate a withdrawal.
 */
export async function withdrawLaunchOsMeasurementFromBrowser(
  input: LaunchOsMeasurementWithdrawalInput,
  facts: LaunchOsWithdrawalBrowserRequestFacts,
  dependencies: LaunchOsWithdrawalDependencies = {},
): Promise<LaunchOsMeasurementWithdrawalResult> {
  const parsed = launchOsMeasurementWithdrawalSchema.safeParse(input);
  if (!parsed.success) return withdrawalResult("invalid", "WITHDRAWAL_INPUT_REJECTED");
  const originDecision = authorizeLaunchOsBrowserRelayRequest({ ...facts, secGpc: null });
  if (!originDecision.allowed) {
    return withdrawalResult("invalid", originDecision.code);
  }
  const gpc = facts.secGpc?.trim() === "1";
  if (parsed.data.reason === "global_privacy_control" && !gpc) {
    return withdrawalResult("invalid", "GPC_SIGNAL_REQUIRED");
  }
  const env = dependencies.env ?? process.env;
  const nowMs = dependencies.nowImpl?.() ?? Date.now();
  const initialAuthorityReferenceHash = launchOsConsentAuthorityReferenceHash(
    facts.consentCookie,
    env,
    nowMs,
  );
  const retryCapability = initialAuthorityReferenceHash
    ? undefined
    : openLaunchOsWithdrawalRetryCapability(
        facts.withdrawalRetryCapability,
        parsed.data,
        nowMs,
        env,
      );
  const authorityReferenceHash =
    initialAuthorityReferenceHash ?? retryCapability?.authorityReferenceHash;
  if (!authorityReferenceHash) {
    return withdrawalResult("invalid", "WITHDRAWAL_AUTHORITY_REQUIRED", 0, true);
  }

  // Revocation wins before the first network or CRM await. A failed downstream
  // transport can only leave cleanup pending; it can never leave measurement
  // authority alive. The retry cookie is scoped to this exact PII-free intent.
  if (initialAuthorityReferenceHash) {
    try {
      const capability = createLaunchOsWithdrawalRetryCapability(
        parsed.data,
        authorityReferenceHash,
        nowMs,
        env,
      );
      dependencies.setRetryCapability?.(capability);
    } catch {
      // Misconfigured retry transport never resurrects the authority being
      // withdrawn. The browser marker still preserves the intent.
    }
  }
  dependencies.clearAuthority?.();

  let sourceSuppressed = false;
  try {
    if (!dependencies.revokeSourceMeasurement) {
      throw new Error("source revocation is not configured");
    }
    await dependencies.revokeSourceMeasurement({
      authorityReferenceHash,
      requestId: parsed.data.requestId,
      occurredAt: parsed.data.occurredAt,
    });
    sourceSuppressed = true;
  } catch {
    // The withdrawal-only capability and browser pending marker retain the
    // exact request for another attempt. No measurement authority is restored.
  }

  const result = await postLaunchOsMeasurementWithdrawal(
    { ...parsed.data, reason: gpc ? "global_privacy_control" : "user_denied" },
    dependencies,
  );
  const retryPending = !result.accepted || !sourceSuppressed;
  if (!retryPending) dependencies.clearRetryCapability?.();
  return {
    ...result,
    retryable: retryPending || result.retryable,
    retryPending,
    sourceSuppression: sourceSuppressed ? "complete" : "pending",
  };
}

export async function withdrawLaunchOsMeasurementFromCurrentRequest(
  input: LaunchOsMeasurementWithdrawalInput,
) {
  try {
    const requestUrl = new URL(getRequest().url);
    return await withdrawLaunchOsMeasurementFromBrowser(input, currentWithdrawalRequestFacts(), {
      clearAuthority: () => deleteCookie(LAUNCHOS_CONSENT_COOKIE_NAME, { path: "/" }),
      setRetryCapability: (capability) =>
        setCookie(WITHDRAWAL_RETRY_COOKIE_NAME, capability, {
          httpOnly: true,
          secure: requestUrl.protocol === "https:",
          sameSite: "lax",
          path: "/",
          maxAge: WITHDRAWAL_RETRY_TTL_SECONDS,
        }),
      clearRetryCapability: () => deleteCookie(WITHDRAWAL_RETRY_COOKIE_NAME, { path: "/" }),
      revokeSourceMeasurement: async (revocation) => {
        const databaseId = process.env.NOTION_WAITLIST_DB_ID;
        if (!databaseId) throw new Error("NOTION_WAITLIST_DB_ID is not set");
        const registry = createNotionMeasurementRevocationRegistry({
          request: createNotionRequest(),
          databaseId,
          replaySecret: process.env.WAITLIST_REPLAY_HMAC_SECRET ?? "",
          readReplayAuthority: (envelope) =>
            openLaunchOsReplayMetadata(envelope)?.authorityReferenceHash,
        });
        return registry.revoke(revocation);
      },
    });
  } catch {
    return withdrawalResult("invalid", "WITHDRAWAL_REQUEST_CONTEXT_UNAVAILABLE");
  }
}
