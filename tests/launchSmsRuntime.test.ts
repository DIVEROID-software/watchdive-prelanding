import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  LAUNCH_SMS_LAUNCH_URL_TOKEN,
  LAUNCH_SMS_OPT_OUT_TOKEN,
  LAUNCH_SMS_PROVIDER_INSTALLED,
  LAUNCH_SMS_RESERVATION_URL_TOKEN,
} from "../src/lib/launchSms/copy.ts";
import {
  classifyLaunchSmsConsent,
  launchSmsCatalog,
  planLaunchSms,
  runLaunchSms,
  type LaunchSmsRecipient,
} from "../src/lib/launchSms/plan.ts";
import { EMAIL_FOOTER_PHONE_ENV, inspectSmsTransport } from "../src/lib/launchSms/provider.ts";
import { PHONE_CONSENT_VERSION } from "../src/lib/phoneOptInCopy.ts";

function grant(surface: "attempt" | "confirmation" = "attempt", locale = "en"): string {
  return JSON.stringify({
    version: PHONE_CONSENT_VERSION,
    at: "2026-10-28T00:00:00.000Z",
    locale,
    surface,
  });
}

const CONSENT = grant();

test("invalid stored consent timestamps refuse a preview without throwing", () => {
  const invalid = JSON.stringify({
    version: PHONE_CONSENT_VERSION,
    at: "2026-99-28T00:00:00.000Z",
    locale: "en",
    surface: "attempt",
  });
  assert.equal(classifyLaunchSmsConsent(invalid), "malformed");
});

function eligible(overrides: Partial<LaunchSmsRecipient> = {}): LaunchSmsRecipient {
  return {
    savedSignupLocale: "en",
    signupCountry: "US",
    segment: "scuba",
    phonePresent: true,
    smsConsent: CONSENT,
    consentRefused: false,
    gpc: false,
    unsubscribed: false,
    suspect: false,
    duplicate: false,
    qa: false,
    internal: false,
    emailVerified: true,
    payment: "unpaid",
    ...overrides,
  };
}

test("catalog previews nine locales and both variants with tokens intact", () => {
  const items = launchSmsCatalog();
  assert.equal(items.length, 18);
  assert.equal(SUPPORTED_LOCALES.length, 9);
  assert.equal(LAUNCH_SMS_PROVIDER_INSTALLED, false);
  for (const locale of SUPPORTED_LOCALES) {
    const launch = items.find((item) => item.locale === locale && item.variant === "launch");
    const paid = items.find((item) => item.locale === locale && item.variant === "paid-reserver");
    assert.ok(launch);
    assert.ok(paid);
    assert.equal(launch.sendable, false);
    assert.equal(paid.tokensUnresolved, true);
    assert.ok(launch.body.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN));
    assert.equal(launch.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN), false);
    assert.ok(paid.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN));
    assert.equal(paid.body.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN), false);
    assert.ok(launch.body.endsWith(LAUNCH_SMS_OPT_OUT_TOKEN));
    assert.ok(paid.body.includes("149"));
    assert.equal(paid.body.includes("200"), false);
    assert.equal(/coupon|쿠폰/i.test(launch.body + paid.body), false);
  }
});

test("an eligible unpaid recipient dry-runs the public copy and does not send", () => {
  const run = runLaunchSms(eligible(), { mode: "dry-run", envNames: [] });
  assert.equal(run.sent, false);
  assert.equal(run.network, false);
  assert.equal(run.outcome, "dry_run");
  assert.equal(run.variant, "launch");
  assert.ok(run.body?.includes("100"));
  assert.ok(run.body?.includes(LAUNCH_SMS_LAUNCH_URL_TOKEN));
  assert.ok(run.blocks.includes("launch_link_unknown"));
  assert.ok(run.blocks.includes("provider_unconfigured"));
  assert.ok(run.blocks.includes("send_disabled"));
  assert.equal(run.blocks.includes("reservation_link_unknown"), false);
});

