import { prepareCompatibilityRequest, type CompatibilityRequest } from "../compatibility/context.ts";
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
  BrowserRegistration,
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
  WITHDRAW_HANDLE_TTL_MS,
  VERIFICATION_MAX_SENDS,
  WELCOME_DELAY_MS,
  BUDDY_GUIDE_DELAY_MS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_TTL_MS,
} from "./contracts.ts";
import {
  persistableExperimentContext,
  type ExperimentContext,
} from "../conversionExperimentContract.ts";
import type { PollGate } from "./pollGate.ts";
import type { VerificationMailer } from "./resend.ts";
import { observeSignupCountry, type SignupCountryProbe } from "../attribution.ts";
import { canonicalEmail } from "../api/abuse.ts";
import {
  deliverRetargetingLead,
  deliverRetargetingRegistration,
} from "../retargeting/capi.ts";
import { retargetingConsentFromRow, type RetargetingConsent } from "../retargeting/consent.ts";
import {
  planCompleteRegistration,
  planDurableLead,
  type MeasurementPlan,
} from "../retargeting/events.ts";
import { DEFAULT_LOCALE, isLocale, parseLocalePath, type Locale } from "../i18n/locale.ts";
import type { TokenEnvironment } from "./token.ts";
// Core-owned (feat/referral-core): `referralSecret(env)` → status-page signing
// key (derived from the verification secret; throws when that is unset, which
// the guard below treats like a missing origin); `statusUrl(origin, refCode,
// locale, secret)` and `rulesUrl(origin, locale)` build the guide's links.
import { referralSecret, rulesUrl, signStatusToken, statusUrl } from "../referral/statusToken.ts";
import { referralProgramEnabled } from "../referral/program.ts";
import { optOutAddressKey, rowOptedOut } from "../referral/notices.ts";
import {
  PRESS_SYNC_ACCEPTED,
  PRESS_SYNC_CONFIRMED,
  PRESS_SYNC_HELD,
  PRESS_SYNC_IGNORED,
  PRESS_SYNC_INVALID,
  PRESS_SYNC_PENDING,
  pressOutboxFor,
  type PressEnvironment,
  type PressStage,
} from "../press/pressAttribution.server.ts";
import {
  createVerificationToken,
  deterministicMetaEventId,
  isLeadId,
  isVerificationTokenShape,
  newLeadId,
  parseVerificationToken,
  requirePublicOrigin,
  requireSecret,
  signPollHandle,
  verifyPollHandle,
} from "./token.ts";
import {
  measurementFromCell,
  noteStageMeasurement,
  noteStageSignup,
  noteStageVerified,
} from "../stageScore/observe.ts";

/**
 * Meta cookies of the browser that produced a conversion. The click cookie is
 * what ties a confirmation — usually opened in a mail app, not the browser the
 * ad opened — to the ad. The request's network address and user agent never
 * enter this module: the server function adds them when it assembles the
 * dispatchers (`createServiceDependencies`).
 */
export type ConversionContext = {
  googleClientId?: string;
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
    /**
     * Re-reads the row. The dispatcher calls it between the website event and
     * the CRM event, so a refusal that commits during the first stops the second.
     */
    stillAllowed?: () => Promise<boolean>;
  } & ConversionContext,
) => Promise<void | boolean>;

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
  compatibility?: CompatibilityRequest;
  /** Existing pending row may only receive new context with its signed live attempt. */
  compatibilityCredential?: string;
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
  /**
   * Server-owned country sensor for a new row. Callers that omit it do not
   * write a country. A resend never applies it: `startAttempt` leaves the
   * original observation in place.
   */
  signupCountryProbe?: SignupCountryProbe;
  /** The browser's measurement choice at submit time. */
  measurementConsent: boolean;
  googleClientId?: string;
  /** Meta click cookie, stored only when `measurementConsent` is true. */
  metaFbc?: string;
  /** Meta browser cookie, forwarded (never stored) when `measurementConsent` is true. */
  metaFbp?: string;
  /**
   * The id the browser's own `Lead` carried on this submit. When present it is
   * the one id the server sends for the submit Lead of the consent change this
   * request makes, so the two legs dedupe.
   */
  submitEventId?: string;
  /** Language selected on the page. Defaults to English for legacy callers. */
  locale?: Locale;
  /** True when this network has produced too many recent signups to keep mailing. */
  networkSendBlocked: boolean;
  /** Stored only on a new consented, non-suspect row. */
  experiment?: ExperimentContext;
  /** New rows only. Defaults to email. A resend does not write this. */
  signupMethod?: "email" | "google" | "apple";
  googleSubject?: string;
  appleSubject?: string;
  authVerificationProvenance?: string;
  signupLocale?: string;
  /** Social creates fail closed when the provider subject column is missing. */
  requireProviderSubject?: boolean;
  /** Well-formed press link reference (`?press_ref=`), kept on a new row only. */
  pressRef?: string;
};

export type ServiceDependencies = {
  /** Server schema/readiness gate; false by default. */
  compatibilityEnabled?: boolean;
  store: LeadStore;
  mailer: VerificationMailer;
  /** ON-only best-effort public code for the verified row’s welcome guide. */
  resolveWelcomeShareCode?: (refCode: string) => Promise<string | null>;
  env?: TokenEnvironment;
  now?: () => Date;
  leadId?: () => string;
  refCode?: () => string;
  dispatchVerifiedLead?: VerifiedLeadDispatch;
  captureGoogleContext?: (email: string, clientId: unknown, allowed: boolean) => Promise<void>;
  forgetGoogleContext?: (email: string) => Promise<void>;
  /** Canonical verified GA4 sign_up. Repeats collapse inside that sender. */
  dispatchGoogleVerified?: (row: LeadRecord, allowed: () => Promise<boolean>) => Promise<void>;
  /** Historical submit Lead. The durable signup path does not call this. */
  dispatchSubmitLead?: SubmitLeadDispatch;
  /** Prospective Lead and CompleteRegistration. Absent calls the retargeting deliverers. */
  dispatchDurableMeasurement?: (input: {
    plan: MeasurementPlan;
    consent: RetargetingConsent;
    email: string;
    landingPath?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    ip?: string | null;
    ua?: string | null;
    nowSeconds?: number;
  }) => Promise<void>;
  /** Per-attempt limit on grant/withdraw calls. Defaults to one per process. */
  grantGate?: (leadId: string) => boolean;
  /** Refusals have their own replay budget. */
  withdrawGate?: (leadId: string) => boolean;
  /** Trusted Sec-GPC request header, never the JSON body. */
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
  /**
   * Reports a completed press-attributed signup to the press tracker
   * (pressAttribution.server.ts). Absent = no live report; the row still keeps
   * the reference and the replay sends what is owed. Must not throw.
   */
  reportPress?: (
    stage: PressStage,
    row: { pageId: string; pressOutbox?: string; occurredAt: string },
  ) => Promise<unknown>;
};

