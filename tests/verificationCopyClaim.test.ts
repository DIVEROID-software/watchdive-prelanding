// The verify page must not tell a missing fragment that a newer email replaced
// the link, and reservation copy must not claim the mail was delivered.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RESERVATION_DETAILS_COPY } from "../src/components/reservation/details-copy.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { GENERIC_PENDING_MESSAGE } from "../src/lib/verification/contracts.ts";

const DELIVERED_CLAIM = /we sent|enviamos|envoy[ée]|gesendeten|gestuurd|보냈|发送了|發送了|送りました/i;

test("every locale has a missing-fragment verify state distinct from invalid", () => {
  const locales = Object.keys(FROZEN_LANDING_MESSAGES);
  assert.equal(locales.length, 10);
  for (const locale of locales) {
    const copy = FROZEN_LANDING_MESSAGES[locale as keyof typeof FROZEN_LANDING_MESSAGES].verify;
    assert.equal(typeof copy.missingTitle, "string", locale);
    assert.equal(copy.missingTitle.length > 0, true, locale);
    assert.equal(copy.missingBody.length > 0, true, locale);
    assert.notEqual(copy.missingTitle, copy.invalidTitle, locale);
    assert.notEqual(copy.missingBody, copy.invalidBody, locale);
    assert.equal(DELIVERED_CLAIM.test(copy.missingBody), false, locale);
    assert.equal(/instagram|facebook|인스타|페이스북/i.test(copy.missingBody), false, locale);
  }
  const route = readFileSync(new URL("../src/routes/verify.tsx", import.meta.url), "utf8");
  assert.equal(route.includes('setState("missing")'), true);
  assert.equal(route.includes("copy.missingTitle"), true);
});

test("pending copy does not claim the confirmation mail was delivered", () => {
  assert.equal(DELIVERED_CLAIM.test(GENERIC_PENDING_MESSAGE), false);
  for (const [locale, copy] of Object.entries(RESERVATION_DETAILS_COPY)) {
    assert.equal(DELIVERED_CLAIM.test(copy.noticePending), false, locale);
  }
});
