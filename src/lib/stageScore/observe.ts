// Disabled stage-score observer. The flag is checked before any address or
// phone is hashed. A failure here is discarded so signup, verification, and
// payment keep their existing results. This module does not call Meta.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { PRODUCT_CODE, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_LEAD_PENDING,
  MEASUREMENT_CONSENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHHELD,
} from "../verification/contracts.ts";
import { personKey } from "./identity.ts";

const FLAG = "WATCHDIVE_STAGE_SCORE_INTEGRATION";
const PLANES = new Set(["live", "test", "preview", "development", "staging", "unknown"]);
const MEASUREMENTS = new Set([
  "granted",
  "withdrawn",
  "withheld",
  "pending",
  "unknown",
  "unrecognized",
]);

export type StageMeasurement =
  | "granted"
  | "withdrawn"
  | "withheld"
  | "pending"
  | "unknown"
  | "unrecognized";

export type StagePaymentSnapshot = {
  status: string;
  paid: boolean;
  sessionId: string | null;
  amountTotal: number | null;
  currency: string | null;
  amountRefunded: number;
  amountRefundPending: number;
};

const diagnostics = { writes: 0, duplicates: 0, skips: 0 };

export function stageScoreDiagnostics(): { writes: number; duplicates: number; skips: number } {
  return { ...diagnostics };
}

export function resetStageScoreDiagnostics(): void {
  diagnostics.writes = 0;
  diagnostics.duplicates = 0;
  diagnostics.skips = 0;
}

function enabled(): boolean {
  return process.env[FLAG] === "enabled";
}

function dataPlane(): string {
  const value = process.env.WATCHDIVE_STAGE_SCORE_DATA_PLANE;
  if (value && PLANES.has(value)) return value;
  return "staging";
}

export function measurementFromCell(cell: string | undefined): StageMeasurement {
  if (cell === MEASUREMENT_CONSENT_GRANTED) return "granted";
  if (cell === MEASUREMENT_CONSENT_WITHDRAWN) return "withdrawn";
  if (cell === MEASUREMENT_CONSENT_WITHHELD) return "withheld";
  if (cell === MEASUREMENT_CONSENT_LEAD_PENDING) return "pending";
  if (!cell) return "unknown";
  return "unrecognized";
}

function ledgerFile(): string | undefined {
  if (process.env.VERCEL === "1") return undefined;
  const file = process.env.WATCHDIVE_STAGE_SCORE_LEDGER;
  if (!file || !file.startsWith("/") || !file.endsWith(".sqlite")) return undefined;
  const parts = file.split("/").filter(Boolean);
  if (parts.includes("landing") || parts.includes("src")) return undefined;
  if (!existsSync(dirname(file))) return undefined;
  return file;
}

function paymentId(basis: string): string {
  return `pay:${createHash("sha256").update(basis, "utf8").digest("hex")}`;
}

async function write(input: {
  dedupeKey: string;
  email: string;
  observedAt: string;
  kind: string;
  source: string;
  body: Record<string, unknown>;
}): Promise<void> {
  if (!enabled()) return;
  const file = ledgerFile();
  const key = personKey(input.email);
  if (!file || !key || !input.observedAt) {
    diagnostics.skips += 1;
    return;
  }
  try {
    const { appendObservation } = await import("./ledger.ts");
    const result = await appendObservation({
      file,
      dedupeKey: input.dedupeKey,
      personKey: key,
      observedAt: input.observedAt,
      kind: input.kind,
      source: input.source,
      body: input.body,
    });
    if (result === "inserted") diagnostics.writes += 1;
    else diagnostics.duplicates += 1;
  } catch {
    diagnostics.skips += 1;
  }
}

export async function noteStageSignup(input: {
  email: string;
  at: string;
  source: "email" | "oauth";
  measurementCell?: string;
  suspect?: boolean;
  suppressed?: boolean;
  phonePresent?: boolean;
}): Promise<void> {
  if (!enabled()) return;
  try {
    const key = personKey(input.email);
    await write({
      dedupeKey: `signup|${key}`,
      email: input.email,
      observedAt: input.at,
      kind: "email_signup",
      source: input.source,
      body: {
        measurement: measurementFromCell(input.measurementCell),
        phone_present: input.phonePresent === true,
        sms_consent: "missing",
        suspect: input.suspect === true,
        suppressed: input.suppressed === true,
        data_plane: dataPlane(),
      },
    });
  } catch {
    diagnostics.skips += 1;
  }
}

