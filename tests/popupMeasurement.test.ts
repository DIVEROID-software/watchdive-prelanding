import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POPUP_ACQUISITION_PLACEMENT,
  POPUP_FUNNEL_VERSION,
  SECTIONS_TEXT_MAX,
  countPopupSession,
  emptyPopupCounts,
  encodeBehaviorSections,
  encodeLeadExperiment,
  experimentContextIdentity,
  experimentContextSchema,
  experimentFunnelSchema,
  monotonicFunnel,
  parseBehaviorSections,
  parseLeadExperiment,
  persistableExperimentContext,
  unionFunnels,
  FIELD_CONVERSION_EXPERIMENT,
  type ExperimentFunnel,
  type PopupFunnel,
} from "../src/lib/conversionExperimentContract.ts";
import { buildExperimentReport } from "../src/lib/experimentReport.ts";
import { pageBehaviorSummarySchema } from "../src/lib/pageBehaviorSummary.ts";
import { behaviorProperties, createBehaviorNotion } from "../src/lib/api/behaviorNotion.ts";
import { entryPopupFormVisible, entryPopupPanelVisible } from "../src/lib/popupSurface.ts";
import {
  SEGMENT_MEASUREMENT_ID,
  emptySegmentPlacements,
  segmentContextSchema,
} from "../src/lib/segments/measurementContract.ts";
import { buildSegmentMeasurementReport } from "../src/lib/segments/measurementReport.ts";
import { EXPERIMENT_ID } from "../src/lib/conversionExperimentContract.ts";
import { CONSENT_STORAGE_KEY } from "../src/lib/consentRegion.ts";
import { MEASUREMENT_CONSENT_GRANTED } from "../src/lib/verification/contracts.ts";
import { FUNNEL_CHANGED } from "../src/lib/conversionExperimentClient.ts";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const AT = NOW - 60 * 60 * 1000;
const SID = "8d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function bodyFunnel(extra: Partial<ExperimentFunnel> = {}): ExperimentFunnel {
  return {
    exposed: true,
    formVisible: false,
    formFocused: false,
    submitAttempted: false,
    placements: emptySegmentPlacements(),
    ...extra,
  };
}

function popup(extra: Partial<PopupFunnel> = {}): PopupFunnel {
  return {
    version: POPUP_FUNNEL_VERSION,
    placement: POPUP_ACQUISITION_PLACEMENT,
    visible: false,
    focused: false,
    submitAttempted: false,
    dismissed: false,
    accepted: false,
    failed: false,
    closed: false,
    ...extra,
  };
}

function segmentContext(extra: Record<string, unknown> = {}) {
  return segmentContextSchema.parse({
    experimentId: SEGMENT_MEASUREMENT_ID,
    variant: "segmented",
    team: "organic",
    sessionId: SID,
    assignedAt: AT,
    qa: false,
    entrySegment: "scuba",
    layoutRevision: "segments-v1",
    locale: "zh-TW",
    device: "desktop",
    attribution: {},
    ...extra,
  });
}

const rich = (value: string) => ({ rich_text: [{ plain_text: value }] });

function segmentReport(sections: string, leadExperiment?: string, qa = false) {
  const context = segmentContext(qa ? { qa: true } : {});
  return buildSegmentMeasurementReport({
    now: NOW,
    exposureFrom: AT - 1000,
    exposureTo: NOW,
    behavior: {
      availability: "ok",
      truncated: false,
      pages: [
        {
          properties: {
            Name: { title: [{ plain_text: context.sessionId }] },
            Sections: rich(sections),
          },
        },
      ],
    },
    leads: {
      availability: "ok",
      column: "present",
      truncated: false,
      pages: leadExperiment
        ? [
            {
              properties: {
                "Canonical email": { email: "fixture@example.test" },
                [FIELD_CONVERSION_EXPERIMENT]: rich(leadExperiment),
                "Measurement consent": rich(MEASUREMENT_CONSENT_GRANTED),
                "Signed up": { date: { start: new Date(AT + 1000).toISOString() } },
                "Email verified": { checkbox: false },
                "Verification status": { select: { name: "pending" } },
              },
            },
          ]
        : [],
    },
  });
}

