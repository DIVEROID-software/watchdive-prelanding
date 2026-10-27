import { googleBrowserContext } from "../../lib/analytics/browserContext.ts";
import {
  CHECKOUT_PATH,
  checkoutPayload,
  normalizeInviteToken,
  parseCheckoutResponse,
  parseReservationStatus,
  statusRequestPath,
  type ReservationStatus,
} from "./contract.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const JSON_LIMIT = 16_384;

async function readLimitedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0 || text.length > JSON_LIMIT) {
    throw new Error("reservation response was empty or oversized");
  }
  return JSON.parse(text) as unknown;
}

function sameOriginJson(
  method: "GET" | "POST",
  options?: { body?: string; bearer?: string },
): RequestInit {
  return {
    method,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      accept: "application/json",
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...(options?.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
    },
    ...(options?.body ? { body: options.body } : {}),
  };
}

async function responseError(response: Response): Promise<string | null> {
  try {
    const body = await readLimitedJson(response);
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const error = (body as { error?: unknown }).error;
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

async function closedFailure(
  response: Response,
): Promise<"invalid_invite" | "bad_response" | null> {
  if (response.status !== 401 && response.status !== 400) return null;
  const error = await responseError(response);
  return error === "invalid_invite" ? "invalid_invite" : "bad_response";
}

/** Same-turn guard. The first begin wins until end() after a failed attempt. */
export function createReservationSubmitLock(): { tryBegin(): boolean; end(): void } {
  let held = false;
  return {
    tryBegin() {
      if (held) return false;
      held = true;
      return true;
    },
    end() {
      held = false;
    },
  };
}

export async function requestReservationCheckout(
  inviteToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<
  | { ok: true; url: string }
  | { ok: false; reason: "invalid_invite" | "network" | "bad_response" | "conflict" }
> {
  const token = normalizeInviteToken(inviteToken);
  if (!token) return { ok: false, reason: "invalid_invite" };
  try {
    const response = await fetchImpl(
      CHECKOUT_PATH,
      sameOriginJson("POST", {
        body: JSON.stringify({ ...checkoutPayload(token), ...googleBrowserContext() }),
      }),
    );
    if (response.status === 409) return { ok: false, reason: "conflict" };
    const closed = await closedFailure(response);
    if (closed) return { ok: false, reason: closed };
    if (response.status !== 200) return { ok: false, reason: "bad_response" };
    const parsed = parseCheckoutResponse(await readLimitedJson(response));
    return parsed ? { ok: true, url: parsed.url } : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function fetchReservationStatus(
  lookup: { inviteToken: string | null; sessionId: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<
  | { ok: true; status: ReservationStatus }
  | { ok: false; reason: "nothing_to_check" | "network" | "bad_response" | "invalid_invite" }
> {
  const token = normalizeInviteToken(lookup.inviteToken);
  if (!token) return { ok: false, reason: "nothing_to_check" };
  const path = statusRequestPath(lookup.sessionId);
  try {
    const response = await fetchImpl(path, sameOriginJson("GET", { bearer: token }));
    const closed = await closedFailure(response);
    if (closed) return { ok: false, reason: closed };
    if (response.status !== 200) return { ok: false, reason: "bad_response" };
    const status = parseReservationStatus(await readLimitedJson(response));
    return status ? { ok: true, status } : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
