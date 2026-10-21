// Press attribution for the waitlist (press-kit/tracking/CONTRACT.md §3).
//
// A form submission is not a signup here: it only arms a verification attempt.
// A visitor who arrived through a press link (`?press_ref=`) is reported to the
// press tracker on diveroid.ai only when their row becomes a completed signup:
//
//   email double opt-in, first confirmation   → "confirmed"
//   social sign-in wrote the lead, verified    → "confirmed"
//   social sign-in wrote the lead, unverified  → "accepted" (then "confirmed"
//                                                if the address is verified later)
//
// What leaves this server: the opaque press_ref, a keyed digest of the
// canonical email (HMAC with PRESS_TRACKING_SECRET, so the tracker can dedupe
// without ever seeing an address), two timestamps and the suspect flag. Never
// the email, phone, name, IP or user agent.
//
// The reference travels in server state the flow already keeps: the new row's
// `Press event` cell, or the signed OAuth state cookie. `Press sync` says what
// is still owed: held (not a signup yet), pending (a social lead write not yet
// reported), accepted, confirmed, ignored or invalid. The live report is only a
// shortcut; pressReplay.server.ts sends whatever is still owed. Event ids are
// derived from subscriber and stage, so a replay is counted once.
//
// Off unless PRESS_ATTRIBUTION_ENABLED=1 and the secret and origin are set.
// Kept free of path-alias imports so `npm test` can load it directly.
import { createHmac } from "node:crypto";

export const FIELD_PRESS_EVENT = "Press event";
export const FIELD_PRESS_SYNC = "Press sync";

/** Row exists (a form submit or an unverified external-email sign-in) but is not a signup yet. */
export const PRESS_SYNC_HELD = "held";
/** A social sign-in lead write whose "accepted" report is still owed. */
export const PRESS_SYNC_PENDING = "pending";
export const PRESS_SYNC_ACCEPTED = "accepted";
export const PRESS_SYNC_CONFIRMED = "confirmed";
export const PRESS_SYNC_IGNORED = "ignored";
export const PRESS_SYNC_INVALID = "invalid";

const REF = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^[a-f0-9]{64}$/;
const MIN_SECRET_LENGTH = 32;

export type PressEnvironment = {
  PRESS_ATTRIBUTION_ENABLED?: string;
  PRESS_TRACKING_SECRET?: string;
  PRESS_PORTAL_ORIGIN?: string;
};

/** What the row keeps in `Press event`. No contact data. */
export type PressOutbox = {
  v: 1;
  ref: string;
  subscriberKey: string;
  signedUpAt: string;
  flagged: boolean;
};

export type PressStage = "accepted" | "confirmed";

export type PressSignupEvent = {
  v: 1;
  eventId: string;
  stage: PressStage;
  ref: string;
  subscriberKey: string;
  signedUpAt: string;
  occurredAt: string;
  flagged: boolean;
};

/** delivered = created or duplicate; ignored/invalid settle the outbox; retry leaves it pending. */
export type PressDelivery = "delivered" | "ignored" | "invalid" | "retry";

export type PressNotionRequest = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

/** A malformed reference is dropped, never an error: it must not cost the signup. */
export function sanitizePressRef(value: unknown): string | undefined {
  return typeof value === "string" && REF.test(value) ? value : undefined;
}

function portalOrigin(env: PressEnvironment): URL | null {
  const raw = env.PRESS_PORTAL_ORIGIN?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !loopback) return null;
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
  return url;
}

export function pressAttributionEnabled(env: PressEnvironment = process.env): boolean {
  return (
    env.PRESS_ATTRIBUTION_ENABLED === "1" &&
    typeof env.PRESS_TRACKING_SECRET === "string" &&
    env.PRESS_TRACKING_SECRET.length >= MIN_SECRET_LENGTH &&
    portalOrigin(env) !== null
  );
}

/** Same canonical address → same key on every server that holds the secret. */
export function pressSubscriberKey(secret: string, canonicalEmail: string): string {
  return createHmac("sha256", secret).update(`press-subscriber:v1:${canonicalEmail}`).digest("hex");
}

