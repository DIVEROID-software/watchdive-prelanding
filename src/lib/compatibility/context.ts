import { isLocale, type Locale } from "../i18n/locale.ts";
import {
  COMPATIBILITY_CATALOG_VERSION,
  findCompatibilityModel,
  type CompatibilityResult,
} from "./catalog.ts";
export type CompatibilityRequest = { modelId: string; locale: Locale; requested: true };
export type CompatibilityContext = CompatibilityRequest & {
  source: "compatibility-checker";
  requestLocale: Locale;
  model: string;
  result: CompatibilityResult;
  catalogVersion: string;
};
/** Recompute result server-side. Never accept client result/model/source strings. */
export function prepareCompatibilityRequest(value: unknown): CompatibilityContext | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const model = findCompatibilityModel(data.modelId);
  if (!model || !isLocale(data.locale) || data.requested !== true) return null;
  return {
    modelId: model.id,
    locale: data.locale,
    requested: true,
    source: "compatibility-checker",
    requestLocale: data.locale,
    model: model.name || "Not listed",
    result: model.result,
    catalogVersion: COMPATIBILITY_CATALOG_VERSION,
  };
}
/** Additive proposal only. Caller must verify property exists; never migrate implicitly. */
export const COMPATIBILITY_NOTION_PROPERTY = "Compatibility request";
export const COMPATIBILITY_NOTION_SCHEMA_PLAN = {
  [COMPATIBILITY_NOTION_PROPERTY]: { rich_text: {} },
};
export function compatibilityNotionProperties(context: CompatibilityContext) {
  const validated = prepareCompatibilityRequest(context);
  if (!validated) throw new Error("Invalid compatibility context");
  return {
    [COMPATIBILITY_NOTION_PROPERTY]: {
      rich_text: [{ type: "text" as const, text: { content: JSON.stringify(validated) } }],
    },
  };
}
export interface CompatibilityContextStore {
  save(pageId: string, context: CompatibilityContext): Promise<void>;
}
/** Call only AFTER durable lead creation or server proof of ownership of existing lead.
 * Returns no profile information. No mail dispatch and no verification mutation here.
 */
export async function persistCompatibilityContext(
  input: {
    pageId: string;
    context: unknown;
    authority: "new-durable-lead" | "credential-proven-existing";
  },
  store: CompatibilityContextStore,
): Promise<CompatibilityContext> {
  const context = prepareCompatibilityRequest(input.context);
  if (
    !context ||
    !input.pageId ||
    !["new-durable-lead", "credential-proven-existing"].includes(input.authority)
  )
    throw new Error("Compatibility request not authorized");
  await store.save(input.pageId, context);
  return context;
}
