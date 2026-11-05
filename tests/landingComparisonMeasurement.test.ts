import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { SUPPORTED_LOCALES, localizePath } from "../src/lib/i18n/locale.ts";
import * as locale from "../src/lib/i18n/locale.ts";
import * as navigation from "../src/lib/segments/navigation.ts";
import * as contract from "../src/lib/segments/measurementContract.ts";
import * as comparison from "../src/lib/landingComparisonAttribution.ts";
import {
  landingComparisonRegistry,
  type LandingComparisonRun,
} from "../src/lib/landingComparisonRegistry.ts";
import {
  readAttribution,
  getAttribution,
  sanitizeSignupAttribution,
  clearStoredClickIds,
  toLeadAttribution,
} from "../src/lib/attribution.ts";
import {
  parseLeadExperiment,
  encodeLeadExperiment,
  persistableExperimentContext,
} from "../src/lib/conversionExperimentContract.ts";
import { resolveReservationEmailSegment } from "../src/lib/reservation-mail/segment.ts";
import { safeMeasurementPath } from "../src/lib/referral/measurement.ts";
import { CONSENT_STORAGE_KEY, rememberMeasurementChoice } from "../src/lib/consentRegion.ts";
const run: LandingComparisonRun = {
  phaseId: "fixture-my-comparison",
  campaignId: "900000000000000001",
  captureStartsAt: "2026-11-06T00:00:00Z",
  captureEndsAt: "2026-11-11T01:00:00Z",
  signupStartsAt: "2026-11-06T01:00:00Z",
  signupEndsAt: "2026-11-13T01:00:00Z",
  arms: [
    { arm: "control", adsetId: "900000000000000002", adIds: ["900000000000000003"] },
    { arm: "launch", adsetId: "900000000000000004", adIds: ["900000000000000005"] },
  ],
};
const NOW = Date.parse("2026-11-07T00:00:00Z");
const query = (arm = 0) =>
  `?utm_source=meta&utm_medium=paid_social&utm_campaign=${run.campaignId}&utm_term=${run.arms[arm].adsetId}&utm_content=${run.arms[arm].adIds[0]}`;
const raw = (arm = 0) => ({
  utmCampaign: run.campaignId,
  utmTerm: run.arms[arm].adsetId,
  utmContent: run.arms[arm].adIds[0],
});
function storage() {
  const m = new Map<string, string>();
  const out = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
      Object.defineProperty(out, k, { value: v, configurable: true, enumerable: true });
    },
    removeItem: (k: string) => {
      m.delete(k);
      delete (out as Record<string, unknown>)[k];
    },
  };
  return { api: out, map: m };
}

test("comparison mapping contains no invented production IDs; explicit complete operator registry is required", () => {
  assert.ok(comparison.validLandingComparisonRegistry(landingComparisonRegistry));
  assert.ok(
    landingComparisonRegistry.every(
      (entry) => !entry.phaseId.startsWith("fixture") && entry.campaignId !== run.campaignId,
    ),
  );
  assert.ok(comparison.validLandingComparisonRegistry([run]));
  for (const invalid of [
    { ...run, signupEndsAt: run.signupStartsAt },
    { ...run, captureStartsAt: "2026-11-07T00:00:00" },
    { ...run, arms: [run.arms[0], run.arms[0]] },
    { ...run, arms: [run.arms[0], { ...run.arms[1], adIds: [run.campaignId] }] },
    { ...run, campaignId: "{{campaign.id}}" },
  ])
    assert.equal(comparison.validLandingComparisonRegistry([invalid]), false);
  assert.equal(comparison.validLandingComparisonRegistry([run, run]), false);
});

