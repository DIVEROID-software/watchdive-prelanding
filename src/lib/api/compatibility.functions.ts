/** Shared signup integration module. Deliberately no public profile lookup or second
 * mail endpoint: root threads this into the existing abuse-gated joinWaitlist path. */
export {
  prepareCompatibilityRequest,
  persistCompatibilityContext,
  compatibilityNotionProperties,
  COMPATIBILITY_NOTION_SCHEMA_PLAN,
} from "../compatibility/context";
export type {
  CompatibilityRequest,
  CompatibilityContext,
  CompatibilityContextStore,
} from "../compatibility/context";
