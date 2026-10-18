// Additive columns for the existing signup database. Nothing here reads a row
// or authorizes a charge. Root applies the patch; the default plan is dry-run.

const FIELD_SUFFIX = {
  status: "status",
  paid: "paid",
  amountCents: "amount cents",
  currency: "currency",
  sessionId: "Stripe session",
  paymentId: "Stripe payment",
  paidAt: "paid at",
  mode: "mode",
  refundedCents: "refunded cents",
  refundPendingCents: "refund pending cents",
  dispute: "dispute",
  duplicatePaid: "duplicate paid",
  source: "mirror source",
} as const;

function namedFields(prefix: "Reservation" | "Test reservation") {
  return {
    status: `${prefix} ${FIELD_SUFFIX.status}`,
    paid: `${prefix} ${FIELD_SUFFIX.paid}`,
    amountCents: `${prefix} ${FIELD_SUFFIX.amountCents}`,
    currency: `${prefix} ${FIELD_SUFFIX.currency}`,
    sessionId: `${prefix} ${FIELD_SUFFIX.sessionId}`,
    paymentId: `${prefix} ${FIELD_SUFFIX.paymentId}`,
    paidAt: `${prefix} ${FIELD_SUFFIX.paidAt}`,
    mode: `${prefix} ${FIELD_SUFFIX.mode}`,
    refundedCents: `${prefix} ${FIELD_SUFFIX.refundedCents}`,
    refundPendingCents: `${prefix} ${FIELD_SUFFIX.refundPendingCents}`,
    dispute: `${prefix} ${FIELD_SUFFIX.dispute}`,
    duplicatePaid: `${prefix} ${FIELD_SUFFIX.duplicatePaid}`,
    source: `${prefix} ${FIELD_SUFFIX.source}`,
  } as const;
}

/** Live payments. A test event must not write these. */
export const RESERVATION_NOTION = namedFields("Reservation");
/** Test payments. A live event must not write these. */
export const TEST_RESERVATION_NOTION = namedFields("Test reservation");

export function reservationNotionFields(mode: "test" | "live") {
  return mode === "live" ? RESERVATION_NOTION : TEST_RESERVATION_NOTION;
}

export const RESERVATION_STATUS_OPTIONS = [
  "unpaid",
  "open",
  "paid",
  "refunded",
  "partially_refunded",
  "refund_pending",
  "disputed",
  "invalid",
] as const;

export const RESERVATION_MODE_OPTIONS = ["test", "live"] as const;
export const RESERVATION_DISPUTE_OPTIONS = ["none", "open"] as const;
export const RESERVATION_MIRROR_SOURCE = "stripe-retrieve";

/** Notion database ids are 32 hex characters, with or without dashes. */
export const NOTION_DATABASE_ID = /^[0-9a-fA-F-]{32,36}$/;

export type NotionSelectOption = { id?: string; name?: string; color?: string };

export type NotionDatabaseProperty = {
  type?: string;
  select?: { options?: NotionSelectOption[] };
};

export type NotionDatabaseSchema = {
  properties?: Record<string, NotionDatabaseProperty>;
};

export type SchemaAction =
  | { name: string; action: "add"; type: string }
  | { name: string; action: "extend_select"; type: "select"; add: string[] }
  | { name: string; action: "unchanged"; type: string };

export type SchemaConflict = { name: string; expected: string; actual: string };

export type SchemaPlan = {
  actions: SchemaAction[];
  conflicts: SchemaConflict[];
  patch: Record<string, unknown> | null;
};

type SelectSpec = { name: string; options: readonly string[] };
type FieldSet = { [Key in keyof typeof RESERVATION_NOTION]: string };

const FIELD_SETS: readonly FieldSet[] = [RESERVATION_NOTION, TEST_RESERVATION_NOTION];

const SELECTS: SelectSpec[] = FIELD_SETS.flatMap((fields) => [
  { name: fields.status, options: RESERVATION_STATUS_OPTIONS },
  { name: fields.mode, options: RESERVATION_MODE_OPTIONS },
  { name: fields.dispute, options: RESERVATION_DISPUTE_OPTIONS },
]);