export async function noteStageVerified(input: {
  email: string;
  at: string;
  source: "email" | "oauth";
}): Promise<void> {
  if (!enabled()) return;
  try {
    const key = personKey(input.email);
    await write({
      dedupeKey: `verified|${key}`,
      email: input.email,
      observedAt: input.at,
      kind: "email_verified",
      source: input.source,
      body: {},
    });
  } catch {
    diagnostics.skips += 1;
  }
}

export async function noteStagePhoneSaved(input: {
  email: string;
  at: string;
  sms: "granted" | "missing" | "withdrawn" | "unknown";
}): Promise<void> {
  if (!enabled()) return;
  try {
    const key = personKey(input.email);
    await write({
      dedupeKey: `phone|${key}|saved|${input.sms}`,
      email: input.email,
      observedAt: input.at,
      kind: "phone_saved",
      source: "phone",
      body: { phone_present: true, sms_consent: input.sms },
    });
  } catch {
    diagnostics.skips += 1;
  }
}

export async function noteStagePhoneDataWithdrawn(input: { email: string; at: string }): Promise<void> {
  if (!enabled()) return;
  try {
    const key = personKey(input.email);
    await write({
      dedupeKey: `phone|${key}|data-withdrawn`,
      email: input.email,
      observedAt: input.at,
      kind: "phone_data_withdrawn",
      source: "phone",
      body: { phone_present: false, sms_consent: "missing" },
    });
  } catch {
    diagnostics.skips += 1;
  }
}

export async function noteStageMeasurement(input: {
  email: string;
  at: string;
  measurement: StageMeasurement;
}): Promise<void> {
  if (!enabled()) return;
  if (!MEASUREMENTS.has(input.measurement)) return;
  try {
    const key = personKey(input.email);
    await write({
      dedupeKey: `measurement|${key}|${input.measurement}`,
      email: input.email,
      observedAt: input.at,
      kind: "measurement",
      source: "consent",
      body: { measurement: input.measurement },
    });
  } catch {
    diagnostics.skips += 1;
  }
}

function paymentObject(
  snapshot: StagePaymentSnapshot,
  livemode: boolean,
  eventId: string,
): Record<string, unknown> {
  const basis = snapshot.sessionId ? snapshot.sessionId : `nosession:${eventId}`;
  const id = paymentId(basis);
  const incomplete =
    snapshot.status === "invalid" ||
    (snapshot.paid && (snapshot.amountTotal == null || !snapshot.currency)) ||
    (snapshot.status === "paid" && snapshot.paid !== true);
  if (incomplete) return { loaded: false, payment_id: id };
  const pending = snapshot.amountRefundPending > 0;
  const refundState = pending
    ? "pending"
    : snapshot.amountRefunded >= RESERVATION_FEE_CENTS
      ? "full"
      : snapshot.amountRefunded > 0
        ? "partial"
        : "none";
  const status = snapshot.paid && snapshot.status === "paid" ? "paid" : snapshot.status || "unpaid";
  return {
    loaded: true,
    status,
    livemode: livemode === true,
    mode: livemode === true ? "live" : "test",
    webhook_verified: true,
    amount_cents: snapshot.amountTotal ?? 0,
    currency: (snapshot.currency || "usd").toLowerCase(),
    product_code: PRODUCT_CODE,
    refund_state: refundState,
    dispute: snapshot.status === "disputed" ? "open" : "none",
    payment_id: id,
  };
}

export async function noteStagePayment(input: {
  email: string;
  at: string;
  eventId: string;
  livemode: boolean;
  snapshot: StagePaymentSnapshot;
}): Promise<void> {
  if (!enabled()) return;
  try {
    const payment = paymentObject(input.snapshot, input.livemode, input.eventId);
    const paymentIdValue = String(payment.payment_id);
    const marker = [
      payment.loaded === false ? "unknown" : payment.status,
      payment.refund_state ?? "none",
      payment.dispute ?? "none",
    ].join("|");
    const key = personKey(input.email);
    await write({
      dedupeKey: `payment|${key}|${paymentIdValue}|${marker}`,
      email: input.email,
      observedAt: input.at,
      kind: "payment",
      source: "stripe",
      body: { payment },
    });
  } catch {
    diagnostics.skips += 1;
  }
}
