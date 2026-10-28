// Preview and dry-run for the 18 launch SMS drafts. Nothing here sends, opens
// a socket, or accepts a destination URL. A phone number is not ownership,
// purchase intent, or consent. Paid copy is the paid-reserver variant only.
import { SUPPORTED_LOCALES, type Locale } from "../i18n/locale.ts";
import { PHONE_CONSENT_VERSION } from "../phoneOptInCopy.ts";
import {
  LAUNCH_SMS_LAUNCH_URL_TOKEN,
  LAUNCH_SMS_RESERVATION_URL_TOKEN,
  renderLaunchSms,
  type LaunchSmsDraft,
  type LaunchSmsVariant,
} from "./copy.ts";
import { inspectSmsTransport, type SmsTransportInspection } from "./provider.ts";

export const LAUNCH_SMS_SEND_ENV = "WATCHDIVE_LAUNCH_SMS_SEND";

export type LaunchSmsPayment = "live" | "test" | "unpaid" | "unreadable" | "absent";

export type LaunchSmsBlock =
  | "consent_refused"
  | "consent_withdrawn"
  | "consent_malformed"
  | "consent_missing"
  | "unsubscribed"
  | "suspect"
  | "duplicate"
  | "qa"
  | "internal"
  | "no_phone"
  | "payment_unreadable"
  | "launch_link_unknown"
  | "reservation_link_unknown"
  | "provider_unconfigured"
  | "provider_not_implemented"
  | "send_disabled";

export type LaunchSmsRecipient = {
  savedSignupLocale?: string | null;
  signupCountry?: string | null;
  segment?: string | null;
  phonePresent: boolean;
  /**
   * Notion `SMS consent` cell. A grant is the JSON object written by
   * savePhoneOptInService: version, at, locale, surface. A withdrawn marker
   * that still contains the version is not a grant.
   */
  smsConsent?: string | null;
  /** Only `true` is an SMS refusal. A missing value is not a withdrawal. */
  consentRefused?: boolean;
  /**
   * Sec-GPC. Advertising measurement only. It does not opt the person out of SMS.
   * GA4 and Meta gates stay in their own modules. This planner does not read it.
   */
  gpc?: boolean;
  /**
   * Advertising-measurement choice. Unknown, denial, and withdrawal stay on that
   * channel. This planner does not read it, and phone or SMS consent is not an analytics payload.
   */
  measurement?: "granted" | "denied" | "withdrawn" | "unknown" | null;
  unsubscribed?: boolean;
  suspect?: boolean;
  duplicate?: boolean;
  qa?: boolean;
  internal?: boolean;
  /**
   * Email verification. The attempt phone opt-in saves without it, so this
   * planner does not read it.
   */
  emailVerified?: boolean;
  payment: LaunchSmsPayment;
};

export type LaunchSmsPlan = {
  decision: "refuse" | "dry_run";
  /** This package has no sender. The flag stays false after a send request too. */
  sendable: false;
  variant: LaunchSmsVariant | null;
  draft: LaunchSmsDraft | null;
  blocks: LaunchSmsBlock[];
  network: false;
  provider: SmsTransportInspection;
};

export type LaunchSmsCatalogEntry = {
  locale: (typeof SUPPORTED_LOCALES)[number];
  variant: LaunchSmsVariant;
  characters: number;
  koreanMarketingPrefix: boolean;
  body: string;
  sendable: false;
  tokensUnresolved: true;
};

const SMS_WITHDRAWN_MARKER = `${PHONE_CONSENT_VERSION}:withdrawn`;
const SMS_GRANT_KEYS = ["version", "at", "locale", "surface"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWriterInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(new Date(value).getTime()) &&
    new Date(value).toISOString() === value
  );
}

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** A withdrawal signal on the cell. The version string alone is not one. */
function cellWithdrawn(record: Record<string, unknown>): boolean {
  if (record.withdrawn === true || record.surface === "withdrawn") return true;
  if (typeof record.version === "string" && record.version.includes(SMS_WITHDRAWN_MARKER)) {
    return true;
  }
  for (const key of ["status", "state", "decision"] as const) {
    const value = record[key];
    if (value === "withdrawn" || value === "refused" || value === "denied") return true;
  }
  return false;
}

/**
 * The phone service stores JSON.stringify({ version, at, locale, surface }).
 * `includes(version)` would accept a withdrawn marker that still contains the version.
 */
