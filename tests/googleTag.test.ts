import assert from "node:assert/strict";
import test from "node:test";

import {
  googleConsentChoice,
  googleTagBootstrap,
  isGoogleEventId,
  isGoogleTagConfigured,
  readGoogleTagConfig,
  trackGoogleDurableSignup,
  trackGoogleFormStart,
  trackGoogleLead,
  trackGoogleReservationPurchase,
  trackGoogleSubmit,
} from "../src/lib/googleTag.ts";
import { rememberMeasurementChoice } from "../src/lib/consentRegion.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";

test("google ids that are blank or malformed configure nothing", () => {
  assert.deepEqual(readGoogleTagConfig({}), {});
  assert.deepEqual(
    readGoogleTagConfig({
      VITE_GA_MEASUREMENT_ID: "UA-123",
      VITE_GOOGLE_ADS_ID: "G-ABCD12",
      VITE_GOOGLE_ADS_CONVERSION_LABEL: "label",
    }),
    {},
  );
  assert.equal(isGoogleTagConfigured({}), false);
});

test("a real GA4 id and ads id are kept, and the label needs an ads id", () => {
  const config = readGoogleTagConfig({
    VITE_GA_MEASUREMENT_ID: "G-ABC123XY",
    VITE_GOOGLE_ADS_ID: "AW-123456789",
    VITE_GOOGLE_ADS_CONVERSION_LABEL: "AbC_d-1",
  });
  assert.deepEqual(config, {
    gaId: "G-ABC123XY",
    adsId: "AW-123456789",
    adsLabel: "AbC_d-1",
  });
  assert.equal(
    readGoogleTagConfig({ VITE_GOOGLE_ADS_CONVERSION_LABEL: "AbC_d-1" }).adsLabel,
    undefined,
  );
});

test("Google storage stays off until Allow, and Global Privacy Control overrides Allow", () => {
  assert.equal(googleConsentChoice({ stored: null, gpc: false }), "denied");
  assert.equal(googleConsentChoice({ stored: "granted", gpc: false }), "granted");
  assert.equal(googleConsentChoice({ stored: "denied", gpc: false }), "denied");
  assert.equal(googleConsentChoice({ stored: "granted", gpc: true }), "denied");
  assert.equal(googleConsentChoice({ stored: null, gpc: true }), "denied");
});