const CHECKBOXES = FIELD_SETS.flatMap((fields) => [fields.paid, fields.duplicatePaid]);
const NUMBERS = FIELD_SETS.flatMap((fields) => [
  fields.amountCents,
  fields.refundedCents,
  fields.refundPendingCents,
]);
const RICH_TEXT = FIELD_SETS.flatMap((fields) => [
  fields.currency,
  fields.sessionId,
  fields.paymentId,
  fields.source,
]);
const DATES = FIELD_SETS.flatMap((fields) => [fields.paidAt]);

function expectedType(name: string): string | null {
  if (SELECTS.some((spec) => spec.name === name)) return "select";
  if (CHECKBOXES.includes(name as (typeof CHECKBOXES)[number])) return "checkbox";
  if (NUMBERS.includes(name as (typeof NUMBERS)[number])) return "number";
  if (RICH_TEXT.includes(name as (typeof RICH_TEXT)[number])) return "rich_text";
  if (DATES.includes(name as (typeof DATES)[number])) return "date";
  return null;
}

function selectOptions(name: string): readonly string[] {
  return SELECTS.find((spec) => spec.name === name)?.options ?? [];
}

function propertyPatch(name: string): Record<string, unknown> {
  const type = expectedType(name);
  if (type === "select") {
    return { select: { options: selectOptions(name).map((option) => ({ name: option })) } };
  }
  if (type === "checkbox") return { checkbox: {} };
  if (type === "number") return { number: { format: "number" } };
  if (type === "rich_text") return { rich_text: {} };
  if (type === "date") return { date: {} };
  return {};
}

export const RESERVATION_NOTION_PROPERTY_NAMES: readonly string[] = FIELD_SETS.flatMap((fields) => [
  fields.status,
  fields.paid,
  fields.amountCents,
  fields.currency,
  fields.sessionId,
  fields.paymentId,
  fields.paidAt,
  fields.mode,
  fields.refundedCents,
  fields.refundPendingCents,
  fields.dispute,
  fields.duplicatePaid,
  fields.source,
]);

/**
 * Compares the live database property map with the reservation columns.
 * A type collision aborts the whole patch. Existing select options are kept.
 */
export function planReservationNotionSchema(database: NotionDatabaseSchema): SchemaPlan {
  const properties = database.properties ?? {};
  const actions: SchemaAction[] = [];
  const conflicts: SchemaConflict[] = [];
  const patch: Record<string, unknown> = {};

  for (const name of RESERVATION_NOTION_PROPERTY_NAMES) {
    const expected = expectedType(name);
    if (!expected) continue;
    const current = properties[name];
    if (!current) {
      actions.push({ name, action: "add", type: expected });
      patch[name] = propertyPatch(name);
      continue;
    }
    if (current.type !== expected) {
      conflicts.push({ name, expected, actual: current.type ?? "" });
      continue;
    }
    if (expected === "select") {
      const existing = current.select?.options ?? [];
      const have = new Set(
        existing
          .map((option) => option.name)
          .filter((option): option is string => typeof option === "string" && option.length > 0),
      );
      const missing = selectOptions(name).filter((option) => !have.has(option));
      if (missing.length === 0) {
        actions.push({ name, action: "unchanged", type: expected });
        continue;
      }
      actions.push({ name, action: "extend_select", type: "select", add: missing });
      patch[name] = {
        select: {
          options: [
            ...existing
              .filter((option) => typeof option.name === "string" && option.name.length > 0)
              .map((option) => ({
                ...(option.id ? { id: option.id } : {}),
                name: option.name,
                ...(option.color ? { color: option.color } : {}),
              })),
            ...missing.map((option) => ({ name: option })),
          ],
        },
      };
      continue;
    }
    actions.push({ name, action: "unchanged", type: expected });
  }

  return {
    actions,
    conflicts,
    patch: conflicts.length > 0 || Object.keys(patch).length === 0 ? null : patch,
  };
}
