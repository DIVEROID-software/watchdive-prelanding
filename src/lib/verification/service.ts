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
  MEASUREMENT_CONSENT_WITHDRAWN,
  GENERIC_PENDING_MESSAGE,
  MIN_RESPONSE_MS,
  POLL_HANDLE_TTL_MS,
  VERIFICATION_MAX_SENDS,
  WELCOME_DELAY_MS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
} from "./contracts.ts";
import {
  persistableExperimentContext,
  type ExperimentContext,
} from "../conversionExperimentContract.ts";
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
) => Promise<void>;

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
  /** Language selected on the page. Defaults to English for legacy callers. */
  locale?: Locale;
  /** True when this network has produced too many recent signups to keep mailing. */
  networkSendBlocked: boolean;
  /**
   * Optional same-session experiment context. Stored only when this call creates
   * a new consented, non-suspect row. A resend cannot rewrite it.
   */
  experiment?: ExperimentContext;
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
  /** Per-attempt limit on grant calls. Defaults to one per process. */
  grantGate?: (leadId: string) => boolean;
  /**
   * Per-attempt limit on withdrawals. A separate map from `grantGate`: burning
   * the grant budget must not turn a later refusal into a silent no-op.
   */
  withdrawGate?: (leadId: string) => boolean;
  /**
   * Event ids already handed to Meta from this process. A retry of the same
   * attempt reuses the id; it must not become a second Lead.
   */
  submitLeadLedger?: Set<string>;
  /**
   * `Sec-GPC: 1` on the calling request. A trusted browser header, never a
   * field from the JSON body. When set, no grant is written and nothing is sent.
   */
  gpc?: boolean;
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

