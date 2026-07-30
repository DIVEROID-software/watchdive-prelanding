import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

import {
  CANONICAL_EMAIL_PROPERTY,
  NOTION_EMAIL_VALUE_MAX,
  canonicalEmailFilters,
  canonicalEmailProperties,
  getCanonicalEmailShape,
  isCanonicalEmailShapeError,
  setCanonicalEmailShape,
  withCanonicalEmailShape,
} from "../src/lib/api/notionCanonicalEmail.ts";

// Shape of the error notionFetch throws for a non-2xx Notion response.
function notionError(status: number, body: Record<string, unknown>) {
  return new Error(`Notion pages failed (${status}): ${JSON.stringify(body)}`);
}

const SHAPE_MISMATCH = notionError(400, {
  object: "error",
  status: 400,
  code: "validation_error",
  message: `${CANONICAL_EMAIL_PROPERTY} is expected to be email.`,
});

beforeEach(() => {
  setCanonicalEmailShape("email");
});

test("targets the email column type that the live database uses", () => {
  assert.deepEqual(canonicalEmailFilters("diver@example.com"), [
    { property: CANONICAL_EMAIL_PROPERTY, email: { equals: "diver@example.com" } },
  ]);
  assert.deepEqual(canonicalEmailProperties("diver@example.com"), {
    [CANONICAL_EMAIL_PROPERTY]: { email: "diver@example.com" },
  });
});

test("still speaks rich_text for a database on the legacy column type", () => {
  setCanonicalEmailShape("rich_text");

  assert.deepEqual(canonicalEmailFilters("diver@example.com"), [
    { property: CANONICAL_EMAIL_PROPERTY, rich_text: { equals: "diver@example.com" } },
  ]);
  assert.deepEqual(canonicalEmailProperties("diver@example.com"), {
    [CANONICAL_EMAIL_PROPERTY]: { rich_text: [{ text: { content: "diver@example.com" } }] },
  });
});

test("recovers a signup when the column is still rich_text", async () => {
  // Legacy database, but the process starts on the current shape: the first
  // attempt is rejected and the retry has to succeed.
  const sent: string[] = [];
  const result = await withCanonicalEmailShape(async () => {
    const [filter] = canonicalEmailFilters("diver@example.com");
    const key = Object.keys(filter).find((k) => k !== "property")!;
    sent.push(key);
    if (key !== "rich_text") {
      throw notionError(400, {
        code: "validation_error",
        message: `${CANONICAL_EMAIL_PROPERTY} is expected to be rich_text.`,
      });
    }
    return "stored";
  });

  assert.equal(result, "stored");
  assert.deepEqual(sent, ["email", "rich_text"]);
  assert.equal(getCanonicalEmailShape(), "rich_text");
});

test("recovers a signup when the column has been migrated to email", async () => {
  setCanonicalEmailShape("rich_text");
  const sent: string[] = [];

  const result = await withCanonicalEmailShape(async () => {
    const key = Object.keys(
      canonicalEmailProperties("diver@example.com")[CANONICAL_EMAIL_PROPERTY] as Record<
        string,
        unknown
      >,
    )[0];
    sent.push(key);
    if (key !== "email") throw SHAPE_MISMATCH;
    return "stored";
  });

  assert.equal(result, "stored");
  assert.deepEqual(sent, ["rich_text", "email"]);
  assert.equal(getCanonicalEmailShape(), "email");
});

test("remembers the working shape instead of retrying every signup", async () => {
  let attempts = 0;
  const run = async () => {
    attempts += 1;
    if (getCanonicalEmailShape() !== "rich_text") throw SHAPE_MISMATCH;
    return "stored";
  };

  await withCanonicalEmailShape(run);
  assert.equal(attempts, 2);

  await withCanonicalEmailShape(run);
  assert.equal(attempts, 3);
});

test("concurrent first requests recover to the same fallback shape", async () => {
  let releaseFailures: (() => void) | undefined;
  const bothFirstAttemptsReached = new Promise<void>((resolve) => {
    releaseFailures = resolve;
  });
  let firstAttempts = 0;

  const runOne = () =>
    withCanonicalEmailShape(async () => {
      const shape = getCanonicalEmailShape();
      if (shape === "email") {
        firstAttempts += 1;
        if (firstAttempts === 2) releaseFailures?.();
        await bothFirstAttemptsReached;
        throw SHAPE_MISMATCH;
      }
      return "stored";
    });

  assert.deepEqual(await Promise.all([runOne(), runOne()]), ["stored", "stored"]);
  assert.equal(firstAttempts, 2);
  assert.equal(getCanonicalEmailShape(), "rich_text");
});

test("does not retry or flip on failures that are not a column mismatch", async () => {
  const unrelated = [
    notionError(401, { code: "unauthorized", message: "API token is invalid." }),
    notionError(429, { code: "rate_limited", message: "You have been rate limited." }),
    notionError(400, {
      code: "validation_error",
      message: "Source is expected to be select.",
    }),
    new Error("fetch failed"),
  ];

  for (const error of unrelated) {
    let attempts = 0;
    await assert.rejects(
      withCanonicalEmailShape(async () => {
        attempts += 1;
        throw error;
      }),
      (thrown: unknown) => thrown === error,
    );
    assert.equal(attempts, 1);
    assert.equal(getCanonicalEmailShape(), "email");
  }
});

test("classifies only the column mismatch as a shape error", () => {
  assert.equal(isCanonicalEmailShapeError(SHAPE_MISMATCH), true);
  assert.equal(
    isCanonicalEmailShapeError(
      notionError(400, {
        code: "validation_error",
        message: "Suspect is expected to be checkbox.",
      }),
    ),
    false,
  );
  assert.equal(isCanonicalEmailShapeError("not an error"), false);
  assert.equal(isCanonicalEmailShapeError(undefined), false);
});

test("keeps the lead when an address is too long for the email column", () => {
  const long = `${"a".repeat(NOTION_EMAIL_VALUE_MAX)}@example.com`;

  // No filter clause and no property — a value this long could never have been
  // stored, and a 400 here would drop the signup entirely.
  assert.deepEqual(canonicalEmailFilters(long), []);
  assert.deepEqual(canonicalEmailProperties(long), {});

  // The legacy column holds 2000 characters, so nothing is dropped there.
  setCanonicalEmailShape("rich_text");
  assert.equal(canonicalEmailFilters(long).length, 1);
  assert.deepEqual(canonicalEmailProperties(long), {
    [CANONICAL_EMAIL_PROPERTY]: { rich_text: [{ text: { content: long } }] },
  });
});

test("website and Instant Form query/create paths use the schema-safe wrapper", async () => {
  const source = await readFile(
    new URL("../src/lib/api/waitlist.functions.ts", import.meta.url),
    "utf8",
  );

  // Instant Form has separate unique and cross-channel duplicate create paths;
  // both share the same canonical filter/property builders.
  assert.equal((source.match(/withCanonicalEmailShape\(\(\) =>/g) ?? []).length, 5);
  assert.equal((source.match(/canonicalEmailFilters\(canonical\)/g) ?? []).length, 1);
  assert.equal((source.match(/canonicalEmailProperties\(canonical\)/g) ?? []).length, 2);
  assert.doesNotMatch(source, /"Canonical email": \{ email: canonical \}/);
  assert.match(source, /response\.code === "validation_error"/);
  assert.match(source, /response\.message\.includes\(CANONICAL_EMAIL_PROPERTY\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(response\)|await res\.text\(\)/);
});
