// Policy for the transactional double opt-in flow. Every external system is
// injected, so the whole state machine runs in tests against fakes.
//
//   requestVerification — they submitted the form
//   confirmVerification — their tab POSTed the token from the mail
//   pollVerification    — the original tab is asking whether that happened
//   grant*Measurement   — they allowed advertising measurement after the submit
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type {
  BrowserLead,
  ConfirmResponse,
  LeadAttribution,
  LeadRecord,
  LeadStore,
  MeasurementGrantResponse,
  PendingResponse,
  PollResponse,
} from "./contracts.ts";
import {
  conversionBlocked,
  FLAG_MEASUREMENT_WITHDRAWN,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_LEAD_PENDING,
  MEASUREMENT_CONSENT_WITHDRAWN,
  MEASUREMENT_CONSENT_WITHHELD,
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
  deterministicSubmitEventId,
  isVerificationTokenShape,
  newLeadId,
  parseVerificationToken,
  requirePublicOrigin,
  requireSecret,
  signPollHandle,
  verifyPollHandle,
} from "./token.ts";

/**
 * Meta cookies of the browser that produced a conversion. The click cookie is
 * what ties a confirmation — usually opened in a mail app, not the browser the
 * ad opened — to the ad. The request's network address and user agent never
 * enter this module: the server function adds them when it assembles the
 * dispatchers (`createServiceDependencies`).
 */
export type ConversionContext = {
  fbp?: string;
  fbc?: string;
};

export type VerifiedLeadDispatch = (
  input: {
    eventId: string;
    email: string;
    phone?: string;
    source: string;
    landingPath?: string;
    /** Re-checks the row between the website event and the CRM event. */
    stillAllowed?: () => Promise<boolean>;
  } & ConversionContext,
) => Promise<void>;

/** The submit-time `Lead`, sent late when measurement is allowed after the submit. */
export type SubmitLeadDispatch = (
  input: {
    eventId: string;
    email: string;
    phone?: string;
    source: string;
    landingPath?: string;
    utm?: LeadRecord["utm"];
  } & ConversionContext,
) => Promise<boolean>;

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
  /** Meta click cookie, stored only when `measurementConsent` is true. */
  metaFbc?: string;
  /** Meta browser cookie, forwarded (never stored) when `measurementConsent` is true. */
  metaFbp?: string;
  /**
   * The id the browser's own `Lead` carried on this submit (first submit of a
   * page visit only). When present it is the one id the server sends for the
   * submit Lead of this consent change, so the two legs dedupe.
   */
  submitEventId?: string;
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
  dispatchSubmitLead?: SubmitLeadDispatch;
  /** Per-attempt limit on grant/withdraw calls. Defaults to one per process. */
  grantGate?: (leadId: string) => boolean;
  /** Test seam for the response floor. */
  sleep?: (ms: number) => Promise<void>;
  /** Shields the store from replayed poll bursts. */
  pollGate?: PollGate<PollResponse>;
  /**
   * Told when a confirmation mail could not be handed to the provider. Gets
   * the raw error only so it can classify it; it must not put anything from it
   * but the fixed failure class into an alert. Never allowed to fail a submit.
   */
  onDeliveryFailure?: (error: unknown) => Promise<void> | void;
};