test("popup block is additive and a bad popup does not drop body flags", () => {
  const legacy = bodyFunnel({ formFocused: true });
  const stored = encodeBehaviorSections("signup-middle 2s", segmentContext(), legacy);
  const round = parseBehaviorSections(stored);
  assert.equal(round.malformed, false);
  assert.equal(round.funnel?.formFocused, true);
  assert.equal(round.funnel?.popup, undefined);
  assert.equal(round.context?.acquisitionPlacement, undefined);
  assert.equal(round.funnel?.placements?.middle.formFocused, false);

  const malformed = experimentFunnelSchema.parse({
    ...legacy,
    popup: { version: 1, placement: "entry-popup", visible: "yes" },
  });
  assert.equal(malformed.formFocused, true);
  assert.equal(malformed.popup, undefined);
  const unpaired = experimentFunnelSchema.parse({
    ...legacy,
    popup: popup({ accepted: true }),
  });
  assert.equal(unpaired.popup, undefined);
  assert.equal(unpaired.formVisible, false);
  const dismissedOnly = experimentFunnelSchema.parse({
    ...legacy,
    popup: popup({
      dismissed: true,
      failed: true,
      observedAt: { visible: AT, failed: AT + 1, dismissed: AT + 2, accepted: AT + 3, formVisible: 1.5 },
    }),
  });
  assert.equal(dismissedOnly.popup?.accepted, false);
  assert.equal(dismissedOnly.popup?.visible, false);
  assert.equal(dismissedOnly.popup?.formVisible, undefined);
  assert.equal(dismissedOnly.popup?.failed, true);
  assert.equal(dismissedOnly.popup?.observedAt?.visible, undefined);
  assert.equal(dismissedOnly.popup?.observedAt?.accepted, undefined);
  assert.equal(dismissedOnly.popup?.observedAt?.formVisible, undefined);
  assert.equal(dismissedOnly.popup?.observedAt?.failed, AT + 1);
  assert.equal(dismissedOnly.popup?.observedAt?.dismissed, AT + 2);
  assert.equal(dismissedOnly.formFocused, true);

  const summary = pageBehaviorSummarySchema.parse({
    sessionId: SID,
    locale: "zh-TW",
    device: "desktop",
    viewportW: 1440,
    viewportH: 900,
    timezone: "Asia/Taipei",
    durationSec: 4,
    maxScroll: 10,
    referrerHost: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    sections: [{ id: "signup-middle", dwellSec: 2 }],
    clicks: [],
    experiment: segmentContext(),
    funnel: { ...legacy, popup: popup({ visible: true, focused: true }) },
  });
  assert.equal(summary.funnel?.popup?.visible, true);
  assert.equal(summary.funnel?.formFocused, true);
  const properties = behaviorProperties(summary, "TW");
  const text = properties.Sections.rich_text[0].text.content;
  const saved = parseBehaviorSections(text);
  assert.equal(saved.funnel?.popup?.visible, true);
  assert.equal(saved.funnel?.popup?.focused, true);
  assert.equal(saved.funnel?.popup?.accepted, false);
  assert.equal(saved.funnel?.formFocused, true);
  assert.equal(saved.funnel?.placements?.bottom.submitAttempted, false);
  assert.equal(JSON.stringify(saved).includes("@"), false);
});