test("both exact long-ID tuples require their matching real route in all locales", () => {
  for (const lang of SUPPORTED_LOCALES)
    for (const segment of ["scuba", "freediving"]) {
      for (let arm = 0; arm < 2; arm++) {
        const path = localizePath(`${arm ? "/launch" : ""}/${segment}`, lang);
        assert.equal(
          comparison.acceptsLandingComparisonCapture({ ...raw(arm), landingPath: path }, NOW, [
            run,
          ]),
          true,
        );
        assert.equal(
          comparison.acceptsLandingComparisonCapture({ ...raw(1 - arm), landingPath: path }, NOW, [
            run,
          ]),
          false,
        );
        assert.equal(resolveReservationEmailSegment(path), segment);
        assert.equal(safeMeasurementPath(path), `${arm ? "/launch" : ""}/${segment}`);
      }
    }
  for (const path of [
    "/launch/other",
    "/unknown/launch/scuba",
    "/launch/scuba/evil",
    "/launch/scuba?arm=control",
    "https://evil.test/launch/scuba",
    "//launch/scuba",
  ])
    assert.equal(
      comparison.acceptsLandingComparisonCapture({ ...raw(1), landingPath: path }, NOW, [run]),
      false,
      path,
    );
  assert.equal(
    comparison.matchLandingComparison(raw(), Date.parse(run.signupEndsAt), [run]),
    undefined,
  );
  assert.equal(
    comparison.matchLandingComparison(raw(), Date.parse(run.captureStartsAt) - 1, [run]),
    undefined,
  );
});

test("fresh comparison first touch survives language/segment changes, storage corruption never grants a tuple", () => {
  const st = storage();
  const incoming = readAttribution(query(1), "/launch/scuba", NOW);
  const first = comparison.resolveLandingComparisonAttribution({
    incoming,
    rawTuple: raw(1),
    now: NOW,
    registry: [run],
    storage: st.api,
  });
  assert.equal(first.kind, "comparison");
  if (first.kind !== "comparison") throw Error("fixture");
  assert.equal(first.attribution.utmCampaign, "900000000000000001");
  assert.equal(first.attribution.utmContent, "900000000000000005");
  const next = comparison.resolveLandingComparisonAttribution({
    incoming: { landingPath: "/zh-tw/launch/freediving" },
    rawTuple: {},
    now: NOW + 1000,
    registry: [run],
    storage: st.api,
  });
  assert.deepEqual(next, first);
  const crossed = comparison.resolveLandingComparisonAttribution({
    incoming: readAttribution(query(), "/scuba", NOW + 2000),
    rawTuple: raw(),
    now: NOW + 2000,
    registry: [run],
    storage: st.api,
  });
  assert.deepEqual(crossed, first); // first touch is not reassigned by a second arm click
  const other = comparison.resolveLandingComparisonAttribution({
    incoming: { utmCampaign: "unrelated", landingPath: "/scuba" },
    rawTuple: { utmCampaign: "unrelated" },
    now: NOW + 3000,
    registry: [run],
    storage: st.api,
  });
  assert.equal(other.kind, "none");
  st.api.setItem(
    comparison.landingComparisonStorageKey(run),
    JSON.stringify({
      version: 1,
      phaseId: run.phaseId,
      firstTouchAt: NOW,
      attribution: { ...incoming, utmContent: run.arms[0].adIds[0] },
    }),
  );
  assert.equal(
    comparison.resolveLandingComparisonAttribution({
      incoming: { landingPath: "/launch/scuba" },
      rawTuple: {},
      now: NOW + 4000,
      registry: [run],
      storage: st.api,
    }).kind,
    "none",
  );
  const bad = comparison.resolveLandingComparisonAttribution({
    incoming,
    rawTuple: { ...raw(1), utmTerm: undefined },
    now: NOW,
    registry: [run],
  });
  assert.equal(bad.kind, "rejected");
});

test("server boundary rejects malformed, expired and path-mismatched new tuples without blocking signup", () => {
  const valid = {
    ...raw(1),
    utmSource: "meta",
    utmMedium: "paid_social",
    landingPath: "/launch/scuba",
  };
  assert.deepEqual(sanitizeSignupAttribution(valid, NOW, [], [run]), valid);
  for (const bad of [
    { ...valid, utmContent: run.arms[0].adIds[0] },
    { ...valid, utmTerm: "bad" },
    { ...valid, landingPath: "/scuba" },
    { ...valid, utmCampaign: `${run.campaignId}<` },
  ]) {
    const clean = sanitizeSignupAttribution(bad, NOW, [], [run]);
    assert.equal(clean.utmCampaign, undefined);
    assert.equal(clean.landingPath, bad.landingPath);
  }
  assert.equal(
    sanitizeSignupAttribution(valid, Date.parse(run.signupEndsAt), [], [run]).utmCampaign,
    undefined,
  );
});

