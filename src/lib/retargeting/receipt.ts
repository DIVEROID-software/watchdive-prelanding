// Browser receipt codec. No node:crypto, no server planner, no email.
// The cookie carries only the event the server already decided to emit.

import {
  expectedMeasurement,
  isRetargetingEventName,
  RETARGETING_CONTENT,
  signupLocaleOrNull,
  signupSourceOrNull,
  type RetargetingEventName,
} from "./constants.ts";
import type { BrowserRetargetingEvent } from "./events.ts";
import { isRetargetingEventId, paramsAreMeasurementSafe } from "./privacy.ts";

export const RETARGETING_RECEIPT_COOKIE = "wd_rt";
const MAX_EVENTS = 4;
// Ten minutes. A social receipt cannot outlive Meta's 48-hour dedup window.
// The browser also refuses an eventTime older than that window.
const MAX_AGE_SECONDS = 600;
const MAX_EVENT_TIME = 4_000_000_000;

const EVENT_KEYS = new Set([
  "eventName",
  "eventId",
  "eventTime",
  "contentName",
  "value",
  "currency",
  "signupLocale",
  "source",
  "metaDelivery",
]);

export function parseBrowserRetargetingEvent(value: unknown): BrowserRetargetingEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!EVENT_KEYS.has(key)) return null;
  }
  if (typeof record.eventName !== "string" || !isRetargetingEventName(record.eventName)) return null;
  if (typeof record.eventId !== "string" || !isRetargetingEventId(record.eventId)) return null;
  if (
    typeof record.eventTime !== "number" ||
    !Number.isInteger(record.eventTime) ||
    record.eventTime < 0 ||
    record.eventTime > MAX_EVENT_TIME
  ) {
    return null;
  }
  const name = record.eventName as RetargetingEventName;
  if (record.contentName !== RETARGETING_CONTENT[name]) return null;
  const expected = expectedMeasurement(name);
  if (record.value !== expected.value || record.currency !== expected.currency) return null;
  const signupLocale = record.signupLocale === null ? null : signupLocaleOrNull(
    typeof record.signupLocale === "string" ? record.signupLocale : null,
  );
  if (record.signupLocale !== null && !signupLocale) return null;
  const source = record.source === null ? null : signupSourceOrNull(
    typeof record.source === "string" ? record.source : null,
  );
  if (record.source !== null && !source) return null;
  // Only the durable Purchase proof may carry this. Any other value, or the
  // field on Lead/CompleteRegistration, is not a browser event we will fire.
  if ("metaDelivery" in record && (name !== "Purchase" || record.metaDelivery !== "server")) {
    return null;
  }
  const event: BrowserRetargetingEvent = {
    eventName: name,
    eventId: record.eventId,
    eventTime: record.eventTime,
    contentName: RETARGETING_CONTENT[name],
    value: expected.value,
    currency: expected.currency,
    signupLocale,
    source,
    ...(record.metaDelivery === "server" ? { metaDelivery: "server" as const } : {}),
  };
  const params: Record<string, unknown> = {
    eventId: event.eventId,
    content_name: event.contentName,
    value: event.value,
    currency: event.currency,
    ...(event.signupLocale ? { signup_locale: event.signupLocale } : {}),
    ...(event.source ? { content_category: event.source } : {}),
  };
  if (!paramsAreMeasurementSafe(params)) return null;
  return event;
}

function encodePayload(events: BrowserRetargetingEvent[]): string | null {
  if (!events.length || events.length > MAX_EVENTS) return null;
  if (events.some((event) => !parseBrowserRetargetingEvent(event))) return null;
  const payload = JSON.stringify({ v: 1, events });
  if (payload.includes("@") || payload.includes(";")) return null;
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  if (!encoded || encoded.includes(";") || encoded.includes("@")) return null;
  return encoded;
}

function decodePayload(encoded: string): BrowserRetargetingEvent[] | null {
  if (!encoded || encoded.length > 4000 || /[^A-Za-z0-9_-]/.test(encoded)) return null;
  try {
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = new TextDecoder().decode(bytes);
    if (payload.includes("@")) return null;
    const parsed = JSON.parse(payload) as { v?: unknown; events?: unknown };
    if (parsed.v !== 1 || !Array.isArray(parsed.events) || parsed.events.length > MAX_EVENTS) return null;
    const events: BrowserRetargetingEvent[] = [];
    for (const item of parsed.events) {
      const event = parseBrowserRetargetingEvent(item);
      if (!event) return null;
      events.push(event);
    }
    return events.length ? events : null;
  } catch {
    return null;
  }
}

export function retargetingReceiptSetCookie(events: BrowserRetargetingEvent[]): string | null {
  const encoded = encodePayload(events);
  if (!encoded) return null;
  return `${RETARGETING_RECEIPT_COOKIE}=${encoded}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`;
}

export function retargetingReceiptClearCookie(): string {
  return `${RETARGETING_RECEIPT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
}

export function readRetargetingReceipt(cookieHeader: string): BrowserRetargetingEvent[] | null {
  const parts = cookieHeader.split(/;\s*/);
  for (const part of parts) {
    if (!part.startsWith(`${RETARGETING_RECEIPT_COOKIE}=`)) continue;
    return decodePayload(part.slice(RETARGETING_RECEIPT_COOKIE.length + 1));
  }
  return null;
}
