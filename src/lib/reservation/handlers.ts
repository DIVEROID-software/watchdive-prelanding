// HTTP adapters for the reservation routes. Routes stay thin so tests can call
// these with a fake fetch and a fake env. Nothing here reads the Host header.
import { reservationMeasurement } from "./measurement.server.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { StripeApiError, createStripeClient } from "./stripeApi.ts";
import {
  isHostedCheckoutUrl,
  loadReservationState,
  reservationEmailHash,
  startReservationCheckout,
} from "./checkout.ts";
import { TERMS_VERSION } from "./constants.ts";
import {
  readReservationConfig,
  type EnvSource,
  type ReservationConfigResult,
} from "./config.ts";
import { verifyReservationInvite, type ReservationInvite } from "./invite.ts";
import {
  createReservationNotionMirror,
  readReservationNotionMirrorConfig,
  unavailableReservationMirror,
  type ReservationPaymentMirror,
} from "./notionMirror.ts";
import { sessionOwnedByInbox, type ReservationSnapshot } from "./state.ts";
import { processReservationWebhook } from "./webhook.ts";
import { createNotionLeadStore, createNotionRequest } from "../verification/notionLead.ts";
import { conversionBlocked } from "../verification/contracts.ts";
import {
  cleanPaidSnapshot,
  deliverMeasuredPurchase,
  measuredSignupFromRow,
  planMeasuredPurchase,
  verificationSecretOrNull,
  type MeasuredSignup,
} from "../retargeting/apply.ts";
import type { BrowserRetargetingEvent } from "../retargeting/events.ts";
import { retargetingEventIsFresh } from "../retargeting/freshness.ts";

export type ReservationDeps = {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  /** Test override. Production reads the signup row only for a clean paid snapshot. */
  loadMeasuredSignup?: (email: string) => Promise<MeasuredSignup | null>;
  measurement?: ReturnType<typeof reservationMeasurement>;
};

const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]+$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

function disabledOrMisconfigured(result: ReservationConfigResult): Response | null {
  if (result.ok) return null;
  return json(503, { error: result.error });
}

function envOf(deps: ReservationDeps): EnvSource {
  return deps.env ?? process.env;
}

function stripeFor(
  secretKey: string,
  livemode: boolean,
  deps: ReservationDeps,
) {
  return createStripeClient({
    secretKey,
    fetchImpl: deps.fetchImpl,
    allowLive: livemode,
  });
}

function reservationMirror(deps: ReservationDeps): ReservationPaymentMirror | undefined {
  const config = readReservationNotionMirrorConfig(envOf(deps));
  if (!config.enabled) return undefined;
  if (!config.ok) return unavailableReservationMirror();
  return createReservationNotionMirror({
    request: createNotionRequest(deps.fetchImpl, envOf(deps)),
    databaseId: config.databaseId,
  });
}

function logStripe(scope: string, error: unknown): void {
  if (error instanceof StripeApiError) {
    console.error(
      `[reservation] ${scope} stripe ${error.status} ${error.code || error.type || "error"} request ${error.requestId ?? "-"}`,
    );
    return;
  }
  console.error(`[reservation] ${scope} failed`);
}

export function statusBody(
  snapshot: ReservationSnapshot,
  measurement?: { purchase: BrowserRetargetingEvent },
): Record<string, unknown> {
  return {
    status: snapshot.status,
    paid: snapshot.paid,
    sessionId: snapshot.sessionId,
    amountTotal: snapshot.amountTotal,
    currency: snapshot.currency,
    amountRefunded: snapshot.amountRefunded,
    amountRefundPending: snapshot.amountRefundPending,
    duplicatePaid: snapshot.duplicatePaid,
    source: snapshot.source,
    ...(measurement ? { measurement } : {}),
  };
}

async function loadPaidSignup(deps: ReservationDeps, email: string): Promise<MeasuredSignup | null> {
  if (deps.loadMeasuredSignup) return deps.loadMeasuredSignup(email);
  const config = readReservationNotionMirrorConfig(envOf(deps));
  if (!config.enabled || !config.ok) return null;
  try {
    const store = createNotionLeadStore(createNotionRequest(deps.fetchImpl, envOf(deps)), config.databaseId);
    const inbox = reservationCanonicalEmail(email);
    const row = await store.findByEmail(inbox, email);
    return row ? measuredSignupFromRow(row) : null;
  } catch {
    return null;
  }
}

function measurementNowSeconds(deps: ReservationDeps): number {
  return Math.floor((deps.nowMs ?? Date.now()) / 1000);
}

