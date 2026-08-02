// Shared types, policy constants, and the exact live Notion field names for the
// transactional double opt-in flow.
//
// The Notion columns below are already provisioned on the live waitlist
// database. They are the whole persisted state of a verification: an opaque
// per-attempt `Lead ID`, when the mail went out, when the link dies, and
// whether the person confirmed. The raw token and the confirmation URL are
// never among them.
//
// Nothing here describes a client address. The legacy `IP` and `User agent`
// columns are neither read nor written by this flow — not even as a digest.
// Mail-bomb protection lives in `networkGate.ts`, entirely in process memory.
//
// Kept free of path-alias imports so `npm test` can load it directly.

/** Confirmation links last 24 hours. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Shortest gap between two confirmation mails to one address. */
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

/** Hard ceiling on confirmation mails per lead, counted in `Verification sends`. */
export const VERIFICATION_MAX_SENDS = 5;

/**
 * How long after a confirmation the welcome mail carrying the invite link goes
 * out. Resend holds the message itself, so this needs no scheduler of ours and
 * the delay survives a redeploy.
 */
export const WELCOME_DELAY_MS = 24 * 60 * 60 * 1000;

/** A poll handle outlives the link it belongs to by nothing. */
export const POLL_HANDLE_TTL_MS = VERIFICATION_TTL_MS;

/**
 * Every submit takes at least this long. Without a floor the response time
 * itself is the oracle the generic message exists to close: a new address waits
 * on Notion and Resend, while an already-confirmed one returns immediately.
 */
export const MIN_RESPONSE_MS = 400;

// --- poll gate -------------------------------------------------------------
//
// A poll handle is a bearer string that survives in a tab, so a replayed burst
// is normal traffic, not necessarily an attack. Either way it must not become a
// Notion query per request.

/**
 * A poll answer is reused for this long before the store is asked again. Sized
 * against the client's opening interval so a replayed burst — or several tabs
 * sharing one handle — cannot outpace it.
 */
export const POLL_CACHE_TTL_MS = 8000;

/** Hard ceiling on store reads one handle may ever cause. */
export const POLL_MAX_STORE_READS_PER_HANDLE = 20;

/** Bounded so a flood of distinct handles cannot grow the process heap. */
export const POLL_GATE_MAX_ENTRIES = 5000;

/**
 * One response for a new address, an address already pending, an address
 * already verified, and a provider failure. Anything that varies turns the
 * form into an address-existence oracle.
 *
 * It also does not promise a delivery. A repeat submit inside the cooldown, an
 * already-verified address, and a rejected send all reach this message without
 * any mail going out.
 */
export const GENERIC_PENDING_MESSAGE =
  "If this address can receive email, a confirmation link is on its way. Open it to confirm.";

// --- exact live Notion property names -------------------------------------

export const FIELD_VERIFICATION_STATUS = "Verification status";
export const FIELD_VERIFICATION_SENT = "Verification sent";
export const FIELD_VERIFICATION_EXPIRES = "Verification expires";
export const FIELD_EMAIL_VERIFIED = "Email verified";
export const FIELD_VERIFIED_AT = "Verified at";
export const FIELD_VERIFICATION_SENDS = "Verification sends";
export const FIELD_LEAD_ID = "Lead ID";
export const FIELD_META_EVENT_ID = "Meta Event ID";
export const FIELD_WELCOME_EMAIL = "Welcome email";
/** PII-free, HMAC-sealed first-touch context used to replay LaunchOS events. */
export const FIELD_LAUNCHOS_REPLAY_METADATA = "LaunchOS replay metadata";
/** Exact, non-PII state of the optional advertising-measurement authority. */
export const FIELD_MEASUREMENT_CONSENT = "Measurement consent";
/** Leaves a small safety margin below Notion's 2,000-character rich-text limit. */
export const LAUNCHOS_REPLAY_METADATA_MAX_LENGTH = 1_980;

export const MEASUREMENT_CONSENT_GRANTED = "WD-AD-MEASUREMENT-CONSENT-V1:granted" as const;
export const MEASUREMENT_CONSENT_WITHDRAWN = "WD-AD-MEASUREMENT-CONSENT-V1:withdrawn" as const;

// Measurement-only reconciliation context already provisioned on the live
// waitlist database. Withdrawal clears these without touching operational CRM
// state such as the address, verification, Counted, Suspect, or Duplicate.
export const FIELD_ENVIRONMENT = "Environment";
export const FIELD_ACQUISITION_PATH = "Acquisition path";
export const FIELD_QUALIFICATION_RULE_VERSION = "Qualification rule version";
export const FIELD_SOURCE_SCHEMA_VERSION = "Source schema version";
export const FIELD_META_CAMPAIGN_ID = "Meta Campaign ID";
export const FIELD_META_ADSET_ID = "Meta Ad Set ID";
export const FIELD_META_AD_ID = "Meta Ad ID";

// Attribution columns, already provisioned on the live database as text.
export const FIELD_UTM_SOURCE = "UTM Source";
export const FIELD_UTM_MEDIUM = "UTM Medium";
export const FIELD_UTM_CAMPAIGN = "UTM Campaign";
export const FIELD_UTM_CONTENT = "UTM Content";
export const FIELD_UTM_TERM = "UTM Term";
export const FIELD_LANDING_PATH = "Landing path";

export const STATUS_PENDING = "pending";
export const STATUS_VERIFIED = "verified";
export const STATUS_UNSUBSCRIBED = "unsubscribed";
/** Existing live option used only for non-operational synthetic tombstones. */
export const STATUS_SUPPRESSED = "suppressed";