test("the bootstrap is empty without ids and refuses a denied browser", () => {
  assert.equal(googleTagBootstrap({}), "");
  const snippet = googleTagBootstrap({ gaId: "G-ABC123XY", adsId: "AW-123456789" });
  assert.match(snippet, /consent","default"/);
  assert.match(snippet, /ad_storage:"denied"/);
  // The shared regional rule gates the loader (see consentRegion.ts).
  assert.match(snippet, /if\(!\(function\(\)\{/);
  assert.match(snippet, /s==="denied"\)return false/);
  assert.match(snippet, /globalPrivacyControl===true\)return false/);
  assert.match(snippet, /wd_geo=/);
  assert.match(snippet, /G-ABC123XY/);
  assert.match(snippet, /AW-123456789/);
  assert.equal(snippet.includes("generate_lead"), false);
});

test("a 64-hex id and its :phone suffix are event ids; 81 characters is not", () => {
  const id = "a".repeat(64);
  assert.equal(isGoogleEventId(id), true);
  assert.equal(isGoogleEventId(`${id}:phone`), true);
  assert.equal(`${id}:phone`.length, 70);
  assert.equal(isGoogleEventId("a".repeat(81)), false);
  assert.equal(isGoogleEventId("short"), false);
});

test("signup and purchase labels stay off the confirmed-email conversion", () => {
  assert.deepEqual(
    readGoogleTagConfig({
      VITE_GOOGLE_ADS_SIGNUP_LABEL: "SignupLab1",
      VITE_GOOGLE_ADS_PURCHASE_LABEL: "PurchLab01",
    }),
    {},
  );
  const config = readGoogleTagConfig({
    VITE_GA_MEASUREMENT_ID: "G-ABC123XY",
    VITE_GOOGLE_ADS_ID: "AW-123456789",
    VITE_GOOGLE_ADS_CONVERSION_LABEL: "EmailLab1",
    VITE_GOOGLE_ADS_SIGNUP_LABEL: "SignupLab1",
    VITE_GOOGLE_ADS_PURCHASE_LABEL: "PurchLab01",
  });
  assert.equal(config.adsLabel, "EmailLab1");
  assert.equal(config.signupLabel, "SignupLab1");
  assert.equal(config.purchaseLabel, "PurchLab01");

  const calls: unknown[][] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let consent = "granted";
  const installWindow = (next: string) => {
    consent = next;
    const storage = { getItem: () => consent };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dataLayer: [],
        gtag: (...args: unknown[]) => calls.push(args),
        location: { pathname: "/ko/scuba" },
        localStorage: storage,
      },
    });
    // Shared consent reads window.localStorage. Keep the page global in step.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
  };
  rememberMeasurementChoice(null);
  installWindow("granted");
  try {
    const eventId = "a".repeat(64);
    trackGoogleFormStart("hero", config);
    trackGoogleSubmit(eventId, "hero", config);
    trackGoogleLead(eventId, "hero", config);
    assert.equal(trackGoogleDurableSignup(eventId, config), true);
    const purchase = trackGoogleReservationPurchase(eventId, config);
    assert.deepEqual(purchase, { ads: true, ga4: true });
    const names = calls.map((call) => call[1]);
    assert.deepEqual(names, ["form_start", "signup_pending", "generate_lead", "conversion", "conversion", "purchase", "conversion"]);
    const encoded = JSON.stringify(calls);
    assert.match(encoded, /"form_id":"hero"/);
    assert.match(encoded, /"send_to":"AW-123456789\/EmailLab1"/);
    assert.match(encoded, /"send_to":"AW-123456789\/SignupLab1"/);
    assert.match(encoded, /"send_to":"AW-123456789\/PurchLab01"/);
    assert.match(encoded, /"transaction_id":"a{64}"/);
    assert.equal(encoded.includes("@"), false);
    const confirmed = calls[3];
    assert.equal(confirmed?.[1], "conversion");
    assert.equal((confirmed?.[2] as { send_to: string }).send_to, "AW-123456789/EmailLab1");

    calls.length = 0;
    assert.deepEqual(trackGoogleReservationPurchase(eventId, { gaId: "G-ABC123XY" }), {
      ads: false,
      ga4: true,
    });
    assert.deepEqual(calls.map((call) => call[1]), ["purchase"]);

    calls.length = 0;
    assert.deepEqual(
      trackGoogleReservationPurchase(eventId, config, {
        VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      }),
      { ads: true, ga4: false },
    );
    assert.deepEqual(calls.map((call) => call[1]), ["conversion"]);
    assert.equal(
      (calls[0]?.[2] as { send_to?: string }).send_to,
      "AW-123456789/PurchLab01",
    );
    calls.length = 0;
    assert.deepEqual(
      trackGoogleReservationPurchase(eventId, { gaId: "G-ABC123XY" }, {
        VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
      }),
      { ads: false, ga4: false },
    );
    assert.equal(calls.length, 0);
    calls.length = 0;
    assert.deepEqual(
      trackGoogleReservationPurchase(eventId, config, {
        VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false",
      }),
      { ads: true, ga4: true },
    );
    assert.deepEqual(calls.map((call) => call[1]), ["purchase", "conversion"]);

    calls.length = 0;
    const verifiedId = `c${"a".repeat(63)}`;
    trackGoogleLead(verifiedId, "hero", config);
    trackGoogleLead(verifiedId, "hero", config);
    assert.deepEqual(calls.map((call) => call[1]), ["generate_lead", "conversion", "conversion"]);

    calls.length = 0;
    const serverId = `d${"a".repeat(63)}`;
    trackGoogleSubmit(serverId, "offer", config);
    trackGoogleLead(serverId, "offer", config, { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" });
    assert.deepEqual(calls.map((call) => call[1]), ["signup_pending", "conversion"]);

    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { globalPrivacyControl: true },
      });
      calls.length = 0;
      trackGoogleSubmit(serverId, "hero", config);
      trackGoogleLead(verifiedId, "hero", config);
      assert.equal(calls.length, 0);
    } finally {
      if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }

    calls.length = 0;
    installWindow("denied");
    trackGoogleSubmit(eventId, "hero", config);
    trackGoogleLead(eventId, "hero", config);
    assert.equal(trackGoogleDurableSignup(eventId, config), false);
    assert.deepEqual(trackGoogleReservationPurchase(eventId, config), { ads: false, ga4: false });
    assert.equal(calls.length, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    rememberMeasurementChoice(null);
  }

  const snippet = googleTagBootstrap(config);
  assert.equal(snippet.includes("SignupLab1"), false);
  assert.equal(snippet.includes("PurchLab01"), false);
  assert.equal(snippet.includes("EmailLab1"), false);
});

test("the confirmation page still loads no third-party tag", () => {
  assert.equal(allowsThirdPartyScripts("/verify"), false);
  assert.equal(allowsThirdPartyScripts("/ko/verify"), false);
  assert.equal(allowsThirdPartyScripts("/"), true);
  assert.equal(allowsThirdPartyScripts("/admin/behavior"), false);
});

test("server signup rollout is explicit; the default retains the existing verified-lead fallback", async () => {
  const { serverSignupMeasurementEnabled } = await import("../src/lib/googleTag.ts");
  assert.equal(serverSignupMeasurementEnabled({}), false);
  assert.equal(
    serverSignupMeasurementEnabled({ VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" }),
    true,
  );
  assert.equal(serverSignupMeasurementEnabled({ VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false" }), false);
});
