import { SUPPORTED_LOCALES, type Locale } from "../i18n/locale.ts";

/** Dedicated database only. These names are the schema contract; nothing here creates them. */
export const PUSH_PROPERTIES = {
  id: "Push id",
  status: "Push status",
  locale: "Push locale",
  consentVersion: "Push consent version",
  consentAt: "Push consent at",
  expiresAt: "Push expires at",
  ciphertext: "Push ciphertext",
  keyVersion: "Push key version",
  campaignReceipt: "Push campaign receipt",
  updatedAt: "Push updated at",
} as const;

export const PUSH_STATUSES = ["active", "revoked", "expired", "gone"] as const;
export type PushStatus = (typeof PUSH_STATUSES)[number];
export const PUSH_KEY_VERSION = "v1";

const PROPERTY_TYPES = {
  [PUSH_PROPERTIES.id]: "title",
  [PUSH_PROPERTIES.status]: "select",
  [PUSH_PROPERTIES.locale]: "select",
  [PUSH_PROPERTIES.consentVersion]: "rich_text",
  [PUSH_PROPERTIES.consentAt]: "date",
  [PUSH_PROPERTIES.expiresAt]: "date",
  [PUSH_PROPERTIES.ciphertext]: "rich_text",
  [PUSH_PROPERTIES.keyVersion]: "rich_text",
  [PUSH_PROPERTIES.campaignReceipt]: "rich_text",
  [PUSH_PROPERTIES.updatedAt]: "date",
} as const;

type SelectProperty = { type?: unknown; select?: { options?: { name?: unknown }[] } };
type DatabaseShape = {
  object?: unknown;
  archived?: unknown;
  in_trash?: unknown;
  properties?: Record<string, SelectProperty>;
};

function optionNames(property: SelectProperty | undefined): Set<string> {
  return new Set(
    (property?.select?.options ?? [])
      .map((option) => option.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

/** Fail closed unless the live database has every property, type, and select option. */
export function pushSchemaReady(database: unknown): boolean {
  if (!database || typeof database !== "object") return false;
  const schema = database as DatabaseShape;
  if (schema.object !== "database" || schema.archived === true || schema.in_trash === true)
    return false;
  const properties = schema.properties;
  if (!properties) return false;
  for (const [name, type] of Object.entries(PROPERTY_TYPES)) {
    if (properties[name]?.type !== type) return false;
  }
  const statuses = optionNames(properties[PUSH_PROPERTIES.status]);
  const locales = optionNames(properties[PUSH_PROPERTIES.locale]);
  return (
    PUSH_STATUSES.every((status) => statuses.has(status)) &&
    SUPPORTED_LOCALES.every((locale) => locales.has(locale))
  );
}

/**
 * Operator checklist for a new database. This object is never sent to Notion.
 * Create the database and an integration that can see only that database.
 */
export const PUSH_SCHEMA_PLAN = {
  apply: false as const,
  createsDatabase: false as const,
  migratesSchema: false as const,
  databaseEnv: "WATCHDIVE_PUSH_NOTION_DB_ID",
  tokenEnv: "WATCHDIVE_PUSH_NOTION_TOKEN",
  encryptionEnv: "WATCHDIVE_PUSH_ENCRYPTION_SECRET",
  properties: {
    [PUSH_PROPERTIES.id]: { title: {} },
    [PUSH_PROPERTIES.status]: {
      select: { options: PUSH_STATUSES.map((name) => ({ name })) },
    },
    [PUSH_PROPERTIES.locale]: {
      select: { options: SUPPORTED_LOCALES.map((name: Locale) => ({ name })) },
    },
    [PUSH_PROPERTIES.consentVersion]: { rich_text: {} },
    [PUSH_PROPERTIES.consentAt]: { date: {} },
    [PUSH_PROPERTIES.expiresAt]: { date: {} },
    [PUSH_PROPERTIES.ciphertext]: { rich_text: {} },
    [PUSH_PROPERTIES.keyVersion]: { rich_text: {} },
    [PUSH_PROPERTIES.campaignReceipt]: { rich_text: {} },
    [PUSH_PROPERTIES.updatedAt]: { date: {} },
  },
  omitted: ["email", "lead id", "phone", "name", "verified status"],
};