/** The `Press event` cell for a new row, or undefined when there is no press link to keep. */
export function pressOutboxFor(
  input: { pressRef?: string; canonical: string; signedUpAt: string; flagged: boolean },
  env: PressEnvironment = process.env,
): string | undefined {
  const ref = sanitizePressRef(input.pressRef);
  if (!ref || !pressAttributionEnabled(env)) return undefined;
  const outbox: PressOutbox = {
    v: 1,
    ref,
    subscriberKey: pressSubscriberKey(env.PRESS_TRACKING_SECRET as string, input.canonical),
    signedUpAt: input.signedUpAt,
    flagged: input.flagged,
  };
  return JSON.stringify(outbox);
}

export function parsePressOutbox(text: string | undefined): PressOutbox | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<PressOutbox>;
    if (
      value.v === 1 &&
      typeof value.ref === "string" &&
      REF.test(value.ref) &&
      typeof value.subscriberKey === "string" &&
      KEY.test(value.subscriberKey) &&
      typeof value.signedUpAt === "string" &&
      Number.isFinite(Date.parse(value.signedUpAt)) &&
      typeof value.flagged === "boolean"
    ) {
      return { v: 1, ref: value.ref, subscriberKey: value.subscriberKey, signedUpAt: value.signedUpAt, flagged: value.flagged };
    }
  } catch {
    // An unreadable cell is reported as invalid by the caller.
  }
  return undefined;
}

export function pressEvent(outbox: PressOutbox, stage: PressStage, occurredAt: string): PressSignupEvent {
  return {
    v: 1,
    eventId: `press_${stage}_${outbox.subscriberKey.slice(0, 48)}`,
    stage,
    ref: outbox.ref,
    subscriberKey: outbox.subscriberKey,
    signedUpAt: outbox.signedUpAt,
    occurredAt,
    flagged: outbox.flagged,
  };
}

/** One signed POST to the tracker. Never throws. */
export async function deliverPressEvent(
  event: PressSignupEvent,
  env: PressEnvironment = process.env,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<PressDelivery> {
  const origin = portalOrigin(env);
  const secret = env.PRESS_TRACKING_SECRET;
  if (!origin || !secret || secret.length < MIN_SECRET_LENGTH) return "retry";
  const body = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  try {
    const response = await fetcher(new URL("/api/press/signup", origin), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "Content-Type": "application/json",
        "X-Press-Timestamp": timestamp,
        "X-Press-Signature": signature,
      },
      body,
    });
    // Malformed for good: replaying the same bytes cannot succeed.
    if (response.status === 400 || response.status === 413 || response.status === 415) return "invalid";
    if (!response.ok) return "retry";
    const result = (await response.json()) as { ok?: unknown; outcome?: unknown };
    if (result.ok !== true) return "retry";
    if (result.outcome === "created" || result.outcome === "duplicate") return "delivered";
    if (result.outcome === "ignored") return "ignored";
    return "retry";
  } catch {
    return "retry";
  }
}

/** The `Press sync` value after a delivery, or undefined to leave the row as it is. */
export function nextPressSync(stage: PressStage, delivery: PressDelivery): string | undefined {
  if (delivery === "delivered") return stage === "accepted" ? PRESS_SYNC_ACCEPTED : PRESS_SYNC_CONFIRMED;
  if (delivery === "ignored") return PRESS_SYNC_IGNORED;
  if (delivery === "invalid") return PRESS_SYNC_INVALID;
  return undefined;
}

export async function setPressSync(request: PressNotionRequest, pageId: string, state: string): Promise<boolean> {
  try {
    await request("PATCH", `pages/${pageId}`, {
      properties: { [FIELD_PRESS_SYNC]: { rich_text: [{ text: { content: state } }] } },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Live report for one row, used right after the row is created or confirmed.
 * Never throws. Whatever is not settled here stays for the replay.
 */
export async function reportPressStage(
  stage: PressStage,
  row: { pageId: string; pressOutbox?: string; occurredAt: string },
  request: PressNotionRequest,
  env: PressEnvironment = process.env,
  fetcher: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<PressDelivery> {
  const outbox = parsePressOutbox(row.pressOutbox);
  if (!outbox) return "invalid";
  const occurredAt = stage === "accepted" ? outbox.signedUpAt : row.occurredAt;
  const delivery = await deliverPressEvent(pressEvent(outbox, stage, occurredAt), env, fetcher, timeoutMs);
  const next = nextPressSync(stage, delivery);
  if (next) await setPressSync(request, row.pageId, next);
  return delivery;
}