/** Longest a live press report may hold a response; the replay covers the rest. */
const PRESS_REPORT_WAIT_MS = 1500;

/**
 * The press reference a brand-new row keeps. Held, not reported: a submitted
 * form only arms a verification attempt and is not a signup.
 */
function pressOutboxField(
  input: RequestVerificationInput,
  signedUpAt: string,
  flagged: boolean,
  env: unknown,
): { pressOutbox?: string; pressSync?: string } {
  const pressOutbox = pressOutboxFor(
    { pressRef: input.pressRef, canonical: input.canonical, signedUpAt, flagged },
    env as PressEnvironment,
  );
  return pressOutbox ? { pressOutbox, pressSync: PRESS_SYNC_HELD } : {};
}

function pressOwed(stage: PressStage, state: string | undefined): boolean {
  if (stage === "accepted") return !state || state === PRESS_SYNC_HELD || state === PRESS_SYNC_PENDING;
  return state !== PRESS_SYNC_CONFIRMED && state !== PRESS_SYNC_IGNORED && state !== PRESS_SYNC_INVALID;
}

/**
 * Live report for a row that just became a completed signup. Never throws and
 * waits at most PRESS_REPORT_WAIT_MS; what does not finish is replayed.
 */
export async function reportPressNow(
  dependencies: ServiceDependencies,
  stage: PressStage,
  row: Pick<LeadRecord, "pageId" | "pressOutbox" | "pressSync">,
  now: Date,
): Promise<void> {
  if (!row.pressOutbox || !dependencies.reportPress || !pressOwed(stage, row.pressSync)) return;
  const report = dependencies
    .reportPress(stage, { pageId: row.pageId, pressOutbox: row.pressOutbox, occurredAt: now.toISOString() })
    .catch(() => undefined);
  await Promise.race([report, (dependencies.sleep ?? defaultSleep)(PRESS_REPORT_WAIT_MS)]);
}

function newSignupCountry(
  input: RequestVerificationInput,
  observedAt: Date,
): { signupCountry?: ReturnType<typeof observeSignupCountry> } {
  if (!input.signupCountryProbe) return {};
  return {
    signupCountry: observeSignupCountry({
      trustedVercel: input.signupCountryProbe.trustedVercel,
      header: input.signupCountryProbe.header,
      observedAt,
    }),
  };
}

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

