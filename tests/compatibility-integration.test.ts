import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_SECRET,
} from "./helpers/fakes.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import type { CreatePendingInput, LeadRecord } from "../src/lib/verification/contracts.ts";
import type { CompatibilityContext } from "../src/lib/compatibility/context.ts";
import {
  prepareCompatibilityRequest,
  COMPATIBILITY_NOTION_PROPERTY,
} from "../src/lib/compatibility/context.ts";
import { compatibilitySchemaReady } from "../src/lib/compatibility/readiness.server.ts";
import { createNotionLeadStore, toLeadRecord } from "../src/lib/verification/notionLead.ts";
import { createResendMailer } from "../src/lib/verification/resend.ts";
import {
  createVerificationToken,
  parseVerificationToken,
  verificationUrl,
} from "../src/lib/verification/token.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { RETARGETING_COPY } from "../src/components/retargeting/copy.ts";
class CompatibilityStore extends FakeLeadStore {
  contexts = 0;
  async createPending(input: CreatePendingInput): Promise<LeadRecord> {
    const record = await super.createPending(input);
    if (input.compatibility) record.compatibility = input.compatibility;
    return record;
  }
  async recordCompatibility(pageId: string, context: CompatibilityContext) {
    this.contexts++;
    const row = this.rows.get(pageId);
    if (row) row.compatibility = context;
  }
}
function fixture(locale: Locale = "en") {
  const store = new CompatibilityStore();
  const mailer = new FakeMailer();
  let now = new Date("2026-10-26T12:00:00Z");
  const input = {
    email: "mock@example.com",
    canonical: "mock@example.com",
    source: "hero",
    flags: [],
    suspect: false,
    measurementConsent: false,
    networkSendBlocked: false,
    locale,
    compatibility: { modelId: "galaxy-watch4", locale, requested: true as const },
  };
  const deps = {
    store,
    mailer,
    env: TEST_ENV,
    now: () => now,
    leadId: leadIdFactory(),
    sleep: async () => {},
    compatibilityEnabled: true,
  };
  return {
    store,
    mailer,
    input,
    deps,
    advance: () => {
      now = new Date(now.getTime() + 61_000);
    },
  };
}
test("all nine locales persist explicit context before exactly one initial mail; no verified signup", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const f = fixture(locale);
    const response = await requestVerificationService(f.input, f.deps);
    assert.equal(response.status, "pending");
    assert.equal(f.mailer.sent.length, 1);
    const row = [...f.store.rows.values()][0];
    assert.equal(row.compatibility?.source, "compatibility-checker");
    assert.equal(row.compatibility?.requestLocale, locale);
    assert.equal(row.signupLocale, locale);
    assert.equal(row.emailVerified, false);
    assert.equal(row.status, "pending");
    assert.equal(f.mailer.sent[0].compatibility?.modelId, "galaxy-watch4");
    assert.equal(
      parseVerificationToken(f.mailer.sent[0].token, TEST_SECRET, f.deps.now().getTime())?.locale,
      locale,
    );
  }
});
test("readiness, invalid model, locale mismatch and failed durable field all block compatibility mail", async () => {
  for (const variant of ["disabled", "model", "locale", "durability"]) {
    const f = fixture();
    if (variant === "disabled") f.deps.compatibilityEnabled = false;
    if (variant === "model") f.input.compatibility.modelId = "invented";
    if (variant === "locale") f.input.compatibility.locale = "ko";
    if (variant === "durability")
      f.store.createPending = (input) => FakeLeadStore.prototype.createPending.call(f.store, input);
    await assert.rejects(() => requestVerificationService(f.input, f.deps));
    assert.equal(f.mailer.sent.length, 0);
  }
});
test("compatibility resend needs matching live credential, preserves cooldown and original signup language", async () => {
  const f = fixture("ja");
  const first = await requestVerificationService(f.input, f.deps);
  const cooled = await requestVerificationService(
    { ...f.input, compatibilityCredential: first.handle },
    f.deps,
  );
  assert.equal(cooled.handle, first.handle);
  assert.equal(f.mailer.sent.length, 1);
  f.advance();
  const unproven = await requestVerificationService(
    { ...f.input, locale: "ko", compatibility: { ...f.input.compatibility, locale: "ko" } },
    f.deps,
  );
  assert.equal(unproven.status, "pending");
  assert.equal(f.mailer.sent.length, 1);
  assert.equal(f.store.startAttemptCalls, 0);
  await requestVerificationService(
    {
      ...f.input,
      locale: "ko",
      compatibility: { ...f.input.compatibility, locale: "ko" },
      compatibilityCredential: first.handle,
    },
    f.deps,
  );
  assert.equal(f.mailer.sent.length, 2);
  assert.equal(f.store.contexts, 1);
  assert.equal(f.mailer.sent[1].locale, "ja");
  assert.equal(f.mailer.sent[1].compatibility?.requestLocale, "ko");
});
test("existing verified, legacy, unsubscribed and abusive requests produce no compatibility mail or profile mutation", async () => {
  for (const status of ["verified", "legacy", "unsubscribed", "abusive"] as const) {
    const f = fixture();
    const row = f.store.seed({
      email: f.input.email,
      canonical: f.input.canonical,
      status: status === "abusive" ? "pending" : status,
      emailVerified: status === "verified",
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    });
    const before = JSON.stringify(row);
    await requestVerificationService(
      { ...f.input, ...(status === "abusive" ? { flags: ["honeypot"] } : {}) },
      f.deps,
    );
    assert.equal(f.mailer.sent.length, 0);
    assert.equal(f.store.contexts, 0);
    assert.equal(JSON.stringify(row), before);
  }
});
test("actual Notion adapter writes and parses the additive context, without status promotion", async () => {
  const f = fixture("fr");
  const context = prepareCompatibilityRequest(f.input.compatibility)!;
  let properties: Record<string, unknown> = {};
  const store = createNotionLeadStore(async (method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "pages");
    properties = (body as { properties: Record<string, unknown> }).properties;
    return {
      id: "mock-page",
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, value]) => {
          const property = value as { rich_text?: { text: { content: string } }[] };
          return [
            name,
            property.rich_text
              ? { rich_text: property.rich_text.map((item) => ({ plain_text: item.text.content })) }
              : value,
          ];
        }),
      ),
    };
  }, "mock-database");
  const row = await store.createPending({
    email: f.input.email,
    canonical: f.input.canonical,
    source: "hero",
    refCode: "mockcode",
    flags: [],
    suspect: false,
    signedUpAt: f.deps.now().toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    expiresAt: "2026-10-27T12:00:00Z",
    compatibility: context,
  });
  assert.equal(row.compatibility?.requestLocale, "fr");
  assert.equal(row.emailVerified, false);
  assert.ok(properties[COMPATIBILITY_NOTION_PROPERTY]);
  assert.equal(toLeadRecord({ id: "legacy", properties: {} })?.compatibility, undefined);
});
test("schema gate is read-only, defaults closed and requires exact rich_text property", async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return { properties: { [COMPATIBILITY_NOTION_PROPERTY]: { type: "rich_text" } } };
  };
  assert.equal(await compatibilitySchemaReady({}, read), false);
  assert.equal(reads, 0);
  const env = { WATCHDIVE_COMPATIBILITY_ENABLED: "true", NOTION_WAITLIST_DB_ID: "mock-db" };
  assert.equal(await compatibilitySchemaReady(env, read), true);
  assert.equal(await compatibilitySchemaReady(env, async () => ({ properties: {} })), false);
  assert.equal(
    await compatibilitySchemaReady(env, async () => {
      throw new Error("missing");
    }),
    false,
  );
});
test("actual mail transport emits one enriched message with original signed verification URL and idempotency", async () => {
  for (const locale of SUPPORTED_LOCALES) {
    const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
    const mailer = createResendMailer(
      { RESEND_API_KEY: "local-fake-key", WATCHDIVE_EMAIL_FROM: "test@example.com" },
      (async (_url: unknown, init: RequestInit) => {
        calls.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
        return Response.json({ id: "mock-message" });
      }) as typeof fetch,
      async () => {},
    );
    const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
    const token = createVerificationToken(
      leadId,
      Date.parse("2026-10-27T12:00:00Z"),
      false,
      TEST_SECRET,
      locale,
    );
    const compatibility = prepareCompatibilityRequest({
      modelId: "apple-watch-ultra-2",
      locale,
      requested: true,
    })!;
    await mailer.send({
      to: "mock@example.com",
      leadId,
      token,
      locale,
      publicOrigin: TEST_ENV.WATCHDIVE_PUBLIC_ORIGIN,
      compatibility,
    });
    assert.equal(calls.length, 1);
    assert.ok(String(calls[0].body.text).includes(RETARGETING_COPY[locale].planned));
    assert.ok(
      String(calls[0].body.text).includes(verificationUrl(TEST_ENV.WATCHDIVE_PUBLIC_ORIGIN, token)),
    );
    assert.equal(calls[0].headers.get("Idempotency-Key"), `watchdive-verification-${leadId}`);
  }
});
test("shared placements are mounted, compact source hooks and unique DOM IDs remain explicit", () => {
  const index = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const segment = readFileSync(
    new URL("../src/components/segments/SegmentLanding.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(index.includes("<AcquisitionTools />"));
  assert.ok(segment.includes("<AcquisitionTools compatibility={false} />"));
  for (const id of ['domId="compatibility-checker"', 'domId="exit-capture"'])
    assert.ok(index.includes(id));
  assert.ok(index.includes("trackGoogleFormStart(id)"));
  assert.ok(index.includes('trackClarity("sign_up", id)'));
  assert.ok(index.includes("!compact && <SocialAuthEntry"));
  assert.ok(index.includes("phoneOptIn={compact ? undefined"));
});
