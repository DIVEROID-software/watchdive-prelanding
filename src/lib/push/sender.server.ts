import { randomBytes } from "node:crypto";
import { PUSH_COPY_VERSION, pushSendGuard, type PushEnvironment } from "./config.ts";
import {
  encryptWebPushMessage,
  generateEphemeralWebPushKey,
  vapidAuthorization,
} from "./crypto.server.ts";
import { allowedPushEndpoint } from "./http.server.ts";
import type { ListedPushSubscription, PushDirectory } from "./notion.server.ts";
import type { Locale } from "../i18n/locale.ts";

/** One approved launch campaign. A new campaign requires a new copy version in code. */
export const PUSH_CAMPAIGN_ID = PUSH_COPY_VERSION;
export const PUSH_TTL_SECONDS = 86_400;
export const PUSH_TOPIC = "watchdive-launch";
const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;

export type PushTransportRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Uint8Array;
};
export type PushTransport = (request: PushTransportRequest) => Promise<{ status: number }>;

export type PushSendReport = {
  mode: "dry-run" | "send";
  aborted?: string;
  campaign: typeof PUSH_CAMPAIGN_ID;
  examined: number;
  eligible: number;
  skipped: number;
  contested: number;
  expired: number;
  undecryptable: number;
  rejectedEndpoint: number;
  attempted: number;
  gone: number;
  unknown: number;
  rejected: number;
  unconfirmed: number;
  unrecorded: number;
  /** Revoked, withdrawn, or missing on the read immediately before POST. */
  withheld: number;
  /** Delivery can race or be lost between the push service and the receipt write. */
  exactlyOnce: false;
};

/** Service-worker copy is selected by locale. Callers cannot supply a body or URL. */
export function pushLaunchBody(locale: Locale): string {
  return JSON.stringify({ copyVersion: PUSH_COPY_VERSION, kind: "launch" as const, locale });
}

function stamp(state: "pending" | "accepted" | "unknown" | "rejected", at: string, nonce?: string) {
  const base = `v1|${PUSH_CAMPAIGN_ID}|${state}|${at}`;
  return nonce ? `${base}|${nonce}` : base;
}

function emptyReport(
  mode: "dry-run" | "send",
  extra: Partial<PushSendReport> = {},
): PushSendReport {
  return {
    mode,
    campaign: PUSH_CAMPAIGN_ID,
    examined: 0,
    eligible: 0,
    skipped: 0,
    contested: 0,
    expired: 0,
    undecryptable: 0,
    rejectedEndpoint: 0,
    attempted: 0,
    gone: 0,
    unknown: 0,
    rejected: 0,
    unconfirmed: 0,
    unrecorded: 0,
    withheld: 0,
    exactlyOnce: false,
    ...extra,
  };
}

async function buildRequest(
  subscription: ListedPushSubscription,
  env: PushEnvironment,
  expiration: number,
): Promise<PushTransportRequest> {
  const endpoint = new URL(subscription.endpoint);
  const ephemeral = generateEphemeralWebPushKey();
  const body = encryptWebPushMessage(Buffer.from(pushLaunchBody(subscription.locale)), {
    uaPublicKey: Buffer.from(subscription.keys.p256dh, "base64url"),
    authSecret: Buffer.from(subscription.keys.auth, "base64url"),
    asPublicKey: ephemeral.publicKey,
    asPrivateKey: ephemeral.privateKey,
    salt: randomBytes(16),
  });
  const authorization = await vapidAuthorization({
    audience: endpoint.origin,
    subject: env.WATCHDIVE_PUSH_VAPID_SUBJECT ?? "",
    publicKey: env.WATCHDIVE_PUSH_VAPID_PUBLIC_KEY ?? "",
    privateKey: env.WATCHDIVE_PUSH_VAPID_PRIVATE_KEY ?? "",
    expiration,
  });
  return {
    url: endpoint.toString(),
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(PUSH_TTL_SECONDS),
      Topic: PUSH_TOPIC,
      Urgency: "normal",
    },
    body,
  };
}

