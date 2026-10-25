import assert from "node:assert/strict";
import test from "node:test";
import {
  SEGMENT_MEASUREMENT_ID,
  segmentContextSchema,
  segmentSourceTuple,
  emptySegmentPlacements,
} from "../src/lib/segments/measurementContract.ts";
import {
  experimentContextSchema,
  encodeBehaviorSections,
  parseBehaviorSections,
  encodeLeadExperiment,
  parseLeadExperiment,
  persistableExperimentContext,
  EXPERIMENT_MATURITY_MS,
} from "../src/lib/conversionExperimentContract.ts";
import { buildExperimentReport } from "../src/lib/experimentReport.ts";
import { buildSegmentMeasurementReport } from "../src/lib/segments/measurementReport.ts";
import { pageBehaviorSummarySchema } from "../src/lib/pageBehaviorSummary.ts";
import { behaviorProperties } from "../src/lib/api/behaviorNotion.ts";
import {
  newSocialState,
  signSocialState,
  readSocialState,
  issueSocialStateCookie,
} from "../src/lib/socialAuth/state.ts";
import { createNotionLeadStore, type NotionRequest } from "../src/lib/verification/notionLead.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
} from "../src/lib/verification/contracts.ts";
const NOW = Date.parse("2026-10-28T00:00:00Z"),
  AT = NOW - EXPERIMENT_MATURITY_MS - 3600000;
const SID = "8d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
function ctx(extra = {}) {
  return segmentContextSchema.parse({
    experimentId: SEGMENT_MEASUREMENT_ID,
    variant: "segmented",
    team: "organic",
    sessionId: SID,
    assignedAt: AT,
    qa: false,
    entrySegment: "freediving",
    layoutRevision: "segments-v1",
    locale: "en",
    device: "phone",
    attribution: {
      campaignId: "120251627871060215",
      adsetId: "120251627978390215",
      adId: "120251627983480215",
    },
    ...extra,
  });
}
function funnel(extra = {}) {
  return {
    exposed: true,
    formVisible: false,
    formFocused: false,
    submitAttempted: false,
    placements: emptySegmentPlacements(),
    ...extra,
  };
}
const rich = (v: string) => ({ rich_text: [{ plain_text: v }] });
function behavior(c = ctx(), f = funnel()) {
  return {
    properties: {
      Name: { title: [{ plain_text: c.sessionId }] },
      Sections: rich(encodeBehaviorSections("signup-middle 3s", c, f)),
    },
  };
}
function lead(c = ctx(), extra = {}) {
  return {
    properties: {
      "Canonical email": { email: "fixture@example.test" },
      "Conversion experiment": rich(encodeLeadExperiment(c)!),
      "Measurement consent": rich(MEASUREMENT_CONSENT_GRANTED),
      "Signed up": { date: { start: new Date(c.assignedAt + 1000).toISOString() } },
      "Email verified": { checkbox: true },
      "Verified at": { date: { start: new Date(c.assignedAt + 2000).toISOString() } },
      ...extra,
    },
  };
}
function input(behaviorRows = [behavior()], leadRows = [lead()]) {
  return {
    now: NOW,
    exposureFrom: AT - 1000,
    exposureTo: NOW,
    behavior: { availability: "ok" as const, pages: behaviorRows, truncated: false },
    leads: {
      availability: "ok" as const,
      column: "present" as const,
      pages: leadRows,
      truncated: false,
    },
  };
}

test("new context roundtrips shared validators, CRM and behavior storage without new columns", () => {
  const c = ctx(),
    f = funnel();
  f.placements.middle.formVisible = true;
  assert.deepEqual(experimentContextSchema.parse(c), c);
  assert.deepEqual(parseLeadExperiment(encodeLeadExperiment(c)!).context, c);
  const result = parseBehaviorSections(encodeBehaviorSections("x".repeat(1800), c, f));
  assert.deepEqual(result.context, c);
  assert.deepEqual(result.funnel?.placements, f.placements);
  const summary = pageBehaviorSummarySchema.parse({
    sessionId: SID,
    locale: "en",
    device: "phone",
    viewportW: 390,
    viewportH: 844,
    timezone: "Asia/Singapore",
    durationSec: 3,
    maxScroll: 50,
    referrerHost: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    sections: [],
    clicks: [],
    experiment: c,
    funnel: f,
  });
  const stored = behaviorProperties(summary, "SG");
  assert.equal(Object.keys(stored).includes("Segment"), false);
  assert.ok(JSON.stringify(stored).includes(SEGMENT_MEASUREMENT_ID));
});