function pendingResponse(handle: string): PendingResponse {
  return { ok: true, status: "pending", message: GENERIC_PENDING_MESSAGE, handle };
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
    signPollHandle(mintLeadId(), now.getTime(), input.measurementConsent, secret, input.canonical);

  const existing = await store.findByEmail(input.canonical, input.email);

  // A honeypot, a disposable domain or a headless client is somebody using the
  // form to mail a third party. The row is still written for review, but no
  // message is produced.
  const abusive = conversionBlocked(input.flags);
  const suppressed = abusive || input.networkSendBlocked;

  // Measurement allowed on this submit for an address that already has a row
  // (in any of the paths below, decoys included): one grant, and at most one
  // submit Lead for it — under the browser's id when the browser fired one.
  if (existing && !suppressed) {
    await grantFromSubmit(existing, input, dependencies, secret);
  }

  if (existing && existing.status !== "pending" && existing.status !== "legacy") {
    return floor(pendingResponse(decoyHandle()));
  }
  if (existing?.emailVerified) return floor(pendingResponse(decoyHandle()));
  // A legacy single opt-in row is already counted; re-confirming it is not this
  // flow's job and would only reveal that the address is known.
  if (existing?.status === "legacy") return floor(pendingResponse(decoyHandle()));

  if (
    existing &&
    (!attemptCooled(existing, now.getTime()) || existing.sends >= VERIFICATION_MAX_SENDS)
  ) {
    return floor(pendingResponse(decoyHandle()));
  }

  const leadId = mintLeadId();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString();
  const handle = signPollHandle(
    leadId,
    now.getTime(),
    input.measurementConsent,
    secret,
    input.canonical,
  );

  // A suppressed submit must not touch a row that already exists. Arming a new
  // attempt would replace `Lead ID` and kill a live confirmation link — which
  // would hand anyone who can trip a honeypot a way to cancel somebody else's
  // pending signup by replaying their address. Only a brand-new address gets a
  // row here, and it gets one purely so the attempt is reviewable.
  if (suppressed) {
    if (!existing) {
      await store.createPending({
        email: input.email,
        canonical: input.canonical,
        ...(input.phone ? { phone: input.phone } : {}),
        source: input.source,
        refCode: (dependencies.refCode ?? defaultRefCode)(),
        ...(input.referredBy ? { referredBy: input.referredBy } : {}),
        ...(input.attribution ? { attribution: input.attribution } : {}),
        flags: input.flags,
        suspect: input.suspect,
        signedUpAt: now.toISOString(),
        leadId,
        expiresAt,
      });
    }
    return floor(pendingResponse(decoyHandle()));
  }

  let record: LeadRecord;
  if (existing) {
    // Count the attempt before it can fail, so a provider stuck at 500 cannot
    // be used to keep re-arming a send.
    await store.startAttempt(existing.pageId, { leadId, expiresAt, sends: existing.sends + 1 });
    record = existing;
  } else {
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
      signedUpAt: now.toISOString(),
      leadId,
      expiresAt,
      ...(input.measurementConsent && input.metaFbc ? { metaFbc: input.metaFbc } : {}),
      measurementState: input.measurementConsent
        ? MEASUREMENT_CONSENT_GRANTED
        : MEASUREMENT_CONSENT_WITHHELD,
    });
    // The server leg of the browser's submit Lead, same id, through the row
    // gate (a No thanks may already have landed). Never fails the signup.
    if (input.measurementConsent && input.submitEventId) {
      await dispatchSubmitLeadGated(
        record.pageId,
        input.submitEventId,
        submitContext(input),
        dependencies,
      ).catch(() => false);
    }
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
  } catch (error) {
    // The attempt stays armed. Nothing about the failure reaches the response,
    // but somebody has to hear about it: the visitor was just told to check an
    // inbox no mail is going to reach.
    try {
      await dependencies.onDeliveryFailure?.(error);
    } catch {
      // Alerting is best effort and never changes what the visitor sees.
    }
    return floor(pendingResponse(handle));
  }

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
  context: ConversionContext = {},
  options: { localRefusal?: boolean } = {},
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

  // The confirming browser has a refusal stored (a No thanks or Reject all
  // whose server write may not have landed): record it before anything is sent.
  // If that write could not be confirmed, this request sends nothing at all:
  // the signup still completes (status, welcome mail), measurement does not.
  const refusalUnrecorded =
    options.localRefusal === true && !(await withdraw(parsed.leadId, dependencies));

  const metaEventId = deterministicMetaEventId(parsed.leadId, secret);

  if (record.emailVerified || record.status === "verified") {
    // The second click of one link, and the loser of two concurrent clicks,
    // both land here. Re-dispatching is the right move rather than a wasteful
    // one: the first attempt may have been the one that failed, and the event
    // ids are derived, so a duplicate collapses into the same conversion.
    const sent =
      !refusalUnrecorded &&
      (await sendConversions(
        record,
        metaEventId,
        parsed.measurementConsent,
        context,
        dependencies,
        secret,
      ));
    await scheduleWelcome(record, dependencies, now, parsed.locale);
    return {
      ok: true,
      status: "already_verified",
      refCode: record.refCode,
      ...(sent ? browserLead(record, metaEventId) : {}),
      ...measurementAsk(record, parsed.measurementConsent, options.localRefusal),
    };
  }

  // Notion is the authority on the attempt window, not the signed expiry.
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: true, status: "expired" };
  }

  const verifiedAt = now.toISOString();
  await dependencies.store.markVerified(record.pageId, { verifiedAt, metaEventId });

  // Notion has no compare-and-set, so two racing confirmations can both reach
  // this line. Both emit the identical ids, so Meta collapses them.
  const sent =
    !refusalUnrecorded &&
    (await sendConversions(
      { ...record, emailVerified: true, status: "verified" },
      metaEventId,
      parsed.measurementConsent,
      context,
      dependencies,
      secret,
    ));
  await scheduleWelcome(record, dependencies, now, parsed.locale);

  return {
    ok: true,
    status: "verified",
    refCode: record.refCode,
    ...(sent ? browserLead(record, metaEventId) : {}),
    ...measurementAsk(record, parsed.measurementConsent, options.localRefusal),
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
      ...(record.metaEventId && measurementAllows(record, parsed.measurementConsent)
        ? browserLead(record, record.metaEventId)
        : {}),
    };
  };

  return dependencies.pollGate ? dependencies.pollGate.run(handle, read) : read();
}