test("a live payer gets the private variant, and a test payment does not", () => {
  const paid = planLaunchSms(
    eligible({ payment: "live", savedSignupLocale: "ko", signupCountry: "KR" }),
  );
  assert.equal(paid.decision, "dry_run");
  assert.equal(paid.sendable, false);
  assert.equal(paid.variant, "paid-reserver");
  assert.equal(paid.draft?.koreanMarketingPrefix, true);
  assert.ok(paid.draft?.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN));
  assert.ok(paid.blocks.includes("reservation_link_unknown"));
  assert.equal(paid.draft?.body.includes("200"), false);
  const testPayment = planLaunchSms(eligible({ payment: "test" }));
  assert.equal(testPayment.variant, "launch");
  assert.equal(testPayment.draft?.body.includes(LAUNCH_SMS_RESERVATION_URL_TOKEN), false);
});

test("segment does not change the body", () => {
  const scuba = planLaunchSms(eligible({ segment: "scuba" }));
  const freediving = planLaunchSms(eligible({ segment: "freediving" }));
  assert.equal(scuba.draft?.body, freediving.draft?.body);
});

test("row stops and a bad consent cell produce no draft", () => {
  const cases: Array<[Partial<LaunchSmsRecipient>, string]> = [
    [{ consentRefused: true }, "consent_refused"],
    [{ unsubscribed: true }, "unsubscribed"],
    [{ suspect: true }, "suspect"],
    [{ duplicate: true }, "duplicate"],
    [{ qa: true }, "qa"],
    [{ internal: true }, "internal"],
    [{ phonePresent: false }, "no_phone"],
    [{ smsConsent: "no" }, "consent_malformed"],
    [{ smsConsent: `notice ${PHONE_CONSENT_VERSION} saved` }, "consent_malformed"],
    [{ smsConsent: null }, "consent_missing"],
    [{ smsConsent: "  " }, "consent_missing"],
    [{ payment: "unreadable" }, "payment_unreadable"],
  ];
  for (const [overrides, block] of cases) {
    const plan = planLaunchSms(eligible(overrides));
    assert.equal(plan.decision, "refuse", block);
    assert.equal(plan.draft, null, block);
    assert.equal(plan.sendable, false);
    assert.ok(plan.blocks.includes(block as never), block);
    assert.equal(plan.blocks.includes("gpc" as never), false, block);
    const run = runLaunchSms(eligible(overrides), { mode: "send" });
    assert.equal(run.body, null);
    assert.equal(run.sent, false);
    assert.equal(run.network, false);
  }
});

test("an explicit SMS grant still previews when analytics consent is missing or refused", () => {
  const inputs: LaunchSmsRecipient[] = [
    eligible({
      gpc: true,
      measurement: "denied",
      consentRefused: undefined,
      emailVerified: false,
      smsConsent: grant("attempt"),
    }),
    eligible({
      gpc: undefined,
      measurement: "unknown",
      emailVerified: undefined,
      smsConsent: grant("attempt", "ko"),
      savedSignupLocale: "ko",
      signupCountry: "KR",
    }),
    eligible({
      gpc: true,
      measurement: "withdrawn",
      emailVerified: false,
      smsConsent: grant("confirmation"),
    }),
  ];
  for (const recipient of inputs) {
    const plan = planLaunchSms(recipient);
    assert.equal(plan.decision, "dry_run");
    assert.equal(plan.sendable, false);
    assert.ok(plan.draft);
    assert.equal(plan.blocks.includes("consent_refused"), false);
    assert.equal(plan.blocks.includes("consent_missing"), false);
    assert.equal(plan.blocks.includes("consent_withdrawn"), false);
    const run = runLaunchSms(recipient, {
      mode: "send",
      env: { WATCHDIVE_LAUNCH_SMS_SEND: "true" },
    });
    assert.equal(run.outcome, "blocked");
    assert.equal(run.sent, false);
    assert.equal(run.network, false);
  }
  const korean = planLaunchSms(inputs[1]);
  assert.equal(korean.draft?.koreanMarketingPrefix, true);
});