async function purchaseProof(
  deps: ReservationDeps,
  snapshot: ReservationSnapshot,
  email: string,
  gpc: boolean,
): Promise<{ purchase: BrowserRetargetingEvent } | undefined> {
  if (!cleanPaidSnapshot(snapshot)) return undefined;
  const nowSeconds = measurementNowSeconds(deps);
  if (!retargetingEventIsFresh(snapshot.paidAtSeconds ?? null, nowSeconds)) return undefined;
  const secret = verificationSecretOrNull(envOf(deps));
  if (!secret) return undefined;
  const signup = await loadPaidSignup(deps, email);
  if (!signup) return undefined;
  const planned = planMeasuredPurchase({ snapshot, signup, secret, gpc, nowSeconds });
  if (!planned.plan.emit || !planned.plan.browser) return undefined;
  // Durable Meta Purchase is server-only. Meta's event_id dedup lasts about
  // 48 hours from the first receipt, which does not cover this sender's 7-day
  // window. The browser proof stays so Google Ads and GA4 guards still run.
  if (envOf(deps).WATCHDIVE_META_PURCHASE_ENABLED === "true") {
    return { purchase: { ...planned.plan.browser, metaDelivery: "server" } };
  }
  return { purchase: planned.plan.browser };
}

async function deliverPaidSnapshot(
  deps: ReservationDeps,
  snapshot: ReservationSnapshot,
  email: string | null,
): Promise<void> {
  // The durable sender owns Purchase when its flag is on, and it uses the same
  // retargeting event id as purchaseProof. Posting here too would be a second
  // server event. With the flag off, this legacy path remains the only post.
  if (envOf(deps).WATCHDIVE_META_PURCHASE_ENABLED === "true") return;
  if (!email || !cleanPaidSnapshot(snapshot)) return;
  const nowSeconds = measurementNowSeconds(deps);
  if (!retargetingEventIsFresh(snapshot.paidAtSeconds ?? null, nowSeconds)) return;
  const secret = verificationSecretOrNull(envOf(deps));
  if (!secret) return;
  const signup = await loadPaidSignup(deps, email);
  if (!signup) return;
  const planned = planMeasuredPurchase({ snapshot, signup, secret, gpc: false, nowSeconds });
  if (!planned.plan.emit || !planned.plan.browser) return;
  await deliverMeasuredPurchase({
    plan: planned.plan,
    consent: planned.consent,
    email,
    landingPath: signup.landingPath,
    fbc: signup.fbc,
    nowSeconds,
  });
}

