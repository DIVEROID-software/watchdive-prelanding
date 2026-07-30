import assert from "node:assert/strict";
import test from "node:test";

import {
  persistDuplicateWebsiteLeadDurably,
  persistNewWebsiteLeadDurably,
} from "../src/lib/api/websiteLeadPersistence.ts";

test("website lead durability writes Supabase before Notion/Meta and then merge-updates", async () => {
  const calls: string[] = [];
  const result = await persistNewWebsiteLeadDurably({
    writePreliminary: async () => {
      calls.push("lead:preliminary");
      return true;
    },
    writeValidation: async () => {
      calls.push("event:validation");
      return true;
    },
    writeNotionAndMeta: async () => {
      calls.push("external:notion-meta");
      return { notionPageId: "notion-page", metaCapiState: "sent" };
    },
    writeFinal: async (external) => {
      calls.push(`lead:final:${external.notionPageId}:${external.metaCapiState}`);
      return true;
    },
  });

  assert.deepEqual(result, { notionPageId: "notion-page", metaCapiState: "sent" });
  assert.deepEqual(calls, [
    "lead:preliminary",
    "event:validation",
    "external:notion-meta",
    "lead:final:notion-page:sent",
  ]);
});

test("website lead durability aborts before external writes when either Supabase seed fails", async () => {
  for (const failingStep of ["preliminary", "validation"] as const) {
    const calls: string[] = [];
    await assert.rejects(
      persistNewWebsiteLeadDurably({
        writePreliminary: async () => {
          calls.push("preliminary");
          return failingStep !== "preliminary";
        },
        writeValidation: async () => {
          calls.push("validation");
          return failingStep !== "validation";
        },
        writeNotionAndMeta: async () => {
          calls.push("external");
          return {};
        },
        writeFinal: async () => {
          calls.push("final");
          return true;
        },
      }),
      /storage is unavailable/,
    );
    assert.equal(calls.includes("external"), false);
    assert.equal(calls.includes("final"), false);
  }
});

test("website lead durability reports failure when the final merge-update is unavailable", async () => {
  const calls: string[] = [];
  await assert.rejects(
    persistNewWebsiteLeadDurably({
      writePreliminary: async () => true,
      writeValidation: async () => true,
      writeNotionAndMeta: async () => {
        calls.push("external");
        return {};
      },
      writeFinal: async () => {
        calls.push("final");
        return false;
      },
    }),
    /final outcome storage is unavailable/,
  );
  assert.deepEqual(calls, ["external", "final"]);
});

test("duplicate website leads fail closed when their outcome row cannot be stored", async () => {
  await assert.rejects(
    persistDuplicateWebsiteLeadDurably({
      writeOutcome: async () => false,
    }),
    /duplicate lead outcome storage is unavailable/,
  );
});