test("an actual SMS refusal wins over a stored grant", () => {
  const plan = planLaunchSms(eligible({ consentRefused: true, gpc: false, emailVerified: true }));
  assert.equal(plan.decision, "refuse");
  assert.equal(plan.draft, null);
  assert.ok(plan.blocks.includes("consent_refused"));
  assert.equal(plan.blocks.includes("consent_missing"), false);
  assert.equal(classifyLaunchSmsConsent(CONSENT), "granted");
});

test("a withdrawn marker that still contains the version is not a grant", () => {
  const marker = `${PHONE_CONSENT_VERSION}:withdrawn`;
  const embedded = JSON.stringify({
    version: PHONE_CONSENT_VERSION,
    at: "2026-10-28T00:00:00.000Z",
    locale: "en",
    surface: "attempt",
    withdrawn: true,
  });
  const versionField = JSON.stringify({
    version: marker,
    at: "2026-10-28T00:00:00.000Z",
    locale: "en",
    surface: "attempt",
  });
  const status = JSON.stringify({ version: PHONE_CONSENT_VERSION, status: "withdrawn" });
  for (const smsConsent of [marker, embedded, versionField, status]) {
    assert.equal(classifyLaunchSmsConsent(smsConsent), "withdrawn", smsConsent);
    const plan = planLaunchSms(eligible({ smsConsent, gpc: false, emailVerified: true }));
    assert.equal(plan.decision, "refuse");
    assert.equal(plan.draft, null);
    assert.ok(plan.blocks.includes("consent_withdrawn"));
  }
});

test("malformed consent is refused, including a version substring and a short timestamp", () => {
  const incomplete = JSON.stringify({
    version: PHONE_CONSENT_VERSION,
    at: "2026-10-28T00:00:00.000Z",
  });
  const shortTime = JSON.stringify({
    version: PHONE_CONSENT_VERSION,
    at: "2026-10-28T00:00:00Z",
    locale: "en",
    surface: "attempt",
  });
  const wrongVersion = grant().replace(PHONE_CONSENT_VERSION, "WD-SMS-CONSENT-V1");
  for (const smsConsent of [
    incomplete,
    shortTime,
    wrongVersion,
    "{",
    "[]",
    `{"version":"${PHONE_CONSENT_VERSION}"}`,
  ]) {
    assert.equal(classifyLaunchSmsConsent(smsConsent), "malformed", smsConsent);
    const plan = planLaunchSms(eligible({ smsConsent }));
    assert.equal(plan.draft, null);
    assert.ok(plan.blocks.includes("consent_malformed"));
  }
});

test("send mode and a named provider still make no network call", () => {
  let called = 0;
  const fetchImpl = () => {
    called += 1;
    throw new Error("network");
  };
  const run = runLaunchSms(eligible(), {
    mode: "send",
    envNames: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", EMAIL_FOOTER_PHONE_ENV],
    env: { WATCHDIVE_LAUNCH_SMS_SEND: "true" },
    fetchImpl,
  });
  assert.equal(called, 0);
  assert.equal(run.sent, false);
  assert.equal(run.network, false);
  assert.equal(run.outcome, "blocked");
  assert.ok(run.blocks.includes("provider_not_implemented"));
  assert.equal(run.blocks.includes("send_disabled"), false);
  assert.equal(run.blocks.includes("provider_unconfigured"), false);
  assert.equal(inspectSmsTransport([EMAIL_FOOTER_PHONE_ENV]).transport, "none");
  assert.equal(inspectSmsTransport([EMAIL_FOOTER_PHONE_ENV]).emailFooterPhoneKeyPresent, true);
  assert.equal(inspectSmsTransport([]).adapterImplemented, false);
});
