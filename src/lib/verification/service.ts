// Policy for the transactional double opt-in flow. Every external system is
// injected, so the whole state machine runs in tests against fakes.
//
//   requestVerification — they submitted the form
//   confirmVerification — their tab POSTed the token from the mail
//   pollVerification    — the original tab is asking whether that happened
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type {
  BrowserLead,
  ConfirmResponse,
  LeadAttribution,
  LeadRecord,
  LeadStore,
  LaunchOsAuthorizedMeasurementContext,
  LaunchOsReplaySeed,
  PendingResponse,
  PollResponse,
} from "./contracts.ts";
import {
  conversionBlocked,
  GENERIC_PENDING_MESSAGE,
  MIN_RESPONSE_MS,
  POLL_HANDLE_TTL_MS,
  VERIFICATION_MAX_SENDS,
  WELCOME_DELAY_MS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
} from "./contracts.ts";
import type { PollGate } from "./pollGate.ts";
import type { VerificationMailer } from "./resend.ts";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale.ts";
import type { TokenEnvironment } from "./token.ts";
import {
  createVerificationToken,
  deterministicMetaEventId,
  isVerificationTokenShape,
  newLeadId,
  parseVerificationToken,
  requirePublicOrigin,
  requireSecret,
  signPollHandle,
  verifyPollHandle,
} from "./token.ts";

export type VerifiedLeadDispatch = (input: {
  eventId: string;
  email: string;
  phone?: string;
  source: string;
}) => Promise<void>;

export type RequestVerificationInput = {
  email: string;
  canonical: string;
  phone?: string;
  source: string;
  referredBy?: string;
  flags: string[];
  suspect: boolean;
  /**
   * The first touch this browser recorded. Reaches the row only through
   * `createPending`, so a resend cannot rewrite the campaign of a lead that has
   * already been attributed.
   */
  attribution?: LeadAttribution;
  /** The browser's measurement choice at submit time. */
  measurementConsent: boolean;
  /** Explicit, PII-free website-consent evidence. Absent means DATA_GAP. */
  launchOsMeasurement?: LaunchOsAuthorizedMeasurementContext;
  /** Language selected on the page. Defaults to English for legacy callers. */
  locale?: Locale;
  /** True when this network has produced too many recent signups to keep mailing. */
  networkSendBlocked: boolean;
};

export type ServiceDependencies = {
  store: LeadStore;
  mailer: VerificationMailer;
  env?: TokenEnvironment;
  now?: () => Date;
  leadId?: () => string;
  refCode?: () => string;
  dispatchVerifiedLead?: VerifiedLeadDispatch;
  /** Signs the PII-free first-touch context before it enters the CRM row. */
  prepareLaunchOsReplayMetadata?: (input: LaunchOsReplaySeed) => string | undefined;
  /** Replays the immutable envelope after the authoritative CRM write succeeds. */
  dispatchStoredLeadMeasurement?: (input: { replayMetadata: string }) => Promise<void>;
  /** Best-effort adapter dispatch after a known verification outcome. */
  dispatchVerificationMeasurement?: (input: {
    replayMetadata: string;
    outcome: "verified" | "failed";
    occurredAt: string;
    reasonCode?: "expired";
  }) => Promise<void>;
  /** Test seam for the response floor. */
  sleep?: (ms: number) => Promise<void>;
  /** Shields the store from replayed poll bursts. */
  pollGate?: PollGate<PollResponse>;
};

function pendingResponse(handle: string): PendingResponse {
  return { ok: true, status: "pending", message: GENERIC_PENDING_MESSAGE, handle };
}

function launchOsReplayMetadata(
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
  signedUpAt: string,
): string | undefined {
  if (!input.launchOsMeasurement || !dependencies.prepareLaunchOsReplayMetadata) return undefined;
  try {
    return dependencies.prepareLaunchOsReplayMetadata({
      canonicalEmail: input.canonical,
      suspect: input.suspect,
      signedUpAt,
      context: input.launchOsMeasurement,
    });
  } catch {
    return undefined;
  }
}

