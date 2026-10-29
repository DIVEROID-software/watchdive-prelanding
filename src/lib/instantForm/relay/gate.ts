import { requirePublicOrigin, requireSecret } from "../../verification/token.ts";

import { productionForms, type AllowlistForm } from "./allowlist.ts";
import { secretsAreDistinct } from "./auth.ts";
import { PRODUCTION_SENDER } from "./constants.ts";


export type GateEnv = {
  INSTANT_FORM_RUNTIME?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  AWS_LAMBDA_FUNCTION_NAME?: string;
  INSTANT_FORM_CONFIRMATION_ENABLED?: string;
  INSTANT_FORM_CONFIRMATION_DRY_RUN?: string;
  INSTANT_FORM_CONFIRMATION_SECRET?: string;
  INSTANT_FORM_PROSPECTIVE_NOT_BEFORE?: string;
  WATCHDIVE_VERIFICATION_SECRET?: string;
  WATCHDIVE_PUBLIC_ORIGIN?: string;
  WATCHDIVE_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  NOTION_API_KEY?: string;
  NOTION_WAITLIST_DB_ID?: string;
  INSTANT_FORM_CONFIRMATION_LEDGER?: string;
  INSTANT_FORM_CONFIRMATION_ALLOWLIST?: string;
  WATCHDIVE_NATIVE_FORM_PRIVACY?: string;
  [key: string]: string | undefined;
};

export function senderIsProduction(value: string | undefined): boolean {
  const raw = (value ?? "").trim();
  const match = /<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(raw);
  const address = (match ? match[1] : raw).trim().toLowerCase();
  return address === PRODUCTION_SENDER;
}

/** Closed unless every reason is absent. Dry-run and a missing flag both stay closed. */
export function confirmationGate(env: GateEnv, forms: readonly AllowlistForm[]): string[] {
  const reasons: string[] = [];
  if (env.INSTANT_FORM_CONFIRMATION_ENABLED !== "1") reasons.push("disabled");
  if (env.INSTANT_FORM_CONFIRMATION_DRY_RUN !== "0") reasons.push("dry_run");
  const secret = (env.INSTANT_FORM_CONFIRMATION_SECRET ?? "").trim();
  if (Buffer.byteLength(secret, "utf8") < 32) reasons.push("missing_secret");
  let verification = "";
  try {
    verification = requireSecret(env);
  } catch {
    reasons.push("missing_verification_secret");
  }
  if (secret && verification && !secretsAreDistinct(secret, verification)) {
    reasons.push("secret_not_isolated");
  }
  try {
    requirePublicOrigin(env);
  } catch {
    reasons.push("missing_origin");
  }
  const cutoff = Date.parse(env.INSTANT_FORM_PROSPECTIVE_NOT_BEFORE ?? "");
  if (!Number.isFinite(cutoff)) reasons.push("missing_cutoff");
  if (productionForms(forms).length === 0) reasons.push("empty_allowlist");
  // The mailer ignores this variable and always sends help@diveroid.com.
  // A leftover mailbox name would look like an active sender, so it stays closed.
  const from = (env.WATCHDIVE_EMAIL_FROM ?? "").trim();
  if (from && !senderIsProduction(from)) reasons.push("stale_sender_env");
  return reasons;
}

export function cutoffMs(env: GateEnv): number | null {
  const parsed = Date.parse(env.INSTANT_FORM_PROSPECTIVE_NOT_BEFORE ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}
