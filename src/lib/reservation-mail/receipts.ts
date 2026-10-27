// Durable local receipt ledger. One JSONL line per state change, fsynced.
// Lines hold the campaign id, the opaque lead id, and a state. They do not
// hold an email address, a token, a page id, or message content.
//
// A later run trusts this file together with the Notion cell. Evidence that
// a provider accepted the message, or that a previous attempt is outside the
// idempotency window, blocks another send.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FileHandle } from "node:fs/promises";

import {
  RESERVATION_CAMPAIGN_ID,
  parseReservationMarker,
  withinIdempotencyWindow,
  type FailureClass,
} from "./campaign.ts";
import { isReservationEmailSegment, type ReservationEmailSegment } from "./segment.ts";

export type ReceiptState = "intent" | "accepted" | "failed" | "unresolved";

export type ReceiptRecord = {
  v: 1;
  campaignId: string;
  leadId: string;
  state: ReceiptState;
  at: string;
  firstIntentAt: string;
  notion: "pending" | "ok" | "failed";
  failureClass?: FailureClass;
  /**
   * Segment frozen at the first intent of this campaign and lead. Absent on
   * receipts written before segment routing. Not a message body and not a
   * path: a resume uses this value so a later path edit cannot change bytes.
   */
  segment?: ReservationEmailSegment;
};

export type ResolvedReceipt = {
  state: ReceiptState;
  firstIntentAt: string;
  notion: "pending" | "ok" | "failed";
  failureClass?: FailureClass;
  /** Present only when the first receipt line for this lead recorded one. */
  segment?: ReservationEmailSegment;
};

export type Ledger = {
  byLead: Map<string, ResolvedReceipt>;
  corrupt: number;
  foreign: number;
  unsafe: number;
};

export type MailAction =
  | { type: "deliver"; firstIntentAt: string }
  | { type: "record_only"; writeNotion: boolean; firstIntentAt: string }
  | {
      type: "block";
      reason: "accepted" | "unresolved" | "expired";
      writeUnresolved: boolean;
      firstIntentAt?: string;
    };

const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function receiptPaths(
  dir: string,
  campaignId = RESERVATION_CAMPAIGN_ID,
): {
  dir: string;
  file: string;
  lock: string;
} {
  const root = resolve(dir);
  return {
    dir: root,
    file: join(root, `${campaignId}.jsonl`),
    lock: join(root, `${campaignId}.lock`),
  };
}

export function assertReceiptLineSafe(line: string): void {
  if (/@|token=|invite=|https?:\/\//i.test(line)) {
    throw new Error("Unsafe receipt line");
  }
}

function isRecord(value: unknown): value is ReceiptRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as ReceiptRecord;
  return (
    record.v === 1 &&
    record.campaignId === RESERVATION_CAMPAIGN_ID &&
    typeof record.leadId === "string" &&
    LEAD_ID.test(record.leadId) &&
    (record.state === "intent" ||
      record.state === "accepted" ||
      record.state === "failed" ||
      record.state === "unresolved") &&
    typeof record.at === "string" &&
    !Number.isNaN(Date.parse(record.at)) &&
    typeof record.firstIntentAt === "string" &&
    !Number.isNaN(Date.parse(record.firstIntentAt)) &&
    (record.notion === "pending" || record.notion === "ok" || record.notion === "failed") &&
    segmentFieldValid(record)
  );
}

/** Missing segment is a legacy line. A present value must be one of the three. */
function segmentFieldValid(record: ReceiptRecord): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, "segment") || record.segment === undefined) {
    return true;
  }
  return isReservationEmailSegment(record.segment);
}

export function emptyLedger(): Ledger {
  return { byLead: new Map(), corrupt: 0, foreign: 0, unsafe: 0 };
}

export function applyReceiptLine(ledger: Ledger, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    assertReceiptLineSafe(trimmed);
  } catch {
    ledger.unsafe += 1;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    ledger.corrupt += 1;
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    ledger.corrupt += 1;
    return;
  }
  if ((parsed as { campaignId?: string }).campaignId !== RESERVATION_CAMPAIGN_ID) {
    ledger.foreign += 1;
    return;
  }
  if (!isRecord(parsed)) {
    ledger.corrupt += 1;
    return;
  }
  const previous = ledger.byLead.get(parsed.leadId.toLowerCase());
  const firstIntentAt = previous
    ? earlier(previous.firstIntentAt, parsed.firstIntentAt)
    : parsed.firstIntentAt;
  // The first line wins. A later line cannot add or replace a segment, so a
  // legacy intent stays unsegmented and a frozen intent cannot be rewritten.
  const segment = previous ? previous.segment : parsed.segment;
  ledger.byLead.set(parsed.leadId.toLowerCase(), {
    state: parsed.state,
    firstIntentAt,
    notion: parsed.notion,
    ...(parsed.failureClass ? { failureClass: parsed.failureClass } : {}),
    ...(segment ? { segment } : {}),
  });
}