export function classifyLaunchSmsConsent(
  value: string | null | undefined,
): "granted" | "missing" | "withdrawn" | "malformed" {
  if (typeof value !== "string" || value.trim() === "") return "missing";
  const trimmed = value.trim();
  if (trimmed.includes(SMS_WITHDRAWN_MARKER)) return "withdrawn";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "malformed";
  }
  if (!isRecord(parsed)) return "malformed";
  if (cellWithdrawn(parsed)) return "withdrawn";
  const keys = Object.keys(parsed);
  const exactKeys =
    keys.length === SMS_GRANT_KEYS.length &&
    SMS_GRANT_KEYS.every((key) => Object.hasOwn(parsed, key));
  if (!exactKeys) return "malformed";
  if (parsed.version !== PHONE_CONSENT_VERSION) return "malformed";
  if (typeof parsed.at !== "string" || !isWriterInstant(parsed.at)) return "malformed";
  if (typeof parsed.locale !== "string" || !isLocale(parsed.locale)) return "malformed";
  if (parsed.surface !== "attempt" && parsed.surface !== "confirmation") return "malformed";
  return "granted";
}

function hardStops(recipient: LaunchSmsRecipient): LaunchSmsBlock[] {
  const blocks: LaunchSmsBlock[] = [];
  if (recipient.consentRefused === true) blocks.push("consent_refused");
  const consent = classifyLaunchSmsConsent(recipient.smsConsent);
  if (consent === "withdrawn") blocks.push("consent_withdrawn");
  else if (consent === "malformed") blocks.push("consent_malformed");
  else if (consent === "missing") blocks.push("consent_missing");
  if (recipient.unsubscribed === true) blocks.push("unsubscribed");
  if (recipient.suspect === true) blocks.push("suspect");
  if (recipient.duplicate === true) blocks.push("duplicate");
  if (recipient.qa === true) blocks.push("qa");
  if (recipient.internal === true) blocks.push("internal");
  if (recipient.phonePresent !== true) blocks.push("no_phone");
  if (recipient.payment === "unreadable") blocks.push("payment_unreadable");
  return blocks;
}

/** Eighteen drafts. Tokens stay unsubstituted. No recipient is involved. */
export function launchSmsCatalog(): LaunchSmsCatalogEntry[] {
  const variants: LaunchSmsVariant[] = ["launch", "paid-reserver"];
  return SUPPORTED_LOCALES.flatMap((locale) =>
    variants.map((variant) => {
      const draft = renderLaunchSms({ savedSignupLocale: locale, variant });
      return {
        locale,
        variant,
        characters: draft.characters,
        koreanMarketingPrefix: draft.koreanMarketingPrefix,
        body: draft.body,
        sendable: false as const,
        tokensUnresolved: true as const,
      };
    }),
  );
}

export function planLaunchSms(
  recipient: LaunchSmsRecipient,
  options: {
    envNames?: readonly string[];
    env?: Record<string, string | undefined>;
  } = {},
): LaunchSmsPlan {
  const provider = inspectSmsTransport(options.envNames ?? []);
  const stopped = hardStops(recipient);
  if (stopped.length > 0) {
    return {
      decision: "refuse",
      sendable: false,
      variant: null,
      draft: null,
      blocks: stopped,
      network: false,
      provider,
    };
  }
  const variant: LaunchSmsVariant = recipient.payment === "live" ? "paid-reserver" : "launch";
  const draft = renderLaunchSms({
    savedSignupLocale: recipient.savedSignupLocale,
    signupCountry: recipient.signupCountry,
    variant,
    segment: recipient.segment,
  });
  const blocks: LaunchSmsBlock[] = [];
  if (draft.body.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN)) blocks.push("launch_link_unknown");
  if (draft.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN))
    blocks.push("reservation_link_unknown");
  blocks.push(provider.transport === "none" ? "provider_unconfigured" : "provider_not_implemented");
  if ((options.env ?? {})[LAUNCH_SMS_SEND_ENV] !== "true") blocks.push("send_disabled");
  return {
    decision: "dry_run",
    sendable: false,
    variant,
    draft,
    blocks,
    network: false,
    provider,
  };
}

export type LaunchSmsRun = {
  sent: false;
  network: false;
  mode: "dry-run" | "send";
  outcome: "refused" | "dry_run" | "blocked";
  blocks: LaunchSmsBlock[];
  variant: LaunchSmsVariant | null;
  body: string | null;
};

/**
 * Dry-run returns the unsubstituted draft for an eligible recipient.
 * Send is accepted as a mode and still performs no network call.
 */
export function runLaunchSms(
  recipient: LaunchSmsRecipient,
  options: {
    mode?: "dry-run" | "send";
    envNames?: readonly string[];
    env?: Record<string, string | undefined>;
    fetchImpl?: unknown;
  } = {},
): LaunchSmsRun {
  void options.fetchImpl;
  const mode = options.mode === "send" ? "send" : "dry-run";
  const plan = planLaunchSms(recipient, options);
  if (plan.decision === "refuse" || plan.draft === null) {
    return {
      sent: false,
      network: false,
      mode,
      outcome: "refused",
      blocks: plan.blocks,
      variant: null,
      body: null,
    };
  }
  return {
    sent: false,
    network: false,
    mode,
    outcome: mode === "send" ? "blocked" : "dry_run",
    blocks: plan.blocks,
    variant: plan.variant,
    body: plan.draft.body,
  };
}