// --- advertising measurement -------------------------------------------------

/** A refusal recorded on the row, in either of the two places it can live. */
export function measurementWithdrawn(record: LeadRecord): boolean {
  return (
    record.measurementConsent === MEASUREMENT_CONSENT_WITHDRAWN ||
    record.flags.includes(FLAG_MEASUREMENT_WITHDRAWN)
  );
}

/**
 * Whether advertising measurement is allowed for this lead now. Any refusal
 * on the row beats everything. A granted cell (in either granted state)
 * allows it; a withheld cell does not. Only a pre-release row with an empty
 * cell falls back to the attempt's signed consent bit.
 */
export function measurementAllows(record: LeadRecord, signedConsent: boolean): boolean {
  if (measurementWithdrawn(record) || conversionBlocked(record.flags)) return false;
  const cell = record.measurementConsent ?? "";
  if (cell === MEASUREMENT_CONSENT_GRANTED || cell === MEASUREMENT_CONSENT_LEAD_PENDING)
    return true;
  if (cell === MEASUREMENT_CONSENT_WITHHELD) return false;
  return signedConsent;
}

/** @deprecated name kept for callers and tests: same rule as `measurementAllows`. */
export const effectiveMeasurement = measurementAllows;

/** Ask once on the confirmation page: nobody allowed it, nobody refused it. */
function measurementAsk(
  record: LeadRecord,
  signedConsent: boolean,
  localRefusal = false,
): { measurementAsk?: true } {
  if (localRefusal || measurementAllows(record, signedConsent)) return {};
  if (measurementWithdrawn(record) || conversionBlocked(record.flags)) return {};
  return { measurementAsk: true };
}

/**
 * The browser half of the confirmation. Only ever returned for a conversion
 * the server actually sent in the same call (or, on poll, one the row allows).
 */
function browserLead(record: LeadRecord, eventId: string): { browserLead?: BrowserLead } {
  if (!eventId) return {};
  return { browserLead: { eventId, source: record.source, hasPhone: Boolean(record.phone) } };
}

/**
 * The click cookie: the confirming browser's when it has one, else the one
 * stored with the lead when measurement was allowed. No value is invented.
 */
