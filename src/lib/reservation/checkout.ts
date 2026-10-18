// Hosted Stripe Checkout for the USD 3 reservation fee.
//
// Duplicate protection is a deterministic Idempotency-Key of
// canonical-inbox + offer + spent attempt. The key does not include a lead
// id or a token jti, and the Stripe parameters for that key do not either.
// Customer and session lists are reads used to choose the attempt and to
// reuse or expire sessions. They are not an atomic lock. An unknown Stripe
// error does not advance the attempt. Notion is not a lock.
import { createHash } from "node:crypto";

import { canonicalEmail } from "../api/abuse.ts";
import {
  CANCEL_PATH,
  CHECKOUT_HOST,
  FEE_POLICY,
  LATER_PRODUCT_PRICE_CENTS,
  META_ACCEPTED_TERMS,
  META_CURRENCY,
  META_EMAIL_SHA256,
  META_FEE_CENTS,
  META_FEE_POLICY,
  META_LATER_PRICE_CENTS,
  META_OFFER_VERSION,
  META_PRICE_GUARANTEE,
  META_PRODUCT,
  META_REFUND_POLICY,
  META_TERMS_VERSION,
  PRICE_GUARANTEE,
  PRODUCT_CODE,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  REFUND_POLICY,
  RESERVATION_CURRENCY,
  RESERVATION_FEE_CENTS,
  RESERVATION_OFFER_VERSION,
  SUCCESS_PATH,
  TERMS_VERSION,
} from "./constants.ts";
import type { EnabledReservationConfig } from "./config.ts";
import { verifyReservationInvite, type ReservationInvite } from "./invite.ts";
import {
  isIdempotencyConflict,
  type StripeApi,
  type StripeCheckoutSession,
  type StripeCustomer,
} from "./stripeApi.ts";
import {
  aggregateInspections,
  blockingError,
  inspectSessions,
  isOurProduct,
  lineItemsMatch,
  type InspectedSession,
  type ReservationSnapshot,
} from "./state.ts";

export type CheckoutDecision =
  | { kind: "url"; url: string }
  | {
      kind: "blocked";
      error: "already_paid" | "refunded" | "partially_refunded" | "refund_pending" | "disputed";
      snapshot: ReservationSnapshot;
    }
  | { kind: "invalid_invite" }
  | { kind: "in_progress" }
  | { kind: "stripe_error" }
  | { kind: "contract_mismatch" };

export function reservationEmailHash(email: string): string {
  return createHash("sha256").update(`reservation-email:v1:${email}`).digest("hex");
}

/** One key per canonical inbox, offer, and spent attempt. Lead and jti are not inputs. */
export function reservationIdempotencyKey(emailSha256: string, attempt: number): string {
  return `wdres_v1_${emailSha256}_${RESERVATION_OFFER_VERSION}_a${attempt}`;
}

export function reservationSuccessUrl(origin: string): string {
  return `${origin}${SUCCESS_PATH}`;
}

export function reservationCancelUrl(origin: string): string {
  return `${origin}${CANCEL_PATH}`;
}

/** True only for a Stripe-hosted Checkout URL. Any other https host is refused. */
export function isHostedCheckoutUrl(value: string | null | undefined): value is string {
  if (!value || value !== value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === CHECKOUT_HOST &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443")
  );
}

export function contractMetadata(input: { emailSha256: string }): Record<string, string> {
  return {
    [META_PRODUCT]: PRODUCT_CODE,
    [META_OFFER_VERSION]: RESERVATION_OFFER_VERSION,
    [META_EMAIL_SHA256]: input.emailSha256,
    [META_FEE_CENTS]: String(RESERVATION_FEE_CENTS),
    [META_CURRENCY]: RESERVATION_CURRENCY,
    [META_FEE_POLICY]: FEE_POLICY,
    [META_LATER_PRICE_CENTS]: String(LATER_PRODUCT_PRICE_CENTS),
    [META_PRICE_GUARANTEE]: PRICE_GUARANTEE,
    [META_REFUND_POLICY]: REFUND_POLICY,
    [META_ACCEPTED_TERMS]: "true",
    [META_TERMS_VERSION]: TERMS_VERSION,
  };
}

/**
 * Form fields for POST /v1/checkout/sessions. One-time USD 3.00 (300 cents).
 * ui_mode is `hosted` because Stripe-Version 2024-06-20 rejects `hosted_page`.
 * Lead id and invite jti are omitted so two tokens for one inbox share one body.
 */
