import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPATIBILITY_MODELS } from "../src/lib/compatibility/catalog.ts";
import {
  prepareCompatibilityRequest,
  compatibilityNotionProperties,
  persistCompatibilityContext,
} from "../src/lib/compatibility/context.ts";
import { compatibilityEmailFragment } from "../src/lib/compatibility/email.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { RETARGETING_COPY } from "../src/components/retargeting/copy.ts";
test("all exact model names come from existing catalog; no invented case-size support", () => {
  const source = readFileSync(
    new URL("../src/lib/i18n/frozen-landing-messages.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("그 외 모든 Apple Watch 모델"));
  for (const model of COMPATIBILITY_MODELS.filter(
    (m) => m.result !== "unconfirmed" && m.id !== "apple-watch-non-ultra",
  ))
    assert.ok(source.includes(model.name), model.name);
  for (const name of [
    "Apple Watch Ultra",
    "Apple Watch Ultra 2",
    "Apple Watch Ultra 3",
    "Galaxy Watch Ultra2",
  ])
    assert.equal(COMPATIBILITY_MODELS.find((m) => m.name === name)?.result, "planned-app-only");
  assert.equal(
    COMPATIBILITY_MODELS.find((m) => m.id === "apple-watch-non-ultra")?.result,
    "listed-housing",
  );
});
test("server recomputes result/source/model and rejects invalid or implicit requests", () => {
  const base = { modelId: "galaxy-watch4", locale: "ko", requested: true };
  for (const bad of [
    null,
    {},
    { ...base, locale: "xx" },
    { ...base, modelId: "apple-watch-series-99" },
    { ...base, requested: false },
  ])
    assert.equal(prepareCompatibilityRequest(bad), null);
  const context = prepareCompatibilityRequest({
    ...base,
    result: "verified",
    source: "paid",
    model: "<script>",
  })!;
  assert.equal(context.result, "listed-housing");
  assert.equal(context.source, "compatibility-checker");
  assert.equal(context.model, "Galaxy Watch4");
  const stored =
    compatibilityNotionProperties(context)["Compatibility request"].rich_text[0].text.content;
  assert.equal(JSON.parse(stored).locale, "ko");
  assert.equal(stored.includes("<script>"), false);
});
test("all nine requested locales render honest localized result and unverified notice", () => {
  for (const locale of SUPPORTED_LOCALES)
    for (const model of COMPATIBILITY_MODELS) {
      const context = prepareCompatibilityRequest({ modelId: model.id, locale, requested: true })!;
      const fragment = compatibilityEmailFragment(context);
      assert.ok(fragment.text.includes(RETARGETING_COPY[locale].verify));
      assert.equal(
        fragment.text.includes(RETARGETING_COPY[locale].sizes),
        false,
        "picker guidance is not repeated inside the result email",
      );
      assert.ok(fragment.html.includes(`lang="${locale}"`));
      assert.equal(
        fragment.html.includes("href="),
        false,
        "existing mailer owns single signed CTA",
      );
    }
});
test("durable context save must succeed before caller can enrich mail", async () => {
  const input = {
    pageId: "mock-page",
    context: { modelId: "galaxy-watch4", locale: "en", requested: true },
    authority: "new-durable-lead" as const,
  };
  let writes = 0;
  await persistCompatibilityContext(input, {
    save: async () => {
      writes++;
    },
  });
  assert.equal(writes, 1);
  await assert.rejects(() =>
    persistCompatibilityContext(
      { ...input, authority: "unproven" as "new-durable-lead" },
      {
        save: async () => {
          writes++;
        },
      },
    ),
  );
  await assert.rejects(() =>
    persistCompatibilityContext(input, {
      save: async () => {
        throw new Error("durability failure");
      },
    }),
  );
  assert.equal(writes, 1);
});