test("worst-case popup suffix still roundtrips inside the Notion text cap", () => {
  const id = "9".repeat(32);
  const context = segmentContext({
    attribution: { campaignId: id, adsetId: id, adId: id },
  });
  const funnel = bodyFunnel({
    formVisible: true,
    formFocused: true,
    submitAttempted: true,
    placements: {
      middle: { formVisible: true, formFocused: true, submitAttempted: true },
      bottom: { formVisible: true, formFocused: true, submitAttempted: true },
      crossedSegment: true,
    },
    popup: popup({
      visible: true,
      formVisible: true,
      focused: true,
      submitAttempted: true,
      dismissed: true,
      accepted: true,
      failed: true,
      closed: true,
      result: "already_verified",
      observedAt: {
        visible: AT + 1,
        formVisible: AT + 2,
        focused: AT + 3,
        submitAttempted: AT + 4,
        dismissed: AT + 5,
        accepted: AT + 6,
        failed: AT + 7,
        closed: AT + 8,
      },
    }),
  });
  const encoded = encodeBehaviorSections("x".repeat(1800), context, funnel);
  const marker = "[[wd-exp]]";
  const at = encoded.indexOf(marker);
  assert.ok(at >= 0, "experiment must not be dropped to fit the popup block");
  const suffix = encoded.slice(at);
  assert.ok(suffix.length <= 1800, `suffix ${suffix.length}`);
  assert.ok(encoded.length <= SECTIONS_TEXT_MAX);
  const round = parseBehaviorSections(encoded);
  assert.equal(round.malformed, false);
  assert.equal(round.funnel?.popup?.result, "already_verified");
  assert.equal(round.funnel?.popup?.formVisible, true);
  assert.equal(round.funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(round.funnel?.popup?.observedAt?.closed, AT + 8);
  assert.equal(round.funnel?.formVisible, true);
  assert.equal(round.funnel?.placements?.bottom.submitAttempted, true);
  assert.equal(round.context?.acquisitionPlacement, undefined);
});

test("popup submit snapshot joins the lead without sticking to the session or counting as new", () => {
  const session = segmentContext();
  const lead = segmentContext({ acquisitionPlacement: "entry-popup" });
  assert.equal(experimentContextIdentity(session), experimentContextIdentity(lead));
  assert.notEqual(JSON.stringify(session), JSON.stringify(lead));
  const storedLead = encodeLeadExperiment(lead);
  assert.ok(storedLead);
  assert.equal(parseLeadExperiment(storedLead!).context?.acquisitionPlacement, "entry-popup");
  assert.equal(
    persistableExperimentContext(lead, { measurementConsent: false, suspect: false, blocked: false }),
    undefined,
  );
  const seen = popup({
    visible: true,
    formVisible: true,
    focused: true,
    submitAttempted: true,
    accepted: true,
    result: "pending",
    observedAt: { visible: AT + 5, formVisible: AT + 6, focused: AT + 7, submitAttempted: AT + 8, accepted: AT + 9 },
  });
  const sections = encodeBehaviorSections("signup-bottom 1s", session, bodyFunnel({ popup: seen }));
  const report = segmentReport(sections, storedLead!);
  assert.equal(report.quality.mismatchedLeads, 0);
  assert.equal(report.bySegment.scuba.signupSessions, 1);
  assert.equal(report.bySegment.scuba.popup?.visible, 1);
  assert.equal(report.bySegment.scuba.popup?.formVisible, 1);
  assert.equal(report.bySegment.scuba.popup?.pending, 1);
  assert.equal(report.bySegment.scuba.popup?.alreadyVerified, 0);
  assert.equal(report.bySegment.scuba.popup?.accepted, 1);
  assert.equal(report.bySegment.scuba.placements?.middle.formVisible, 0);
  assert.equal(report.bySegment.scuba.placements?.bottom.submitAttempted, 0);
  assert.equal(report.quality.qaPopupSessions, 0);

  const verified = unionFunnels([
    bodyFunnel({ popup: popup({ accepted: true, result: "pending", submitAttempted: true }) }),
    bodyFunnel({ popup: popup({ accepted: true, result: "already_verified", visible: true }) }),
  ]);
  assert.equal(verified.formVisible, false);
  assert.equal(verified.submitAttempted, false);
  assert.equal(verified.popup?.result, "already_verified");
  assert.equal(verified.popup?.visible, true);
  const counts = emptyPopupCounts();
  countPopupSession(verified, counts);
  assert.equal(counts.pending, 0);
  assert.equal(counts.alreadyVerified, 1);
  const plain = monotonicFunnel(bodyFunnel({ formVisible: true, popup: popup({ visible: true }) }));
  assert.equal(plain.formVisible, true);
  assert.equal(plain.popup?.visible, true);
  assert.equal(plain.popup?.accepted, false);
  assert.equal(plain.popup?.observedAt, undefined);
  const earliest = unionFunnels([
    bodyFunnel({ popup: popup({ visible: true, observedAt: { visible: AT + 50 } }) }),
    bodyFunnel({
      popup: popup({
        visible: true,
        focused: true,
        observedAt: { visible: AT + 10, focused: AT + 20, formVisible: AT + 30 },
      }),
    }),
  ]);
  assert.equal(earliest.popup?.observedAt?.visible, AT + 10);
  assert.equal(earliest.popup?.observedAt?.focused, AT + 20);
  assert.equal(earliest.popup?.formVisible, false);
  assert.equal(earliest.popup?.observedAt?.formVisible, undefined);
  assert.equal(earliest.formVisible, false);
});

test("QA popup is stored and excluded from ordinary counts", () => {
  const qa = segmentContext({ qa: true });
  const sections = encodeBehaviorSections(
    "signup-middle 1s",
    qa,
    bodyFunnel({ popup: popup({ visible: true, dismissed: true }) }),
  );
  const report = segmentReport(sections, undefined, true);
  assert.equal(report.quality.qaExcluded, 1);
  assert.equal(report.quality.qaPopupSessions, 1);
  assert.equal(report.bySegment.scuba.sessions, 0);
  assert.equal(report.bySegment.scuba.popup?.visible, 0);

  const legacy = experimentContextSchema.parse({
    experimentId: EXPERIMENT_ID,
    variant: "form_first",
    sessionId: SID,
    assignedAt: AT,
    team: "organic",
    qa: true,
  });
  const legacyReport = buildExperimentReport({
    now: NOW,
    behavior: {
      availability: "ok",
      truncated: false,
      pages: [
        {
          properties: {
            Name: { title: [{ plain_text: SID }] },
            Sections: rich(
              encodeBehaviorSections("offer-form 1s", legacy, bodyFunnel({ popup: popup({ visible: true }) })),
            ),
          },
        },
      ],
    },
    leads: { availability: "ok", column: "present", truncated: false, pages: [] },
  });
  assert.equal(legacyReport.quality.qaExcludedSessions, 1);
  assert.equal(legacyReport.quality.qaPopupSessions, 1);
  assert.equal(legacyReport.popup?.visible, 0);
  assert.equal(legacyReport.total.counts.formVisible, 0);
});

test("a production legacy popup does not move the four body flags", () => {
  const legacy = experimentContextSchema.parse({
    experimentId: EXPERIMENT_ID,
    variant: "form_first",
    sessionId: SID,
    assignedAt: AT,
    team: "organic",
    qa: false,
  });
  const report = buildExperimentReport({
    now: NOW,
    behavior: {
      availability: "ok",
      truncated: false,
      pages: [
        {
          properties: {
            Name: { title: [{ plain_text: SID }] },
            Sections: rich(
              encodeBehaviorSections(
                "offer-form 1s",
                legacy,
                bodyFunnel({
                  popup: popup({ visible: true, focused: true, submitAttempted: true, failed: true }),
                }),
              ),
            ),
          },
        },
      ],
    },
    leads: { availability: "ok", column: "present", truncated: false, pages: [] },
  });
  assert.equal(report.total.counts.formVisible, 0);
  assert.equal(report.total.counts.formFocused, 0);
  assert.equal(report.total.counts.submitAttempted, 0);
  assert.equal(report.popup?.visible, 1);
  assert.equal(report.popup?.formVisible, 0);
  assert.equal(report.popup?.failed, 1);
  assert.equal(report.popup?.accepted, 0);
  assert.equal(report.quality.qaPopupSessions, 0);
});

test("panel view and form hit-test stay distinct, and a hidden document is neither", () => {
  const names = ["window", "document"];
  const old = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const rect = { top: 20, left: 20, width: 120, height: 40, bottom: 60, right: 140, x: 20, y: 20, toJSON() { return this; } };
  const hit = {};
  const browser = { innerWidth: 400, innerHeight: 800, visualViewport: { width: 400, height: 800 } };
  const documentStub: { visibilityState: string; elementFromPoint: () => object } = {
    visibilityState: "visible",
    elementFromPoint: () => hit,
  };
  function control(kind: "email" | "submit" | "form" | "panel") {
    return {
      kind,
      hidden: false,
      getBoundingClientRect: () => rect,
      querySelector(selector: string) {
        if (selector === 'input[type="email"]') return control("email");
        if (selector === 'button[type="submit"]') return control("submit");
        if (selector === "form") return control("form");
        return null;
      },
      contains(other: object) {
        return other === hit;
      },
    };
  }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
    Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
    const panel = control("panel");
    const node = panel as unknown as Element;
    assert.equal(entryPopupPanelVisible(node, false), true);
    assert.equal(entryPopupFormVisible(node, false), true);
    assert.equal(entryPopupPanelVisible(node, true), false);
    assert.equal(entryPopupFormVisible(node, true), false);
    panel.hidden = true;
    assert.equal(entryPopupPanelVisible(node, false), false);
    assert.equal(entryPopupFormVisible(node, false), false);
    panel.hidden = false;
    documentStub.visibilityState = "hidden";
    assert.equal(entryPopupPanelVisible(node, false), false);
    assert.equal(entryPopupFormVisible(node, false), false);
    documentStub.visibilityState = "visible";
    documentStub.elementFromPoint = () => ({});
    assert.equal(entryPopupPanelVisible(node, false), true);
    assert.equal(entryPopupFormVisible(node, false), false);
    rect.width = 0;
    assert.equal(entryPopupPanelVisible(node, false), false);
    assert.equal(entryPopupFormVisible(node, false), false);
    rect.width = 120;
    assert.equal(entryPopupPanelVisible(null, false), false);
    assert.equal(entryPopupFormVisible(null, false), false);
  } finally {
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("popup milestones stay off the body flags and do not replay, backfill, or stick the CRM tag", async () => {
  const names = ["window", "document", "location", "localStorage", "sessionStorage", "navigator"];
  const old = Object.fromEntries(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const localMap = new Map<string, string>();
  const sessionMap = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  const local = storage(localMap);
  const session = storage(sessionMap);
  const location = {
    pathname: "/ko/scuba",
    search: "",
    hash: "",
    hostname: "watchdive.diveroid.com",
  };
  const browser = Object.assign(new EventTarget(), {
    localStorage: local,
    innerWidth: 390,
    __wdLandingVariant: "form_first",
    __wdLandingQa: false,
    location,
  });
  try {
    for (const [key, value] of Object.entries({
      window: browser,
      document: { cookie: "wd_geo=SG", visibilityState: "visible" },
      location,
      localStorage: local,
      sessionStorage: session,
      navigator: {},
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    local.setItem(CONSENT_STORAGE_KEY, "denied");
    const denied = await import(`../src/lib/conversionExperimentClient.ts?popup-denied=${Date.now()}`);
    denied.initializeConversionExperiment(true);
    denied.markPopupMilestone("visible");
    denied.markPopupServerResult("pending");
    assert.equal(denied.getConversionExperiment(), undefined);
    assert.equal(denied.getConversionFunnel().popup, undefined);
    local.setItem(CONSENT_STORAGE_KEY, "granted");
    denied.initializeConversionExperiment(true);
    assert.equal(denied.getConversionFunnel().popup, undefined);
    let events = 0;
    browser.addEventListener(FUNNEL_CHANGED, () => {
      events += 1;
    });
    denied.markPopupMilestone("visible");
    denied.markPopupMilestone("visible");
    denied.markPopupMilestone("formVisible");
    denied.markPopupMilestone("focused");
    denied.markPopupMilestone("submitAttempted");
    denied.markPopupServerResult("error");
    denied.markPopupServerResult("error");
    denied.markPopupServerResult("pending");
    denied.markPopupServerResult("pending");
    denied.markPopupServerResult("already_verified");
    denied.markPopupServerResult("pending");
    denied.markPopupMilestone("dismissed");
    const funnel = denied.getConversionFunnel();
    assert.equal(funnel.formVisible, false);
    assert.equal(funnel.formFocused, false);
    assert.equal(funnel.submitAttempted, false);
    assert.equal(funnel.placements?.middle.formVisible, false);
    assert.equal(funnel.placements?.bottom.formFocused, false);
    assert.equal(funnel.popup.visible, true);
    assert.equal(funnel.popup.formVisible, true);
    assert.equal(funnel.popup.focused, true);
    assert.equal(funnel.popup.submitAttempted, true);
    assert.equal(funnel.popup.dismissed, true);
    assert.equal(funnel.popup.failed, true);
    assert.equal(funnel.popup.accepted, true);
    assert.equal(funnel.popup.result, "already_verified");
    assert.equal(typeof funnel.popup.observedAt.visible, "number");
    assert.equal(typeof funnel.popup.observedAt.formVisible, "number");
    assert.equal(typeof funnel.popup.observedAt.accepted, "number");
    assert.equal(funnel.popup.observedAt.closed, undefined);
    const firstVisible = funnel.popup.observedAt.visible;
    denied.markPopupMilestone("visible");
    assert.equal(denied.getConversionFunnel().popup.observedAt.visible, firstVisible);
    assert.equal(events, 8);
    denied.markConversionMilestone("formVisible", "hero");
    denied.markConversionMilestone("submitAttempted", "offer");
    const mixed = denied.getConversionFunnel();
    assert.equal(mixed.formVisible, true);
    assert.equal(mixed.submitAttempted, true);
    assert.equal(mixed.placements.middle.formVisible, true);
    assert.equal(mixed.placements.bottom.submitAttempted, true);
    assert.equal(mixed.placements.bottom.formVisible, false);
    assert.equal(mixed.popup.visible, true);
    const context = denied.getConversionExperiment();
    const snap = denied.withPopupAcquisition(context);
    assert.equal(Object.hasOwn(context, "acquisitionPlacement"), false);
    assert.equal(snap.acquisitionPlacement, "entry-popup");
    assert.equal(
      JSON.parse(session.getItem("watchdive.segments.session.20261025") ?? "{}").acquisitionPlacement,
      undefined,
    );
    assert.equal(Object.hasOwn(denied.getConversionExperiment(), "acquisitionPlacement"), false);
    denied.revokeConversionExperiment();
    denied.markPopupMilestone("focused");
    local.setItem(CONSENT_STORAGE_KEY, "granted");
    denied.initializeConversionExperiment(true);
    assert.equal(denied.getConversionExperiment(), undefined);

    const gpc = await import(`../src/lib/conversionExperimentClient.ts?popup-gpc=${Date.now()}`);
    Object.defineProperty(globalThis, "navigator", {
      value: { globalPrivacyControl: true },
      configurable: true,
    });
    local.setItem(CONSENT_STORAGE_KEY, "granted");
    gpc.initializeConversionExperiment(true);
    gpc.markPopupMilestone("visible");
    assert.equal(gpc.getConversionExperiment(), undefined);
    assert.equal(gpc.getConversionFunnel().popup, undefined);

    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    location.hostname = "preview.example.test";
    session.setItem("wd:acquisition-capture:v1", "entry-shown");
    const qa = await import(`../src/lib/conversionExperimentClient.ts?popup-qa=${Date.now()}`);
    qa.initializeConversionExperiment(true);
    assert.equal(qa.getConversionFunnel().popup, undefined);
    qa.markPopupMilestone("visible");
    assert.equal(qa.getConversionExperiment().qa, true);
    assert.equal(qa.getConversionFunnel().popup.visible, true);
    assert.equal(qa.getConversionFunnel().formVisible, false);

    const page = globalThis.document as { visibilityState?: string };
    page.visibilityState = "hidden";
    const hiddenTab = await import(`../src/lib/conversionExperimentClient.ts?popup-hidden=${Date.now()}`);
    hiddenTab.initializeConversionExperiment(true);
    hiddenTab.markPopupMilestone("visible");
    hiddenTab.markPopupMilestone("formVisible");
    assert.equal(hiddenTab.getConversionFunnel().popup, undefined);
    page.visibilityState = "visible";
    hiddenTab.initializeConversionExperiment(true);
    assert.equal(hiddenTab.getConversionFunnel().popup, undefined);
    page.visibilityState = "hidden";
    hiddenTab.markPopupMilestone("visible");
    hiddenTab.markPopupMilestone("formVisible");
    assert.equal(hiddenTab.getConversionFunnel().popup, undefined);
    page.visibilityState = "visible";
    hiddenTab.markPopupMilestone("dismissed");
    hiddenTab.markPopupServerResult("error");
    const sparse = hiddenTab.getConversionFunnel().popup;
    assert.equal(sparse.dismissed, true);
    assert.equal(sparse.failed, true);
    assert.equal(sparse.accepted, false);
    assert.equal(sparse.visible, false);
    assert.equal(sparse.formVisible, false);
    assert.equal(typeof sparse.observedAt.dismissed, "number");
    assert.equal(typeof sparse.observedAt.failed, "number");
    assert.equal(sparse.observedAt.visible, undefined);
    assert.equal(sparse.observedAt.formVisible, undefined);
    assert.equal(sparse.observedAt.accepted, undefined);
    const dismissedAt = sparse.observedAt.dismissed;
    hiddenTab.markPopupMilestone("dismissed");
    assert.equal(hiddenTab.getConversionFunnel().popup.observedAt.dismissed, dismissedAt);
    hiddenTab.markPopupMilestone("visible");
    assert.equal(hiddenTab.getConversionFunnel().popup.visible, true);
    assert.equal(typeof hiddenTab.getConversionFunnel().popup.observedAt.visible, "number");
  } finally {
    for (const name of names) {
      if (old[name]) Object.defineProperty(globalThis, name, old[name]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("the entry form keeps the legacy source contract and does not add a conversion event", () => {
  const index = read("src/routes/index.tsx");
  const entry = read("src/components/retargeting/EntryCapture.tsx");
  const client = read("src/lib/conversionExperimentClient.ts");
  const tools = index.slice(index.indexOf("export function AcquisitionTools"), index.indexOf("function HeroProof"));
  assert.match(tools, /domId="entry-capture"/);
  assert.match(tools, /recordFunnel=\{false\}/);
  assert.match(index, /const popupMeasurement = domId === ENTRY_POPUP_DOM_ID/);
  assert.match(index, /source: id,/);
  assert.match(
    index,
    /experiment: popupMeasurement\s*\?\s*withPopupAcquisition\(getConversionExperiment\(\)\)\s*:\s*getConversionExperiment\(\)/,
  );
  assert.equal(index.includes("trackMetaLead"), false);
  assert.match(entry, /entryPopupPanelVisible\(node, parked\)/);
  assert.match(entry, /markPopupMilestone\("visible"\)/);
  assert.match(entry, /entryPopupFormVisible\(node, parked\)/);
  assert.match(entry, /markPopupMilestone\("formVisible"\)/);
  assert.match(entry, /visibilitychange/);
  assert.match(entry, /markPopupMilestone\("dismissed"\)/);
  assert.doesNotMatch(entry, /wd:acquisition-capture:v1/);
  assert.doesNotMatch(client, /gtag|fbq|trackMeta|trackGoogle|sign_up|purchase/);
  assert.match(client, /const POPUP_FUNNEL_VERSION = 1/);
  assert.match(client, /const POPUP_ACQUISITION_PLACEMENT = "entry-popup"/);
  assert.equal(POPUP_FUNNEL_VERSION, 1);
  assert.equal(POPUP_ACQUISITION_PLACEMENT, "entry-popup");
});

const OTHER = "9d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
const UX_DB = "0123456789abcdef0123456789abcdef";
const UX_KEY = "ntn_test_secret_key";

function seenPopup(extra: Partial<PopupFunnel> = {}): PopupFunnel {
  return popup({
    visible: true,
    formVisible: true,
    focused: true,
    submitAttempted: true,
    accepted: true,
    result: "pending",
    observedAt: {
      visible: AT + 1,
      formVisible: AT + 2,
      focused: AT + 3,
      submitAttempted: AT + 4,
      accepted: AT + 5,
    },
    ...extra,
  });
}

function behaviorSummary(extra: Record<string, unknown> = {}) {
  const experiment = extra.experiment === undefined ? segmentContext() : extra.experiment;
  const { experiment: _experiment, ...rest } = extra;
  return pageBehaviorSummarySchema.parse({
    sessionId: SID,
    locale: "zh-TW",
    device: "desktop",
    viewportW: 1440,
    viewportH: 900,
    timezone: "Asia/Taipei",
    durationSec: 3,
    maxScroll: 10,
    referrerHost: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    sections: [{ id: "offer-form", dwellSec: 2 }],
    clicks: [],
    experiment,
    funnel: bodyFunnel(),
    ...rest,
  });
}

type NotionCall = { url: string; method: string; body: Record<string, unknown> | undefined };

function notionHarness(answers: Array<{ status: number; body: unknown } | Error>) {
  const calls: NotionCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    const answer = answers.shift() ?? { status: 200, body: { id: "page-default" } };
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const lines: string[] = [];
  let clock = 1_000_000;
  const store = createBehaviorNotion({
    fetchImpl,
    env: { NOTION_API_KEY: UX_KEY, NOTION_UX_DB_ID: UX_DB },
    now: () => clock,
    log: (text) => lines.push(text),
  });
  return { calls, lines, store, advance: (ms: number) => (clock += ms) };
}

function sectionsText(call: NotionCall | undefined): string {
  const properties = call?.body?.properties as
    | { Sections?: { rich_text?: { text?: { content?: string } }[] } }
    | undefined;
  return properties?.Sections?.rich_text?.[0]?.text?.content ?? "";
}

function storedPopup(call: NotionCall | undefined) {
  return parseBehaviorSections(sectionsText(call));
}

const NOT_FOUND = {
  status: 404,
  body: {
    object: "error",
    status: 404,
    code: "object_not_found",
    message: "Could not find page with ID: 0123456789abcdef0123456789abcdef.",
  },
};

test("a later same-session summary keeps the popup this instance already stored", async () => {
  const notion = read("src/lib/api/behaviorNotion.ts");
  assert.equal(notion.includes("localStorage"), false);
  assert.equal(notion.includes("sessionStorage"), false);
  const { calls, store } = notionHarness([
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-1" } },
  ]);
  const viewed = await store.write(
    behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }),
    "SG",
  );
  assert.deepEqual(viewed, { stored: true });
  const laterPlacements = emptySegmentPlacements();
  laterPlacements.bottom.submitAttempted = true;
  const kept = await store.write(
    behaviorSummary({
      durationSec: 40,
      funnel: bodyFunnel({
        formVisible: true,
        placements: laterPlacements,
      }),
    }),
    "SG",
  );
  assert.deepEqual(kept, { stored: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].url, "https://api.notion.com/v1/pages/page-1");
  assert.equal(calls.some((call) => call.url.includes("/query")), false);
  const patched = storedPopup(calls[1]);
  assert.equal(patched.funnel?.exposed, true);
  assert.equal(patched.funnel?.formVisible, true);
  assert.equal(patched.funnel?.formFocused, false);
  assert.equal(patched.funnel?.submitAttempted, false);
  assert.equal(patched.funnel?.placements?.bottom.submitAttempted, true);
  assert.equal(patched.funnel?.placements?.middle.formVisible, false);
  assert.equal(patched.funnel?.popup?.visible, true);
  assert.equal(patched.funnel?.popup?.formVisible, true);
  assert.equal(patched.funnel?.popup?.focused, true);
  assert.equal(patched.funnel?.popup?.submitAttempted, true);
  assert.equal(patched.funnel?.popup?.accepted, true);
  assert.equal(patched.funnel?.popup?.result, "pending");
  assert.equal(patched.funnel?.popup?.dismissed, false);
  assert.equal(patched.funnel?.popup?.failed, false);
  assert.equal(patched.funnel?.popup?.closed, false);
  assert.equal(patched.funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(patched.funnel?.popup?.observedAt?.formVisible, AT + 2);
  assert.equal(patched.funnel?.popup?.observedAt?.focused, AT + 3);
  assert.equal(patched.funnel?.popup?.observedAt?.submitAttempted, AT + 4);
  assert.equal(patched.funnel?.popup?.observedAt?.accepted, AT + 5);
  assert.equal(sectionsText(calls[1]).includes("@"), false);
  const properties = calls[1].body?.properties as { Duration?: { number?: number } };
  assert.equal(properties.Duration?.number, 40);

  const upgraded = await store.write(
    behaviorSummary({
      funnel: bodyFunnel({
        formFocused: true,
        popup: popup({
          visible: true,
          accepted: true,
          result: "already_verified",
          dismissed: true,
          observedAt: { visible: AT + 50, accepted: AT + 60, dismissed: AT + 70 },
        }),
      }),
    }),
    "SG",
  );
  assert.deepEqual(upgraded, { stored: true });
  const unioned = storedPopup(calls[2]);
  assert.equal(unioned.funnel?.formFocused, true);
  assert.equal(unioned.funnel?.formVisible, false);
  assert.equal(unioned.funnel?.submitAttempted, false);
  assert.equal(unioned.funnel?.popup?.result, "already_verified");
  assert.equal(unioned.funnel?.popup?.visible, true);
  assert.equal(unioned.funnel?.popup?.formVisible, true);
  assert.equal(unioned.funnel?.popup?.accepted, true);
  assert.equal(unioned.funnel?.popup?.dismissed, true);
  assert.equal(unioned.funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(unioned.funnel?.popup?.observedAt?.formVisible, AT + 2);
  assert.equal(unioned.funnel?.popup?.observedAt?.accepted, AT + 5);
  assert.equal(unioned.funnel?.popup?.observedAt?.dismissed, AT + 70);
  assert.equal(calls[2].method, "PATCH");
  assert.equal(calls[2].url, "https://api.notion.com/v1/pages/page-1");

  const legacy = experimentContextSchema.parse({
    experimentId: EXPERIMENT_ID,
    variant: "form_first",
    sessionId: SID,
    assignedAt: AT,
    team: "organic",
    qa: false,
  });
  const cold = notionHarness([{ status: 200, body: { id: "legacy-1" } }, { status: 200, body: { id: "legacy-1" } }]);
  await cold.store.write(
    behaviorSummary({
      experiment: legacy,
      funnel: {
        exposed: true,
        formVisible: false,
        formFocused: false,
        submitAttempted: false,
        popup: seenPopup(),
      },
    }),
    "SG",
  );
  await cold.store.write(
    behaviorSummary({
      durationSec: 9,
      experiment: legacy,
      funnel: { exposed: true, formVisible: false, formFocused: false, submitAttempted: false },
    }),
    "SG",
  );
  assert.equal(cold.calls[1].method, "PATCH");
  assert.equal(storedPopup(cold.calls[1]).funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(storedPopup(cold.calls[1]).funnel?.popup?.accepted, true);
  assert.equal(storedPopup(cold.calls[1]).funnel?.submitAttempted, false);
});

test("another session, QA bit, or experiment context does not inherit a stored popup", async () => {
  const primed = notionHarness([
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-2" } },
    { status: 200, body: { id: "page-1" } },
  ]);
  await primed.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  await primed.store.write(
    behaviorSummary({
      sessionId: OTHER,
      experiment: segmentContext({ sessionId: OTHER }),
      funnel: bodyFunnel(),
    }),
    "SG",
  );
  assert.equal(primed.calls[1].method, "POST");
  assert.equal(storedPopup(primed.calls[1]).funnel?.popup, undefined);
  assert.equal(sectionsText(primed.calls[1]).includes("entry-popup"), false);
  await primed.store.write(behaviorSummary({ durationSec: 11, funnel: bodyFunnel() }), "SG");
  assert.equal(primed.calls[2].method, "PATCH");
  assert.equal(primed.calls[2].url, "https://api.notion.com/v1/pages/page-1");
  assert.equal(storedPopup(primed.calls[2]).funnel?.popup?.observedAt?.accepted, AT + 5);

  const mismatches = [
    segmentContext({ qa: true }),
    segmentContext({ team: "A" }),
    segmentContext({ assignedAt: AT + 1 }),
    segmentContext({ entrySegment: "freediving" }),
    segmentContext({ acquisitionPlacement: "entry-popup" }),
    segmentContext({ sessionId: OTHER }),
  ];
  for (const experiment of mismatches) {
    const one = notionHarness([
      { status: 200, body: { id: "page-1" } },
      { status: 200, body: { id: "page-1" } },
    ]);
    await one.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
    await one.store.write(behaviorSummary({ durationSec: 12, experiment, funnel: bodyFunnel() }), "SG");
    assert.equal(one.calls[1].method, "PATCH", JSON.stringify(experiment));
    assert.equal(storedPopup(one.calls[1]).funnel?.popup, undefined, JSON.stringify(experiment));
    assert.equal(storedPopup(one.calls[1]).context?.qa, experiment.qa);
  }

  const wiped = notionHarness([
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-1" } },
    { status: 200, body: { id: "page-1" } },
  ]);
  await wiped.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  await wiped.store.write(
    behaviorSummary({ experiment: segmentContext({ qa: true }), funnel: bodyFunnel() }),
    "SG",
  );
  await wiped.store.write(behaviorSummary({ durationSec: 13, funnel: bodyFunnel() }), "SG");
  assert.equal(storedPopup(wiped.calls[2]).funnel?.popup, undefined);

  const fresh = notionHarness([{ status: 200, body: { id: "page-9" } }]);
  await fresh.store.write(behaviorSummary({ durationSec: 14, funnel: bodyFunnel() }), "SG");
  assert.equal(fresh.calls.length, 1);
  assert.equal(fresh.calls[0].method, "POST");
  assert.equal(fresh.calls[0].url.includes("/query"), false);
  assert.equal(storedPopup(fresh.calls[0]).funnel?.popup, undefined);
});

test("a failed write does not invent a popup, and a failed update still carries one already stored", async () => {
  const missed = notionHarness([
    new TypeError("fetch failed"),
    { status: 200, body: { id: "page-1" } },
  ]);
  assert.deepEqual(
    await missed.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG"),
    { stored: false, reason: "failed" },
  );
  assert.deepEqual(await missed.store.write(behaviorSummary({ funnel: bodyFunnel() }), "SG"), {
    stored: true,
  });
  assert.equal(storedPopup(missed.calls[1]).funnel?.popup, undefined);
  assert.equal(missed.lines.some((line) => line.includes(SID) || line.includes("@")), false);

  const replaced = notionHarness([
    { status: 200, body: { id: "page-1" } },
    NOT_FOUND,
    { status: 200, body: { id: "page-2" } },
    { status: 200, body: { id: "page-2" } },
  ]);
  await replaced.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  assert.deepEqual(
    await replaced.store.write(behaviorSummary({ durationSec: 20, funnel: bodyFunnel() }), "SG"),
    { stored: true },
  );
  assert.deepEqual(
    replaced.calls.map((call) => call.method),
    ["POST", "PATCH", "POST"],
  );
  assert.equal(replaced.calls[2].url, "https://api.notion.com/v1/pages");
  assert.equal(storedPopup(replaced.calls[2]).funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(storedPopup(replaced.calls[2]).funnel?.popup?.accepted, true);
  await replaced.store.write(behaviorSummary({ durationSec: 21, funnel: bodyFunnel() }), "SG");
  assert.equal(replaced.calls[3].method, "PATCH");
  assert.equal(replaced.calls[3].url, "https://api.notion.com/v1/pages/page-2");
  assert.equal(storedPopup(replaced.calls[3]).funnel?.popup?.observedAt?.formVisible, AT + 2);

  const stalled = notionHarness([
    { status: 200, body: { id: "page-1" } },
    new TypeError("patch down"),
    new TypeError("post down"),
    { status: 400, body: { object: "error", status: 400, code: "validation_error", message: "nope" } },
    { status: 200, body: { id: "page-3" } },
  ]);
  await stalled.store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  assert.deepEqual(
    await stalled.store.write(behaviorSummary({ durationSec: 30, funnel: bodyFunnel() }), "SG"),
    { stored: false, reason: "failed" },
  );
  assert.deepEqual(
    stalled.calls.slice(0, 3).map((call) => call.method),
    ["POST", "PATCH", "POST"],
  );
  assert.equal(storedPopup(stalled.calls[2]).funnel?.popup?.observedAt?.accepted, AT + 5);
  assert.deepEqual(
    await stalled.store.write(behaviorSummary({ durationSec: 31, funnel: bodyFunnel() }), "SG"),
    { stored: false, reason: "failed" },
  );
  assert.equal(stalled.calls[3].method, "POST");
  assert.equal(storedPopup(stalled.calls[3]).funnel?.popup?.visible, true);
  stalled.advance(61_000);
  assert.deepEqual(
    await stalled.store.write(behaviorSummary({ durationSec: 32, funnel: bodyFunnel() }), "SG"),
    { stored: true },
  );
  assert.equal(stalled.calls[4].method, "POST");
  assert.equal(storedPopup(stalled.calls[4]).funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(storedPopup(stalled.calls[4]).funnel?.popup?.result, "pending");
  assert.equal(stalled.lines.some((line) => line.includes("@") || line.includes(UX_KEY)), false);
});

test("a session dropped from the 500-row map is not backfilled from Notion", async () => {
  assert.match(read("src/lib/api/behaviorNotion.ts"), /const SESSION_PAGES_MAX = 500/);
  // SID plus 499 other sessions fills the map. The next new session drops SID.
  // One update while SID is still resident must keep the popup. After the drop,
  // the next write is a new row and does not query the old one.
  const writes = 1 + 499 + 1 + 1 + 1;
  const { calls, store } = notionHarness(
    Array.from({ length: writes }, () => ({ status: 200, body: { id: "page-1" } })),
  );
  await store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  for (let i = 0; i < 499; i++) {
    const sessionId = crypto.randomUUID();
    await store.write(
      behaviorSummary({
        sessionId,
        experiment: segmentContext({ sessionId }),
        funnel: bodyFunnel(),
      }),
      "SG",
    );
  }
  await store.write(behaviorSummary({ durationSec: 15, funnel: bodyFunnel() }), "SG");
  assert.equal(calls[500].method, "PATCH");
  assert.equal(calls[500].url, "https://api.notion.com/v1/pages/page-1");
  assert.equal(storedPopup(calls[500]).funnel?.popup?.observedAt?.visible, AT + 1);
  const sessionId = crypto.randomUUID();
  await store.write(
    behaviorSummary({
      sessionId,
      experiment: segmentContext({ sessionId }),
      funnel: bodyFunnel(),
    }),
    "SG",
  );
  const again = calls.length;
  await store.write(behaviorSummary({ durationSec: 16, funnel: bodyFunnel() }), "SG");
  assert.equal(calls[again].method, "POST");
  assert.equal(calls[again].url, "https://api.notion.com/v1/pages");
  assert.equal(calls[again].url.includes("/query"), false);
  assert.equal(storedPopup(calls[again]).funnel?.popup, undefined);
});

test("overlapping writes for one session keep the stored popup on that row", async () => {
  const calls: NotionCall[] = [];
  let releaseFirst: () => void = () => {};
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let n = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    });
    n += 1;
    if (n === 1) {
      started();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return new Response(JSON.stringify({ id: "page-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  const store = createBehaviorNotion({
    fetchImpl,
    env: { NOTION_API_KEY: UX_KEY, NOTION_UX_DB_ID: UX_DB },
    now: () => 1_000_000,
    log: () => {},
  });
  const first = store.write(behaviorSummary({ funnel: bodyFunnel({ popup: seenPopup() }) }), "SG");
  await startedPromise;
  const second = store.write(behaviorSummary({ durationSec: 8, funnel: bodyFunnel({ formVisible: true }) }), "SG");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  releaseFirst();
  assert.deepEqual(await first, { stored: true });
  assert.deepEqual(await second, { stored: true });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "PATCH"],
  );
  assert.equal(calls[1].url, "https://api.notion.com/v1/pages/page-1");
  const patched = storedPopup(calls[1]);
  assert.equal(patched.funnel?.formVisible, true);
  assert.equal(patched.funnel?.popup?.visible, true);
  assert.equal(patched.funnel?.popup?.accepted, true);
  assert.equal(patched.funnel?.popup?.observedAt?.visible, AT + 1);
  assert.equal(patched.funnel?.popup?.observedAt?.accepted, AT + 5);
  assert.equal(patched.funnel?.submitAttempted, false);
});