test("actual getAttribution scopes away old campaign, preserves consent, strips click IDs from CRM", () => {
  const originals = Object.fromEntries(
    ["window", "location", "document", "navigator", "localStorage"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  const oldNow = Date.now,
    st = storage();
  Date.now = () => NOW;
  try {
    const location = { pathname: "/launch/scuba", search: query(1) + "&fbclid=fixture-click" };
    for (const [key, value] of Object.entries({
      window: { location, localStorage: st.api },
      location,
      document: { cookie: "wd_geo=MY" },
      navigator: { globalPrivacyControl: false },
      localStorage: st.api,
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    rememberMeasurementChoice(null);
    st.api.setItem(
      "wd_attr",
      JSON.stringify({ utmCampaign: "historic-other", utmSource: "meta", landingPath: "/scuba" }),
    );
    const attr = getAttribution([], [run]);
    assert.equal(attr.utmCampaign, run.campaignId);
    assert.equal(attr.fbclid, "fixture-click");
    assert.equal(toLeadAttribution(attr).fbclid, undefined);
    assert.equal(JSON.parse(st.api.getItem("wd_attr")!).utmCampaign, "historic-other");
    location.pathname = "/ja/launch/freediving";
    location.search = "";
    assert.equal(getAttribution([], [run]).utmCampaign, run.campaignId);
    st.api.setItem(CONSENT_STORAGE_KEY, "denied");
    clearStoredClickIds();
    assert.equal(getAttribution([], [run]).fbclid, undefined);
    assert.equal(
      JSON.parse(st.api.getItem(comparison.landingComparisonStorageKey(run))!).attribution.fbclid,
      undefined,
    );
  } finally {
    Date.now = oldNow;
    for (const [k, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else delete (globalThis as Record<string, unknown>)[k];
    }
    rememberMeasurementChoice(null);
  }
});

function browser(pathname: string, search: string, permission = true) {
  const session = storage(),
    local = storage(),
    location = { hostname: "watchdive.diveroid.com", pathname, search };
  const win = Object.assign(new EventTarget(), {
    __wdLandingVariant: "form_first",
    __wdLandingQa: false,
  });
  const source = readFileSync(
    new URL("../src/lib/conversionExperimentClient.ts", import.meta.url),
    "utf8",
  ).replace("import.meta.env?.VITE_CONVERSION_EXPERIMENT_ENABLED", '"true"');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => any> = {};
  let allow = permission;
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name.includes("consentRegion")) return { measurementAllowed: () => allow };
      if (name.includes("competitionRegistry")) return { competitionRegistry: [] };
      if (name.includes("landingComparisonAttribution"))
        return {
          matchLandingComparison: (raw: any, now: number) =>
            comparison.matchLandingComparison(raw, now, [run]),
        };
      if (name.includes("segments/navigation")) return navigation;
      if (name.includes("measurementContract")) return contract;
      if (name.includes("i18n/locale")) return locale;
      throw Error("Unknown fixture dependency");
    },
    window: win,
    document: { visibilityState: "visible" },
    location,
    sessionStorage: session.api,
    localStorage: local.api,
    crypto: webcrypto,
    URLSearchParams,
    Event,
    Date: { now: () => NOW },
  });
  return {
    api: exports,
    location,
    session,
    permit: (v: boolean) => {
      allow = v;
    },
  };
}

test("actual client freezes first layout/IDs, flags layout crossover, and starts fresh for a new registered run", () => {
  const b = browser("/scuba", "");
  const prior = b.api.getConversionExperiment();
  assert.equal(prior.layoutRevision, "segments-v1");
  b.location.pathname = "/launch/scuba";
  b.location.search = query(1);
  const c = b.api.getConversionExperiment();
  assert.notEqual(c.sessionId, prior.sessionId);
  assert.equal(c.layoutRevision, "airy-v1");
  assert.equal(c.attribution.campaignId, run.campaignId);
  b.location.pathname = "/zh-tw/launch/freediving";
  b.location.search = "";
  assert.equal(b.api.getConversionExperiment(), c);
  assert.equal(b.api.getConversionFunnel().placements.crossedSegment, true);
  b.location.pathname = "/scuba";
  assert.equal(b.api.getConversionExperiment(), c);
  assert.equal(b.api.getConversionFunnel().placements.crossedLayout, true);
  assert.deepEqual(
    parseLeadExperiment(encodeLeadExperiment(c)!).context,
    JSON.parse(JSON.stringify(c)),
  );
  const gate = { measurementConsent: true, suspect: false, blocked: false };
  assert.ok(persistableExperimentContext(c, gate));
  assert.equal(persistableExperimentContext(c, { ...gate, suspect: true }), undefined);
  b.permit(false);
  b.api.revokeConversionExperiment();
  assert.equal(b.api.getConversionExperiment(), undefined);
  b.permit(true);
  assert.equal(b.api.getConversionExperiment(), undefined);
});

test("denied, unknown routes and preview QA do not become eligible real exposures", () => {
  assert.equal(browser("/launch/scuba", query(1), false).api.getConversionExperiment(), undefined);
  const b = browser("/unknown/launch/scuba", query(1));
  // Root bootstrap's legacy marker can exist globally; it must not manufacture segment context.
  assert.notEqual(b.api.getConversionExperiment()?.experimentId, contract.SEGMENT_MEASUREMENT_ID);
  const preview = browser("/launch/scuba", query(1));
  preview.location.hostname = "127.0.0.1";
  assert.equal(preview.api.getConversionExperiment()?.qa, true);
});

test("capture end stops new visits while prior first touch survives delayed signup and separate verification window", () => {
  const st = storage();
  const beforeEnd = Date.parse(run.captureEndsAt) - 1000;
  const afterEnd = Date.parse(run.captureEndsAt) + 24 * 60 * 60 * 1000;
  const incoming = readAttribution(query(1), "/launch/scuba", beforeEnd);
  const initial = comparison.resolveLandingComparisonAttribution({
    incoming,
    rawTuple: raw(1),
    now: beforeEnd,
    registry: [run],
    storage: st.api,
  });
  assert.equal(initial.kind, "comparison");
  assert.equal(comparison.matchLandingComparison(raw(1), afterEnd, [run]), undefined);
  const delayed = comparison.resolveLandingComparisonAttribution({
    incoming,
    rawTuple: raw(1),
    now: afterEnd,
    registry: [run],
    storage: st.api,
  });
  assert.deepEqual(delayed, initial);
  const untagged = comparison.resolveLandingComparisonAttribution({
    incoming: { landingPath: "/ko/launch/freediving" },
    rawTuple: {},
    now: afterEnd,
    registry: [run],
    storage: st.api,
  });
  assert.deepEqual(untagged, initial);
  const brandNew = comparison.resolveLandingComparisonAttribution({
    incoming,
    rawTuple: raw(1),
    now: afterEnd,
    registry: [run],
    storage: storage().api,
  });
  assert.equal(brandNew.kind, "rejected");
  assert.equal(
    sanitizeSignupAttribution(incoming, afterEnd, [], [run]).utmCampaign,
    run.campaignId,
  );
  assert.equal(
    sanitizeSignupAttribution(incoming, Date.parse(run.signupEndsAt), [], [run]).utmCampaign,
    undefined,
  );
  st.api.setItem(
    comparison.landingComparisonStorageKey(run),
    JSON.stringify({
      version: 1,
      phaseId: run.phaseId,
      firstTouchAt: afterEnd,
      attribution: incoming,
    }),
  );
  assert.equal(
    comparison.resolveLandingComparisonAttribution({
      incoming: { landingPath: "/launch/scuba" },
      rawTuple: {},
      now: afterEnd,
      registry: [run],
      storage: st.api,
    }).kind,
    "none",
  );
});
