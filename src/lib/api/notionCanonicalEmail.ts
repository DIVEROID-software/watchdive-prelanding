// The Notion "Canonical email" column started out as rich_text and is now typed
// email. Notion rejects any filter condition or property value whose key does
// not match the column's live type, so a hard-coded shape breaks signups on
// whichever side of that migration it is not on.
//
// Instead of pinning one shape, remember the last one that worked and flip on
// the single error Notion returns for a type mismatch. The happy path costs no
// extra request, and a schema change self-heals after one signup.
//
// Kept free of relative imports so `npm test` can load it directly.

export const CANONICAL_EMAIL_PROPERTY = "Canonical email";

// developers.notion.com/reference/request-limits — an email property value is
// capped at 200 characters, where rich_text allows 2000. The submit validator
// accepts addresses up to 320, so the gap is reachable.
export const NOTION_EMAIL_VALUE_MAX = 200;

export type CanonicalEmailShape = "email" | "rich_text";

// Current live schema first; a legacy rich_text database flips this on its
// first signup.
let currentShape: CanonicalEmailShape = "email";

export function getCanonicalEmailShape(): CanonicalEmailShape {
  return currentShape;
}

// Test seam. Request handling never sets the shape directly — it moves only
// through withCanonicalEmailShape below.
export function setCanonicalEmailShape(shape: CanonicalEmailShape): void {
  currentShape = shape;
}

// Dedupe filter clauses for the current shape. An address longer than the email
// column can hold could never have been stored, so it contributes no clause and
// dedupe falls back to the exact-email title match.
export function canonicalEmailFilters(canonical: string): Record<string, unknown>[] {
  if (currentShape === "rich_text") {
    return [{ property: CANONICAL_EMAIL_PROPERTY, rich_text: { equals: canonical } }];
  }
  if (canonical.length > NOTION_EMAIL_VALUE_MAX) return [];
  return [{ property: CANONICAL_EMAIL_PROPERTY, email: { equals: canonical } }];
}

// Properties fragment to spread into a page create. An over-long address drops
// only its dedupe key — losing the whole lead to a 400 would be worse.
export function canonicalEmailProperties(canonical: string): Record<string, unknown> {
  if (currentShape === "rich_text") {
    return {
      [CANONICAL_EMAIL_PROPERTY]: { rich_text: [{ text: { content: canonical.slice(0, 1900) } }] },
    };
  }
  if (canonical.length > NOTION_EMAIL_VALUE_MAX) return {};
  return { [CANONICAL_EMAIL_PROPERTY]: { email: canonical } };
}

// Notion answers a shape mismatch with a 400 validation_error naming the
// column. Auth failures, rate limits and outages must never flip the shape.
export function isCanonicalEmailShapeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("(400)") &&
    message.includes("validation_error") &&
    message.includes(CANONICAL_EMAIL_PROPERTY)
  );
}

// Runs a Notion call that references Canonical email. `run` must build its
// request body when called, not before, so the retry picks up the new shape.
export async function withCanonicalEmailShape<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isCanonicalEmailShapeError(error)) throw error;
    currentShape = currentShape === "email" ? "rich_text" : "email";
    return run();
  }
}
