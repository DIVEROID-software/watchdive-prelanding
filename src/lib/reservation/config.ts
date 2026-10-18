// Reservation stays inert until WATCHDIVE_RESERVATION_ENABLED is exactly
// "true". A live Stripe key is refused unless WATCHDIVE_RESERVATION_ALLOW_LIVE
// is exactly "true", so a test checkout cannot silently take live charges.
import { requirePublicOrigin } from "../verification/token.ts";
import {
  ENV_PUBLIC_ORIGIN,
  ENV_RESERVATION_ALLOW_LIVE,
  ENV_RESERVATION_ENABLED,
  ENV_RESERVATION_TOKEN_SECRET,
  ENV_STRIPE_SECRET_KEY,
  ENV_STRIPE_WEBHOOK_SECRET,
} from "./constants.ts";

export type EnvSource = Record<string, string | undefined>;

export type ReservationConfigProblem =
  | "disabled"
  | "missing_secret_key"
  | "invalid_secret_key"
  | "live_key_refused"
  | "missing_webhook_secret"
  | "invalid_webhook_secret"
  | "missing_token_secret"
  | "invalid_token_secret"
  | "invalid_origin";

export type EnabledReservationConfig = {
  secretKey: string;
  webhookSecret: string | null;
  tokenSecret: string | null;
  origin: string | null;
  livemode: boolean;
  mode: "test" | "live";
};

export type ReservationConfigResult =
  | { ok: true; value: EnabledReservationConfig }
  | {
      ok: false;
      error: "reservation_disabled" | "reservation_misconfigured";
      problem: ReservationConfigProblem;
    };

export type ReservationConfigNeeds = {
  webhookSecret: boolean;
  tokenSecret: boolean;
  origin: boolean;
};

const TEST_KEY = /^(?:sk|rk)_test_\S+$/;
const LIVE_KEY = /^(?:sk|rk)_live_\S+$/;
const WEBHOOK_SECRET = /^whsec_\S+$/;

function trimmed(env: EnvSource, name: string): string {
  return (env[name] ?? "").trim();
}

export function assertTokenSecret(secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("WATCHDIVE_RESERVATION_TOKEN_SECRET must be at least 32 bytes");
  }
  return secret;
}

/**
 * Reads reservation env. Disabled and misconfigured are different: disabled
 * means the feature flag is off (the steady state until root turns it on);
 * misconfigured means the flag is on but a required secret is missing or a
 * live key was presented without the live opt-in.
 */
export function readReservationConfig(
  env: EnvSource,
  needs: ReservationConfigNeeds,
): ReservationConfigResult {
  if (trimmed(env, ENV_RESERVATION_ENABLED) !== "true") {
    return { ok: false, error: "reservation_disabled", problem: "disabled" };
  }

  const secretKey = trimmed(env, ENV_STRIPE_SECRET_KEY);
  if (!secretKey) {
    return { ok: false, error: "reservation_misconfigured", problem: "missing_secret_key" };
  }
  const livemode = LIVE_KEY.test(secretKey);
  const testmode = TEST_KEY.test(secretKey);
  if (!livemode && !testmode) {
    return { ok: false, error: "reservation_misconfigured", problem: "invalid_secret_key" };
  }
  if (secretKey.length < 20) {
    return { ok: false, error: "reservation_misconfigured", problem: "invalid_secret_key" };
  }
  if (livemode && trimmed(env, ENV_RESERVATION_ALLOW_LIVE) !== "true") {
    return { ok: false, error: "reservation_misconfigured", problem: "live_key_refused" };
  }

  let webhookSecret: string | null = null;
  const webhookRaw = trimmed(env, ENV_STRIPE_WEBHOOK_SECRET);
  if (needs.webhookSecret || webhookRaw) {
    if (!webhookRaw) {
      return {
        ok: false,
        error: "reservation_misconfigured",
        problem: "missing_webhook_secret",
      };
    }
    if (!WEBHOOK_SECRET.test(webhookRaw) || webhookRaw.length < 12) {
      return {
        ok: false,
        error: "reservation_misconfigured",
        problem: "invalid_webhook_secret",
      };
    }
    webhookSecret = webhookRaw;
  }
  if (needs.webhookSecret && !webhookSecret) {
    return { ok: false, error: "reservation_misconfigured", problem: "missing_webhook_secret" };
  }

  let tokenSecret: string | null = null;
  const tokenRaw = trimmed(env, ENV_RESERVATION_TOKEN_SECRET);
  if (needs.tokenSecret || tokenRaw) {
    if (!tokenRaw) {
      return { ok: false, error: "reservation_misconfigured", problem: "missing_token_secret" };
    }
    if (Buffer.byteLength(tokenRaw, "utf8") < 32) {
      return { ok: false, error: "reservation_misconfigured", problem: "invalid_token_secret" };
    }
    tokenSecret = tokenRaw;
  }

  let origin: string | null = null;
  if (needs.origin || trimmed(env, ENV_PUBLIC_ORIGIN)) {
    try {
      origin = requirePublicOrigin({ WATCHDIVE_PUBLIC_ORIGIN: env[ENV_PUBLIC_ORIGIN] });
    } catch {
      if (needs.origin) {
        return { ok: false, error: "reservation_misconfigured", problem: "invalid_origin" };
      }
      origin = null;
    }
  }

  return {
    ok: true,
    value: {
      secretKey,
      webhookSecret,
      tokenSecret,
      origin,
      livemode,
      mode: livemode ? "live" : "test",
    },
  };
}