test("optional malformed/private context fails open and never retains contact fields", () => {
  const gate = { measurementConsent: true, suspect: false, blocked: false };
  for (const bad of [
    { ...ctx(), email: "fixture@example.test" },
    { ...ctx(), attribution: { campaignId: "fixture@example.test" } },
    { ...ctx(), entrySegment: "phone-123456789" },
  ])
    assert.equal(persistableExperimentContext(bad, gate), undefined);
  assert.equal(
    persistableExperimentContext(ctx(), { ...gate, measurementConsent: false }),
    undefined,
  );
  assert.equal(persistableExperimentContext(ctx(), { ...gate, suspect: true }), undefined);
  assert.equal(persistableExperimentContext(ctx(), { ...gate, blocked: true }), undefined);
  assert.deepEqual(
    segmentSourceTuple(
      "?utm_campaign=1234&utm_campaign=5678&utm_content=fixture%40example.test&utm_term=123456",
    ),
    { campaignId: undefined, adsetId: "123456", adId: undefined },
  );
});

test("signed OAuth state retains complete context and stays within cookie budget", () => {
  const state = newSocialState(
    {
      provider: "google",
      source: "hero",
      segment: "freediving",
      locale: "en",
      origin: "https://watchdive.diveroid.com",
      attribution: {},
      measurementConsent: true,
      experiment: ctx(),
      country: { header: "SG", trustedVercel: true },
    },
    NOW,
  );
  const secret = "fixture-signing-secret-at-least-32-chars";
  const token = signSocialState(state, secret);
  assert.ok(token.length < 4000);
  assert.deepEqual(readSocialState(token, secret, {}, NOW)?.experiment, ctx());
  assert.ok(issueSocialStateCookie(state, secret));
});

test("legacy report ignores segment rows before session grouping or lead joins", () => {
  const r = buildExperimentReport(input());
  assert.equal(r.total.counts.sessions, 0);
  assert.equal(r.total.counts.newEmails, 0);
  assert.equal(r.quality.malformedBehaviorRows, 0);
  assert.equal(r.quality.unmatchedLeads, 0);
});

test("new report dedupes snapshots/leads, retains placement gaps and hides all identities", () => {
  const f = funnel();
  f.placements.middle.submitAttempted = true;
  const r = buildSegmentMeasurementReport(
    input([behavior(), behavior(ctx(), f)], [lead(), lead()]),
  );
  assert.equal(r.bySegment.freediving.sessions, 1);
  assert.equal(r.bySegment.freediving.matureSignupSessions, 1);
  assert.equal(r.bySegment.freediving.matureVerifiedRate, 1);
  assert.equal(r.quality.duplicateLeadRows, 1);
  assert.equal(r.quality.placementGaps, 1);
  assert.equal(r.bySegment.freediving.placements!.middle.formFocused, 0);
  assert.equal(r.coverage.decisionReady, false);
  assert.equal(r.coverage.contextPersistence, "unknown");
  assert.equal(r.coverage.allVisitors, null);
  assert.equal(JSON.stringify(r).includes("fixture@example.test"), false);
  assert.equal(JSON.stringify(r).includes(SID), false);
});

test("48h maturity, exposure bounds and frozen device define the actual denominator", () => {
  const fresh = ctx({
    sessionId: "9d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f",
    assignedAt: NOW - 3600000,
    entrySegment: "scuba",
  });
  const r = buildSegmentMeasurementReport(
    input(
      [behavior(), behavior(fresh)],
      [lead(), lead(fresh, { "Canonical email": { email: "other@example.test" } })],
    ),
  );
  assert.equal(r.bySegment.scuba.sessions, 1);
  assert.equal(r.bySegment.scuba.matureSessions, 0);
  assert.equal(r.bySegment.scuba.matureSignupRate, null);
  assert.equal(
    buildSegmentMeasurementReport({ ...input(), device: "desktop" }).bySegment.freediving.sessions,
    0,
  );
  assert.equal(
    buildSegmentMeasurementReport({ ...input(), exposureFrom: AT + 1 }).bySegment.freediving
      .sessions,
    0,
  );
});

