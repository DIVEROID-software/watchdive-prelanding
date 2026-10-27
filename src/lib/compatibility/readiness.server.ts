import { COMPATIBILITY_NOTION_PROPERTY } from "./context.ts";
export type CompatibilityEnvironment = {
  WATCHDIVE_COMPATIBILITY_ENABLED?: string;
  NOTION_WAITLIST_DB_ID?: string;
};
/** Read-only gate. A flag alone is not proof that the additive CRM property exists. */
export async function compatibilitySchemaReady(
  env: CompatibilityEnvironment,
  request: (method: "GET", path: string) => Promise<Record<string, unknown>>,
): Promise<boolean> {
  if (env.WATCHDIVE_COMPATIBILITY_ENABLED !== "true" || !env.NOTION_WAITLIST_DB_ID) return false;
  try {
    const schema = await request("GET", `databases/${env.NOTION_WAITLIST_DB_ID}`);
    const properties = schema.properties as Record<string, { type?: unknown }> | undefined;
    return properties?.[COMPATIBILITY_NOTION_PROPERTY]?.type === "rich_text";
  } catch {
    return false;
  }
}
