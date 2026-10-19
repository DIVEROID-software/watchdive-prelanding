// Customer-send gate. Dry-run does not call Stripe.
//
// A send may proceed only when reservation is enabled, live mode is allowed,
// the secret key is a live key, the public origin is the production site, and
// a read-only probe can see the pinned Stripe account and the hosted Checkout
// host. This module does not create a Checkout Session.
import { isHostedCheckoutUrl } from "../reservation/checkout.ts";
import {
  ENV_PUBLIC_ORIGIN,
  ENV_RESERVATION_ALLOW_LIVE,
  ENV_RESERVATION_ENABLED,
  STRIPE_API_BASE,
  STRIPE_API_VERSION,
} from "../reservation/constants.ts";
import { readReservationConfig, type EnvSource } from "../reservation/config.ts";

/** Frozen production origin. Preview, QA, and localhost are not this value. */
export const PRODUCTION_ORIGIN = "https://watchdive.diveroid.com";

/** Pinned Diveroid live account from the reservation contract. */
export const PRODUCTION_STRIPE_ACCOUNT = "acct_1Tl9bv1UxFzpSUuA";

const CHECKOUT_REACHABILITY_URL = "https://checkout.stripe.com/";

export type CheckoutProbeInput = {
  secretKey: string;
  origin: string;
};

export type CheckoutProbeResult =
  | { ok: true; checkoutUrl: string; accountId: string }
  | { ok: false; reason: string };

export type CheckoutProbe = (input: CheckoutProbeInput) => Promise<CheckoutProbeResult>;

export type LiveGateResult = { ok: true } | { ok: false; problem: string };

/**
 * Static reasons a customer send must refuse. This does not call the network.
 * The returned text never includes a key or a secret.
 */
export function liveGateConfigProblem(env: EnvSource): string | undefined {
  if ((env[ENV_RESERVATION_ENABLED] ?? "").trim() !== "true") {
    return "WATCHDIVE_RESERVATION_ENABLED must be exactly true";
  }
  if ((env[ENV_RESERVATION_ALLOW_LIVE] ?? "").trim() !== "true") {
    return "WATCHDIVE_RESERVATION_ALLOW_LIVE must be exactly true";
  }
  const config = readReservationConfig(env, {
    webhookSecret: false,
    tokenSecret: true,
    origin: true,
  });
  if (!config.ok) {
    return `reservation config refused (${config.problem})`;
  }
  if (!config.value.livemode || config.value.mode !== "live") {
    return "customer mail requires a live Stripe key";
  }
  if (!isProductionCustomerOrigin(config.value.origin)) {
    return "public origin is not the production site; QA and preview links are not mailed";
  }
  if ((env[ENV_PUBLIC_ORIGIN] ?? "").trim() !== PRODUCTION_ORIGIN) {
    return "public origin is not the production site; QA and preview links are not mailed";
  }
  return undefined;
}

/** True only for the production site. Localhost, Vercel preview, and QA hosts are false. */
export function isProductionCustomerOrigin(origin: string | null | undefined): boolean {
  if (origin !== PRODUCTION_ORIGIN) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return false;
  }
  if (host.endsWith(".vercel.app") || host.includes("preview") || host.startsWith("qa.")) {
    return false;
  }
  return url.protocol === "https:" && host === "watchdive.diveroid.com";
}

export async function assertLiveCustomerSend(
  env: EnvSource,
  probe: CheckoutProbe,
): Promise<LiveGateResult> {
  const problem = liveGateConfigProblem(env);
  if (problem) return { ok: false, problem };
  const config = readReservationConfig(env, {
    webhookSecret: false,
    tokenSecret: true,
    origin: true,
  });
  if (!config.ok || !config.value.livemode || !config.value.origin) {
    return { ok: false, problem: "reservation config refused" };
  }
  let probed: CheckoutProbeResult;
  try {
    probed = await probe({ secretKey: config.value.secretKey, origin: config.value.origin });
  } catch {
    return { ok: false, problem: "production checkout probe failed" };
  }
  if (!probed.ok) return { ok: false, problem: `production checkout unavailable (${probed.reason})` };
  if (!isHostedCheckoutUrl(probed.checkoutUrl)) {
    return { ok: false, problem: "checkout URL is not a Stripe-hosted Checkout URL" };
  }
  if (probed.accountId !== PRODUCTION_STRIPE_ACCOUNT) {
    return { ok: false, problem: "Stripe account does not match the pinned production account" };
  }
  return { ok: true };
}

/**
 * Read-only probe. GET /v1/account, then GET the Checkout host with no
 * Authorization header. It never POSTs and never calls /v1/checkout/sessions.
 * Failure reasons are fixed tokens. The response body is not returned.
 */
export async function probeProductionCheckout(
  input: CheckoutProbeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutProbeResult> {
  let accountResponse: Response;
  try {
    accountResponse = await fetchImpl(`${STRIPE_API_BASE}/v1/account`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${input.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
      },
    });
  } catch {
    return { ok: false, reason: "stripe_account_unreachable" };
  }
  if (accountResponse.status !== 200) return { ok: false, reason: "stripe_account_rejected" };
  let accountId = "";
  let chargesEnabled = false;
  let detailsSubmitted = false;
  try {
    const body = (await accountResponse.json()) as Record<string, unknown>;
    if (typeof body.id === "string") accountId = body.id;
    chargesEnabled = body.charges_enabled === true;
    detailsSubmitted = body.details_submitted === true;
  } catch {
    return { ok: false, reason: "stripe_account_unreadable" };
  }
  if (accountId !== PRODUCTION_STRIPE_ACCOUNT) return { ok: false, reason: "stripe_account_mismatch" };
  if (!chargesEnabled || !detailsSubmitted) return { ok: false, reason: "stripe_account_not_chargeable" };

  let checkoutResponse: Response;
  try {
    checkoutResponse = await fetchImpl(CHECKOUT_REACHABILITY_URL, {
      method: "GET",
      redirect: "manual",
    });
  } catch {
    return { ok: false, reason: "checkout_host_unreachable" };
  }
  if (checkoutResponse.status < 200 || checkoutResponse.status >= 400) {
    return { ok: false, reason: "checkout_host_rejected" };
  }
  if (!isHostedCheckoutUrl(CHECKOUT_REACHABILITY_URL)) {
    return { ok: false, reason: "checkout_url_not_hosted" };
  }
  return {
    ok: true,
    checkoutUrl: CHECKOUT_REACHABILITY_URL,
    accountId,
  };
}