test("missing/truncated sources are unavailable and never become zero success", () => {
  for (const variant of [
    { ...input(), leads: { ...input().leads, column: "missing" as const } },
    { ...input(), leads: { ...input().leads, truncated: true } },
    { ...input(), behavior: { ...input().behavior, availability: "unavailable" as const } },
  ]) {
    const r = buildSegmentMeasurementReport(variant);
    assert.equal(r.partial, true);
    assert.equal(r.bySegment.freediving.signupSessions, null);
    assert.equal(r.bySegment.freediving.matureSignupRate, null);
  }
});

test("withdrawal, duplicate flags, no consent and prior canonical signup cannot gain acquisition credit", () => {
  for (const extra of [
    { "Measurement consent": rich(MEASUREMENT_CONSENT_WITHDRAWN) },
    { Duplicate: { checkbox: true } },
    { "Measurement consent": rich("") },
  ])
    assert.equal(
      buildSegmentMeasurementReport(input([behavior()], [lead(ctx(), extra)])).bySegment.freediving
        .signupSessions,
      0,
    );
  const prior = lead(ctx(), {
    "Signed up": { date: { start: new Date(AT - 1000).toISOString() } },
    "Conversion experiment": rich(""),
  });
  assert.equal(
    buildSegmentMeasurementReport(input([behavior()], [lead(), prior])).bySegment.freediving
      .signupSessions,
    0,
  );
  assert.equal(
    buildSegmentMeasurementReport(
      input(
        [behavior()],
        [lead(), lead(ctx(), { "Measurement consent": rich(MEASUREMENT_CONSENT_WITHDRAWN) })],
      ),
    ).bySegment.freediving.signupSessions,
    0,
  );
});

