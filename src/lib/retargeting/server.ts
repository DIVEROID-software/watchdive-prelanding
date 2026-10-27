// Server entry. Do not import this file from a browser component.
// The client entry is ./browser.ts, which does not pull in node:crypto.

export { paidDripSuppressed, classifyAudience, classifyBrowserVisitor } from "./audience.ts";
export type { AudienceDecision, AudiencePerson, AudiencePayment } from "./audience.ts";
export { deliverRetargetingLead, deliverRetargetingPurchase, deliverRetargetingRegistration } from "./capi.ts";
export type { RetargetingDelivery, RetargetingDeliveryInput } from "./capi.ts";
export { retargetingConsentAllows, retargetingConsentFromRow } from "./consent.ts";
export type { RetargetingConsent, RetargetingConsentState } from "./consent.ts";
export { EVENT_CONTRACT_MATRIX } from "./contract.ts";
export { RETARGETING_PHASE } from "./constants.ts";
export { planCompleteRegistration, planDurableLead, planPurchase } from "./events.ts";
export type {
  BrowserRetargetingEvent,
  LeadPlanInput,
  MeasurementPlan,
  PurchasePlanInput,
  RegistrationPlanInput,
} from "./events.ts";
export { retargetingExportSql } from "./exportSql.ts";
export { buildRetargetingReadiness } from "./readiness.ts";
export type { RetargetingReadiness } from "./readiness.ts";
