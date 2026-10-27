// Public return-to-reservation request. A valid email always gets the same
// accepted answer, whether or not a link was sent. The response has no
// account, payment, token, or lead id. Mail goes out only for an explicit
// POST from this site, and only to a verified unpaid signup.
import { createNetworkGate, type NetworkGate } from "../verification/networkGate.ts";
import { firstIp, isHeadlessUA } from "../api/abuse.ts";
import { readResendConfig } from "../verification/resend.ts";
import { networkKey, requirePublicOrigin, requireSecret } from "../verification/token.ts";
import { readReservationTokenSecret } from "../reservation-mail/inviteLink.ts";
import { isReservationEmail } from "./invite.ts";
import type { ReservationMessage } from "../reservation-mail/run.ts";
import type { ReturnCooldown } from "./returnCooldown.ts";
import {
  chooseReturnRecipient,
  returnWindowBucket,
  type ReturnAccount,
} from "./returnEligibility.ts";
import { buildReservationReturnMessage, type ReturnMailEnv } from "./returnMail.ts";

export const RESERVATION_RETURN_PATH = "/api/reservation/return";

const MAX_BODY_CHARS = 2048;
const ACCEPTED = { ok: true, status: "accepted" } as const;

const flights = new Set<string>();

export type ReturnDirectory = {
  list(email: string): Promise<ReturnAccount[]>;
};

export type ReturnHandlerDeps = {
  env: ReturnMailEnv & {
    NOTION_API_KEY?: string;
    NOTION_WAITLIST_DB_ID?: string;
    RESEND_API_KEY?: string;
    WATCHDIVE_EMAIL_FROM?: string;
    WATCHDIVE_EMAIL_FROM_NAME?: string;
    WATCHDIVE_EMAIL_REPLY_TO?: string;
  };
  directory: ReturnDirectory;
  send: (message: ReservationMessage) => Promise<void>;
  cooldown: ReturnCooldown;
  nowMs?: number;
  networkGate?: NetworkGate;
};

export function reservationReturnReady(env: ReturnHandlerDeps["env"]): boolean {
  try {
    readReservationTokenSecret(env);
    requirePublicOrigin(env);
    const unsub = (env.WATCHDIVE_RESERVATION_UNSUBSCRIBE_SECRET ?? "").trim();
    if (unsub) {
      if (Buffer.byteLength(unsub, "utf8") < 32) return false;
    } else {
      requireSecret(env);
    }
    readResendConfig(env);
    if (!(env.NOTION_API_KEY ?? "").trim() || !(env.NOTION_WAITLIST_DB_ID ?? "").trim()) return false;
    return true;
  } catch {
    return false;
  }
}

export function resetReservationReturnFlightsForTests(): void {
  flights.clear();
}

export async function handleReservationReturn(
  request: Request,
  deps: ReturnHandlerDeps,
): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "method" });
  let origin = "";
  try {
    origin = requirePublicOrigin(deps.env);
  } catch {
    return json(503, { error: "unavailable" });
  }
  if (!requestAllowed(request, origin)) return json(400, { error: "origin" });

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return json(400, { error: "body" });
  }
  if (honeypotTripped(body.company)) return json(200, ACCEPTED);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isReservationEmail(email)) return json(400, { error: "invalid_email" });
  if (!reservationReturnReady(deps.env)) return json(503, { error: "unavailable" });
  if (isHeadlessUA(request.headers.get("user-agent"))) return json(200, ACCEPTED);

  const gate = deps.networkGate ?? returnNetworkGate;
  const secret = readReservationTokenSecret(deps.env);
  const verdict = gate.record(networkKey(firstIp(request.headers.get("x-forwarded-for")), secret));
  if (verdict.blocked) return json(200, ACCEPTED);

  let rows: ReturnAccount[];
  try {
    rows = await deps.directory.list(email);
  } catch {
    console.error("[reservation-return] lookup_failed");
    return json(200, ACCEPTED);
  }
  const account = chooseReturnRecipient(rows, email);
  if (!account) return json(200, ACCEPTED);

  const nowMs = deps.nowMs ?? Date.now();
  const bucket = returnWindowBucket(nowMs);
  const flight = `${account.leadId.toLowerCase()}:${bucket}`;
  if (flights.has(flight)) return json(200, ACCEPTED);
  flights.add(flight);
  try {
    let cooled = false;
    try {
      cooled = await deps.cooldown.alreadySent(account.leadId, bucket);
    } catch {
      console.error("[reservation-return] cooldown_unread");
      return json(200, ACCEPTED);
    }
    if (cooled) return json(200, ACCEPTED);
    let message: ReservationMessage;
    try {
      message = buildReservationReturnMessage({ account, bucket, nowMs, env: deps.env });
    } catch {
      console.error("[reservation-return] invite_failed");
      return json(200, ACCEPTED);
    }
    if (message.to.trim().toLowerCase() !== account.email.trim().toLowerCase()) {
      console.error("[reservation-return] recipient_mismatch");
      return json(200, ACCEPTED);
    }
    try {
      await deps.send(message);
    } catch {
      console.error("[reservation-return] send_failed");
      return json(200, ACCEPTED);
    }
    try {
      await deps.cooldown.remember(account.leadId, bucket, new Date(nowMs).toISOString());
    } catch {
      console.error("[reservation-return] cooldown_unrecorded");
    }
    return json(200, ACCEPTED);
  } finally {
    flights.delete(flight);
  }
}

const returnNetworkGate = createNetworkGate({
  windowMs: 60 * 60 * 1000,
  repeatThreshold: 4,
  blockThreshold: 8,
  globalWindowMs: 60 * 60 * 1000,
  globalThreshold: 200,
});

function requestAllowed(request: Request, origin: string): boolean {
  const header = request.headers.get("origin");
  if (!header || header !== origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (!site) return true;
  return site === "same-origin" || site === "none";
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new Error("body");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body");
  return parsed as Record<string, unknown>;
}

function honeypotTripped(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return true;
  return value.trim().length > 0;
}

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