test("QA, inconsistent assignment, invalid verification and late events stay out", () => {
  assert.equal(
    buildSegmentMeasurementReport(input([behavior(ctx({ qa: true }))], [])).bySegment.freediving
      .sessions,
    0,
  );
  assert.equal(
    buildSegmentMeasurementReport(input([behavior(), behavior(ctx({ entrySegment: "scuba" }))], []))
      .quality.inconsistentSessions,
    1,
  );
  const late = lead(ctx(), {
    "Verified at": { date: { start: new Date(AT + EXPERIMENT_MATURITY_MS + 1).toISOString() } },
  });
  const r = buildSegmentMeasurementReport(input([behavior()], [late]));
  assert.equal(r.bySegment.freediving.signupSessions, 1);
  assert.equal(r.bySegment.freediving.verifiedSessions, 0);
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
test("browser entry context freezes across segment/locale/tuple crossover; revoke closes enrollment", async () => {
  const names = ["window", "document", "location", "localStorage", "sessionStorage", "navigator"];
  const old = Object.fromEntries(
    names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]),
  );
  const local = memoryStorage(),
    session = memoryStorage();
  const location = {
    pathname: "/freediving",
    search: "?utm_campaign=1234&utm_term=5678&utm_content=9012",
    hostname: "watchdive.diveroid.com",
  };
  const browser = Object.assign(new EventTarget(), {
    localStorage: local,
    innerWidth: 390,
    __wdLandingVariant: "form_first",
    location,
  });
  const doc = { cookie: "wd_geo=SG", visibilityState: "visible" };
  try {
    for (const [key, value] of Object.entries({
      window: browser,
      document: doc,
      location,
      localStorage: local,
      sessionStorage: session,
      navigator: {},
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    const client = await import(
      `../src/lib/conversionExperimentClient.ts?segment-fixture=${Date.now()}`
    );
    client.initializeConversionExperiment(true);
    const entry = client.getConversionExperiment();
    assert.equal(entry?.experimentId, SEGMENT_MEASUREMENT_ID);
    assert.notEqual(
      entry?.sessionId,
      client.behaviorSessionId(),
      "segment row cannot overwrite legacy session row",
    );
    client.markConversionMilestone("formVisible", "hero");
    client.markConversionMilestone("submitAttempted", "offer");
    location.pathname = "/ko/scuba";
    location.search = "?utm_campaign=9999";
    browser.innerWidth = 1300;
    client.initializeConversionExperiment(true);
    assert.deepEqual(client.getConversionExperiment(), entry);
    const reload = await import(
      `../src/lib/conversionExperimentClient.ts?reload-fixture=${Date.now()}`
    );
    reload.initializeConversionExperiment(true);
    assert.deepEqual(
      reload.getConversionExperiment(),
      entry,
      "reload retains first segment, tuple, locale, device and observation ID",
    );
    const f = client.getConversionFunnel();
    assert.equal(f.placements?.crossedSegment, true);
    assert.equal(f.placements?.middle.formVisible, true);
    assert.equal(f.placements?.bottom.submitAttempted, true);
    assert.equal(f.placements?.bottom.formFocused, false);
    client.revokeConversionExperiment();
    client.initializeConversionExperiment(true);
    assert.equal(client.getConversionExperiment(), undefined);
    assert.equal(session.getItem("watchdive.segments.session.20261025"), null);
    const denied = await import(
      `../src/lib/conversionExperimentClient.ts?denied-fixture=${Date.now()}`
    );
    local.setItem("watchdive.measurement-consent.v3", "denied");
    denied.initializeConversionExperiment(true);
    assert.equal(denied.getConversionExperiment(), undefined);
    denied.closeExperimentEnrollmentOnSubmit();
    local.setItem("watchdive.measurement-consent.v3", "granted");
    denied.initializeConversionExperiment(true);
    assert.equal(denied.getConversionExperiment(), undefined);
    const gpc = await import(`../src/lib/conversionExperimentClient.ts?gpc-fixture=${Date.now()}`);
    Object.defineProperty(globalThis, "navigator", {
      value: { globalPrivacyControl: true },
      configurable: true,
    });
    gpc.initializeConversionExperiment(true);
    assert.equal(gpc.getConversionExperiment(), undefined);
  } finally {
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("actual CRM create adapter stores new context and withdrawal clears the same existing column", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const request: NotionRequest = async (_method, _path, body) => {
    writes.push(body as Record<string, unknown>);
    return {
      id: "fixture-page",
      properties: { Email: { title: [{ plain_text: "fixture@example.test" }] } },
    };
  };
  const store = createNotionLeadStore(request, "fixture-db");
  await store.createPending({
    email: "fixture@example.test",
    canonical: "fixture@example.test",
    source: "hero",
    refCode: "test1234",
    flags: [],
    suspect: false,
    signedUpAt: new Date(AT + 1000).toISOString(),
    leadId: SID,
    expiresAt: new Date(NOW).toISOString(),
    measurementState: MEASUREMENT_CONSENT_GRANTED,
    experiment: ctx(),
  });
  const properties = writes[0].properties as Record<string, any>;
  const stored = properties["Conversion experiment"].rich_text[0].text.content;
  assert.deepEqual(parseLeadExperiment(stored).context, ctx());
  assert.equal(properties.Source.select.name, "hero");
  await store.recordMeasurementWithdrawal!("fixture-page");
  assert.deepEqual(
    (writes.at(-1)!.properties as Record<string, unknown>)["Conversion experiment"],
    { rich_text: [] },
  );
});

test("malformed row order cannot reinstate a fenced session", () => {
  const bad = behavior(ctx());
  bad.properties.Name.title[0].plain_text = "9d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
  for (const rows of [
    [bad, behavior()],
    [behavior(), bad],
  ]) {
    const r = buildSegmentMeasurementReport(input(rows));
    assert.equal(r.bySegment.freediving.sessions, 0);
    assert.equal(r.bySegment.freediving.signupSessions, 0);
  }
});