/** Identity columns for a new row only. `startAttempt` never calls this. */
function newRowIdentity(input: RequestVerificationInput) {
  const signupMethod = input.signupMethod ?? "email";
  return {
    signupMethod,
    ...(input.authVerificationProvenance
      ? { authVerificationProvenance: input.authVerificationProvenance }
      : signupMethod === "email"
        ? { authVerificationProvenance: "email:double-opt-in" as const }
        : {}),
    ...(input.googleSubject ? { googleSubject: input.googleSubject } : {}),
    ...(input.appleSubject ? { appleSubject: input.appleSubject } : {}),
    signupLocale: isLocale(input.signupLocale)
      ? input.signupLocale
      : (input.locale ?? DEFAULT_LOCALE),
    ...(input.requireProviderSubject ? { requireProviderSubject: true as const } : {}),
  };
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

function stageScoreEnabled(): boolean {
  return process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION === "enabled";
}

function stageSource(input: { signupMethod?: string }): "email" | "oauth" {
  return input.signupMethod === "google" || input.signupMethod === "apple" ? "oauth" : "email";
}

async function recordStageSignup(
  input: RequestVerificationInput,
  at: string,
  measurementCell: string,
  suppressedRow: boolean,
): Promise<void> {
  if (!stageScoreEnabled()) return;
  await noteStageSignup({
    email: input.email,
    at,
    source: stageSource(input),
    measurementCell,
    suspect: input.suspect === true,
    suppressed: suppressedRow,
    // A bare signup payload cannot confer phone consent or a phone score.
    phonePresent: false,
  });
}

async function recordStageVerified(
  email: string,
  at: string,
  source: "email" | "oauth",
): Promise<void> {
  if (!stageScoreEnabled()) return;
  await noteStageVerified({ email, at, source });
}

async function recordStageMeasurementCell(
  email: string,
  at: string,
  cell: string | undefined,
): Promise<void> {
  if (!stageScoreEnabled()) return;
  await noteStageMeasurement({ email, at, measurement: measurementFromCell(cell) });
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
  const consentRequested = !dependencies.gpc && input.measurementConsent;

  // Every early return still hands back a well-formed handle naming an attempt
  // no row carries. The caller cannot tell a skipped send from a real one.
  const decoyHandle = () =>
    signPollHandle(mintLeadId(), now.getTime(), consentRequested, secret, input.email);

  const compatibility = input.compatibility ? prepareCompatibilityRequest(input.compatibility) : null;
  if (input.compatibility && (!compatibility || !dependencies.compatibilityEnabled || compatibility.locale !== (input.locale ?? DEFAULT_LOCALE))) {
    throw new Error("Compatibility request unavailable");
  }
  const existing = await store.findByEmail(input.canonical, input.email);
  const compatibilityProof = compatibility && existing && input.compatibilityCredential
    ? verifyPollHandle(input.compatibilityCredential, secret, now.getTime(), POLL_HANDLE_TTL_MS)
    : undefined;
  const ownCompatibilityAttempt = Boolean(compatibilityProof && compatibilityProof.leadId === existing?.leadId);


  // A honeypot, a disposable domain or a headless client is somebody using the
  // form to mail a third party. The row is still written for review, but no
  // message is produced.
  const abusive = conversionBlocked(input.flags);
  const suppressed = abusive || input.networkSendBlocked;

  // Measurement allowed on this submit for an address that already has a row
  // (in any of the paths below, decoys included): one grant, and at most one
  // submit Lead for it — under the browser's id when this request is the one
  // that moved the row from withheld. The response floor covers the time.
  if (existing && !suppressed && consentRequested) {
    await grantFromSubmit(existing, input, dependencies, secret);
  }

  // Owner-requested status disclosure. This is only a notice, never proof of
  // inbox ownership. Keep the decoy handle and return no checkout credential.
  if (
    existing &&
    !suppressed &&
    (existing.status === "verified" || existing.emailVerified) &&
    existing.status !== "unsubscribed"
  ) {
    return floor({
      ...pendingResponse(decoyHandle()),
      status: "already_verified" as const,
      message: "This email address is already verified.",
    });
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
    return floor(pendingResponse(ownCompatibilityAttempt ? input.compatibilityCredential! : decoyHandle()));
  }

  const leadId = mintLeadId();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString();
  const handle = signPollHandle(leadId, now.getTime(), consentRequested, secret, input.email);

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
        source: input.source,
        refCode: (dependencies.refCode ?? defaultRefCode)(),
        ...(input.referredBy ? { referredBy: input.referredBy } : {}),
        ...(input.attribution ? { attribution: input.attribution } : {}),
        ...newSignupCountry(input, now),
        flags: input.flags,
        suspect: input.suspect,
        signedUpAt: now.toISOString(),
        leadId,
        expiresAt,
        // Nothing was sent for it: a later consented, non-abusive submit can
        // still open its one submit Lead. Empty is only for pre-release rows.
        measurementState: MEASUREMENT_CONSENT_WITHHELD,
        ...newRowIdentity(input),
        ...pressOutboxField(input, now.toISOString(), true, env),
      });
      await recordStageSignup(input, now.toISOString(), MEASUREMENT_CONSENT_WITHHELD, true);
    }
    return floor(pendingResponse(decoyHandle()));
  }

  // Model context never overwrites another person's row by public email lookup.
  // A new request is durable with the new lead; a pending resend needs its current signed handle.
  if (compatibility && existing) {
    if (!ownCompatibilityAttempt || !store.recordCompatibility) {
      return floor(pendingResponse(decoyHandle()));
    }
    await store.recordCompatibility(existing.pageId, compatibility);
    const reread = await store.reread(existing.pageId);
    if (!reread || reread.leadId !== existing.leadId || reread.status !== "pending" || reread.emailVerified ||
        reread.compatibility?.modelId !== compatibility.modelId || reread.compatibility.locale !== compatibility.locale) {
      return floor(pendingResponse(decoyHandle()));
    }
  }

  let record: LeadRecord;
  if (existing) {
    // Count the attempt before it can fail, so a provider stuck at 500 cannot
    // be used to keep re-arming a send.
    await store.startAttempt(existing.pageId, { leadId, expiresAt, sends: existing.sends + 1 });
    record = existing;
  } else {
    record = await store.createPending({
      ...(compatibility ? { compatibility } : {}),
      email: input.email,
      canonical: input.canonical,
      source: input.source,
      refCode: (dependencies.refCode ?? defaultRefCode)(),
      ...(input.referredBy ? { referredBy: input.referredBy } : {}),
      ...(input.attribution ? { attribution: input.attribution } : {}),
      ...newSignupCountry(input, now),
      flags: input.flags,
      suspect: input.suspect,
      signedUpAt: now.toISOString(),
      leadId,
      expiresAt,
      ...(consentRequested && input.metaFbc ? { metaFbc: input.metaFbc } : {}),
      ...leadExperiment({ ...input, measurementConsent: consentRequested }),
      measurementState: consentRequested
        ? MEASUREMENT_CONSENT_GRANTED
        : MEASUREMENT_CONSENT_WITHHELD,
      ...newRowIdentity(input),
      ...pressOutboxField(input, now.toISOString(), input.suspect, env),
    });
    if (compatibility && (record.compatibility?.modelId !== compatibility.modelId || record.compatibility.locale !== compatibility.locale)) {
      throw new Error("Compatibility context was not persisted");
    }
    await recordStageSignup(
      input,
      now.toISOString(),
      consentRequested ? MEASUREMENT_CONSENT_GRANTED : MEASUREMENT_CONSENT_WITHHELD,
      false,
    );
    // Durable Lead for this new row only. The public response stays generic.
    // The historical browser-id Lead stopped in this same edit.
    if (consentRequested) {
      await emitDurableSignupLead(
        record.pageId,
        submitContext(input),
        dependencies,
        secret,
        Math.floor(now.getTime() / 1000),
      ).catch(() => undefined);
    }
  }

  const mailLocale = compatibility && isLocale(existing?.signupLocale) ? existing.signupLocale : (input.locale ?? DEFAULT_LOCALE);
  if (dependencies.captureGoogleContext) {
    try {
      const fresh = consentRequested ? await dependencies.store.reread(record.pageId) : undefined;
      await dependencies.captureGoogleContext(
        record.email,
        input.googleClientId,
        Boolean(fresh && measurementAllows(fresh, false)),
      );
    } catch {
      /* An unavailable consent read is not a refusal or a signup failure. */
    }
  }

  const token = createVerificationToken(
    leadId,
    now.getTime() + VERIFICATION_TTL_MS,
    consentRequested,
    secret,
    mailLocale,
  );

  try {
    await dependencies.mailer.send({
      to: input.email,
      token,
      leadId,
      publicOrigin,
      locale: mailLocale,
      ...(compatibility ? { compatibility } : {}),
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
 * Hands the welcome mail to the provider with a hold. Resend keeps the message
 * until then, so the delay needs no scheduler of ours and survives a redeploy.
 *
 * With Buddy Invite switched off (the default until the owner's final go-live)
 * this is exactly the legacy welcome: invite link only, WELCOME_DELAY_MS
 * (24 hours). Switched on, it is the program guide (rewards, status page,
 * rules) after BUDDY_GUIDE_DELAY_MS (30 minutes).
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

  const env = (dependencies.env ?? process.env) as TokenEnvironment &
    Record<string, string | undefined>;
  let publicOrigin: string;
  let guideLinks: { statusUrl: string; rulesUrl: string } | undefined;
  try {
    publicOrigin = requirePublicOrigin(env);
    if (referralProgramEnabled(env)) {
      // The guide is promotional: an address that opted out of mail (status or
      // an `unsubscribed` Launch/Reservation mail marker) on this row OR ANY
      // other row of the same inbox gets no guide at all — the same rule the
      // Buddy Invite notices apply (notices.ts `optedOutAddresses`).
      if (rowOptedOut(record)) return;
      if (await addressOptedOut(record, dependencies.store)) return;
      // The guide links the signed status page. Without the referral signing
      // secret there is no page to link, so the welcome waits, exactly like a
      // missing public origin: `Welcome email` stays empty and a later
      // confirmation of the same link tries again once the secret is set.
      const secret = referralSecret(env);
      if (!secret) return;
      guideLinks = {
        statusUrl: statusUrl(publicOrigin, record.refCode, locale, secret),
        rulesUrl: rulesUrl(publicOrigin, locale),
      };
    }
  } catch {
    return;
  }

  let shareCode: string | null = null;
  if (guideLinks && record.emailVerified && dependencies.resolveWelcomeShareCode) {
    try {
      shareCode = await dependencies.resolveWelcomeShareCode(record.refCode);
    } catch {
      // Code availability must never prevent confirmation or the welcome guide.
    }
  }
  const delay = guideLinks ? BUDDY_GUIDE_DELAY_MS : WELCOME_DELAY_MS;
  const scheduledAt = new Date(now.getTime() + delay).toISOString();
  try {
    await dependencies.mailer.sendWelcome({
      to: record.email,
      refCode: record.refCode,
      leadId: record.leadId,
      publicOrigin,
      scheduledAt,
      locale,
      ...(guideLinks ?? {}),
      ...(guideLinks && shareCode ? { shareCode } : {}),
      ...(guideLinks && record.signupCountry ? { signupCountry: record.signupCountry } : {}),
    });
    await dependencies.store.markWelcomeScheduled(record.pageId, { scheduledAt });
  } catch {
    // Best effort by design. The confirmation already succeeded.
  }
}

/**
 * Whether any row of this inbox carries an opt-out. Rows are matched by the
 * opt-out inbox key (Gmail dots/plus, googlemail), the key notices use, so
 * the guide and the notices always agree on who opted out. Fails closed: a
 * store that cannot list the rows means no guide (and `Welcome email` stays
 * empty, so a later confirmation tries again).
 */
async function addressOptedOut(record: LeadRecord, store: LeadStore): Promise<boolean> {
  if (!store.listByAddress) return true;
  const key = optOutAddressKey(record.email);
  const rows = await store.listByAddress(canonicalEmail(record.email), record.email);
  return rows.some(
    (row) => Boolean(row.email) && optOutAddressKey(row.email) === key && rowOptedOut(row),
  );
}

function welcomeLocale(record: LeadRecord): Locale {
  if (isLocale(record.signupLocale)) return record.signupLocale;
  if (record.landingPath) {
    try {
      return parseLocalePath(record.landingPath).locale;
    } catch {
      return DEFAULT_LOCALE;
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * First verification of a social row. An already-verified, duplicate, or
 * unsubscribed row is left untouched: `markVerified` always rewrites Verified at.
 */
export async function completeSocialVerification(
  record: LeadRecord,
  dependencies: ServiceDependencies,
  context: ConversionContext,
  now: Date,
): Promise<"verified" | "already"> {
  if (
    record.duplicate ||
    record.status === "unsubscribed" ||
    record.emailVerified ||
    record.status === "verified" ||
    record.verifiedAt
  ) {
    if (record.emailVerified || record.status === "verified" || record.verifiedAt) {
      await recordStageVerified(record.email, now.toISOString(), "oauth");
    }
    return "already";
  }
  if (!isLeadId(record.leadId)) return "already";
  const fresh = await dependencies.store.reread(record.pageId).catch(() => undefined);
  if (
    !fresh ||
    fresh.duplicate ||
    fresh.status === "unsubscribed" ||
    fresh.emailVerified ||
    fresh.status === "verified" ||
    fresh.verifiedAt ||
    !isLeadId(fresh.leadId)
  ) {
    if (fresh?.emailVerified || fresh?.status === "verified" || fresh?.verifiedAt) {
      await recordStageVerified(fresh.email, now.toISOString(), "oauth");
    }
    return "already";
  }
  const secret = requireSecret(dependencies.env ?? process.env);
  const metaEventId = deterministicMetaEventId(fresh.leadId, secret);
  const verifiedAt = now.toISOString();
  await dependencies.store.markVerified(fresh.pageId, { verifiedAt, metaEventId });
  await recordStageVerified(fresh.email, verifiedAt, "oauth");
  await sendConversions(
    { ...fresh, emailVerified: true, status: "verified", verifiedAt },
    metaEventId,
    false,
    context,
    dependencies,
    secret,
  );
  await scheduleWelcome(
    { ...fresh, emailVerified: true, status: "verified" },
    dependencies,
    now,
    welcomeLocale(fresh),
  );
  await reportPressNow(dependencies, "confirmed", fresh, now);
  return "verified";
}

/**
 * Sends one confirmation mail for the row's current Lead ID.
 * Does not call `startAttempt` and does not move Verified at.
 * Without `noteVerificationSend`, sends nothing.
 */
export async function sendSocialVerificationMail(
  record: LeadRecord,
  dependencies: ServiceDependencies,
  now: Date,
  locale: Locale,
): Promise<"sent" | "skipped"> {
  if (!dependencies.store.noteVerificationSend) return "skipped";
  if (!isLeadId(record.leadId)) return "skipped";
  if (
    record.duplicate ||
    record.status === "unsubscribed" ||
    record.emailVerified ||
    record.status === "verified" ||
    record.verifiedAt
  ) {
    return "skipped";
  }
  if (!attemptCooled(record, now.getTime()) || record.sends >= VERIFICATION_MAX_SENDS)
    return "skipped";
  const env = dependencies.env ?? process.env;
  let secret: string;
  let publicOrigin: string;
  try {
    secret = requireSecret(env);
    publicOrigin = requirePublicOrigin(env);
  } catch {
    return "skipped";
  }
  const token = createVerificationToken(
    record.leadId,
    now.getTime() + VERIFICATION_TTL_MS,
    false,
    secret,
    locale,
  );
  await dependencies.mailer.send({
    to: record.email,
    token,
    leadId: record.leadId,
    publicOrigin,
    locale,
  });
  await dependencies.store.noteVerificationSend(record.pageId, {
    sends: record.sends + 1,
    sentAt: now.toISOString(),
  });
  return "sent";
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
  // A refusal that could not be written is reported back, so the page keeps
  // Try again instead of showing it as saved.
  let refusalUnrecorded = false;
  if (options.localRefusal) {
    // The row this call just read, by page: a resend that replaced `Lead ID`
    // in between must not make the refusal miss.
    refusalUnrecorded = !(await withdrawRecord(record, dependencies));
    // Even an unavailable CRM cannot override this request's explicit refusal.
    dependencies = { ...dependencies, gpc: true };
  }
  const refusal = {
    ...(refusalUnrecorded ? { refusalRecorded: false as const } : {}),
    // A refusal credential for this signup that survives a resend: the sealed
    // address finds the row even after `Lead ID` changes. Withdrawals only.
    // Under a fresh attempt id no row carries, so it can never poll or grant;
    // a withdrawal finds the row through the sealed address alone.
    refusalHandle: signPollHandle(
      (dependencies.leadId ?? newLeadId)(),
      now.getTime(),
      false,
      secret,
      record.email,
    ),
  };

  const metaEventId = deterministicMetaEventId(parsed.leadId, secret);

  if (record.emailVerified || record.status === "verified") {
    await recordStageVerified(record.email, now.toISOString(), "email");
    // The second click of one link, and the loser of two concurrent clicks,
    // both land here. Re-dispatching is the right move rather than a wasteful
    // one: the first attempt may have been the one that failed, and the event
    // ids are derived, so a duplicate collapses into the same conversion.
    const sent = await sendConversions(
      record,
      metaEventId,
      parsed.measurementConsent,
      context,
      dependencies,
      secret,
    );
    await scheduleWelcome(record, dependencies, now, parsed.locale);
    return {
      ok: true,
      status: "already_verified",
      refCode: record.refCode,
      ...(referralProgramEnabled(env as Record<string, string | undefined>) && record.refCode
        ? { statusToken: signStatusToken(record.refCode, referralSecret(env)) }
        : {}),
      ...(record.phone && !record.suspect ? { phoneAdded: true as const } : {}),
      ...(sent ? browserLead(record, metaEventId) : {}),
      ...measurementAsk(record, parsed.measurementConsent, options.localRefusal),
      ...refusal,
    };
  }

  // Notion is the authority on the attempt window, not the signed expiry.
  const expiresAt = record.expiresAt ? Date.parse(record.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    // A stored refusal that could not be written is still reported, so the
    // page does not show it as saved; no refusal handle for a dead link.
    return {
      ok: true,
      status: "expired",
      ...(refusalUnrecorded ? { refusalRecorded: false as const } : {}),
    };
  }

  const verifiedAt = now.toISOString();
  await dependencies.store.markVerified(record.pageId, { verifiedAt, metaEventId });
  await recordStageVerified(record.email, verifiedAt, "email");

  // Notion has no compare-and-set, so two racing confirmations can both reach
  // this line. Both emit the identical ids, so Meta collapses them.
  const sent = await sendConversions(
    { ...record, emailVerified: true, status: "verified" },
    metaEventId,
    parsed.measurementConsent,
    context,
    dependencies,
    secret,
  );
  await scheduleWelcome({ ...record, emailVerified: true, status: "verified" }, dependencies, now, parsed.locale);
  // First confirmation: the signup is complete and its address verified.
  await reportPressNow(dependencies, "confirmed", record, now);
  const registration = await emitEmailRegistration(
    { ...record, emailVerified: true, status: "verified" },
    dependencies,
    secret,
    context,
    Math.floor(now.getTime() / 1000),
  );

  return {
    ok: true,
    status: "verified",
    refCode: record.refCode,
    ...(referralProgramEnabled(env as Record<string, string | undefined>) && record.refCode
      ? { statusToken: signStatusToken(record.refCode, referralSecret(env)) }
      : {}),
    ...(record.phone && !record.suspect ? { phoneAdded: true as const } : {}),
    ...(sent ? browserLead(record, metaEventId) : {}),
    ...(registration ? { registration } : {}),
    ...measurementAsk(record, parsed.measurementConsent, options.localRefusal),
    ...refusal,
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

    const registration = storedRegistrationBrowser(
      record,
      secret,
      Math.floor(now.getTime() / 1000),
      dependencies.gpc === true,
    );
    return {
      ok: true,
      status: "verified",
      refCode: record.refCode,
      ...(!dependencies.gpc &&
      record.metaEventId &&
      measurementAllows(record, parsed.measurementConsent)
        ? browserLead(record, record.metaEventId)
        : {}),
      // Read only. The send already happened on confirm or on the grant.
      ...(registration ? { registration } : {}),
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
  if (
    record.status === "unsubscribed" ||
    measurementWithdrawn(record) ||
    conversionBlocked(record.flags)
  )
    return false;
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
  if (dependencies.gpc) return undefined;
  const row = await dependencies.store.reread(pageId).catch(() => undefined);
  if (!row || !measurementAllows(row, signedConsent)) return undefined;
  return row;
}

/**
 * Closes a `granted-lead-pending` cell after a later Allow. It does not emit a
 * standard Lead: that event belongs only to the request that created the row.
 * A refusal racing the close still wins: it lives in `Flags`, which this never
 * touches. A failed close leaves the cell pending for the next Allow.
 */
async function flushPendingLead(
  pageId: string,
  _context: ConversionContext,
  dependencies: ServiceDependencies,
  _secret: string,
  _browserEventId?: string,
): Promise<void> {
  // Historical submit Lead stopped. A late Allow records consent and does not
  // emit another standard Lead: the row was not created by this request.
  const row = await rowAllowsSend(pageId, false, dependencies);
  if (!row || row.measurementConsent !== MEASUREMENT_CONSENT_LEAD_PENDING) return;
  const after = await dependencies.store.reread(pageId).catch(() => undefined);
  if (
    after &&
    !measurementWithdrawn(after) &&
    after.measurementConsent === MEASUREMENT_CONSENT_LEAD_PENDING
  ) {
    await dependencies.store
      .recordMeasurementState(pageId, MEASUREMENT_CONSENT_GRANTED)
      .catch(() => {
        // Stays pending: the next Allow tries the close again. No Lead is sent.
      });
    // A refusal whose write landed between that read and this write must not
    // be left overwritten.
    const settled = await dependencies.store.reread(pageId).catch(() => undefined);
    if (
      settled &&
      settled.flags.includes(FLAG_MEASUREMENT_WITHDRAWN) &&
      settled.measurementConsent !== MEASUREMENT_CONSENT_WITHDRAWN
    ) {
      await dependencies.store.recordMeasurementWithdrawal(pageId).catch(() => {});
      await recordStageMeasurementCell(
        settled.email,
        (dependencies.now ?? (() => new Date()))().toISOString(),
        MEASUREMENT_CONSENT_WITHDRAWN,
      );
    } else if (settled?.measurementConsent === MEASUREMENT_CONSENT_GRANTED) {
      await recordStageMeasurementCell(
        settled.email,
        (dependencies.now ?? (() => new Date()))().toISOString(),
        settled.measurementConsent,
      );
    }
  }
}

async function dispatchDurable(
  dependencies: ServiceDependencies,
  plan: MeasurementPlan,
  consent: RetargetingConsent,
  row: LeadRecord,
  context: ConversionContext,
  nowSeconds: number,
): Promise<void> {
  const input = {
    plan,
    consent,
    email: row.email,
    landingPath: row.landingPath ?? null,
    fbp: context.fbp ?? null,
    fbc: context.fbc || row.metaFbc || null,
    nowSeconds,
  };
  if (dependencies.dispatchDurableMeasurement) {
    await dependencies.dispatchDurableMeasurement(input);
    return;
  }
  if (plan.browser?.eventName === "CompleteRegistration") {
    await deliverRetargetingRegistration(input);
    return;
  }
  await deliverRetargetingLead(input);
}

/** Server Lead for the request that created the row. Nothing is returned to the browser. */
async function emitDurableSignupLead(
  pageId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
  nowSeconds: number,
): Promise<void> {
  const row = await rowAllowsSend(pageId, false, dependencies);
  if (!row) return;
  const consent = retargetingConsentFromRow({
    measurementConsent: row.measurementConsent,
    gpc: dependencies.gpc === true,
    unsubscribed: row.status === "unsubscribed",
  });
  const plan = planDurableLead({
    rowCreated: true,
    resend: false,
    duplicate: row.duplicate === true,
    abusive: conversionBlocked(row.flags),
    suspect: row.suspect,
    unsubscribed: row.status === "unsubscribed",
    pageId: row.pageId,
    secret,
    consent,
    source: row.source,
    signupLocale: row.signupLocale,
    occurredAtSeconds: nowSeconds,
    nowSeconds,
  });
  if (!plan.emit || !plan.browser) return;
  await dispatchDurable(dependencies, plan, consent, row, context, nowSeconds);
}

/** First email-link verification only. The browser payload has no address. */
async function emitEmailRegistration(
  record: LeadRecord,
  dependencies: ServiceDependencies,
  secret: string,
  context: ConversionContext,
  nowSeconds: number,
): Promise<BrowserRegistration | undefined> {
  const row = await rowAllowsSend(record.pageId, true, dependencies);
  if (!row) return undefined;
  const consent = retargetingConsentFromRow({
    measurementConsent: row.measurementConsent,
    gpc: dependencies.gpc === true,
    unsubscribed: row.status === "unsubscribed",
  });
  const plan = planCompleteRegistration({
    verified: true,
    source: "email_link",
    pageId: row.pageId,
    secret,
    consent,
    duplicate: row.duplicate === true,
    abusive: conversionBlocked(row.flags),
    suspect: row.suspect,
    unsubscribed: row.status === "unsubscribed",
    signupLocale: row.signupLocale,
    occurredAtSeconds: nowSeconds,
    nowSeconds,
  });
  const registration = registrationFromPlan(plan, nowSeconds);
  if (!registration) return undefined;
  await dispatchDurable(dependencies, plan, consent, row, context, nowSeconds);
  return registration;
}

/**
 * CRM `Verified at` only. This is the instant markVerified wrote, not Signed up,
 * the welcome, the grant clock, or a checkbox. Missing and unparseable are absent.
 */
function authoritativeVerifiedAtSeconds(record: LeadRecord): number | undefined {
  if (!record.verifiedAt) return undefined;
  const ms = Date.parse(record.verifiedAt);
  if (!Number.isFinite(ms)) return undefined;
  const seconds = Math.floor(ms / 1000);
  if (!Number.isInteger(seconds) || seconds < 0) return undefined;
  return seconds;
}

/**
 * Same registration id as the first email-link send. The event time is the
 * stored verification. deduped_retry refuses a missing time instead of using now.
 */
function planStoredRegistration(
  row: LeadRecord,
  secret: string,
  nowSeconds: number,
  gpc: boolean,
): { plan: MeasurementPlan; occurredAtSeconds: number | undefined } {
  const occurredAtSeconds = authoritativeVerifiedAtSeconds(row);
  const consent = retargetingConsentFromRow({
    measurementConsent: row.measurementConsent,
    gpc,
    unsubscribed: row.status === "unsubscribed",
  });
  const plan = planCompleteRegistration({
    verified: row.emailVerified || row.status === "verified",
    source: "deduped_retry",
    pageId: row.pageId,
    secret,
    consent,
    duplicate: row.duplicate === true,
    abusive: conversionBlocked(row.flags),
    suspect: row.suspect,
    unsubscribed: row.status === "unsubscribed",
    signupLocale: row.signupLocale,
    ...(occurredAtSeconds == null ? {} : { occurredAtSeconds }),
    nowSeconds,
  });
  return { plan, occurredAtSeconds };
}

function registrationFromPlan(
  plan: MeasurementPlan,
  occurredAtSeconds: number,
): BrowserRegistration | undefined {
  const registration = plan.browser;
  if (!plan.emit || registration?.eventName !== "CompleteRegistration") return undefined;
  if (plan.eventTime !== occurredAtSeconds || registration.eventTime !== occurredAtSeconds) {
    return undefined;
  }
  return {
    eventName: "CompleteRegistration",
    eventId: registration.eventId,
    eventTime: registration.eventTime,
    contentName: registration.contentName,
    value: registration.value,
    currency: registration.currency,
    signupLocale: registration.signupLocale,
    source: registration.source,
  };
}

/** Browser half for a poll. Does not send. */
function storedRegistrationBrowser(
  record: LeadRecord,
  secret: string,
  nowSeconds: number,
  gpc: boolean,
): BrowserRegistration | undefined {
  const { plan, occurredAtSeconds } = planStoredRegistration(record, secret, nowSeconds, gpc);
  if (occurredAtSeconds == null) return undefined;
  return registrationFromPlan(plan, occurredAtSeconds);
}

/** Server send for a late Allow. Uses the stored verification time. */
async function emitStoredRegistration(
  pageId: string,
  context: ConversionContext,
  dependencies: ServiceDependencies,
  secret: string,
  nowSeconds: number,
): Promise<BrowserRegistration | undefined> {
  const row = await rowAllowsSend(pageId, false, dependencies);
  if (!row) return undefined;
  const { plan, occurredAtSeconds } = planStoredRegistration(
    row,
    secret,
    nowSeconds,
    dependencies.gpc === true,
  );
  if (occurredAtSeconds == null) return undefined;
  const registration = registrationFromPlan(plan, occurredAtSeconds);
  if (!registration) return undefined;
  const consent = retargetingConsentFromRow({
    measurementConsent: row.measurementConsent,
    gpc: dependencies.gpc === true,
    unsubscribed: row.status === "unsubscribed",
  });
  await dispatchDurable(dependencies, plan, consent, row, context, nowSeconds);
  return registration;
}

function submitContext(input: RequestVerificationInput): ConversionContext {
  return {
    ...(input.metaFbp ? { fbp: input.metaFbp } : {}),
    ...(input.metaFbc ? { fbc: input.metaFbc } : {}),
  };
}

/**
 * A consented submit for an address that already has a row: the same grant as
 * the inbox card (re-read, refusal wins), then the pending cell is closed.
 * No standard Lead is emitted. The row was not created by this request.
 * Legacy and unsubscribed rows are left alone.
 */
async function grantFromSubmit(
  existing: LeadRecord,
  input: RequestVerificationInput,
  dependencies: ServiceDependencies,
  secret: string,
): Promise<void> {
  if (conversionBlocked(existing.flags)) return;
  if (existing.status !== "pending" && existing.status !== "verified") return;
  try {
    const outcome = await applyGrant(existing, dependencies);
    if (outcome !== "granted" && outcome !== "opened") return;
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
  const acknowledged = await dependencies
    .dispatchVerifiedLead({
      eventId,
      email: row.email,
      ...(row.phone ? { phone: row.phone } : {}),
      source: row.source,
      ...(row.landingPath ? { landingPath: row.landingPath } : {}),
      ...conversionContext(row, context),
      stillAllowed,
    })
    .catch(() => false);
  // Legacy injected dispatchers return void; production returns Meta's receipt.
  if (acknowledged === false) return false;
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
  if (context.googleClientId && dependencies.captureGoogleContext) {
    try {
      const fresh = dependencies.gpc ? undefined : await dependencies.store.reread(record.pageId);
      await dependencies.captureGoogleContext(
        record.email,
        context.googleClientId,
        Boolean(fresh && measurementAllows(fresh, signedConsent)),
      );
    } catch {
      /* Preserve context on transient CRM failure; send fails closed below. */
    }
  }
  // Independent of Meta configuration and of the browser polling lifecycle.
  // The sink rechecks persisted refusal immediately before dispatch.
  if (
    dependencies.dispatchGoogleVerified &&
    (record.emailVerified || record.status === "verified")
  ) {
    const allowed = async () => {
      if (dependencies.gpc) return false;
      // A failed read propagates as retry, rather than deleting allowed context.
      const fresh = await dependencies.store.reread(record.pageId);
      return Boolean(
        fresh &&
        !fresh.duplicate &&
        measurementAllows(fresh, signedConsent) &&
        (fresh.emailVerified || fresh.status === "verified"),
      );
    };
    await dependencies.dispatchGoogleVerified(record, allowed).catch(() => {});
  }
  await flushPendingLead(record.pageId, context, dependencies, secret);
  return sendConfirmation(record.pageId, confirmationEventId, signedConsent, context, dependencies);
}

/** Stores the click cookie, then makes sure no refusal landed meanwhile. */
async function storeClickCookie(
  pageId: string,
  fbc: string | undefined,
  dependencies: ServiceDependencies,
): Promise<void> {
  if (!fbc || !(await rowAllowsSend(pageId, false, dependencies))) return;
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
const processWithdrawGate = createGrantGate();

// The refusal budget is spent only by refusals that were recorded: replays of
// a refusal this process has already seen land `limit` times are answered
// from memory (a grant can never undo a recorded refusal, so that answer stays
// true). A failed write never spends it, so Try again always reaches Notion.
const saturatedRefusals = new WeakMap<(leadId: string) => boolean, Set<string>>();
async function withdrawWithinBudget(
  leadId: string,
  dependencies: ServiceDependencies,
  refusalCanonical?: string,
  missIsRecorded = true,
): Promise<boolean> {
  const gate = dependencies.withdrawGate ?? processWithdrawGate;
  let saturated = saturatedRefusals.get(gate);
  if (!saturated) {
    saturated = new Set();
    saturatedRefusals.set(gate, saturated);
  }
  if (saturated.has(leadId)) return true;
  const recorded = await withdraw(leadId, dependencies, refusalCanonical, missIsRecorded);
  if (recorded && !gate(leadId)) {
    if (saturated.size > 10_000) saturated.clear();
    saturated.add(leadId);
  }
  return recorded;
}

/**
 * Records a grant so that a refusal always wins. Notion has no
 * compare-and-set, so: re-read, refuse if withdrawn; write only the consent
 * cell; re-read again, and if a refusal landed meanwhile (the flag a grant
 * never writes), put the cell back and refuse. A failed write is a refusal.
 *
 * Only a cell that says `withheld` moves to `granted-lead-pending` ("opened":
 * this call made that change). An empty cell is a row from before the cell
 * existed: whatever its submit did is already done, and no signed bit can
 * prove otherwise (reminder links are minted without one), so it moves
 * straight to `granted` and no submit Lead follows. Losing that one
 * pre-release Lead beats counting it twice.
 */
async function applyGrant(
  record: LeadRecord,
  dependencies: ServiceDependencies,
): Promise<"granted" | "opened" | "refused" | "uncertain"> {
  if (dependencies.gpc) return "refused";
  const { store } = dependencies;
  const fresh = await store.reread(record.pageId).catch(() => undefined);
  if (!fresh) return "uncertain";
  if (
    fresh.status === "unsubscribed" ||
    measurementWithdrawn(fresh) ||
    conversionBlocked(fresh.flags)
  )
    return "refused";
  const cell = fresh.measurementConsent ?? "";
  if (cell === MEASUREMENT_CONSENT_GRANTED || cell === MEASUREMENT_CONSENT_LEAD_PENDING) {
    await recordStageMeasurementCell(
      fresh.email,
      (dependencies.now ?? (() => new Date()))().toISOString(),
      cell,
    );
    return "granted";
  }
  const target =
    cell === MEASUREMENT_CONSENT_WITHHELD
      ? MEASUREMENT_CONSENT_LEAD_PENDING
      : MEASUREMENT_CONSENT_GRANTED;
  try {
    await store.recordMeasurementState(record.pageId, target);
  } catch {
    // The write may have landed. Never infer permission from its exception.
  }
  const after = await store.reread(record.pageId).catch(() => undefined);
  if (!after) return "uncertain";
  if (measurementWithdrawn(after)) {
    await store.recordMeasurementWithdrawal(record.pageId).catch(() => {});
    return "refused";
  }
  if (after.status === "unsubscribed" || conversionBlocked(after.flags)) return "refused";
  if (!measurementAllows(after, false)) return "uncertain";
  await recordStageMeasurementCell(
    after.email,
    (dependencies.now ?? (() => new Date()))().toISOString(),
    after.measurementConsent,
  );
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
 * real attempt or decoy: nothing in it says what the row is. A form submit
 * does not emit a Lead or a CompleteRegistration. A row that is already
 * verified can emit CompleteRegistration from its stored time. This answer
 * still carries no browser event; the poll does.
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
  if (dependencies.gpc) return floor({ ok: true });
  const parsed = verifyPollHandle(handle, secret, now.getTime(), POLL_HANDLE_TTL_MS);
  if (!parsed || !(dependencies.grantGate ?? processGrantGate)(parsed.leadId)) {
    return floor({ ok: true });
  }

  const record = await dependencies.store.findByLeadId(parsed.leadId).catch(() => undefined);
  if (!record || record.status === "unsubscribed") return floor({ ok: true });

  const outcome = await applyGrant(record, dependencies);
  if (outcome === "granted" || outcome === "opened") {
    const context = {
      ...(input.googleClientId ? { googleClientId: input.googleClientId } : {}),
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
    // Unverified rows produce no registration. The answer stays `{ ok: true }`.
    await emitStoredRegistration(
      record.pageId,
      context,
      dependencies,
      secret,
      Math.floor(now.getTime() / 1000),
    );
  }
  return floor({ ok: true });
}

/**
 * Measurement allowed on the confirmation page. The confirmation token names
 * the attempt; the lead must already be confirmed. Sends what was withheld.
 * The legacy browser half comes back only if that send landed. CompleteRegistration
 * uses the stored verification time and the same event id as the first path.
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

  const outcome = await applyGrant(record, dependencies);
  if (outcome === "uncertain") return floor({ ok: true, status: "retry" });
  if (outcome === "refused") return floor({ ok: true });
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
  const final = await dependencies.store.reread(record.pageId).catch(() => undefined);
  if (!final) return floor({ ok: true, status: "retry" });
  if (!measurementAllows(final, parsed.measurementConsent)) return floor({ ok: true });
  // A failed legacy EmailVerified receipt must not suppress the independent
  // standard registration payload (including the Google verified-signup label).
  const registration = await emitStoredRegistration(
    final.pageId,
    input,
    dependencies,
    secret,
    Math.floor(now.getTime() / 1000),
  );
  return floor({
    ok: true,
    ...(sent ? browserLead(final, eventId) : { status: "retry" as const }),
    ...(registration ? { registration } : {}),
  });
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
  /**
   * Whether "no row for this id" counts as recorded. True for poll handles (a
   * decoy names no row, and its sealed address was already tried). False for
   * a confirmation token: it named a real row, and a resend that replaced
   * `Lead ID` must not turn a refusal into a silent no-op.
   */
  missIsRecorded = true,
): Promise<boolean> {
  let record: LeadRecord | undefined;
  try {
    record = await dependencies.store.findByLeadId(leadId);
    // A decoy handle (cooldown, send ceiling, already confirmed) names no row,
    // but the person's mail still confirms one: find it by the sealed address.
    // Every handle a submit returns carries it, so this lookup says nothing
    // about which kind of handle it was, and the answer stays the same.
    if (!record && refusalCanonical) {
      // The seal holds the address as stored (the row's title); the canonical
      // form is derived from it, so either column finds the row.
      record = await dependencies.store.findByEmail(
        canonicalEmail(refusalCanonical),
        refusalCanonical,
      );
    }
  } catch {
    return false;
  }
  if (!record) return missIsRecorded;
  return withdrawRecord(record, dependencies);
}

/** Writes the refusal onto a row already in hand, and confirms it by re-reading. */
async function withdrawRecord(
  record: LeadRecord,
  dependencies: ServiceDependencies,
): Promise<boolean> {
  let contextErased = true;
  try {
    await dependencies.forgetGoogleContext?.(record.email);
  } catch {
    contextErased = false;
  }
  // Persist refusal even if external context cleanup failed. The UI gets a
  // retry response until both are acknowledged; dispatch checks the row now.
  if (measurementWithdrawn(record)) {
    await recordStageMeasurementCell(
      record.email,
      (dependencies.now ?? (() => new Date()))().toISOString(),
      MEASUREMENT_CONSENT_WITHDRAWN,
    );
    return contextErased;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await dependencies.store.recordMeasurementWithdrawal(record.pageId);
    } catch {
      // The re-read decides; the write may have landed before the error.
    }
    const after = await dependencies.store.reread(record.pageId).catch(() => undefined);
    if (after && measurementWithdrawn(after)) {
      await recordStageMeasurementCell(
        after.email,
        (dependencies.now ?? (() => new Date()))().toISOString(),
        MEASUREMENT_CONSENT_WITHDRAWN,
      );
      return contextErased;
    }
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
  // Longer than a poll or a grant may use it: a refusal has to land for as
  // long as any confirmation link for the signup can still be opened.
  const parsed = verifyPollHandle(handle, secret, now.getTime(), WITHDRAW_HANDLE_TTL_MS);
  const recorded = parsed
    ? await withdrawWithinBudget(parsed.leadId, dependencies, parsed.refusalCanonical)
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
  const recorded = parsed
    ? await withdrawWithinBudget(parsed.leadId, dependencies, undefined, false)
    : false;
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