function leadExperiment(input: RequestVerificationInput): { experiment?: ExperimentContext } {
  const experiment = persistableExperimentContext(input.experiment, {
    measurementConsent: input.measurementConsent,
    suspect: input.suspect,
    blocked: conversionBlocked(input.flags) || input.networkSendBlocked,
  });
  return experiment ? { experiment } : {};
}

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

  // Global Privacy Control wins over a body that claims consent. The header is
  // the only input; the JSON field cannot turn it off.
  const consentRequested = dependencies.gpc === true ? false : input.measurementConsent;

  // Every early return still hands back a well-formed handle naming an attempt
  // no row carries. The caller cannot tell a skipped send from a real one.
  const decoyHandle = () =>
    signPollHandle(mintLeadId(), now.getTime(), consentRequested, secret);

  const existing = await store.findByEmail(input.canonical, input.email);

  // A honeypot, a disposable domain or a headless client is somebody using the
  // form to mail a third party. The row is still written for review, but no
  // message is produced.
  const abusive = conversionBlocked(input.flags);
  const suppressed = abusive || input.networkSendBlocked;

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
  // Replaced after a resend, once we know whether this attempt already emitted
  // its Lead. A true bit is not itself that proof.
  let consentBit = consentRequested;
  let handle = signPollHandle(leadId, now.getTime(), consentBit, secret);

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
    // A resend that now carries consent, for a row that was not already
    // granted: record the grant and send the withheld Lead under this new
    // attempt id. A cell that was already granted used either the original
    // browser event id or an earlier server id — a second id would double-count.
    // The signed bit on this request is not that proof. Mail still goes out
    // when the measurement write cannot be confirmed.
    if (consentBit && !conversionBlocked(existing.flags)) {
      const late = await grantWithheldLeadOnResend(existing, leadId, input, dependencies, secret);
      // A true bit is the receipt that this attempt's Lead was sent, or that
      // the row was already granted under an earlier id. An unconfirmed send
      // and a withdrawal stay false: the bit alone is not that receipt.
      if (late === "pending" || late === "withdrawn") consentBit = false;
    }
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
      ...(consentBit && input.metaFbc ? { metaFbc: input.metaFbc } : {}),
      ...(consentBit ? { measurementGranted: true as const } : {}),
      ...leadExperiment({ ...input, measurementConsent: consentBit }),
    });
  }

  handle = signPollHandle(leadId, now.getTime(), consentBit, secret);
  const token = createVerificationToken(
    leadId,
    now.getTime() + VERIFICATION_TTL_MS,
    consentBit,
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
    const consent = consentForRequest(record, parsed.measurementConsent, dependencies);
    await dispatchIfPermitted(record, metaEventId, consent, dependencies, context);
    await scheduleWelcome(record, dependencies, now, parsed.locale);
    return {
      ok: true,
      status: "already_verified",
      refCode: record.refCode,
      ...browserLead(record, metaEventId, consent),
      ...measurementAsk(record, parsed.measurementConsent),
    };
  }

  // Notion is the authority on the attempt window, not the signed expiry.
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: true, status: "expired" };
  }

  const verifiedAt = now.toISOString();
  await dependencies.store.markVerified(record.pageId, { verifiedAt, metaEventId });

  // Notion has no compare-and-set, so two racing confirmations can genuinely
  // both reach this line. That is safe, not lucky: the event id is derived from
  // the attempt, so both emit the identical id and Meta collapses them into one
  // conversion. Dispatch is the only downstream action and it is idempotent.
  // Gating on a re-read would not add exactly-once — it would only risk
  // dropping the single dispatch when the read comes back stale.
  const consent = consentForRequest(record, parsed.measurementConsent, dependencies);
  await dispatchIfPermitted(record, metaEventId, consent, dependencies, context);
  await scheduleWelcome(record, dependencies, now, parsed.locale);

  return {
    ok: true,
    status: "verified",
    refCode: record.refCode,
    ...browserLead(record, metaEventId, consent),
    ...measurementAsk(record, parsed.measurementConsent),
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
      ...browserLead(
        record,
        record.metaEventId,
        consentForRequest(record, parsed.measurementConsent, dependencies),
      ),
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
  context: ConversionContext = {},
): Promise<void> {
  if (!measurementConsent || conversionBlocked(record.flags)) return;
  if (!dependencies.dispatchVerifiedLead) return;
  await dependencies
    .dispatchVerifiedLead({
      eventId,
      email: record.email,
      ...(record.phone ? { phone: record.phone } : {}),
      source: record.source,
      ...(record.landingPath ? { landingPath: record.landingPath } : {}),
      ...conversionContext(record, context),
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

/**
 * Whether advertising measurement is allowed for this lead now. A withdrawal
 * recorded on the row beats everything; otherwise the submitting browser's
 * signed choice, or a later explicit grant recorded on the row, allows it.
 */
/** A refusal recorded on the row, in either of the two places it can live. */
export function measurementWithdrawn(record: LeadRecord): boolean {
  return (
    record.measurementConsent === MEASUREMENT_CONSENT_WITHDRAWN ||
    record.flags.includes(FLAG_MEASUREMENT_WITHDRAWN)
  );
}

export function effectiveMeasurement(record: LeadRecord, signedConsent: boolean): boolean {
  if (measurementWithdrawn(record)) return false;
  return signedConsent || record.measurementConsent === MEASUREMENT_CONSENT_GRANTED;
}

/** Global Privacy Control on the calling request beats a granted row and a signed bit. */
function consentForRequest(
  record: LeadRecord,
  signedConsent: boolean,
  dependencies: ServiceDependencies,
): boolean {
  if (dependencies.gpc) return false;
  return effectiveMeasurement(record, signedConsent);
}

/** Ask once on the confirmation page: nobody allowed it, nobody refused it. */
function measurementAsk(record: LeadRecord, signedConsent: boolean): { measurementAsk?: true } {
  if (effectiveMeasurement(record, signedConsent)) return {};
  if (measurementWithdrawn(record)) return {};
  if (conversionBlocked(record.flags)) return {};
  return { measurementAsk: true };
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

export type AttemptGrantInput = ConversionContext;

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
/** Withdrawals do not spend the grant budget, and grants do not spend this one. */
const processWithdrawGate = createGrantGate();
const processSubmitLeadLedger = new Set<string>();

type GrantOutcome = "granted" | "already" | "refused" | "uncertain";
type MeasurementView = "granted" | "withdrawn" | "open" | "unknown";

function leadLedger(dependencies: ServiceDependencies): Set<string> {
  return dependencies.submitLeadLedger ?? processSubmitLeadLedger;
}

/**
 * A failed read is `unknown`, never a guess from the object we already held.
 * Dispatching off that stale object is how a withdrawal was missed.
 */
async function readMeasurementState(store: LeadStore, pageId: string): Promise<MeasurementView> {
  try {
    const row = await store.reread(pageId);
    if (!row) return "unknown";
    if (measurementWithdrawn(row)) return "withdrawn";
    if (row.measurementConsent === MEASUREMENT_CONSENT_GRANTED) return "granted";
    return "open";
  } catch {
    return "unknown";
  }
}

/**
 * The server id is owed unless this attempt already emitted the Lead.
 * `already` plus a true signed bit is that receipt: the cell was granted
 * before this call, and the attempt was signed as consented (the original
 * submit's browser event id, or a resend whose dispatch we confirmed).
 * A true bit alone is not a receipt — outcome `granted` means the cell was
 * not granted yet, so the Lead is still owed under the server id.
 */
function owesServerSubmitLead(signedConsent: boolean, outcome: "granted" | "already"): boolean {
  return !(outcome === "already" && signedConsent);
}

/**
 * Records a grant so that a refusal always wins. Notion has no
 * compare-and-set, so: re-read, refuse if withdrawn; write only the consent
 * cell; re-read again, and if a refusal landed meanwhile (the flag a grant
 * never writes), put the cell back and refuse.
 *
 * A read that throws is `uncertain`. The stale record is not consulted, and
 * nothing is sent: a withdrawal may be sitting on the row we could not see.
 * The write, if it landed, stays. The next call sees `already` and sends the
 * same server id when this was a late grant.
 */
async function applyGrant(
  record: LeadRecord,
  dependencies: ServiceDependencies,
): Promise<GrantOutcome> {
  const { store } = dependencies;
  const fresh = await readMeasurementState(store, record.pageId);
  if (fresh === "unknown") return "uncertain";
  if (fresh === "withdrawn") return "refused";
  if (fresh === "granted") return "already";
  try {
    await store.recordMeasurementGrant(record.pageId);
  } catch {
    // The write may have landed and the error is only the lost response.
    // The re-read decides. Treating this as a refusal dropped a Lead that a
    // later call, seeing the cell already granted, is allowed to send.
  }
  const after = await readMeasurementState(store, record.pageId);
  if (after === "withdrawn") {
    await store.recordMeasurementWithdrawal(record.pageId).catch(() => {});
    return "refused";
  }
  // `granted` covers both a clean write and a write whose response was lost.
  // Anything else (still open, or a read that failed) is retried. Nothing is
  // sent until a read actually shows the grant.
  if (after === "granted") return "granted";
  return "uncertain";
}

/**
 * `granted` — the cell was already granted, so this resend must not mint a
 * new Lead id. `withdrawn` — a refusal is on the row. `pending` — the Lead
 * is still owed; the caller signs the new attempt as not-yet-sent so a later
 * grant retries the same server id. `dispatched` — this call sent it.
 */
type ResendLateLead = "dispatched" | "granted" | "withdrawn" | "pending";

/**
 * Resend of a row whose submit withheld the Lead. Re-reads before the write,
 * after the write, and again after the click cookie, and only then sends.
 */
async function grantWithheldLeadOnResend(
  existing: LeadRecord,
  leadId: string,
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
  secret: string,
): Promise<ResendLateLead> {
  const prior = await readMeasurementState(dependencies.store, existing.pageId);
  if (prior === "granted") return "granted";
  if (prior === "withdrawn") return "withdrawn";
  if (prior !== "open") return "pending";
  try {
    await dependencies.store.recordMeasurementGrant(existing.pageId);
  } catch {
    const lost = await readMeasurementState(dependencies.store, existing.pageId);
    if (lost === "withdrawn") {
      await dependencies.store.recordMeasurementWithdrawal(existing.pageId).catch(() => {});
      return "withdrawn";
    }
    if (lost !== "granted") return "pending";
  }
  const context: ConversionContext = input.metaFbc ? { fbc: input.metaFbc } : {};
  const afterWrite = await readMeasurementState(dependencies.store, existing.pageId);
  if (afterWrite === "withdrawn") {
    await dependencies.store.recordMeasurementWithdrawal(existing.pageId).catch(() => {});
    return "withdrawn";
  }
  if (afterWrite !== "granted") return "pending";
  if (context.fbc) {
    await dependencies.store.recordMeasurementFbc(existing.pageId, context.fbc).catch(() => {});
    const afterFbc = await readMeasurementState(dependencies.store, existing.pageId);
    if (afterFbc === "withdrawn") {
      await dependencies.store.recordMeasurementWithdrawal(existing.pageId).catch(() => {});
      return "withdrawn";
    }
    if (afterFbc !== "granted") return "pending";
  }
  const sent = await sendSubmitLeadOnce(existing, leadId, context, dependencies, secret);
  return sent ? "dispatched" : "pending";
}

/** One server Lead per attempt id per process. A failed send stays retryable. */
async function sendSubmitLeadOnce(
  record: LeadRecord,
  leadId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
): Promise<boolean> {
  if (!dependencies.dispatchSubmitLead) return false;
  const eventId = deterministicSubmitEventId(leadId, secret);
  const ledger = leadLedger(dependencies);
  if (ledger.has(eventId)) return true;
  if ((await readMeasurementState(dependencies.store, record.pageId)) !== "granted") return false;
  try {
    await dependencies.dispatchSubmitLead({
      eventId,
      email: record.email,
      ...(record.phone ? { phone: record.phone } : {}),
      source: record.source,
      ...(record.landingPath ? { landingPath: record.landingPath } : {}),
      ...(record.utm ? { utm: record.utm } : {}),
      ...context,
    });
    ledger.add(eventId);
    return true;
  } catch {
    return false;
  }
}

/** Same floor as submit: a decoy and a real attempt answer in the same time. */
function grantFloor(dependencies: ServiceDependencies) {
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const startedAtMs = clock().getTime();
  return <T>(result: T) => withResponseFloor(startedAtMs, () => clock().getTime(), sleep, result);
}

/**
 * After a grant: the withheld submit Lead (when this attempt has not already
 * emitted one) and the confirmation, if it has happened. Both use ids derived
 * from the attempt, so a retry collapses at Meta.
 *
 * The row is read immediately before the click cookie is written, again after
 * that write, and again immediately before each dispatch. A withdrawal wins.
 * A read that fails is not treated as the record we held in memory: nothing
 * is sent. Notion and Meta are not one transaction, so a withdrawal that
 * lands during the dispatch HTTP call itself can still ride that one request.
 * That window is the call, not the cookie write.
 */
async function dispatchAfterGrant(
  record: LeadRecord,
  leadId: string,
  signedConsent: boolean,
  outcome: "granted" | "already",
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
  surface: "attempt" | "confirmation",
): Promise<MeasurementGrantResponse> {
  const retry = (): MeasurementGrantResponse =>
    surface === "confirmation" ? { ok: true, status: "retry" } : { ok: true };
  const quiet = (): MeasurementGrantResponse => ({ ok: true });

  const before = await readMeasurementState(dependencies.store, record.pageId);
  if (before === "unknown") return retry();
  if (before !== "granted") return quiet();

  const conversion = conversionContext(record, context);
  const submitEventId = deterministicSubmitEventId(leadId, secret);
  const oweLead = owesServerSubmitLead(signedConsent, outcome);
  const ledger = leadLedger(dependencies);
  if (oweLead && conversion.fbc && !ledger.has(submitEventId)) {
    await dependencies.store.recordMeasurementFbc(record.pageId, conversion.fbc).catch(() => {});
    const afterFbc = await readMeasurementState(dependencies.store, record.pageId);
    if (afterFbc === "withdrawn") {
      await dependencies.store.recordMeasurementWithdrawal(record.pageId).catch(() => {});
      return quiet();
    }
    if (afterFbc !== "granted") return retry();
  }

  const response: MeasurementGrantResponse = { ok: true };
  if (oweLead) {
    const sent = await sendSubmitLeadOnce(record, leadId, conversion, dependencies, secret);
    const now = await readMeasurementState(dependencies.store, record.pageId);
    if (now === "withdrawn") return quiet();
    if (!sent && now !== "granted") return retry();
    if (sent && surface === "confirmation") {
      response.submitLead = { eventId: submitEventId, source: record.source };
    }
  }

  if (!(record.emailVerified || record.status === "verified")) return response;
  const emailView = await readMeasurementState(dependencies.store, record.pageId);
  if (emailView === "unknown") return retry();
  if (emailView !== "granted") return quiet();
  const emailEventId =
    record.metaEventId || deterministicMetaEventId(leadId, secret);
  if (!ledger.has(emailEventId)) {
    await dispatchIfPermitted(record, emailEventId, true, dependencies, context);
    ledger.add(emailEventId);
  }
  if (surface === "confirmation") {
    Object.assign(response, browserLead(record, emailEventId, true));
  }
  return response;
}

/**
 * Measurement allowed from the inbox card, after the submit. The poll handle
 * — held only by the submitting tab, signed, short-lived — names the attempt.
 * Every handle gets the same body, `{ ok: true }`, in the same minimum time.
 * The late Lead stays on the server. A browser payload here would both tell
 * a caller whether the address is a real ungranted lead and fire a conversion
 * for a decoy.
 */
const attemptGrantBody = (): MeasurementGrantResponse => ({ ok: true });

export async function grantAttemptMeasurementService(
  handle: string,
  input: AttemptGrantInput,
  dependencies: ServiceDependencies,
): Promise<MeasurementGrantResponse> {
  const floor = grantFloor(dependencies);
  const env = dependencies.env ?? process.env;
  const secret = requireSecret(env);
  const now = (dependencies.now ?? (() => new Date()))();
  if (dependencies.gpc) return floor(attemptGrantBody());
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  if (!parsed || !(dependencies.grantGate ?? processGrantGate)(parsed.leadId)) {
    return floor(attemptGrantBody());
  }

  let record: LeadRecord | undefined;
  try {
    record = await dependencies.store.findByLeadId(parsed.leadId);
  } catch {
    // Same body as a decoy. The client repeats the call a bounded number of
    // times, because this answer cannot say whether the grant landed.
    return floor(attemptGrantBody());
  }
  if (!record || record.status === "unsubscribed") return floor(attemptGrantBody());
  if (measurementWithdrawn(record) || conversionBlocked(record.flags)) {
    return floor(attemptGrantBody());
  }

  const outcome = await applyGrant(record, dependencies);
  if (outcome === "refused" || outcome === "uncertain") return floor(attemptGrantBody());
  await dispatchAfterGrant(
    record,
    parsed.leadId,
    parsed.measurementConsent,
    outcome,
    { ...(input.fbp ? { fbp: input.fbp } : {}), ...(input.fbc ? { fbc: input.fbc } : {}) },
    dependencies,
    secret,
    "attempt",
  );
  return floor(attemptGrantBody());
}

/**
 * Measurement allowed on the confirmation page. The confirmation token names
 * the attempt; the lead must already be confirmed. Sends what was withheld —
 * the submit `Lead` and the confirmation — and returns both browser halves.
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
  if (dependencies.gpc) return floor({ ok: true });
  if (!isVerificationTokenShape(rawToken)) return floor({ ok: true });
  const parsed = parseVerificationToken(rawToken, secret, now.getTime());
  if (!parsed || !(dependencies.grantGate ?? processGrantGate)(parsed.leadId)) {
    return floor({ ok: true });
  }

  let record: LeadRecord | undefined;
  try {
    record = await dependencies.store.findByLeadId(parsed.leadId);
  } catch {
    return floor({ ok: true, status: "retry" });
  }
  if (!record || record.status === "unsubscribed") return floor({ ok: true });
  if (!(record.emailVerified || record.status === "verified")) return floor({ ok: true });
  if (measurementWithdrawn(record) || conversionBlocked(record.flags)) return floor({ ok: true });

  const outcome = await applyGrant(record, dependencies);
  if (outcome === "uncertain") return floor({ ok: true, status: "retry" });
  if (outcome === "refused") return floor({ ok: true });
  // The token holder received the mail. The browser halves are theirs.
  // They are attached only after a re-read still shows the grant.
  return floor(
    await dispatchAfterGrant(
      { ...record, metaEventId: deterministicMetaEventId(parsed.leadId, secret) },
      parsed.leadId,
      parsed.measurementConsent,
      outcome,
      input,
      dependencies,
      secret,
      "confirmation",
    ),
  );
}

/**
 * A refusal after the submit (inbox card, banner, or confirmation page) while
 * this browser still holds the attempt's handle or token. Recorded on the row,
 * so a later confirmation in any browser sends nothing.
 */
async function withdraw(leadId: string, dependencies: ServiceDependencies): Promise<boolean> {
  let record: LeadRecord | undefined;
  try {
    record = await dependencies.store.findByLeadId(leadId);
  } catch {
    // A failed lookup is not "no row". Claiming it was recorded hides the refusal.
    return false;
  }
  // Confirmed absence (decoy, rotated, gone) or already refused: nothing to undo.
  if (!record) return true;
  if (measurementWithdrawn(record)) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await dependencies.store.recordMeasurementWithdrawal(record.pageId);
    } catch {
      // The write may have landed before the error. The re-read decides.
    }
    const after = await readMeasurementState(dependencies.store, record.pageId);
    if (after === "withdrawn") return true;
  }
  return false;
}

/**
 * `recorded: false` means the refusal is not known to be on the row. That
 * includes a failed write, a rate limit, an expired or invalid handle, and a
 * lookup that threw. The client keeps a retry. It is not a success.
 */
export type WithdrawResponse = { ok: true; recorded: boolean };

export async function withdrawAttemptMeasurementService(
  handle: string,
  dependencies: ServiceDependencies,
): Promise<WithdrawResponse> {
  const floor = grantFloor(dependencies);
  const secret = requireSecret(dependencies.env ?? process.env);
  const now = (dependencies.now ?? (() => new Date()))();
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  if (!parsed) return floor({ ok: true as const, recorded: false });
  if (!(dependencies.withdrawGate ?? processWithdrawGate)(parsed.leadId)) {
    return floor({ ok: true as const, recorded: false });
  }
  return floor({ ok: true as const, recorded: await withdraw(parsed.leadId, dependencies) });
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
  if (!parsed) return floor({ ok: true as const, recorded: false });
  if (!(dependencies.withdrawGate ?? processWithdrawGate)(parsed.leadId)) {
    return floor({ ok: true as const, recorded: false });
  }
  return floor({ ok: true as const, recorded: await withdraw(parsed.leadId, dependencies) });
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
