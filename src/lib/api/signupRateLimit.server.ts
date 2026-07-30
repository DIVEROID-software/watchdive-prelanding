import { createHmac } from "node:crypto";

const RATE_LIMIT_RPC = "consume_signup_rate_limit_v1";
const DEFAULT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 120;
const REQUEST_TIMEOUT_MS = 5_000;

type RateLimitResult = {
  allowed: boolean;
  configured: boolean;
  reason?: "unconfigured" | "missing_ip" | "limited" | "storage_unavailable";
};

function runtimeEnvironment(): "production" | "preview" | "development" {
  const value = process.env.VERCEL_ENV;
  if (value === "production" || value === "preview") return value;
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function allowWhenUnconfigured(environment: ReturnType<typeof runtimeEnvironment>): boolean {
  return environment !== "production";
}

function normalizedRequestHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host || /[\s/@\\?#]/.test(host)) return null;
  try {
    return new URL(`http://${host}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Rejects cross-site browser submissions before they consume a rate-limit
 * bucket. Custom domains and Vercel preview domains need no allowlist because
 * the browser Origin must exactly match the public request Host.
 *
 * joinWaitlist is a browser-only endpoint: missing Origin/Host fails closed in
 * production. Preview/development allow missing headers for local tooling and
 * non-browser smoke tests, but an explicitly mismatched Origin is always
 * rejected.
 */
export function isSignupRequestOriginAllowed(args: { origin: string; host: string }): boolean {
  const environment = runtimeEnvironment();
  const origin = args.origin.trim();
  const host = normalizedRequestHost(args.host);
  if (!origin || !host) return environment !== "production";

  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      return false;
    }
    if (
      parsedOrigin.protocol !== "https:" &&
      !(environment === "development" && parsedOrigin.protocol === "http:")
    ) {
      return false;
    }
    return parsedOrigin.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * Applies a generous, per-network fixed-window limit before any CRM or CAPI
 * write. The raw address exists only in this function's memory. The database
 * receives a window-rotating keyed HMAC that cannot be reversed or correlated
 * across windows without the independently configured secret.
 */
export async function consumeSignupRateLimit(
  args: { ip: string; now?: Date },
  fetchImpl: typeof fetch = fetch,
): Promise<RateLimitResult> {
  const environment = runtimeEnvironment();
  const allowFallback = allowWhenUnconfigured(environment);
  const secret = process.env.SIGNUP_RATE_LIMIT_HMAC_SECRET?.trim() ?? "";
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (secret.length < 32 || !supabaseUrl || !serviceRoleKey) {
    return {
      allowed: allowFallback,
      configured: false,
      reason: "unconfigured",
    };
  }

  const ip = args.ip.trim();
  if (!ip) {
    return {
      allowed: allowFallback,
      configured: true,
      reason: "missing_ip",
    };
  }

  const windowSeconds = boundedInteger(
    process.env.SIGNUP_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_WINDOW_SECONDS,
    60,
    7_200,
  );
  const maxAttempts = boundedInteger(
    process.env.SIGNUP_RATE_LIMIT_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
    10,
    1_000,
  );
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return {
      allowed: allowFallback,
      configured: true,
      reason: "storage_unavailable",
    };
  }
  const windowMs = windowSeconds * 1_000;
  const windowStartedAt = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMs);
  const bucketHash = createHmac("sha256", secret)
    .update(`${environment}\u001fsignup\u001f${windowStartedAt.toISOString()}\u001f${ip}`, "utf8")
    .digest("hex");

  try {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${RATE_LIMIT_RPC}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket_hash: bucketHash,
        p_environment: environment,
        p_window_started_at: windowStartedAt.toISOString(),
        p_expires_at: expiresAt.toISOString(),
        p_limit: maxAttempts,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[signup-rate-limit] storage failed (${response.status})`);
      return {
        allowed: allowFallback,
        configured: true,
        reason: "storage_unavailable",
      };
    }
    const consumed = (await response.json()) as unknown;
    if (consumed !== true && consumed !== false) {
      console.error("[signup-rate-limit] storage returned an invalid response");
      return {
        allowed: allowFallback,
        configured: true,
        reason: "storage_unavailable",
      };
    }
    return {
      allowed: consumed,
      configured: true,
      ...(consumed ? {} : { reason: "limited" as const }),
    };
  } catch (error) {
    console.error(
      "[signup-rate-limit] storage request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      allowed: allowFallback,
      configured: true,
      reason: "storage_unavailable",
    };
  }
}
