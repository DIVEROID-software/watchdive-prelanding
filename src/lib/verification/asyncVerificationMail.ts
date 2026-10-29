// Confirmation mail that runs after the signup response.
//
// The attempt row is the authority and is written before the response. This
// module only hands that attempt to the provider and records acceptance.
// It does not mint a new attempt, does not send the 24-hour follow-up, and
// does not decide that an empty `Verification sent` cell is safe to replay:
// a suppressed signup stores the same shape on purpose.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import {
  conversionBlocked,
  type LeadRecord,
  type LeadStore,
} from "./contracts.ts";
import {
  classifyDeliveryFailure,
  verificationBackoffMs,
  type VerificationMail,
  type VerificationMailer,
} from "./resend.ts";

/**
 * Registers work that must outlive the HTTP response. Production passes
 * Vercel `waitUntil` from `@vercel/functions`. The promise passed in already
 * has a catch. A hook that throws makes the caller await that same promise.
 */
export type AfterResponseHook = (task: Promise<unknown>) => void;

export type QueuedMailOutcome =
  | "accepted"
  | "accepted_unrecorded"
  | "provider_rejected"
  | "superseded"
  | "not_pending"
  | "suppressed"
  | "unreadable";

export type VerificationMailEvent = {
  outcome: Exclude<QueuedMailOutcome, "accepted"> | "hook_unavailable";
  status: number | null;
  reason: string;
};

const READ_ATTEMPTS = 3;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readRow(
  store: Pick<LeadStore, "reread">,
  pageId: string,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Promise<LeadRecord | undefined> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    try {
      return await store.reread(pageId);
    } catch (error) {
      lastError = error;
      if (attempt < READ_ATTEMPTS) await sleep(verificationBackoffMs(attempt, random()));
    }
  }
  throw lastError;
}

const defaultLog = (event: VerificationMailEvent) => {
  console.error("[watchdive] verification_mail", {
    provider: "resend",
    operation: "verification",
    phase: "after_response",
    outcome: event.outcome,
    status: event.status,
    reason: event.reason,
  });
};

function blockSend(
  row: LeadRecord | undefined,
  leadId: string,
): "superseded" | "suppressed" | "not_pending" | undefined {
  if (!row || row.leadId !== leadId) return "superseded";
  // Same gate as requestVerificationService: honeypot, disposable, and
  // headless flags stop the message. `suspect` is also set for ip-repeat,
  // and that submit still mails. A network block never reaches this function.
  if (conversionBlocked(row.flags)) return "suppressed";
  if (row.status !== "pending" || row.emailVerified || row.verifiedAt) return "not_pending";
  return undefined;
}

/**
 * One attempt, one provider call. Retries, the idempotency key and the
 * provider timeout live in the mailer. This function never throws: the
 * response hook has to be able to hold the promise without an unhandled
 * rejection, and a failure stays on the row as a missing send time.
 */
export async function deliverQueuedVerificationMail(input: {
  store: Pick<LeadStore, "reread" | "markSent">;
  mailer: Pick<VerificationMailer, "send">;
  pageId: string;
  leadId: string;
  mail: VerificationMail;
  now?: () => Date;
  onDeliveryFailure?: (error: unknown) => Promise<void> | void;
  log?: (event: VerificationMailEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<QueuedMailOutcome> {
  const log = input.log ?? defaultLog;
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? defaultSleep;
  const random = input.random ?? Math.random;
  let current: LeadRecord | undefined;
  try {
    current = await readRow(input.store, input.pageId, sleep, random);
  } catch {
    log({ outcome: "unreadable", status: null, reason: "store_read_failed" });
    return "unreadable";
  }
  const blocked = blockSend(current, input.leadId);
  if (blocked) {
    log({ outcome: blocked, status: null, reason: blocked });
    return blocked;
  }

  try {
    await input.mailer.send(input.mail);
  } catch (error) {
    const classified = classifyDeliveryFailure(error);
    log({
      outcome: "provider_rejected",
      status: classified.status,
      reason: classified.reason,
    });
    try {
      await input.onDeliveryFailure?.(error);
    } catch {
      // The alert is best effort. The visitor already has the pending answer.
    }
    return "provider_rejected";
  }

  try {
    const after = await readRow(input.store, input.pageId, sleep, random);
    if (blockSend(after, input.leadId)) {
      // The provider accepted a message for an attempt that is no longer the
      // row's current one. Stamping `Verification sent` would make the new
      // attempt look delivered.
      log({ outcome: "accepted_unrecorded", status: null, reason: "attempt_moved" });
      return "accepted_unrecorded";
    }
    await input.store.markSent(input.pageId, { sentAt: now().toISOString() });
  } catch {
    log({ outcome: "accepted_unrecorded", status: null, reason: "store_write_failed" });
    return "accepted_unrecorded";
  }
  return "accepted";
}

/**
 * Await the send when no hook is installed. When a hook is installed, register
 * the promise and return. If registration throws, await the same promise
 * instead of leaving it running with nobody attached.
 */
export async function settleVerificationMail(
  hook: AfterResponseHook | undefined,
  start: () => Promise<unknown>,
): Promise<"inline" | "scheduled"> {
  if (!hook) {
    await start();
    return "inline";
  }
  const task = Promise.resolve()
    .then(start)
    .catch(() => undefined);
  try {
    hook(task);
  } catch {
    await task;
    return "inline";
  }
  return "scheduled";
}
