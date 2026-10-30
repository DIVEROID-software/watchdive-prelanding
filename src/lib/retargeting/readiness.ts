// Booleans and env names only. This module never reads a secret's value into its result
// and never calls Meta or Google.

import { metaCapiConfigStatus } from "../api/metaCapi.ts";
import { readGoogleTagConfig } from "../googleTag.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";
import { RETARGETING_PHASE } from "./constants.ts";

export type RetargetingReadiness = {
  phase: typeof RETARGETING_PHASE;
  readyForLive: false;
  deployed: false;
  /** Callsites are in this tree. This is not a deploy and not a live conversion. */
  integrationApplied: true;
  advertiserVerification: "requires_platform_readback";
  liveConversionClaimed: false;
  liveDeliveryClaimed: false;
  googleAds: {
    globalIdEnv: "VITE_GOOGLE_ADS_ID";
    globalIdConfigured: boolean;
    confirmedEmailLabelEnv: "VITE_GOOGLE_ADS_CONVERSION_LABEL";
    confirmedEmailLabelConfigured: boolean;
    signupLabelEnv: "VITE_GOOGLE_ADS_SIGNUP_LABEL";
    signupLabelConfigured: boolean;
    purchaseLabelEnv: "VITE_GOOGLE_ADS_PURCHASE_LABEL";
    purchaseLabelConfigured: boolean;
    note: string;
  };
  meta: {
    capiEnabled: boolean;
    missing: string[];
    note: string;
  };
  purchase: {
    acceptsNotionPaidFlag: false;
    acceptsSuccessUrl: false;
    requiresStripeInspection: true;
    feeCents: 300;
    currency: "usd";
  };
  historicalEventsPreserved: ["form_start", "generate_lead", "EmailVerified", "trackMetaLead"];
  blockedReasons: string[];
};

export function buildRetargetingReadiness(
  env: Record<string, string | undefined> = process.env,
): RetargetingReadiness {
  const google = readGoogleTagConfig(env);
  const capi = metaCapiConfigStatus();
  const googleAds = {
    globalIdEnv: "VITE_GOOGLE_ADS_ID" as const,
    globalIdConfigured: Boolean(google.adsId),
    confirmedEmailLabelEnv: "VITE_GOOGLE_ADS_CONVERSION_LABEL" as const,
    confirmedEmailLabelConfigured: Boolean(google.adsLabel),
    signupLabelEnv: "VITE_GOOGLE_ADS_SIGNUP_LABEL" as const,
    signupLabelConfigured: Boolean(google.signupLabel),
    purchaseLabelEnv: "VITE_GOOGLE_ADS_PURCHASE_LABEL" as const,
    purchaseLabelConfigured: Boolean(google.purchaseLabel),
    note: "Account 139-796-0411 uses the GA4 import for sign_up and purchase. Blank VITE_GOOGLE_ADS_ID and direct labels are expected and are recorded only as configured flags. They are not blockedReasons, and this function does not gate the Measurement Protocol sender. A direct label remains a separate route and stays unset. readyForLive stays false because this report does not claim a live conversion.",
  };
  const blockedReasons = [
    "Current account verification and conversion-goal status require platform readback; the older account's paused state does not describe the new account.",
    "Integrated candidate is local only. Production conversion receipt and audience exclusions remain unverified.",
    "Grok reported a manual customer-list upload at 2026-10-26 17:53 KST; automatic refresh and current paid exclusions remain unverified.",
    "Raw form submit is signup_pending and is not an Ads conversion. While the public server flag is off, the landing poll sends one generate_lead and one sign_up. When both flags are on, the server owns sign_up.",
  ];
  if (!capi.enabled) blockedReasons.push(`Meta CAPI is not enabled (${capi.missing.join(", ") || "unknown"}).`);

  return {
    phase: RETARGETING_PHASE,
    readyForLive: false,
    deployed: false,
    integrationApplied: true,
    advertiserVerification: "requires_platform_readback",
    liveConversionClaimed: false,
    liveDeliveryClaimed: false,
    googleAds,
    meta: {
      capiEnabled: capi.enabled,
      missing: capi.missing,
      note: "pixelIdsMatch and enabled are booleans. This readiness check does not call the Graph API and does not print a token.",
    },
    purchase: {
      acceptsNotionPaidFlag: false,
      acceptsSuccessUrl: false,
      requiresStripeInspection: true,
      feeCents: RESERVATION_FEE_CENTS,
      currency: RESERVATION_CURRENCY,
    },
    historicalEventsPreserved: ["form_start", "generate_lead", "EmailVerified", "trackMetaLead"],
    blockedReasons,
  };
}