async function currentReplayMetadata(
  record: LeadRecord,
  dependencies: ServiceDependencies,
): Promise<string | undefined> {
  try {
    const current = await dependencies.store.reread(record.pageId);
    return current && current.launchOsReplayMetadata === record.launchOsReplayMetadata
      ? current.launchOsReplayMetadata
      : undefined;
  } catch {
    // A source read failure must suppress telemetry, never authorize it from a
    // stale in-memory record that may have been revoked concurrently.
    return undefined;
  }
}

async function dispatchStoredLeadMeasurement(
  record: LeadRecord | undefined,
  dependencies: ServiceDependencies,
) {
  if (!record?.launchOsReplayMetadata || !dependencies.dispatchStoredLeadMeasurement) {
    return Promise.resolve();
  }
  const replayMetadata = await currentReplayMetadata(record, dependencies);
  if (!replayMetadata) return;
  return dependencies
    .dispatchStoredLeadMeasurement({
      replayMetadata,
    })
    .catch(() => {
      // Measurement is replayable from the sealed CRM metadata and never
      // changes the operational signup result.
    });
}

async function dispatchVerificationMeasurement(
  record: LeadRecord,
  dependencies: ServiceDependencies,
  outcome: "verified" | "failed",
  occurredAt: string,
  reasonCode?: "expired",
) {
  if (!record.launchOsReplayMetadata || !dependencies.dispatchVerificationMeasurement) return;
  const replayMetadata = await currentReplayMetadata(record, dependencies);
  if (!replayMetadata) return;
  await dependencies
    .dispatchVerificationMeasurement({
      replayMetadata,
      outcome,
      occurredAt,
      ...(reasonCode ? { reasonCode } : {}),
    })
    .catch(() => {
      // Verification remains authoritative even when telemetry is unavailable.
    });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Holds every submit open for the same minimum. A cheap path — already
 * confirmed, inside the cooldown, suppressed for abuse — would otherwise answer
 * visibly faster than a real one, and the response time would say what the
 * response body refuses to.
 */
async function withResponseFloor<T>(
  startedAtMs: number,
  nowMs: () => number,
  sleep: (ms: number) => Promise<void>,
  result: T,
): Promise<T> {
  const elapsed = nowMs() - startedAtMs;
  if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
  return result;
}

/**
 * Cooldown normally runs from the recorded send. When that write failed after a
 * message actually went out, `Verification sent` is missing and the attempt
 * would look mailable again — so the attempt's own start, recoverable as
 * `Verification expires` minus the TTL, is the fallback. Erring towards "a mail
 * may already have gone" is the safe direction: the cost is a delayed resend,
 * not a duplicate message.
 */
function attemptCooled(record: LeadRecord | undefined, nowMs: number): boolean {
  if (!record) return true;
  const sentAt = record.sentAt ? Date.parse(record.sentAt) : Number.NaN;
  if (Number.isFinite(sentAt)) return nowMs - sentAt >= VERIFICATION_RESEND_COOLDOWN_MS;

  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt)) {
    const attemptStartedAt = expiresAt - VERIFICATION_TTL_MS;
    return nowMs - attemptStartedAt >= VERIFICATION_RESEND_COOLDOWN_MS;
  }
  return true;
}