function conversionContext(record: LeadRecord, context: ConversionContext): ConversionContext {
  const fbc = context.fbc || record.metaFbc;
  return {
    ...(context.fbp ? { fbp: context.fbp } : {}),
    ...(fbc ? { fbc } : {}),
  };
}

/**
 * The gate every send passes through, immediately before it leaves: a fresh
 * read of the row. It fails closed — an unreadable row sends nothing. That
 * never loses a conversion for good: a `granted-lead-pending` Lead stays
 * pending and the next grant, resend or confirmation retries it, and a
 * confirmation is re-sent on the next click of the link.
 */
async function rowAllowsSend(
  pageId: string,
  signedConsent: boolean,
  dependencies: ServiceDependencies,
): Promise<LeadRecord | undefined> {
  const row = await dependencies.store.reread(pageId).catch(() => undefined);
  if (!row || !measurementAllows(row, signedConsent)) return undefined;
  return row;
}

/**
 * Sends the withheld submit `Lead` if — and only if — the row says it is
 * pending, under an id derived from the row (stable across resends, so a retry
 * dedupes). The row moves to `granted` only after Meta acknowledged the event.
 * A refusal racing that last write still wins: it lives in `Flags`, which this
 * never touches.
 */
async function flushPendingLead(
  pageId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
  browserEventId?: string,
): Promise<void> {
  if (!dependencies.dispatchSubmitLead) return;
  const row = await rowAllowsSend(pageId, false, dependencies);
  if (!row || row.measurementConsent !== MEASUREMENT_CONSENT_LEAD_PENDING) return;
  const acknowledged = await sendSubmitLead(
    row,
    browserEventId || deterministicSubmitEventId(row.pageId, secret),
    context,
    dependencies,
  );
  // With a browser id the browser leg has already fired under it: this change
  // of consent has had its one id, and a later retry under a different id
  // would be a second Lead. Without one, only Meta's acknowledgement closes it.
  if (!acknowledged && !browserEventId) return;
  const after = await dependencies.store.reread(pageId).catch(() => undefined);
  if (after && after.measurementConsent === MEASUREMENT_CONSENT_LEAD_PENDING) {
    await dependencies.store
      .recordMeasurementState(pageId, MEASUREMENT_CONSENT_GRANTED)
      .catch(() => {
        // Stays pending: the next opportunity re-sends under the same id.
      });
    // A refusal whose cell write landed between that read and this write
    // must not be left overwritten.
    const settled = await dependencies.store.reread(pageId).catch(() => undefined);
    if (settled && settled.flags.includes(FLAG_MEASUREMENT_WITHDRAWN)) {
      if (settled.measurementConsent !== MEASUREMENT_CONSENT_WITHDRAWN) {
        await dependencies.store.recordMeasurementWithdrawal(pageId).catch(() => {});
      }
    }
  }
}

function sendSubmitLead(
  row: LeadRecord,
  eventId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
): Promise<boolean> {
  if (!dependencies.dispatchSubmitLead) return Promise.resolve(false);
  return dependencies
    .dispatchSubmitLead({
      eventId,
      email: row.email,
      ...(row.phone ? { phone: row.phone } : {}),
      source: row.source,
      ...(row.landingPath ? { landingPath: row.landingPath } : {}),
      ...(row.utm ? { utm: row.utm } : {}),
      ...conversionContext(row, context),
    })
    .catch(() => false);
}

/** A brand-new row's submit Lead: re-read, then sent only if the row allows it. */
async function dispatchSubmitLeadGated(
  pageId: string,
  eventId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
): Promise<boolean> {
  const row = await rowAllowsSend(pageId, false, dependencies);
  if (!row) return false;
  return sendSubmitLead(row, eventId, context, dependencies);
}

function submitContext(input: RequestVerificationInput): ConversionContext {
  return {
    ...(input.metaFbp ? { fbp: input.metaFbp } : {}),
    ...(input.metaFbc ? { fbc: input.metaFbc } : {}),
  };
}