export function reservationSessionParams(input: {
  origin: string;
  customerId: string;
  emailSha256: string;
}): Record<string, string> {
  const metadata = contractMetadata(input);
  const params: Record<string, string> = {
    mode: "payment",
    ui_mode: "hosted",
    submit_type: "pay",
    success_url: reservationSuccessUrl(input.origin),
    cancel_url: reservationCancelUrl(input.origin),
    customer: input.customerId,
    client_reference_id: input.emailSha256,
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": RESERVATION_CURRENCY,
    "line_items[0][price_data][unit_amount]": String(RESERVATION_FEE_CENTS),
    "line_items[0][price_data][product_data][name]": PRODUCT_NAME,
    "line_items[0][price_data][product_data][description]": PRODUCT_DESCRIPTION,
  };
  for (const [key, value] of Object.entries(metadata)) {
    params[`metadata[${key}]`] = value;
    params[`payment_intent_data[metadata][${key}]`] = value;
    params[`line_items[0][price_data][product_data][metadata][${key}]`] = value;
  }
  return params;
}

function customerKey(emailSha256: string): string {
  return `wdres_cus_v1_${emailSha256}`;
}

function sameInbox(stored: string | null, email: string): boolean {
  if (!stored) return false;
  return canonicalEmail(stored) === email;
}

async function listCustomers(stripe: StripeApi, email: string): Promise<StripeCustomer[]> {
  const listed = await stripe.listCustomersByEmail(email);
  return listed.filter((customer) => sameInbox(customer.email, email));
}

async function listSessionsFor(
  stripe: StripeApi,
  customers: StripeCustomer[],
): Promise<StripeCheckoutSession[]> {
  const sessions: StripeCheckoutSession[] = [];
  const seen = new Set<string>();
  for (const customer of customers) {
    const page = await stripe.listCheckoutSessions({ customerId: customer.id });
    for (const session of page) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
    }
  }
  return sessions;
}

function chooseCustomer(
  customers: StripeCustomer[],
  sessions: StripeCheckoutSession[],
): StripeCustomer | undefined {
  const withSession = new Set(
    sessions.filter((session) => isOurProduct(session)).map((session) => session.customerId),
  );
  const preferred = customers.filter((customer) => withSession.has(customer.id));
  const pool = preferred.length > 0 ? preferred : customers;
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0];
}

async function findOrCreateCustomer(
  stripe: StripeApi,
  email: string,
  emailSha256: string,
): Promise<StripeCustomer> {
  const existing = await listCustomers(stripe, email);
  const chosen = chooseCustomer(existing, []);
  if (chosen) return chosen;
  try {
    return await stripe.createCustomer(
      {
        email,
        metadata: {
          [META_PRODUCT]: PRODUCT_CODE,
          [META_OFFER_VERSION]: RESERVATION_OFFER_VERSION,
          [META_EMAIL_SHA256]: emailSha256,
        },
      },
      customerKey(emailSha256),
    );
  } catch (error) {
    if (!isIdempotencyConflict(error)) throw error;
    const again = await listCustomers(stripe, email);
    const retry = chooseCustomer(again, []);
    if (retry) return retry;
    throw error;
  }
}

export async function loadReservationState(
  stripe: StripeApi,
  email: string,
  livemode: boolean,
  nowMs: number,
): Promise<{ snapshot: ReservationSnapshot; inspected: InspectedSession[]; customers: StripeCustomer[] }> {
  const emailSha256 = reservationEmailHash(email);
  const customers = await listCustomers(stripe, email);
  const sessions = await listSessionsFor(stripe, customers);
  const inspected = await inspectSessions(stripe, sessions, livemode, nowMs, emailSha256);
  return { snapshot: aggregateInspections(inspected), inspected, customers };
}

async function expireSessions(stripe: StripeApi, sessions: StripeCheckoutSession[]): Promise<void> {
  for (const session of sessions) {
    if (session.status !== "open") continue;
    try {
      await stripe.expireCheckoutSession(session.id);
    } catch (error) {
      if (!isAlreadyClosed(error)) throw error;
    }
  }
}

function isAlreadyClosed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 400
  );
}