export async function requestVerificationService(
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
): Promise<PendingResponse> {
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const publicOrigin = requirePublicOrigin(env);
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const startedAtMs = clock().getTime();
  const floor = <T>(result: T) =>
    withResponseFloor(startedAtMs, () => clock().getTime(), sleep, result);

  const now = clock();
  const mintLeadId = dependencies.leadId ?? newLeadId;
  const { store } = dependencies;

  // Every early return still hands back a well-formed handle naming an attempt
  // no row carries. The caller cannot tell a skipped send from a real one.
  const decoyHandle = () =>
    signPollHandle(mintLeadId(), now.getTime(), input.measurementConsent, secret);

  const existing = await store.findByEmail(input.canonical, input.email);

  const replayExistingMeasurement = () =>
    existing?.status === "unsubscribed"
      ? Promise.resolve()
      : dispatchStoredLeadMeasurement(existing, dependencies);

  // A honeypot, a disposable domain or a headless client is somebody using the
  // form to mail a third party. The row is still written for review, but no
  // message is produced.
  const abusive = conversionBlocked(input.flags);
  const suppressed = abusive || input.networkSendBlocked;

  if (existing && existing.status !== "pending" && existing.status !== "legacy") {
    await replayExistingMeasurement();
    return floor(pendingResponse(decoyHandle()));
  }
  if (existing?.emailVerified) {
    await replayExistingMeasurement();
    return floor(pendingResponse(decoyHandle()));
  }
  // A legacy single opt-in row is already counted; re-confirming it is not this
  // flow's job and would only reveal that the address is known.
  if (existing?.status === "legacy") return floor(pendingResponse(decoyHandle()));

  if (
    existing &&
    (!attemptCooled(existing, now.getTime()) || existing.sends >= VERIFICATION_MAX_SENDS)
  ) {
    await replayExistingMeasurement();
    return floor(pendingResponse(decoyHandle()));
  }

  const leadId = mintLeadId();
  const signedUpAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString();
  const handle = signPollHandle(leadId, now.getTime(), input.measurementConsent, secret);

  // A suppressed submit must not touch a row that already exists. Arming a new
  // attempt would replace `Lead ID` and kill a live confirmation link — which
  // would hand anyone who can trip a honeypot a way to cancel somebody else's
  // pending signup by replaying their address. Only a brand-new address gets a
  // row here, and it gets one purely so the attempt is reviewable.
  if (suppressed) {
    if (!existing) {
      const replayMetadata = launchOsReplayMetadata(input, dependencies, signedUpAt);
      const suppressedRecord = await store.createPending({
        email: input.email,
        canonical: input.canonical,
        ...(input.phone ? { phone: input.phone } : {}),
        source: input.source,
        refCode: (dependencies.refCode ?? defaultRefCode)(),
        ...(input.referredBy ? { referredBy: input.referredBy } : {}),
        ...(input.attribution ? { attribution: input.attribution } : {}),
        flags: input.flags,
        suspect: input.suspect,
        signedUpAt,
        leadId,
        expiresAt,
        ...(replayMetadata ? { launchOsReplayMetadata: replayMetadata } : {}),
      });
      await dispatchStoredLeadMeasurement(suppressedRecord, dependencies);
    } else {
      await replayExistingMeasurement();
    }
    return floor(pendingResponse(decoyHandle()));
  }

  let record: LeadRecord;
  let measurementDispatch: Promise<void> = Promise.resolve();
  if (existing) {
    // Count the attempt before it can fail, so a provider stuck at 500 cannot
    // be used to keep re-arming a send.
    await store.startAttempt(existing.pageId, { leadId, expiresAt, sends: existing.sends + 1 });
    record = existing;
    measurementDispatch = dispatchStoredLeadMeasurement(record, dependencies);
  } else {
    const replayMetadata = launchOsReplayMetadata(input, dependencies, signedUpAt);
    record = await store.createPending({
      email: input.email,
      canonical: input.canonical,
      ...(input.phone ? { phone: input.phone } : {}),
      source: input.source,
      refCode: (dependencies.refCode ?? defaultRefCode)(),
      ...(input.referredBy ? { referredBy: input.referredBy } : {}),
      ...(input.attribution ? { attribution: input.attribution } : {}),
      flags: input.flags,
      suspect: input.suspect,
      signedUpAt,
      leadId,
      expiresAt,
      ...(replayMetadata ? { launchOsReplayMetadata: replayMetadata } : {}),
    });
    measurementDispatch = dispatchStoredLeadMeasurement(record, dependencies);
  }

  const token = createVerificationToken(
    leadId,
    now.getTime() + VERIFICATION_TTL_MS,
    input.measurementConsent,
    secret,
    input.locale ?? DEFAULT_LOCALE,
  );

  try {
    await dependencies.mailer.send({
      to: input.email,
      token,
      leadId,
      publicOrigin,
      locale: input.locale ?? DEFAULT_LOCALE,
    });
  } catch {
    await measurementDispatch;
    // The attempt stays armed. Nothing about the failure reaches the response.
    return floor(pendingResponse(handle));
  }

  // The email provider hand-off starts immediately after the CRM commit. The
  // bounded direct relay runs in parallel, then is awaited before returning so
  // a serverless runtime cannot freeze an unobserved fire-and-forget promise.
  await measurementDispatch;

  try {
    await store.markSent(record.pageId, { sentAt: now.toISOString() });
  } catch {
    // The message is already gone. Failing the response now would tell somebody
    // their signup broke moments after they were mailed a working link, and
    // would invite a resend of a message they already have. The cooldown still
    // holds without this write, because it falls back to the attempt's start.
  }
  return floor(pendingResponse(handle));
}