export async function runPushCampaign(input: {
  mode: "dry-run" | "send";
  directory: PushDirectory;
  transport: PushTransport;
  env: PushEnvironment;
  now?: Date;
}): Promise<PushSendReport> {
  const mode = input.mode === "send" ? "send" : "dry-run";
  const now = input.now ?? new Date();
  const expiration = Math.floor(now.getTime() / 1000) + VAPID_LIFETIME_SECONDS;
  if (mode === "send" && !pushSendGuard(input.env))
    return emptyReport(mode, { aborted: "send_not_confirmed" });
  if (mode === "send") {
    try {
      await vapidAuthorization({
        audience: "https://fcm.googleapis.com",
        subject: input.env.WATCHDIVE_PUSH_VAPID_SUBJECT ?? "",
        publicKey: input.env.WATCHDIVE_PUSH_VAPID_PUBLIC_KEY ?? "",
        privateKey: input.env.WATCHDIVE_PUSH_VAPID_PRIVATE_KEY ?? "",
        expiration,
      });
    } catch {
      return emptyReport(mode, { aborted: "vapid_key_invalid" });
    }
  }
  let listed;
  try {
    listed = await input.directory.listActive();
  } catch {
    return emptyReport(mode, { aborted: "directory_unavailable" });
  }
  if (listed.truncated)
    return emptyReport(mode, { aborted: "directory_truncated", undecryptable: 0 });
  const report = emptyReport(mode, {
    undecryptable: listed.undecryptable,
    examined: listed.subscriptions.length,
  });
  for (const subscription of listed.subscriptions) {
    if (subscription.expirationTime != null && subscription.expirationTime <= now.getTime()) {
      report.expired++;
      if (mode === "send") {
        try {
          await input.directory.setStatus(subscription.id, "expired", false);
        } catch {
          report.unrecorded++;
        }
      }
      continue;
    }
    if (!allowedPushEndpoint(subscription.endpoint)) {
      report.rejectedEndpoint++;
      continue;
    }
    if (subscription.receipt.trim()) {
      report.skipped++;
      continue;
    }
    report.eligible++;
    if (mode !== "send") continue;
    const pending = stamp("pending", now.toISOString(), randomBytes(16).toString("hex"));
    try {
      await input.directory.setReceipt(subscription.id, pending);
      if ((await input.directory.getReceipt(subscription.id)) !== pending) {
        report.contested++;
        continue;
      }
    } catch {
      report.unrecorded++;
      continue;
    }
    let request;
    try {
      request = await buildRequest(subscription, input.env, expiration);
      if (
        request.url !== subscription.endpoint ||
        request.headers.TTL !== String(PUSH_TTL_SECONDS)
      ) {
        throw new Error("push_request");
      }
    } catch {
      try {
        await input.directory.setReceipt(subscription.id, stamp("rejected", now.toISOString()));
        report.rejected++;
      } catch {
        report.unconfirmed++;
      }
      continue;
    }
    let gate;
    try {
      gate = await input.directory.readGate(subscription.id);
    } catch {
      report.unconfirmed++;
      continue;
    }
    if (
      !gate ||
      gate.status !== "active" ||
      gate.consent !== PUSH_COPY_VERSION ||
      gate.receipt !== pending
    ) {
      report.withheld++;
      if (gate?.receipt === pending) {
        try {
          await input.directory.setReceipt(subscription.id, "");
        } catch {
          report.unconfirmed++;
        }
      }
      continue;
    }
    let status = 0;
    try {
      status = (await input.transport(request)).status;
    } catch {
      status = 0;
    }
    report.attempted++;
    try {
      if (status === 401 || status === 403) {
        await input.directory.setReceipt(subscription.id, "");
        report.aborted = "push_unauthorized";
        return report;
      }
      if (status === 404 || status === 410) {
        await input.directory.setStatus(subscription.id, "gone", true);
        report.gone++;
        continue;
      }
      if (status >= 200 && status < 300) {
        await input.directory.setReceipt(subscription.id, stamp("accepted", now.toISOString()));
        continue;
      }
      await input.directory.setReceipt(
        subscription.id,
        stamp(
          status >= 500 || status === 429 || status === 0 ? "unknown" : "rejected",
          now.toISOString(),
        ),
      );
      if (status >= 500 || status === 429 || status === 0) report.unknown++;
      else report.rejected++;
    } catch {
      report.unconfirmed++;
    }
  }
  return report;
}

/** Real push-service POST. Tests pass a fake transport and never call this. */
export async function webPushTransport(request: PushTransportRequest): Promise<{ status: number }> {
  if (!allowedPushEndpoint(request.url)) throw new Error("push_endpoint");
  // DOM BodyInit rejects Uint8Array<ArrayBufferLike> (a SharedArrayBuffer, or a
  // view into a larger buffer). Copy the exact view into a fresh ArrayBuffer.
  const body = new ArrayBuffer(request.body.byteLength);
  new Uint8Array(body).set(request.body);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status };
}