/**
 * A submit carrying measurement permission for an address that already has a
 * row: the same grant as the inbox card (re-read, refusal wins), then the
 * submit Lead only if the row's cell says it was withheld — under the
 * browser's id when it sent one, so both legs are one Lead. A row already
 * granted gets no second Lead. Legacy and unsubscribed rows are left alone.
 */
async function grantFromSubmit(
  existing: LeadRecord,
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
  secret: string,
): Promise<void> {
  if (!input.measurementConsent || conversionBlocked(existing.flags)) return;
  if (existing.status !== "pending" && existing.status !== "verified") return;
  try {
    const outcome = await applyGrant(existing, dependencies);
    if (outcome === "refused") return;
    // The browser's id only for the consent change this request made. A cell
    // that was already pending is a retry of an earlier send under the row's
    // id: it keeps that id and closes only on Meta's acknowledgement.
    await flushPendingLead(
      existing.pageId,
      submitContext(input),
      dependencies,
      secret,
      outcome === "opened" ? input.submitEventId : undefined,
    );
  } catch {
    // Measurement never fails a submit.
  }
}

/** The confirmation, through the same gate. True when it was sent. */
async function sendConfirmation(
  pageId: string,
  eventId: string,
  signedConsent: boolean,
  context: ConversionContext,
  dependencies: ServiceDependencies,
): Promise<boolean> {
  if (!dependencies.dispatchVerifiedLead) return false;
  const row = await rowAllowsSend(pageId, signedConsent, dependencies);
  if (!row || !(row.emailVerified || row.status === "verified")) return false;
  const stillAllowed = async () =>
    Boolean(await rowAllowsSend(pageId, signedConsent, dependencies));
  await dependencies
    .dispatchVerifiedLead({
      eventId,
      email: row.email,
      ...(row.phone ? { phone: row.phone } : {}),
      source: row.source,
      ...(row.landingPath ? { landingPath: row.landingPath } : {}),
      ...conversionContext(row, context),
      // Between its two Meta calls the dispatcher asks again, so a refusal
      // that lands during the first call stops the second.
      stillAllowed,
    })
    .catch(() => {
      // A measurement outage never un-confirms a confirmed lead.
    });
  // The browser half only if the row still allows it after the send: a
  // refusal that landed during the HTTP call keeps the pixel quiet.
  return stillAllowed();
}

/**
 * Everything a confirmed (or confirming) lead may send: a pending submit Lead
 * first, then the confirmation. Each passes the row gate on its own.
 */
async function sendConversions(
  record: LeadRecord,
  confirmationEventId: string,
  signedConsent: boolean,
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
): Promise<boolean> {
  await flushPendingLead(record.pageId, context, dependencies, secret);
  return sendConfirmation(record.pageId, confirmationEventId, signedConsent, context, dependencies);
}

/** Stores the click cookie, then makes sure no refusal landed meanwhile. */
async function storeClickCookie(
  pageId: string,
  fbc: string | undefined,
  dependencies: ServiceDependencies,
): Promise<void> {
  if (!fbc) return;
  await dependencies.store.recordMeasurementFbc(pageId, fbc).catch(() => {});
  const after = await dependencies.store.reread(pageId).catch(() => undefined);
  if (after && measurementWithdrawn(after)) {
    // The withdrawal write clears the click cookie; repeat it so it is gone.
    await dependencies.store.recordMeasurementWithdrawal(pageId).catch(() => {});
  }
}

export type AttemptGrantInput = ConversionContext & { source?: string };

// Grants and refusals per attempt, per server process. A real browser sends
// one or two; anything beyond this is a replay, answered without touching the
// CRM or Meta. Bounded so a flood cannot grow it without limit.
const GRANT_CALLS_PER_ATTEMPT = 6;
export function createGrantGate(limit = GRANT_CALLS_PER_ATTEMPT): (leadId: string) => boolean {
  const calls = new Map<string, number>();
  return (leadId) => {
    if (calls.size > 10_000) calls.clear();
    const count = (calls.get(leadId) ?? 0) + 1;
    calls.set(leadId, count);
    return count <= limit;
  };
}
const processGrantGate = createGrantGate();