function openSessions(inspected: InspectedSession[]): StripeCheckoutSession[] {
  return inspected
    .filter((item) => item.kind === "open")
    .map((item) => item.session)
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

function pastDueOpenSessions(
  inspected: InspectedSession[],
  nowMs: number,
): StripeCheckoutSession[] {
  const due: StripeCheckoutSession[] = [];
  for (const item of inspected) {
    if (item.kind === "foreign") continue;
    const session = item.session;
    if (session.status === "open" && session.expiresAt * 1000 <= nowMs) due.push(session);
  }
  return due.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

/** Expires every still-open session, including one past expires_at. */
export async function expireOpenSessions(
  stripe: StripeApi,
  inspected: InspectedSession[],
  nowMs: number,
): Promise<void> {
  const seen = new Set<string>();
  const targets = [...openSessions(inspected), ...pastDueOpenSessions(inspected, nowMs)].filter(
    (session) => {
      if (seen.has(session.id)) return false;
      seen.add(session.id);
      return true;
    },
  );
  await expireSessions(stripe, targets);
}

/**
 * Calls the Stripe expire API for sessions that are still open after
 * expires_at, then re-reads. A failed expire, or a re-read that still shows
 * one of those sessions open, does not continue to session creation.
 */
export async function retirePastDueOpenSessions(
  stripe: StripeApi,
  email: string,
  livemode: boolean,
  nowMs: number,
  loaded: { snapshot: ReservationSnapshot; inspected: InspectedSession[]; customers: StripeCustomer[] },
): Promise<
  | { snapshot: ReservationSnapshot; inspected: InspectedSession[]; customers: StripeCustomer[] }
  | "fail_closed"
> {
  const due = pastDueOpenSessions(loaded.inspected, nowMs);
  if (due.length === 0) return loaded;
  await expireSessions(stripe, due);
  const reloaded = await loadReservationState(stripe, email, livemode, nowMs);
  if (pastDueOpenSessions(reloaded.inspected, nowMs).length > 0) return "fail_closed";
  return reloaded;
}

/**
 * Keeps the oldest Stripe-hosted open URL and expires every other open session,
 * including any open URL whose host is not checkout.stripe.com.
 */
export async function collapseOpenSessions(
  stripe: StripeApi,
  inspected: InspectedSession[],
): Promise<StripeCheckoutSession | null> {
  const open = openSessions(inspected);
  const evil = open.filter((session) => !isHostedCheckoutUrl(session.url));
  await expireSessions(stripe, evil);
  const good = open.filter((session) => isHostedCheckoutUrl(session.url));
  const keeper = good[0] ?? null;
  await expireSessions(
    stripe,
    good.filter((session) => session.id !== keeper?.id),
  );
  return keeper;
}

/** Expired sessions only. Paid, open, and unknown errors do not spend an attempt. */
function spentAttempts(inspected: InspectedSession[]): number {
  return inspected.filter((item) => {
    if (item.kind !== "terminal_unpaid" && item.kind !== "invalid") return false;
    return item.session.status === "expired";
  }).length;
}

function sessionExpired(session: StripeCheckoutSession, nowMs: number): boolean {
  return session.status === "expired" || session.expiresAt * 1000 <= nowMs;
}

async function createSession(
  stripe: StripeApi,
  params: Record<string, string>,
  emailSha256: string,
  attempt: number,
): Promise<StripeCheckoutSession | "conflict"> {
  try {
    return await stripe.createCheckoutSession(params, reservationIdempotencyKey(emailSha256, attempt));
  } catch (error) {
    if (isIdempotencyConflict(error)) return "conflict";
    throw error;
  }
}

/**
 * Starts checkout or returns the existing open URL. Never creates a session
 * when this inbox already has a paid, refunded, partially refunded,
 * refund-pending, or disputed reservation for this offer.
 */
export async function startReservationCheckout(input: {
  inviteToken: string;
  config: EnabledReservationConfig;
  stripe: StripeApi;
  nowMs: number;
}): Promise<CheckoutDecision> {
  const secret = input.config.tokenSecret;
  const origin = input.config.origin;
  if (!secret || !origin) return { kind: "stripe_error" };
  const invite = verifyReservationInvite(input.inviteToken, secret, input.nowMs);
  if (!invite) return { kind: "invalid_invite" };
  try {
    return await checkoutForInvite(invite, origin, input.config.livemode, input.stripe, input.nowMs);
  } catch (error) {
    if (isIdempotencyConflict(error)) return { kind: "in_progress" };
    console.error(
      `[reservation] checkout stripe ${error instanceof Error ? error.name : "error"}`,
    );
    return { kind: "stripe_error" };
  }
}

async function blockedDecision(
  stripe: StripeApi,
  loaded: { snapshot: ReservationSnapshot; inspected: InspectedSession[] },
  nowMs: number,
): Promise<CheckoutDecision> {
  const blocked = blockingError(loaded.snapshot.status);
  if (!blocked) return { kind: "in_progress" };
  await expireOpenSessions(stripe, loaded.inspected, nowMs);
  return { kind: "blocked", error: blocked, snapshot: loaded.snapshot };
}

async function afterConflict(
  stripe: StripeApi,
  email: string,
  livemode: boolean,
  nowMs: number,
): Promise<CheckoutDecision> {
  const again = await loadReservationState(stripe, email, livemode, nowMs);
  if (blockingError(again.snapshot.status)) return blockedDecision(stripe, again, nowMs);
  if (again.snapshot.status === "open") {
    const keeper = await collapseOpenSessions(stripe, again.inspected);
    if (isHostedCheckoutUrl(keeper?.url)) return { kind: "url", url: keeper.url };
  }
  return { kind: "in_progress" };
}

async function acceptCreated(
  stripe: StripeApi,
  created: StripeCheckoutSession,
  invite: ReservationInvite,
  origin: string,
  livemode: boolean,
  nowMs: number,
): Promise<CheckoutDecision> {
  if (!isHostedCheckoutUrl(created.url) || created.livemode !== livemode || created.status !== "open") {
    if (created.status === "open") await expireSessions(stripe, [created]);
    return { kind: "contract_mismatch" };
  }
  if (sessionExpired(created, nowMs)) return { kind: "in_progress" };
  if (created.amountTotal !== RESERVATION_FEE_CENTS || created.currency !== RESERVATION_CURRENCY) {
    await expireSessions(stripe, [created]);
    return { kind: "contract_mismatch" };
  }
  if (created.successUrl !== reservationSuccessUrl(origin)) {
    await expireSessions(stripe, [created]);
    return { kind: "contract_mismatch" };
  }
  const createdItems = await stripe.listLineItems(created.id);
  if (!lineItemsMatch(createdItems)) {
    await expireSessions(stripe, [created]);
    return { kind: "contract_mismatch" };
  }

  const refreshed = await loadReservationState(stripe, invite.email, livemode, nowMs);
  if (blockingError(refreshed.snapshot.status)) return blockedDecision(stripe, refreshed, nowMs);
  const keeper = await collapseOpenSessions(stripe, refreshed.inspected);
  if (isHostedCheckoutUrl(keeper?.url)) return { kind: "url", url: keeper.url };
  return { kind: "in_progress" };
}

async function checkoutForInvite(
  invite: ReservationInvite,
  origin: string,
  livemode: boolean,
  stripe: StripeApi,
  nowMs: number,
): Promise<CheckoutDecision> {
  const emailSha256 = reservationEmailHash(invite.email);
  let loaded = await loadReservationState(stripe, invite.email, livemode, nowMs);
  if (blockingError(loaded.snapshot.status)) return blockedDecision(stripe, loaded, nowMs);

  const invalidOpen = loaded.inspected
    .flatMap((item) => item.kind === "invalid" && item.session.status === "open" ? [item.session] : []);
  if (invalidOpen.length > 0) {
    await expireSessions(stripe, invalidOpen);
    loaded = await loadReservationState(stripe, invite.email, livemode, nowMs);
    if (blockingError(loaded.snapshot.status)) return blockedDecision(stripe, loaded, nowMs);
  }

  const retired = await retirePastDueOpenSessions(
    stripe,
    invite.email,
    livemode,
    nowMs,
    loaded,
  );
  if (retired === "fail_closed") return { kind: "in_progress" };
  loaded = retired;
  if (blockingError(loaded.snapshot.status)) return blockedDecision(stripe, loaded, nowMs);

  if (loaded.snapshot.status === "open") {
    const keeper = await collapseOpenSessions(stripe, loaded.inspected);
    if (isHostedCheckoutUrl(keeper?.url)) return { kind: "url", url: keeper.url };
    return { kind: "in_progress" };
  }

  const customer =
    chooseCustomer(loaded.customers, loaded.inspected.flatMap((item) =>
      item.kind === "foreign" ? [] : [item.session],
    )) ?? (await findOrCreateCustomer(stripe, invite.email, emailSha256));

  const params = reservationSessionParams({
    origin,
    customerId: customer.id,
    emailSha256,
  });
  const attempt = spentAttempts(loaded.inspected) + 1;
  let created = await createSession(stripe, params, emailSha256, attempt);
  if (created === "conflict") return afterConflict(stripe, invite.email, livemode, nowMs);

  if (created.status === "complete" || created.paymentStatus === "paid") {
    const settled = await loadReservationState(stripe, invite.email, livemode, nowMs);
    if (blockingError(settled.snapshot.status)) return blockedDecision(stripe, settled, nowMs);
    return { kind: "in_progress" };
  }

  if (sessionExpired(created, nowMs)) {
    const reloaded = await loadReservationState(stripe, invite.email, livemode, nowMs);
    if (blockingError(reloaded.snapshot.status)) return blockedDecision(stripe, reloaded, nowMs);
    const next = spentAttempts(reloaded.inspected) + 1;
    if (next === attempt) return { kind: "in_progress" };
    const retried = await createSession(stripe, params, emailSha256, next);
    if (retried === "conflict") return afterConflict(stripe, invite.email, livemode, nowMs);
    if (sessionExpired(retried, nowMs) || retried.status === "complete") return { kind: "in_progress" };
    created = retried;
  }

  return acceptCreated(stripe, created, invite, origin, livemode, nowMs);
}