/**
 * `legacy` is a row written before this flow existed: no status at all. Those
 * people joined under single opt-in and keep counting, but they are never
 * treated as a confirmation this flow produced.
 */
export type VerificationStatus = "pending" | "verified" | "unsubscribed" | "legacy";

export type LeadRecord = {
  pageId: string;
  email: string;
  status: VerificationStatus;
  emailVerified: boolean;
  refCode: string;
  source: string;
  suspect: boolean;
  flags: string[];
  phone: string;
  leadId: string;
  metaEventId: string;
  sends: number;
  sentAt?: string;
  expiresAt?: string;
  verifiedAt?: string;
  /** HMAC-sealed PII-free context. It is never returned to the browser. */
  launchOsReplayMetadata?: string;
  /** Set once the welcome mail has been accepted by the provider. */
  welcomeAt?: string;
};

/**
 * The campaign that produced a lead, as the CRM stores it.
 *
 * Written once, when the row is created. A resend of the same address goes
 * through `startAttempt`, which never touches these columns, so the campaign
 * frozen by the first accepted submit is the one that survives.
 *
 * `fbclid` is deliberately not here. It names a click rather than a campaign,
 * and its only use is strengthening the Meta match — so it stops at the server
 * and never becomes a column.
 */
export type LeadAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPath?: string;
};

/** PII-free browser context accepted by the LaunchOS website adapter. */
export type LaunchOsMeasurementContext = {
  funnelInstanceId: string;
  attribution: {
    campaignId?: string;
    adsetId?: string;
    targetId?: string;
    adId?: string;
    contentId?: string;
  };
  measurementConsent: {
    purpose: "advertising_measurement";
    state: "granted";
    version: "WD-AD-MEASUREMENT-CONSENT-V1";
  };
  placement?: "hero" | "offer";
};

/**
 * Server-bound consent evidence. The browser can never provide this field: the
 * request handler derives it from the verified HttpOnly authority cookie and
 * overwrites the browser payload before anything is sealed or dispatched.
 */
export type LaunchOsAuthorizedMeasurementContext = LaunchOsMeasurementContext & {
  authorityReferenceHash: string;
  attributionAuthority: "approved_meta_identity_snapshot_v1";
};

/**
 * Inputs available only after the CRM has accepted the lead. The server turns
 * these into one HMAC-sealed, PII-free replay contract; the canonical address
 * is used to derive the opaque lead id and is never written into the envelope.
 */
export type LaunchOsReplaySeed = {
  canonicalEmail: string;
  suspect: boolean;
  signedUpAt: string;
  context: LaunchOsAuthorizedMeasurementContext;
};

export type CreatePendingInput = {
  email: string;
  canonical: string;
  phone?: string;
  source: string;
  refCode: string;
  referredBy?: string;
  flags: string[];
  suspect: boolean;
  signedUpAt: string;
  leadId: string;
  expiresAt: string;
  attribution?: LeadAttribution;
  launchOsReplayMetadata?: string;
};

/** Written when a new attempt is minted — this is what kills the previous link. */
export type StartAttemptInput = {
  leadId: string;
  expiresAt: string;
  sends: number;
};

export type MarkSentInput = {
  sentAt: string;
};

/** When the welcome mail was handed to the provider, not when it will arrive. */
export type MarkWelcomeInput = {
  scheduledAt: string;
};

export type MarkVerifiedInput = {
  verifiedAt: string;
  metaEventId: string;
};

export interface LeadStore {
  findByEmail(canonical: string, email: string): Promise<LeadRecord | undefined>;
  findByLeadId(leadId: string): Promise<LeadRecord | undefined>;
  createPending(input: CreatePendingInput): Promise<LeadRecord>;
  startAttempt(pageId: string, input: StartAttemptInput): Promise<void>;
  markSent(pageId: string, input: MarkSentInput): Promise<void>;
  markVerified(pageId: string, input: MarkVerifiedInput): Promise<void>;
  markWelcomeScheduled(pageId: string, input: MarkWelcomeInput): Promise<void>;
  reread(pageId: string): Promise<LeadRecord | undefined>;
}

export type PendingResponse = {
  ok: true;
  status: "pending";
  message: string;
  /** Opaque signed handle: attempt id and issue time, never an address. */
  handle: string;
};

/**
 * The list is full. A cap the page draws but never enforces is invented
 * scarcity, so this is a real outcome the form has to be able to receive.
 */
export type ClosedResponse = {
  ok: true;
  status: "closed";
  message: string;
};

export const WAITLIST_CLOSED_MESSAGE =
  "The pre-launch list is full. Watch Dive opens to everyone on Kickstarter on 10 August.";

export type ConfirmStatus = "verified" | "expired" | "already_verified" | "invalid";

/**
 * What the browser needs to fire its half of the Meta conversion. One shape,
 * defined once: confirm and poll hand back the same thing, and three copies of
 * the literal was three places for them to drift apart.
 */
export type BrowserLead = { eventId: string; source: string; hasPhone: boolean };

export type ConfirmResponse = {
  ok: true;
  status: ConfirmStatus;
  refCode?: string;
  /** Present only when the attempt's signed consent bit permits measurement. */
  browserLead?: BrowserLead;
};

export type PollResponse = {
  ok: true;
  status: "pending" | "verified" | "expired";
  refCode?: string;
  browserLead?: BrowserLead;
};

/**
 * A honeypot / disposable / headless signal disqualifies the conversion. A
 * shared IP stays a review flag only — it is not grounds to drop a real
 * confirmed lead, which is how the public counters already treat it.
 */
export function conversionBlocked(flags: string[]): boolean {
  return flags.some((flag) => flag !== "ip-repeat");
}