/**
 * Records a grant so that a refusal always wins. Notion has no
 * compare-and-set, so: re-read, refuse if withdrawn; write only the consent
 * cell; re-read again, and if a refusal landed meanwhile (the flag a grant
 * never writes), put the cell back and refuse. A failed write is a refusal.
 *
 * Only a cell that says `withheld` moves to `granted-lead-pending`. An empty
 * cell is a row from before the cell existed: whatever its submit did is
 * already done, and no signed bit can prove otherwise (reminder links, for
 * one, are minted without it), so it moves straight to `granted` and no
 * submit Lead follows. Losing that one pre-release Lead beats counting it twice.
 */
async function applyGrant(
  record: LeadRecord,
  dependencies: ServiceDependencies,
): Promise<"granted" | "opened" | "refused"> {
  const { store } = dependencies;
  const fresh = (await store.reread(record.pageId).catch(() => undefined)) ?? record;
  if (measurementWithdrawn(fresh) || conversionBlocked(fresh.flags)) return "refused";
  const cell = fresh.measurementConsent ?? "";
  if (cell === MEASUREMENT_CONSENT_GRANTED || cell === MEASUREMENT_CONSENT_LEAD_PENDING) {
    return "granted";
  }
  const target =
    cell === MEASUREMENT_CONSENT_WITHHELD
      ? MEASUREMENT_CONSENT_LEAD_PENDING
      : MEASUREMENT_CONSENT_GRANTED;
  try {
    await store.recordMeasurementState(record.pageId, target);
  } catch {
    return "refused";
  }
  const after = await store.reread(record.pageId).catch(() => undefined);
  if (after && measurementWithdrawn(after)) {
    await store.recordMeasurementWithdrawal(record.pageId).catch(() => {});
    return "refused";
  }
  // "opened": this call is the one that moved `withheld` to pending.
  return target === MEASUREMENT_CONSENT_LEAD_PENDING ? "opened" : "granted";
}

/** Same floor as submit: a decoy and a real attempt answer in the same time. */
function grantFloor(dependencies: ServiceDependencies) {
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const startedAtMs = clock().getTime();
  return <T>(result: T) => withResponseFloor(startedAtMs, () => clock().getTime(), sleep, result);
}

/**
 * Measurement allowed from the inbox card (or the banner) after the submit.
 * The poll handle — held only by the submitting tab, signed, short-lived —
 * names the attempt. The answer is always `{ ok: true }` after the same floor,
 * real attempt or decoy: nothing in it says what the row is. Conversions are
 * server-side only; the browser fires nothing from this answer.
 */
export async function grantAttemptMeasurementService(
  handle: string,
  input: AttemptGrantInput,
  dependencies: ServiceDependencies,
): Promise<MeasurementGrantResponse> {
  const floor = grantFloor(dependencies);
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const now = (dependencies.now ?? (() => new Date()))();
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  if (!parsed || !(dependencies.grantGate ?? processGrantGate)(parsed.leadId)) {
    return floor({ ok: true });
  }

  const record = await dependencies.store.findByLeadId(parsed.leadId);
  if (!record || record.status === "unsubscribed") return floor({ ok: true });

  const outcome = await applyGrant(record, dependencies);
  if (outcome !== "refused") {
    const context = {
      ...(input.fbp ? { fbp: input.fbp } : {}),
      ...(input.fbc ? { fbc: input.fbc } : {}),
    };
    await sendConversions(
      record,
      record.metaEventId || deterministicMetaEventId(parsed.leadId, secret),
      parsed.measurementConsent,
      context,
      dependencies,
      secret,
    );
    await storeClickCookie(record.pageId, input.fbc, dependencies);
  }
  return floor({ ok: true });
}

/**
 * Measurement allowed on the confirmation page. The confirmation token names
 * the attempt; the lead must already be confirmed. Sends what was withheld and
 * returns the confirmation's browser half only if that was actually sent.
 */
