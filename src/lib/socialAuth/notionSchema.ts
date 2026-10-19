// Additive Notion properties for social signup. Planning only: nothing here writes.

export const SOCIAL_SIGNUP_METHOD = "Signup method";
export const SOCIAL_RICH_TEXT_FIELDS = [
  "Google subject",
  "Apple subject",
  "Auth verification provenance",
  "Signup locale",
] as const;
export const SOCIAL_SIGNUP_METHOD_OPTIONS = ["email", "google", "apple"] as const;

export type NotionPropertySchema = {
  type?: string;
  select?: { options?: { name?: string; id?: string; color?: string }[] };
};

export type SocialSchemaDatabase = {
  properties?: Record<string, NotionPropertySchema>;
};

export type SocialSchemaConflict = { name: string; reason: "wrong_type" };

export type SocialSchemaAction =
  | { op: "skip"; name: string }
  | { op: "add" | "patch"; name: string; property: Record<string, unknown> };

export type SocialSchemaPlan = {
  ok: boolean;
  conflicts: SocialSchemaConflict[];
  actions: SocialSchemaAction[];
  /** Absent when every column is already the right shape. */
  patch: { properties: Record<string, unknown> } | null;
};

function selectProperty(options: { name?: string; color?: string }[]): Record<string, unknown> {
  return {
    select: {
      options: options.map((option) => ({
        name: option.name,
        ...(option.color ? { color: option.color } : {}),
      })),
    },
  };
}

export function planSocialSignupNotionSchema(database: SocialSchemaDatabase): SocialSchemaPlan {
  const properties = database.properties ?? {};
  const conflicts: SocialSchemaConflict[] = [];
  const actions: SocialSchemaAction[] = [];
  const patch: Record<string, unknown> = {};

  const method = properties[SOCIAL_SIGNUP_METHOD];
  if (!method) {
    const property = selectProperty(SOCIAL_SIGNUP_METHOD_OPTIONS.map((name) => ({ name })));
    actions.push({ op: "add", name: SOCIAL_SIGNUP_METHOD, property });
    patch[SOCIAL_SIGNUP_METHOD] = property;
  } else if (method.type !== "select") {
    conflicts.push({ name: SOCIAL_SIGNUP_METHOD, reason: "wrong_type" });
  } else {
    const existing = method.select?.options ?? [];
    const names = new Set(existing.map((option) => option.name).filter((name): name is string => Boolean(name)));
    const missing = SOCIAL_SIGNUP_METHOD_OPTIONS.filter((name) => !names.has(name));
    if (missing.length === 0) {
      actions.push({ op: "skip", name: SOCIAL_SIGNUP_METHOD });
    } else {
      const property = selectProperty([
        ...existing.map((option) => ({ name: option.name, color: option.color })),
        ...missing.map((name) => ({ name })),
      ]);
      actions.push({ op: "patch", name: SOCIAL_SIGNUP_METHOD, property });
      patch[SOCIAL_SIGNUP_METHOD] = property;
    }
  }

  for (const name of SOCIAL_RICH_TEXT_FIELDS) {
    const current = properties[name];
    if (!current) {
      const property = { rich_text: {} };
      actions.push({ op: "add", name, property });
      patch[name] = property;
    } else if (current.type !== "rich_text") {
      conflicts.push({ name, reason: "wrong_type" });
    } else {
      actions.push({ op: "skip", name });
    }
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
    actions,
    patch: Object.keys(patch).length > 0 ? { properties: patch } : null,
  };
}