/**
 * Hands the invite-link mail to the provider with a 24-hour hold. Resend keeps
 * the message until then, so the delay needs no scheduler of ours and survives
 * a redeploy.
 *
 * Keyed on the lead inside the mailer, so two racing confirmations and a later
 * click of the same link all converge on one scheduled message. A failure never
 * un-confirms a confirmed address: `Welcome email` simply stays empty and the
 * next confirmation of the same link tries again.
 */
async function scheduleWelcome(
  record: LeadRecord,
  dependencies: ServiceDependencies,
  now: Date,
  locale: Locale,
): Promise<void> {
  // Already handed over, no link to give, or the same abuse signals that
  // disqualify a conversion — an invite link is exactly what a farmer wants.
  if (record.welcomeAt || !record.refCode || conversionBlocked(record.flags)) return;

  let publicOrigin: string;
  try {
    publicOrigin = requirePublicOrigin(dependencies.env ?? process.env);
  } catch {
    return;
  }

  const scheduledAt = new Date(now.getTime() + WELCOME_DELAY_MS).toISOString();
  try {
    await dependencies.mailer.sendWelcome({
      to: record.email,
      refCode: record.refCode,
      leadId: record.leadId,
      publicOrigin,
      scheduledAt,
      locale,
    });
    await dependencies.store.markWelcomeScheduled(record.pageId, { scheduledAt });
  } catch {
    // Best effort by design. The confirmation already succeeded.
  }
}

export async function confirmVerificationService(
  rawToken: string,
  dependencies: ServiceDependencies,
): Promise<ConfirmResponse> {
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const now = (dependencies.now ?? (() => new Date()))();

  // Shape and signature are checked before any I/O, so a forged or expired
  // token costs nothing and reveals nothing.
  if (!isVerificationTokenShape(rawToken)) return { ok: true, status: "invalid" };
  const parsed = parseVerificationToken(rawToken, secret, now.getTime());
  if (!parsed) return { ok: true, status: "invalid" };

  const record = await dependencies.store.findByLeadId(parsed.leadId);
  // No row carries this attempt id — forged, or superseded by a resend that
  // replaced `Lead ID`.
  if (!record) return { ok: true, status: "invalid" };
  if (record.status === "unsubscribed") return { ok: true, status: "invalid" };

  const metaEventId = deterministicMetaEventId(parsed.leadId, secret);

  if (record.emailVerified || record.status === "verified") {
    // The second click of one link, and the loser of two concurrent clicks,
    // both land here. Re-dispatching is the right move rather than a wasteful
    // one: the first attempt may have been the one that failed, and the event
    // id is derived from the attempt, so a duplicate collapses into the same
    // conversion instead of inflating it.
    await dispatchIfPermitted(record, metaEventId, parsed.measurementConsent, dependencies);
    // Replays must reproduce the exact payload paired with the deterministic
    // event id. A fresh click time would turn an idempotent retry into a 409.
    if (record.verifiedAt && Number.isFinite(Date.parse(record.verifiedAt))) {
      await dispatchVerificationMeasurement(
        record,
        dependencies,
        "verified",
        new Date(record.verifiedAt).toISOString(),
      );
    }
    await scheduleWelcome(record, dependencies, now, parsed.locale);
    return {
      ok: true,
      status: "already_verified",
      refCode: record.refCode,
      ...browserLead(record, metaEventId, parsed.measurementConsent),
    };
  }

  // Notion is the authority on the attempt window, not the signed expiry.
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt)) {
    // There is no stable timestamp to bind to the deterministic failure id.
    // Keep the operational response fail-closed and emit no ambiguous row.
    return { ok: true, status: "expired" };
  }
  if (expiresAt <= now.getTime()) {
    await dispatchVerificationMeasurement(
      record,
      dependencies,
      "failed",
      // Expiry is the stable outcome boundary. Reopening the same still-signed
      // link later must not change occurredAt under the same event id.
      new Date(expiresAt).toISOString(),
      "expired",
    );
    return { ok: true, status: "expired" };
  }

  const verifiedAt = now.toISOString();
  await dependencies.store.markVerified(record.pageId, { verifiedAt, metaEventId });

  // Notion has no compare-and-set, so two racing confirmations can genuinely
  // both reach this line. Meta keeps the attempt-scoped id and dedupes them;
  // LaunchOS binds each immutable verifiedAt to its event id, so two writers
  // cannot send one id with conflicting timestamps. Its read model still
  // counts the canonical lead once. A later click reuses the timestamp that
  // survived in the CRM row.
  await dispatchIfPermitted(record, metaEventId, parsed.measurementConsent, dependencies);
  await dispatchVerificationMeasurement(record, dependencies, "verified", verifiedAt);
  await scheduleWelcome(record, dependencies, now, parsed.locale);

  return {
    ok: true,
    status: "verified",
    refCode: record.refCode,
    ...browserLead(record, metaEventId, parsed.measurementConsent),
  };
}