export async function grantConfirmationMeasurementService(
  rawToken: string,
  input: ConversionContext,
  dependencies: ServiceDependencies,
): Promise<MeasurementGrantResponse> {
  const floor = grantFloor(dependencies);
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const now = (dependencies.now ?? (() => new Date()))();
  if (!isVerificationTokenShape(rawToken)) return floor({ ok: true });
  const parsed = parseVerificationToken(rawToken, secret, now.getTime());
  if (!parsed || !(dependencies.grantGate ?? processGrantGate)(parsed.leadId)) {
    return floor({ ok: true });
  }

  const record = await dependencies.store.findByLeadId(parsed.leadId);
  if (!record || record.status === "unsubscribed") return floor({ ok: true });
  if (!(record.emailVerified || record.status === "verified")) return floor({ ok: true });

  if ((await applyGrant(record, dependencies)) === "refused") {
    return floor({ ok: true });
  }
  const eventId = deterministicMetaEventId(parsed.leadId, secret);
  const sent = await sendConversions(
    record,
    eventId,
    parsed.measurementConsent,
    input,
    dependencies,
    secret,
  );
  await storeClickCookie(record.pageId, input.fbc, dependencies);
  return floor({ ok: true, ...(sent ? browserLead(record, eventId) : {}) });
}

/**
 * A refusal after the submit (inbox card, banner, or confirmation page) while
 * this browser still holds the attempt's handle or token. Recorded on the row,
 * so a later confirmation in any browser sends nothing. Retried and re-read:
 * `recorded` is true only when the row really shows the refusal (or there is
 * no row to refuse for).
 */
async function withdraw(
  leadId: string,
  dependencies: ServiceDependencies,
  refusalCanonical?: string,
): Promise<boolean> {
  let record: LeadRecord | undefined;
  try {
    record = await dependencies.store.findByLeadId(leadId);
    // A decoy handle (cooldown, send ceiling, already confirmed) names no row,
    // but the person's mail still confirms one: find it by the sealed address.
    // Every handle a submit returns carries it, so this lookup says nothing
    // about which kind of handle it was, and the answer stays the same.
    if (!record && refusalCanonical) {
      record = await dependencies.store.findByEmail(refusalCanonical, refusalCanonical);
    }
  } catch {
    // Unknown is not recorded: the browser keeps retrying.
    return false;
  }
  if (!record || measurementWithdrawn(record)) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await dependencies.store.recordMeasurementWithdrawal(record.pageId);
    } catch {
      // The re-read decides; the write may have landed before the error.
    }
    const after = await dependencies.store.reread(record.pageId).catch(() => undefined);
    if (after && measurementWithdrawn(after)) return true;
  }
  return false;
}

/** `recorded: false` only when a real refusal could not be written; retry. */
export type WithdrawResponse = { ok: true; recorded: boolean };

export async function withdrawAttemptMeasurementService(
  handle: string,
  dependencies: ServiceDependencies,
): Promise<WithdrawResponse> {
  const floor = grantFloor(dependencies);
  const secret = requireSecret(dependencies.env ?? process.env);
  const now = (dependencies.now ?? (() => new Date()))();
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  // An expired or unreadable handle records nothing, so it must not tell the
  // browser it did: the browser keeps its refusal pending and hands it to the
  // confirmation request, which records it before anything is sent.
  const recorded = parsed
    ? await withdraw(parsed.leadId, dependencies, parsed.refusalCanonical)
    : false;
  return floor({ ok: true as const, recorded });
}

export async function withdrawConfirmationMeasurementService(
  rawToken: string,
  dependencies: ServiceDependencies,
): Promise<WithdrawResponse> {
  const floor = grantFloor(dependencies);
  const secret = requireSecret(dependencies.env ?? process.env);
  const now = (dependencies.now ?? (() => new Date()))();
  const parsed = isVerificationTokenShape(rawToken)
    ? parseVerificationToken(rawToken, secret, now.getTime())
    : undefined;
  const recorded = parsed ? await withdraw(parsed.leadId, dependencies) : false;
  return floor({ ok: true as const, recorded });
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
