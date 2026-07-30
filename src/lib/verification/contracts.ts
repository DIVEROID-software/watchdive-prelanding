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

export const STATUS_PENDING = "pending";
export const STATUS_VERIFIED = "verified";
export const STATUS_UNSUBSCRIBED = "unsubscribed";

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
  /** Set once the welcome mail has been accepted by the provider. */
  welcomeAt?: string;
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
