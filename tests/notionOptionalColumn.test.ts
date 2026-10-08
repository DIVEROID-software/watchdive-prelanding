// The optional Meta click-cookie column. A 400 that names it is retried once
// without the column. A lost response, a 5xx, or a 400 about another field is
// not retried: Notion may already have created the page.
import assert from "node:assert/strict";
import test from "node:test";

import { setCanonicalEmailShape } from "../src/lib/api/notionCanonicalEmail.ts";
import type { CreatePendingInput } from "../src/lib/verification/contracts.ts";
import { FIELD_MEASUREMENT_CONSENT } from "../src/lib/verification/contracts.ts";
import {
  NotionRequestError,
  createNotionLeadStore,
  type NotionRequest,
} from "../src/lib/verification/notionLead.ts";

const COLUMN = "Meta fbc";
const FBC = "fb.1.1759900000000.IwAR0abcdefghijklmnop";

const input: CreatePendingInput = {
  email: "diver@example.com",
  canonical: "diver@example.com",
  source: "hero",
  refCode: "abcd1234",
  flags: [],
  suspect: false,
  signedUpAt: "2026-10-08T00:00:00.000Z",
  leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
  expiresAt: "2026-10-09T00:00:00.000Z",
  metaFbc: FBC,
  measurementState: "WD-AD-MEASUREMENT-CONSENT-V1:granted",
};

function notionError(status: number, code: string, message: string): NotionRequestError {
  return new NotionRequestError(status, JSON.stringify({ code, message }));
}

function page(): Record<string, unknown> {
  return { id: "page-1", properties: { Email: { title: [{ plain_text: input.email }] } } };
}

test("createPending retries only a 400 that names the click-cookie column", async () => {
  const previous = process.env.NOTION_META_FBC_PROPERTY;
  process.env.NOTION_META_FBC_PROPERTY = COLUMN;
  setCanonicalEmailShape("email");
  const bodies: unknown[] = [];

  const run = async (fail: (call: number) => Error | undefined) => {
    bodies.length = 0;
    let calls = 0;
    const request: NotionRequest = async (method, path, body) => {
      if (method === "POST" && path === "pages") {
        calls += 1;
        bodies.push(body);
        const error = fail(calls);
        if (error) throw error;
        return page();
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    const store = createNotionLeadStore(request, "db");
    return { store, calls: () => calls };
  };

  try {
    const named = await run((call) =>
      call === 1 ? notionError(400, "validation_error", `${COLUMN} is not a property that exists.`) : undefined,
    );
    const created = await named.store.createPending(input);
    assert.equal(created.pageId, "page-1");
    assert.equal(named.calls(), 2);
    const first = bodies[0] as { properties: Record<string, unknown> };
    const second = bodies[1] as { properties: Record<string, unknown> };
    assert.ok(first.properties[COLUMN]);
    assert.equal(second.properties[COLUMN], undefined);
    assert.ok(first.properties[FIELD_MEASUREMENT_CONSENT]);
    assert.ok(second.properties[FIELD_MEASUREMENT_CONSENT], "consent survives the column retry");

    for (const fail of [
      () => new Error("socket hang up"),
      () => notionError(500, "internal_server_error", `${COLUMN} exploded`),
      () => notionError(400, "validation_error", "Email is expected to be title."),
    ]) {
      const once = await run(() => fail());
      await assert.rejects(() => once.store.createPending(input));
      assert.equal(once.calls(), 1, fail().message);
    }
  } finally {
    if (previous === undefined) delete process.env.NOTION_META_FBC_PROPERTY;
    else process.env.NOTION_META_FBC_PROPERTY = previous;
    setCanonicalEmailShape("email");
  }
});
