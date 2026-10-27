import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getAttribution, clearStoredClickIds } from "../src/lib/attribution.ts";
import { CONSENT_STORAGE_KEY, rememberMeasurementChoice } from "../src/lib/consentRegion.ts";
import type { CompetitionRound } from "../src/lib/competitionRegistry.ts";

const originals = new Map(
  ["window", "document", "localStorage", "navigator"].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ]),
);
afterEach(() => {
  rememberMeasurementChoice(null);
  for (const [k, v] of originals) {
    if (v) Object.defineProperty(globalThis, k, v);
    else Reflect.deleteProperty(globalThis, k);
  }
});
function browser(choice: string | null, country = "DE", gpc = false) {
  const values: Record<string, string> = {};
  const storage = Object.create(null);
  Object.defineProperties(storage, {
    getItem: { value: (k: string) => values[k] ?? null },
    setItem: {
      value: (k: string, v: string) => {
        values[k] = v;
        Object.defineProperty(storage, k, { value: v, enumerable: true, configurable: true });
      },
    },
    removeItem: {
      value: (k: string) => {
        delete values[k];
        delete storage[k];
      },
    },
  });
  if (choice) storage.setItem(CONSENT_STORAGE_KEY, choice);
  for (const [key, value] of Object.entries({
    window: {
      localStorage: storage,
      location: {
        search:
          "?fbclid=click1&gclid=click2&gbraid=click3&wbraid=click4&ttclid=click5&utm_source=meta",
        pathname: "/ko",
      },
    },
    localStorage: storage,
    document: { cookie: `wd_geo=${country}` },
    navigator: { globalPrivacyControl: gpc },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  return storage as Storage;
}
function assertNoClicks(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /fbclid|gclid|gbraid|wbraid|ttclid|capturedAt|click[1-5]/,
  );
}
test("unknown region, rejected consent and GPC never persist or return click IDs", () => {
  for (const [choice, country, gpc] of [
    [null, "XX", false],
    [null, "DE", false],
    ["denied", "KR", false],
    ["granted", "US", true],
  ] as const) {
    const storage = browser(choice, country, gpc);
    storage.setItem(
      "wd_attr",
      JSON.stringify({ fbclid: "oldclick", gclid: "oldgoogle", capturedAt: 1, utmSource: "meta" }),
    );
    assertNoClicks(getAttribution([]));
    assertNoClicks(storage.getItem("wd_attr"));
  }
});
test("allowed consent captures clicks; withdrawal clears legacy and retired competition storage", () => {
  const storage = browser("granted");
  assert.equal(getAttribution([]).fbclid, "click1");
  storage.setItem(
    "wd_competition_attr_v1:retired:round",
    JSON.stringify({
      version: 1,
      attribution: { fbclid: "click1", capturedAt: 1, utmCampaign: "round" },
    }),
  );
  storage.setItem("unrelated", "keep");
  clearStoredClickIds();
  assertNoClicks(storage.getItem("wd_attr"));
  assertNoClicks(storage.getItem("wd_competition_attr_v1:retired:round"));
  assert.equal(storage.getItem("unrelated"), "keep");
  storage.setItem(CONSENT_STORAGE_KEY, "denied");
  assertNoClicks(getAttribution([]));
});
test("competition capture also strips click IDs before writing its scoped envelope", () => {
  const storage = browser("denied");
  const now = Date.now();
  const round = {
    experimentId: "qa",
    roundId: "round",
    campaignId: "101",
    captureStartsAt: new Date(now - 1000).toISOString(),
    signupStartsAt: new Date(now).toISOString(),
    signupEndsAt: new Date(now + 60000).toISOString(),
    ads: [{ adId: "301", adsetId: "201", armId: "A", strategyVersion: "v1" }],
  } as CompetitionRound;
  window.location.search = "?utm_campaign=101&utm_term=201&utm_content=301&fbclid=click1";
  assertNoClicks(getAttribution([round]));
  assertNoClicks(storage.getItem("wd_competition_attr_v1:qa:round"));
});
test("storage failure preserves a runtime refusal and returns no click identifiers", () => {
  browser(null, "US");
  rememberMeasurementChoice("denied");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  assertNoClicks(getAttribution([]));
});

test("an in-memory refusal wins over a stale stored grant after a failed write", () => {
  browser("granted", "US");
  rememberMeasurementChoice("denied");
  assertNoClicks(getAttribution([]));
});

test("token-safe browser context reads only an existing consented GA cookie", async () => {
  const { googleBrowserContext } = await import("../src/lib/analytics/browserContext.ts");
  browser("granted");
  document.cookie = "wd_geo=DE; _ga=GA1.1.123.456";
  assert.deepEqual(googleBrowserContext(), { measurementConsent: true, googleClientId: "123.456" });
  browser("denied");
  document.cookie = "wd_geo=US; _ga=GA1.1.123.456";
  assert.deepEqual(googleBrowserContext(), { measurementConsent: false });
  browser("granted", "US", true);
  document.cookie = "wd_geo=US; _ga=GA1.1.123.456";
  assert.deepEqual(googleBrowserContext(), { measurementConsent: false });
});