export async function pollVerificationService(
  handle: string,
  dependencies: ServiceDependencies,
): Promise<PollResponse> {
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const now = (dependencies.now ?? (() => new Date()))();

  // A bad signature is rejected before the gate, so junk handles never occupy
  // an entry in it.
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  if (!parsed) return { ok: true, status: "expired" };

  const read = async (): Promise<PollResponse> => {
    // A handle minted for a skipped send names no row, so it reads pending
    // until it ages out — the same answer a genuinely waiting tab gets.
    const record = await dependencies.store.findByLeadId(parsed.leadId);
    if (!record || !record.emailVerified) return { ok: true, status: "pending" };

    return {
      ok: true,
      status: "verified",
      refCode: record.refCode,
      ...browserLead(record, record.metaEventId, parsed.measurementConsent),
    };
  };

  return dependencies.pollGate ? dependencies.pollGate.run(handle, read) : read();
}

/**
 * The one place a conversion leaves. Gated on the attempt's signed consent bit
 * and on the abuse flags, and never allowed to fail the confirmation.
 */
async function dispatchIfPermitted(
  record: LeadRecord,
  eventId: string,
  measurementConsent: boolean,
  dependencies: ServiceDependencies,
): Promise<void> {
  if (!measurementConsent || conversionBlocked(record.flags)) return;
  if (!dependencies.dispatchVerifiedLead) return;
  await dependencies
    .dispatchVerifiedLead({
      eventId,
      email: record.email,
      ...(record.phone ? { phone: record.phone } : {}),
      source: record.source,
    })
    .catch(() => {
      // A measurement outage never un-confirms a confirmed lead.
    });
}

/**
 * The pixel leg is advertising measurement, so it is gated on the signed
 * consent bit from the submitting browser — not on whatever the confirming
 * browser happens to default to. Operational verification is unaffected either
 * way: the lead is confirmed and counted regardless.
 */
function browserLead(
  record: LeadRecord,
  eventId: string,
  measurementConsent: boolean,
): { browserLead?: BrowserLead } {
  if (!measurementConsent || !eventId || conversionBlocked(record.flags)) return {};
  return { browserLead: { eventId, source: record.source, hasPhone: Boolean(record.phone) } };
}

function defaultRefCode(): string {
  // Exactly 8 lowercase alphanumerics, matching every code already in the CRM.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.from(bytes)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 8);
}