export async function handleReservationCheckout(
  request: Request,
  deps: ReservationDeps = {},
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const config = readReservationConfig(envOf(deps), {
    webhookSecret: true,
    tokenSecret: true,
    origin: true,
  });
  const refused = disabledOrMisconfigured(config);
  if (refused || !config.ok) return refused ?? json(503, { error: "reservation_misconfigured" });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json(415, { error: "bad_request" });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 4096) return json(413, { error: "payload_too_large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_request" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json(400, { error: "bad_request" });
  }
  const body = parsed as {
    inviteToken?: unknown;
    acceptedTerms?: unknown;
    termsVersion?: unknown;
    measurementConsent?: unknown;
    googleClientId?: unknown;
  };
  if (typeof body.inviteToken !== "string") return json(400, { error: "invalid_invite" });
  if (body.acceptedTerms !== true || body.termsVersion !== TERMS_VERSION) {
    return json(400, { error: "rejected_terms" });
  }
  const inviteToken = body.inviteToken;

  const nowMs = deps.nowMs ?? Date.now();
  const invite = verifyReservationInvite(inviteToken, config.value.tokenSecret!, nowMs);
  if (!invite) return json(400, { error: "invalid_invite" });
  // An old signed link is not proof that its signup row still exists. Check
  // immediately before any Stripe call so a deleted/unverified lead cannot
  // create another payment that the webhook has nowhere to record. Standalone
  // test-mode integrations may omit Notion; live checkout never may.
  const mirrorConfig = readReservationNotionMirrorConfig(envOf(deps));
  if (config.value.livemode || mirrorConfig.enabled) {
    if (!mirrorConfig.enabled || !mirrorConfig.ok) {
      return json(503, { error: "reservation_misconfigured" });
    }
    try {
      const store = createNotionLeadStore(createNotionRequest(deps.fetchImpl, envOf(deps)), mirrorConfig.databaseId);
      const row = await store.findByLeadId(invite.leadId);
      if (!row || row.leadId !== invite.leadId || row.status !== "verified" || !row.emailVerified ||
          row.suspect || row.duplicate || conversionBlocked(row.flags) ||
          reservationCanonicalEmail(row.email) !== invite.email) {
        return json(400, { error: "invalid_invite" });
      }
    } catch {
      return json(503, { error: "reservation_unavailable" });
    }
  }

  try {
    const invite =
      config.value.tokenSecret &&
      verifyReservationInvite(inviteToken, config.value.tokenSecret, deps.nowMs ?? Date.now());
    if (!invite) return json(400, { error: "invalid_invite" });
    // Disabled tracking has no checkout dependency. When configured, persist
    // the current choice before Stripe: a failed refusal must not leave an old
    // allowed context eligible for a later payment webhook.
    try {
      await (deps.measurement ?? reservationMeasurement(envOf(deps), deps.fetchImpl))?.capture(
        invite.email,
        body.googleClientId,
        body.measurementConsent === true && request.headers.get("sec-gpc") !== "1",
      );
    } catch {
      return json(503, { error: "measurement_unavailable" });
    }
    const decision = await startReservationCheckout({
      inviteToken,
      config: config.value,
      stripe: stripeFor(config.value.secretKey, config.value.livemode, deps),
      nowMs,
    });
    if (decision.kind === "url") {
      if (!isHostedCheckoutUrl(decision.url)) return json(502, { error: "stripe_contract_mismatch" });
      return json(200, { url: decision.url });
    }
    if (decision.kind === "invalid_invite") return json(400, { error: "invalid_invite" });
    if (decision.kind === "blocked") {
      return json(409, {
        error: decision.error,
        status: decision.snapshot.status,
        paid: decision.snapshot.paid,
      });
    }
    if (decision.kind === "in_progress") return json(409, { error: "reservation_in_progress" });
    if (decision.kind === "contract_mismatch") {
      return json(502, { error: "stripe_contract_mismatch" });
    }
    return json(502, { error: "stripe_error" });
  } catch (error) {
    logStripe("checkout", error);
    return json(502, { error: "stripe_error" });
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer (\S+)$/i.exec(header);
  if (!match?.[1] || /\s/.test(match[1])) return null;
  return match[1];
}

async function inboxStatus(
  stripe: ReturnType<typeof stripeFor>,
  invite: ReservationInvite,
  livemode: boolean,
  nowMs: number,
  sessionId: string | null,
  request: Request,
  deps: ReservationDeps,
): Promise<Response> {
  if (sessionId) {
    const session = await stripe.retrieveCheckoutSession(sessionId);
    const emailSha256 = reservationEmailHash(invite.email);
    if (!sessionOwnedByInbox(session, emailSha256) || !session.customerId) {
      return json(404, { error: "not_found" });
    }
    const customer = await stripe.retrieveCustomer(session.customerId);
    if (!customer.email || reservationCanonicalEmail(customer.email) !== invite.email) {
      return json(404, { error: "not_found" });
    }
  }
  const loaded = await loadReservationState(stripe, invite.email, livemode, nowMs);
  const measurement = await purchaseProof(
    deps,
    loaded.snapshot,
    invite.email,
    request.headers.get("sec-gpc") === "1",
  );
  return json(200, statusBody(loaded.snapshot, measurement));
}

export async function handleReservationStatus(
  request: Request,
  deps: ReservationDeps = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(405, { error: "method_not_allowed" });
  }
  const token = bearerToken(request);
  if (!token) return json(401, { error: "missing_bearer" });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (sessionId && !SESSION_ID.test(sessionId)) return json(400, { error: "bad_request" });

  const config = readReservationConfig(envOf(deps), {
    webhookSecret: false,
    tokenSecret: true,
    origin: false,
  });
  const refused = disabledOrMisconfigured(config);
  if (refused || !config.ok) return refused ?? json(503, { error: "reservation_misconfigured" });

  const secret = config.value.tokenSecret;
  if (!secret) return json(503, { error: "reservation_misconfigured" });
  const nowMs = deps.nowMs ?? Date.now();
  const invite = verifyReservationInvite(token, secret, nowMs);
  if (!invite) return json(401, { error: "invalid_invite" });

  const stripe = stripeFor(config.value.secretKey, config.value.livemode, deps);
  try {
    return await inboxStatus(stripe, invite, config.value.livemode, nowMs, sessionId, request, deps);
  } catch (error) {
    if (error instanceof StripeApiError && error.status === 404) {
      return json(404, { error: "not_found" });
    }
    logStripe("status", error);
    return json(502, { error: "stripe_error" });
  }
}

export async function handleReservationWebhook(
  request: Request,
  deps: ReservationDeps = {},
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  const config = readReservationConfig(envOf(deps), {
    webhookSecret: true,
    tokenSecret: false,
    origin: false,
  });
  const refused = disabledOrMisconfigured(config);
  if (refused || !config.ok) return refused ?? json(503, { error: "reservation_misconfigured" });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) {
    return json(413, { error: "payload_too_large" });
  }
  try {
    const result = await processReservationWebhook({
      rawBody,
      signatureHeader: request.headers.get("stripe-signature"),
      config: config.value,
      stripe: stripeFor(config.value.secretKey, config.value.livemode, deps),
      nowMs: deps.nowMs ?? Date.now(),
      mirror: reservationMirror(deps),
      onPaidSnapshot: (snapshot, email) => deliverPaidSnapshot(deps, snapshot, email),
      measure: (deps.measurement ?? reservationMeasurement(envOf(deps), deps.fetchImpl))?.completed,
    });
    return json(result.httpStatus, result.body);
  } catch (error) {
    logStripe("webhook", error);
    return json(500, { error: "stripe_error" });
  }
}
