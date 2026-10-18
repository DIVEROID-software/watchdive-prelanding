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
      sameOriginJson("POST", { body: JSON.stringify(checkoutPayload(token)) }),
    );
    if (response.status === 409) return { ok: false, reason: "conflict" };
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
  | { ok: false; reason: "nothing_to_check" | "network" | "bad_response" }
> {
  const token = normalizeInviteToken(lookup.inviteToken);
  if (!token) return { ok: false, reason: "nothing_to_check" };
  const path = statusRequestPath(lookup.sessionId);
  try {
    const response = await fetchImpl(path, sameOriginJson("GET", { bearer: token }));
    if (response.status !== 200) return { ok: false, reason: "bad_response" };
    const status = parseReservationStatus(await readLimitedJson(response));
    return status ? { ok: true, status } : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
