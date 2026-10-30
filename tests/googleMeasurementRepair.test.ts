import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rememberMeasurementChoice } from "../src/lib/consentRegion.ts";
import {
  attachVerifiedGoogleClient,
  tagLoadBlocked,
  trackGoogleLead,
  trackGoogleReservationPurchase,
  trackGoogleSubmit,
  verifyMeasurementUrlSafe,
  initGoogleTag,
} from "../src/lib/googleTag.ts";

const GA = { gaId: "G-ABC123XY" };
const EVENT_ID = "a".repeat(64);

function installBrowser(location: {
  pathname: string;
  search?: string;
  hash?: string;
  origin?: string;
  protocol?: string;
}) {
  const calls: unknown[][] = [];
  const scripts: { src?: string }[] = [];
  let cookie = "";
  const storage = new Map<string, string>();
  const windowValue = {
    dataLayer: [] as unknown[],
    gtag: (...args: unknown[]) => {
      calls.push(args);
    },
    location: {
      pathname: location.pathname,
      search: location.search ?? "",
      hash: location.hash ?? "",
      origin: location.origin ?? "https://watchdive.diveroid.com",
      protocol: location.protocol ?? "https:",
    },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
    __watchDiveGooglePageViewSent: false,
  };
  const documentValue = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      const pair = value.split(";")[0] ?? "";
      const name = pair.slice(0, pair.indexOf("="));
      const parts = cookie
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`));
      parts.push(pair);
      cookie = parts.join("; ");
    },
    getElementById: () => null,
    createElement: () => ({ id: "", async: false, src: "" }),
    head: {
      appendChild(node: { src?: string }) {
        scripts.push(node);
      },
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentValue });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: windowValue.localStorage,
  });
  rememberMeasurementChoice("granted");
  return {
    calls,
    scripts,
    storage,
    readCookie: () => cookie,
  };
}

function restoreBrowser() {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "navigator");
  rememberMeasurementChoice(null);
}

test("unsafe verify and reservation urls never count as measurement-safe", () => {
  assert.equal(verifyMeasurementUrlSafe({ pathname: "/verify", hash: "#token", search: "" }), false);
  assert.equal(
    verifyMeasurementUrlSafe({ pathname: "/ko/verify", hash: "", search: "?session_id=cs_test" }),
    false,
  );
  assert.equal(verifyMeasurementUrlSafe({ pathname: "/reservation", hash: "", search: "" }), false);
  assert.equal(
    tagLoadBlocked({ pathname: "/reservation", hash: "", search: "?session_id=cs_live_secret" }),
    true,
  );
  assert.equal(verifyMeasurementUrlSafe({ pathname: "/verify", hash: "", search: "" }), true);
  assert.equal(tagLoadBlocked({ pathname: "/ko/scuba", hash: "#offer", search: "?utm_source=ig" }), false);
});

test("verified browser sign_up fires once; pending, refusal, and the server flag do not", () => {
  const browser = installBrowser({ pathname: "/ko/scuba" });
  try {
    trackGoogleSubmit(EVENT_ID, "hero", GA);
    assert.deepEqual(
      browser.calls.map((call) => call[1]),
      ["signup_pending"],
    );
    trackGoogleLead(EVENT_ID, "hero", GA);
    trackGoogleLead(EVENT_ID, "hero", GA);
    assert.deepEqual(
      browser.calls.map((call) => call[1]),
      ["signup_pending", "generate_lead", "sign_up"],
    );
    const signup = browser.calls.find((call) => call[1] === "sign_up")?.[2] as {
      method: string;
      event_id: string;
    };
    assert.equal(signup.method, "email");
    assert.equal(signup.event_id, EVENT_ID);
    assert.equal(JSON.stringify(browser.calls).includes("@"), false);
    assert.equal(browser.storage.get(`wd.ga4.verified-signup.${EVENT_ID}`), "1");

    browser.calls.length = 0;
    const other = `b${"b".repeat(63)}`;
    trackGoogleLead(other, "hero", GA, { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" });
    assert.equal(browser.calls.length, 0);

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { globalPrivacyControl: true },
    });
    trackGoogleLead(`c${"c".repeat(63)}`, "hero", GA);
    trackGoogleSubmit(`c${"c".repeat(63)}`, "hero", GA);
    assert.equal(browser.calls.length, 0);
  } finally {
    restoreBrowser();
  }
});

test("reservation purchase does not fire while the Stripe session is in the url", () => {
  const browser = installBrowser({
    pathname: "/reservation",
    search: "?session_id=cs_test_secret",
  });
  try {
    const result = trackGoogleReservationPurchase(EVENT_ID, GA);
    initGoogleTag({ config: GA });
    assert.deepEqual(result, { ads: false, ga4: false });
    assert.equal(browser.calls.length, 0);
    assert.equal(browser.scripts.length, 0);
    assert.equal(browser.readCookie().includes("session_id"), false);
  } finally {
    restoreBrowser();
  }
});

test("verify client attachment is synchronous, refused while the flag is off, and mints only one safe id", () => {
  const browser = installBrowser({ pathname: "/verify", hash: "", search: "" });
  const originalTimeout = globalThis.setTimeout;
  let waits = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    waits += 1;
    return originalTimeout(...args);
  }) as typeof setTimeout;
  try {
    const off = attachVerifiedGoogleClient(
      { pathname: "/verify", hash: "", search: "", origin: "https://watchdive.diveroid.com", protocol: "https:" },
      { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "false" },
      GA,
    );
    assert.equal(off, false);
    assert.equal(browser.scripts.length, 0);
    assert.equal(waits, 0);

    const unsafe = attachVerifiedGoogleClient(
      { pathname: "/verify", hash: "#secret-token", search: "", origin: "https://watchdive.diveroid.com", protocol: "https:" },
      { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" },
      GA,
    );
    assert.equal(unsafe, false);
    assert.equal(browser.scripts.length, 0);

    const started = Date.now();
    const attached = attachVerifiedGoogleClient(
      { pathname: "/verify", hash: "", search: "", origin: "https://watchdive.diveroid.com", protocol: "https:" },
      { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" },
      GA,
    );
    assert.equal(attached, true);
    assert.ok(Date.now() - started < 50);
    assert.equal(waits, 0);
    assert.equal(browser.scripts.length, 1);
    assert.match(browser.scripts[0]?.src ?? "", /id=G-ABC123XY$/);
    assert.equal((browser.scripts[0]?.src ?? "").includes("session_id"), false);
    const cookieId = browser.readCookie().match(/_ga=GA1\.1\.(\d+\.\d+)/)?.[1];
    assert.match(cookieId ?? "", /^\d{10}\.\d{10}$/);
    const config = browser.calls.find((call) => call[0] === "config");
    assert.equal((config?.[2] as { client_id?: string }).client_id, cookieId);
    assert.equal(
      (config?.[2] as { page_location?: string }).page_location,
      "https://watchdive.diveroid.com/verify",
    );
    const pageView = browser.calls.find((call) => call[1] === "page_view");
    assert.equal((pageView?.[2] as { page_location?: string }).page_location, "https://watchdive.diveroid.com/verify");
    assert.equal(JSON.stringify(browser.calls).includes("session_id"), false);
    assert.equal(JSON.stringify(browser.calls).includes("#"), false);

    const again = attachVerifiedGoogleClient(
      { pathname: "/verify", hash: "", search: "", origin: "https://watchdive.diveroid.com", protocol: "https:" },
      { VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true" },
      GA,
    );
    assert.equal(again, false);
    assert.equal(browser.scripts.length, 1);
  } finally {
    globalThis.setTimeout = originalTimeout;
    restoreBrowser();
  }
});

test("verify does not send the landing sign_up fallback and confirmation is not delayed", () => {
  const verify = readFileSync(new URL("../src/routes/verify.tsx", import.meta.url), "utf8");
  const google = readFileSync(new URL("../src/lib/googleTag.ts", import.meta.url), "utf8");
  assert.equal(verify.includes("trackGoogleLead"), false);
  assert.equal(verify.includes("await attachVerifiedGoogleClient"), false);
  assert.equal(verify.includes("VERIFY_CLIENT_WAIT"), false);
  assert.equal(google.includes("AW-18370584790"), false);
  assert.equal(google.includes("VERIFY_CLIENT_WAIT_MS"), false);
  assert.match(verify, /void confirm\(\)/);
});
