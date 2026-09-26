import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  countryFromHeader,
  pageBehaviorSummarySchema,
} from "../src/lib/pageBehaviorSummary.ts";

const sample = {
  sessionId: "8d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f",
  locale: "ko" as const,
  device: "phone" as const,
  viewportW: 390,
  viewportH: 844,
  timezone: "Asia/Seoul",
  durationSec: 42,
  maxScroll: 80,
  referrerHost: "www.google.com",
  utmSource: "meta",
  utmMedium: "paid",
  utmCampaign: "launch",
  sections: [{ id: "offer-form", dwellSec: 12 }],
  clicks: [{ id: "header-cta", x: 50, y: 10 }],
};

test("a consented session summary keeps device, country code, time and named clicks", () => {
  assert.equal(pageBehaviorSummarySchema.safeParse(sample).success, true);
  assert.equal(countryFromHeader("kr"), "KR");
  assert.equal(countryFromHeader("korea"), "");
});

test("email, phone and addresses never fit a behavior summary", () => {
  assert.equal(
    pageBehaviorSummarySchema.safeParse({
      ...sample,
      sections: [{ id: "ada@example.com", dwellSec: 1 }],
    }).success,
    false,
  );
  assert.equal(
    pageBehaviorSummarySchema.safeParse({
      ...sample,
      clicks: [{ id: "01012345678", x: 1, y: 1 }],
    }).success,
    false,
  );
  assert.equal(
    pageBehaviorSummarySchema.safeParse({ ...sample, referrerHost: "https://evil.test" }).success,
    false,
  );
});

test("the behavior store does not read an address or a raw user agent", () => {
  const source = readFileSync(new URL("../src/lib/api/pageBehavior.server.ts", import.meta.url), "utf8");
  assert.equal(source.includes("x-forwarded-for"), false);
  assert.equal(source.includes("user-agent"), false);
  assert.equal(source.includes("NOTION_WAITLIST_DB_ID"), false);
  assert.ok(source.includes("NOTION_UX_DB_ID"));
});