function earlier(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export async function loadLedger(file: string): Promise<Ledger> {
  const ledger = emptyLedger();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return ledger;
    throw error;
  }
  for (const line of raw.split("\n")) applyReceiptLine(ledger, line);
  return ledger;
}

export function ledgerUnsafe(ledger: Ledger): boolean {
  return ledger.corrupt > 0 || ledger.foreign > 0 || ledger.unsafe > 0;
}

export async function prepareReceiptDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

export async function openReceiptLog(file: string): Promise<FileHandle> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  return open(file, "a", 0o600);
}

export async function appendReceipt(handle: FileHandle, record: ReceiptRecord): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  assertReceiptLineSafe(line);
  await handle.write(line);
  await handle.sync();
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

/** One sender at a time. A dead holder's lock is removed. A live lock refuses. */
export async function acquireReceiptLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.write(`${process.pid}\n${new Date().toISOString()}\n`);
      await handle.sync();
      await handle.close();
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const current = await readFile(lockPath, "utf8").catch(() => "");
      const pid = Number(current.split("\n")[0]);
      if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) {
        await rm(lockPath, { force: true });
        continue;
      }
      throw new Error("Receipt lock is held");
    }
  }
  throw new Error("Receipt lock is held");
}

export async function releaseReceiptLock(lockPath: string): Promise<void> {
  const current = await readFile(lockPath, "utf8").catch(() => "");
  if (current.startsWith(`${process.pid}\n`)) await rm(lockPath, { force: true });
}

/**
 * What to do for one eligible recipient. Notion `sent` and a ledger
 * `accepted` both mean the provider already took the message. A recorded
 * failure is not retried, including inside the idempotency window. An intent
 * with no provider outcome may resume inside the window. Outside the window,
 * nothing is sent again.
 */
export function decideMailAction(
  reservationMail: string | undefined,
  receipt: ResolvedReceipt | undefined,
  now: Date,
): MailAction {
  const marker = parseReservationMarker(reservationMail);
  const notionSent = marker.kind === "sent";
  const ledgerAccepted = receipt?.state === "accepted";
  const firstIntentAt =
    receipt?.firstIntentAt ??
    (marker.kind === "failed" || marker.kind === "sent" ? marker.at : undefined);

  if (notionSent || ledgerAccepted) {
    const notionOk = notionSent && receipt?.state === "accepted" && receipt.notion === "ok";
    if (notionOk && receipt) {
      return { type: "block", reason: "accepted", writeUnresolved: false };
    }
    return {
      type: "record_only",
      writeNotion: !notionSent,
      firstIntentAt: firstIntentAt ?? now.toISOString(),
    };
  }
  if (receipt?.state === "unresolved") {
    return { type: "block", reason: "unresolved", writeUnresolved: false };
  }
  if (marker.kind === "hold") {
    return { type: "block", reason: "unresolved", writeUnresolved: false };
  }
  if (receipt && !withinIdempotencyWindow(receipt.firstIntentAt, now)) {
    return {
      type: "block",
      reason: "expired",
      writeUnresolved: true,
      firstIntentAt: receipt.firstIntentAt,
    };
  }
  // A clear rejection and any failed marker stay closed. Replaying them after
  // the provider forgets the idempotency key can deliver a second message.
  if (receipt?.state === "failed") {
    return { type: "block", reason: "unresolved", writeUnresolved: false };
  }
  if (marker.kind === "failed") {
    if (!marker.at || !withinIdempotencyWindow(marker.at, now)) {
      return {
        type: "block",
        reason: "expired",
        writeUnresolved: true,
        firstIntentAt: marker.at,
      };
    }
    return { type: "block", reason: "unresolved", writeUnresolved: false };
  }
  return { type: "deliver", firstIntentAt: receipt?.firstIntentAt ?? now.toISOString() };
}

export async function receiptFileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
}
