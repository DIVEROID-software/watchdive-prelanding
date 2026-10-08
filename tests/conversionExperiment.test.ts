import assert from "node:assert/strict";
import test from "node:test";

import { shouldDiscardBehaviorUserAgent } from "../src/lib/api/behaviorAudience.ts";
import { behaviorProperties } from "../src/lib/api/behaviorNotion.ts";
import {
  EXPERIMENT_ID,
  EXPERIMENT_MATURITY_MS,
  encodeBehaviorSections,
  encodeLeadExperiment,
  experimentContextSchema,
  FIELD_CONVERSION_EXPERIMENT,
  parseBehaviorSections,
  type ExperimentContext,
  type ExperimentFunnel,
} from "../src/lib/conversionExperimentContract.ts";
import {
  buildExperimentReport,
  experimentReportAuthorized,
  handleExperimentReport,
  type NotionPageLike,
} from "../src/lib/experimentReport.ts";
import { pageBehaviorSummarySchema } from "../src/lib/pageBehaviorSummary.ts";
import {
  FIELD_EMAIL_VERIFIED,
  FIELD_MEASUREMENT_CONSENT,
  FIELD_SIGNED_UP,
  FIELD_SUSPECT,
  FIELD_VERIFICATION_STATUS,
  FIELD_VERIFIED_AT,
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHDRAWN,
} from "../src/lib/verification/contracts.ts";
import { createNotionLeadStore, NotionRequestError, type NotionRequest } from "../src/lib/verification/notionLead.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

const SESSION = "8d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
const OTHER = "9d8b6c3e-1f4a-4e2b-9c7d-0a1b2c3d4e5f";
const NOW = Date.parse("2026-10-10T00:00:00.000Z");
const MATURE_AT = NOW - EXPERIMENT_MATURITY_MS - 60 * 60 * 1000;
const FRESH_AT = NOW - 60 * 60 * 1000;
const TOKEN = "r".repeat(32);
const FBC = "fb.1.1710000000000.AbcdEFGHijkl";

const sampleSummary = {
  sessionId: SESSION,
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

function context(overrides: Partial<ExperimentContext> = {}): ExperimentContext {
  return {
    experimentId: EXPERIMENT_ID,
    variant: "control",
    sessionId: SESSION,
    assignedAt: MATURE_AT,
    team: "A",
    qa: false,
    ...overrides,
  };
}

function funnel(overrides: Partial<ExperimentFunnel> = {}): ExperimentFunnel {
  return { exposed: true, formVisible: false, formFocused: false, submitAttempted: false, ...overrides };
}

function rich(value: string) {
  return { rich_text: [{ plain_text: value }] };
}

function behaviorPage(ctx: ExperimentContext, marks: ExperimentFunnel, title = ctx.sessionId): NotionPageLike {
  return {
    properties: {
      Name: { title: [{ plain_text: title }] },
      Sections: rich(encodeBehaviorSections("offer-form 12s", ctx, marks)),
    },
  };
}

function leadPage(options: {
  ctx: ExperimentContext;
  email?: string;
  canonical?: string;
  signedUp?: number;
  verifiedAt?: number;
  consent?: string;
  suspect?: boolean;
  duplicate?: boolean;
  flags?: string[];
  raw?: string;
}): NotionPageLike {
  const signedUp = new Date(options.signedUp ?? options.ctx.assignedAt + 60_000).toISOString();
  return {
    properties: {
      Email: { title: [{ plain_text: options.email ?? "diver@example.com" }] },
      "Canonical email": { email: options.canonical ?? options.email ?? "diver@example.com" },
      [FIELD_CONVERSION_EXPERIMENT]: rich(options.raw ?? encodeLeadExperiment(options.ctx)!),
      [FIELD_MEASUREMENT_CONSENT]: rich(options.consent ?? MEASUREMENT_CONSENT_GRANTED),
      [FIELD_SUSPECT]: { checkbox: options.suspect ?? false },
      Duplicate: { checkbox: options.duplicate ?? false },
      Flags: { multi_select: (options.flags ?? []).map((name) => ({ name })) },
      [FIELD_SIGNED_UP]: { date: { start: signedUp } },
      [FIELD_VERIFICATION_STATUS]: { select: { name: options.verifiedAt ? "verified" : "pending" } },
      [FIELD_EMAIL_VERIFIED]: { checkbox: Boolean(options.verifiedAt) },
      ...(options.verifiedAt
        ? { [FIELD_VERIFIED_AT]: { date: { start: new Date(options.verifiedAt).toISOString() } } }
        : {}),
    },
  };
}

function report(behavior: NotionPageLike[], leads: NotionPageLike[] = [], now = NOW) {
  return buildExperimentReport({
    now,
    behavior: { availability: "ok", pages: behavior, truncated: false },
    leads: { availability: "ok", column: "present", pages: leads, truncated: false },
  });
}

test("the contract is the six fields the browser already sends", () => {
  const value = context();
  assert.deepEqual(experimentContextSchema.parse(value), value);
  assert.deepEqual(Object.keys(experimentContextSchema.parse(value)).sort(), [
    "assignedAt",
    "experimentId",
    "qa",
    "sessionId",
    "team",
    "variant",
  ]);
  assert.equal(experimentContextSchema.safeParse({ ...value, variant: "other" }).success, false);
  assert.equal(experimentContextSchema.safeParse({ ...value, assignedAt: 1.5 }).success, false);
});

test("a bad experiment object does not reject the rest of a behavior summary", () => {
  const parsed = pageBehaviorSummarySchema.parse({
    ...sampleSummary,
    experiment: { experimentId: "nope" },
    funnel: { exposed: "yes" },
  });
  assert.equal(parsed.experiment, undefined);
  assert.equal(parsed.funnel, undefined);
  assert.equal(parsed.sessionId, SESSION);
  const kept = pageBehaviorSummarySchema.parse({
    ...sampleSummary,
    experiment: context({ assignedAt: FRESH_AT }),
    funnel: funnel({ formVisible: true }),
  });
  assert.equal(kept.experiment?.variant, "control");
  assert.equal(kept.funnel?.formVisible, true);
});

test("experiment context rides inside Sections and leaves the live columns unchanged", () => {
  const plain = behaviorProperties(sampleSummary, "KR");
  assert.deepEqual(Object.keys(plain).sort(), [
    "Campaign",
    "Clicks",
    "Country",
    "Device",
    "Duration",
    "Locale",
    "Name",
    "Referrer",
    "Scroll",
    "Sections",
    "Timezone",
    "Viewport",
  ]);
  assert.equal(
    (plain.Sections as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content,
    "offer-form 12s",
  );
  const encoded = behaviorProperties(
    {
      ...sampleSummary,
      experiment: context(),
      funnel: funnel({ formFocused: true }),
    },
    "KR",
  );
  const text = (encoded.Sections as { rich_text: { text: { content: string } }[] }).rich_text[0].text
    .content;
  assert.ok(text.startsWith("offer-form 12s\n"));
  assert.ok(text.length < 1900);
  const parsed = parseBehaviorSections(text);
  assert.equal(parsed.malformed, false);
  assert.equal(parsed.context?.variant, "control");
  assert.equal(parsed.funnel?.formFocused, true);
  assert.equal(parsed.funnel?.formVisible, false);
  assert.equal(parsed.funnel?.exposed, true);
  assert.equal(text.includes("@"), false);
});

test("duplicate session rows are one exposure and a partial row does not erase an earlier milestone", () => {
  const result = report([
    behaviorPage(context(), funnel()),
    behaviorPage(context({ assignedAt: MATURE_AT + 5_000 }), funnel({ formFocused: true })),
  ]);
  assert.equal(result.total.counts.sessions, 1);
  assert.equal(result.total.counts.formFocused, 1);
  assert.equal(result.total.counts.formVisible, 0);
  assert.equal(result.quality.milestoneGaps, 1);
  assert.equal(result.byArm.control.byTeam.A.counts.sessions, 1);
  assert.equal(result.byArm.form_first.total.counts.sessions, 0);
  assert.equal(result.decision.winner, null);
});

test("inconsistent arms, QA, and missing exposure stay out of the denominator", () => {
  const mixed = report([
    behaviorPage(context(), funnel()),
    behaviorPage(context({ variant: "form_first" }), funnel({ formVisible: true })),
    behaviorPage(context({ sessionId: OTHER, qa: true }), funnel(), OTHER),
    behaviorPage(context({ sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000009", team: "B" }), funnel({ exposed: false }), "aaaaaaaa-bbbb-4ccc-8ddd-000000000009"),
  ]);
  assert.equal(mixed.total.counts.sessions, 0);
  assert.equal(mixed.quality.inconsistentSessions, 1);
  assert.equal(mixed.quality.qaExcludedSessions, 1);
  assert.equal(mixed.quality.contextWithoutExposure, 1);
});

test("a consented exposure stays in the denominator when no lead was saved", () => {
  const result = report([behaviorPage(context(), funnel({ formVisible: true }))]);
  assert.equal(result.total.counts.sessions, 1);
  assert.equal(result.total.counts.newEmails, 0);
  assert.equal(result.quality.unmatchedLeads, 0);
});

test("server truth excludes withdrawn, suspect, duplicate, and unmatched leads", () => {
  const ctx = context();
  const result = report(
    [behaviorPage(ctx, funnel({ submitAttempted: true }))],
    [
      leadPage({ ctx, verifiedAt: ctx.assignedAt + 60_000 }),
      leadPage({
        ctx: context({ sessionId: OTHER }),
        email: "other@example.com",
        consent: MEASUREMENT_CONSENT_WITHDRAWN,
      }),
      leadPage({
        ctx: context({ sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000002" }),
        email: "suspect@example.com",
        suspect: true,
      }),
      leadPage({
        ctx: context({ sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000003" }),
        email: "copy@example.com",
        canonical: "diver@example.com",
      }),
      leadPage({
        ctx: context({ team: "B" }),
        email: "mismatch@example.com",
      }),
      leadPage({
        ctx: context({ sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000005" }),
        email: "alone@example.com",
      }),
    ],
  );
  assert.equal(result.total.counts.newEmails, 1);
  assert.equal(result.total.counts.verifiedWithin48h, 1);
  assert.equal(result.quality.withdrawnExcluded, 1);
  assert.equal(result.quality.suspectExcluded, 1);
  assert.equal(result.quality.duplicateExcluded, 1);
  assert.equal(result.quality.mismatchedLeads, 1);
  assert.equal(result.quality.unmatchedLeads, 1);
  const body = JSON.stringify(result);
  for (const secret of ["diver@example.com", "other@example.com", SESSION, "fb.1"]) {
    assert.equal(body.includes(secret), false, secret);
  }
});

test("48 hour maturity uses first exposure and does not treat a fresh session as finished", () => {
  const mature = context({ assignedAt: MATURE_AT });
  const fresh = context({ sessionId: OTHER, variant: "form_first", assignedAt: FRESH_AT });
  const lateVerified = context({
    sessionId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000006",
    team: "C",
    assignedAt: MATURE_AT,
  });
  const result = report(
    [
      behaviorPage(mature, funnel({ submitAttempted: true })),
      behaviorPage(fresh, funnel({ submitAttempted: true }), OTHER),
      behaviorPage(lateVerified, funnel({ submitAttempted: true }), lateVerified.sessionId),
    ],
    [
      leadPage({ ctx: mature, verifiedAt: mature.assignedAt + 2 * 60 * 60 * 1000 }),
      leadPage({
        ctx: fresh,
        email: "fresh@example.com",
        verifiedAt: fresh.assignedAt + 30 * 60 * 1000,
      }),
      leadPage({
        ctx: lateVerified,
        email: "late@example.com",
        verifiedAt: lateVerified.assignedAt + EXPERIMENT_MATURITY_MS + 60_000,
      }),
    ],
  );
  assert.equal(result.total.counts.sessions, 3);
  assert.equal(result.total.counts.matureSessions, 2);
  assert.equal(result.total.counts.verifiedWithin48h, 2);
  assert.equal(result.total.counts.matureVerifiedWithin48h, 1);
  assert.equal(result.quality.immatureSessions, 1);
  assert.equal(result.quality.lateEvents, 1);
  assert.equal(result.complete, true);
  assert.equal(result.decision.ready, false);
  assert.equal(result.decision.matureCohortAvailable, true);
  assert.equal(result.decision.winner, null);
  assert.equal(result.total.counts.newEmails, 3);
  assert.equal(result.total.counts.sessionsWithNewEmail, 3);
  assert.equal(result.total.counts.sessionsWithVerifiedEmail, 2);
  assert.equal(result.total.counts.matureSessionsWithNewEmail, 2);
  assert.equal(result.total.counts.matureSessionsWithVerifiedEmail, 1);
  assert.equal(result.total.counts.immatureSessionsWithNewEmail, 1);
  assert.equal(result.total.rates.matureVerifiedWithin48hPerMatureSession, 0.5);
  assert.equal(result.total.rates.matureNewEmailPerSession, 1);
  assert.equal(result.total.rates.matureVerifiedEmailPerSession, 0.5);
  assert.equal(result.total.rates.savedEmailSessionsPerSession, 1);
});

test("missing schema and a failed read are unavailable, not zero", () => {
  const missing = buildExperimentReport({
    now: NOW,
    behavior: {
      availability: "ok",
      pages: [behaviorPage(context(), funnel())],
      truncated: false,
    },
    leads: { availability: "unavailable", column: "missing", pages: [], truncated: false },
  });
  assert.equal(missing.total.counts.sessions, 1);
  assert.equal(missing.total.counts.newEmails, null);
  assert.equal(missing.sources.conversionExperimentColumn, "missing");
  assert.equal(missing.complete, false);
  assert.equal(missing.decision.winner, null);

  const unread = buildExperimentReport({
    now: NOW,
    behavior: { availability: "unconfigured", pages: [], truncated: false },
    leads: { availability: "unconfigured", column: "unknown", pages: [], truncated: false },
  });
  assert.equal(unread.total.counts.sessions, null);
  assert.equal(unread.total.counts.newEmails, null);
  assert.equal(unread.total.counts.sessions === 0, false);

  const partial = buildExperimentReport({
    now: NOW,
    behavior: {
      availability: "ok",
      pages: [behaviorPage(context(), funnel())],
      truncated: true,
    },
    leads: { availability: "ok", column: "present", pages: [], truncated: false },
  });
  assert.equal(partial.complete, false);
  assert.equal(partial.partial, true);
  assert.equal(partial.decision.ready, false);
});

test("the report route rejects every bad token before a database read", async () => {
  let reads = 0;
  const source = {
    env: {
      NOTION_API_KEY: "ntn_test",
      NOTION_UX_DB_ID: "db",
      NOTION_WAITLIST_DB_ID: "wait",
      WATCHDIVE_EXPERIMENT_REPORT_TOKEN: TOKEN,
    },
    now: () => NOW,
    behaviorQuery: async () => {
      reads += 1;
      return { ok: true as const, page: { results: [], has_more: false } };
    },
    waitlistRequest: (async () => {
      reads += 1;
      return { results: [], has_more: false };
    }) as NotionRequest,
  };
  for (const header of [null, "Bearer nope", `Bearer ${"r".repeat(31)}`, "Bearer "]) {
    const response = await handleExperimentReport(new Request("https://watchdive.diveroid.com/api/experiment-report", { headers: header ? { authorization: header } : {} }), {
      ...source,
      env: { ...source.env, WATCHDIVE_EXPERIMENT_REPORT_TOKEN: header?.includes("r".repeat(31)) && !header.includes(TOKEN) ? "r".repeat(31) : TOKEN },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  const unset = await handleExperimentReport(
    new Request("https://watchdive.diveroid.com/api/experiment-report", {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
    { ...source, env: { ...source.env, WATCHDIVE_EXPERIMENT_REPORT_TOKEN: " " } },
  );
  assert.equal(unset.status, 401);
  assert.equal(reads, 0);
  assert.equal(experimentReportAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(experimentReportAuthorized(`Bearer ${TOKEN}`, `${TOKEN}x`), false);
});

test("an authorized report reads both stores and still hides raw ids", async () => {
  const calls: string[] = [];
  const response = await handleExperimentReport(
    new Request("https://watchdive.diveroid.com/api/experiment-report", {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
    {
      env: {
        NOTION_API_KEY: "ntn_test",
        NOTION_UX_DB_ID: "ux-db",
        NOTION_WAITLIST_DB_ID: "wait-db",
        WATCHDIVE_EXPERIMENT_REPORT_TOKEN: TOKEN,
      },
      now: () => NOW,
      behaviorQuery: async (body) => {
        calls.push(JSON.stringify(body.filter));
        return {
          ok: true,
          page: {
            results: [behaviorPage(context(), funnel({ submitAttempted: true }))],
            has_more: false,
          },
        };
      },
      waitlistRequest: (async (_method, path, body) => {
        calls.push(path);
        assert.equal((body as { filter: { property: string } }).filter.property, FIELD_CONVERSION_EXPERIMENT);
        return {
          results: [leadPage({ ctx: context(), verifiedAt: MATURE_AT + 1_000 })],
          has_more: false,
        };
      }) as NotionRequest,
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total.counts.sessions, 1);
  assert.equal(body.total.counts.matureVerifiedWithin48h, 1);
  assert.equal(body.decision.winner, null);
  assert.equal(JSON.stringify(body).includes(SESSION), false);
  assert.equal(JSON.stringify(body).includes("diver@example.com"), false);
  assert.ok(calls.some((call) => call.includes("[[wd-exp]]")));
  assert.ok(calls.some((call) => call.includes("databases/wait-db/query")));
});

test("a missing experiment column is a validation 400 and does not become zero leads", async () => {
  const response = await handleExperimentReport(
    new Request("https://watchdive.diveroid.com/api/experiment-report", {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
    {
      env: {
        NOTION_API_KEY: "ntn_test",
        NOTION_UX_DB_ID: "ux-db",
        NOTION_WAITLIST_DB_ID: "wait-db",
        WATCHDIVE_EXPERIMENT_REPORT_TOKEN: TOKEN,
      },
      now: () => NOW,
      behaviorQuery: async () => ({
        ok: true,
        page: { results: [behaviorPage(context(), funnel())], has_more: false },
      }),
      waitlistRequest: (async () => {
        throw new NotionRequestError(
          400,
          JSON.stringify({
            code: "validation_error",
            message: "Conversion experiment is not a property that exists.",
          }),
        );
      }) as NotionRequest,
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sources.conversionExperimentColumn, "missing");
  assert.equal(body.total.counts.sessions, 1);
  assert.equal(body.total.counts.newEmails, null);
  assert.equal(body.complete, false);
  assert.equal(body.decision.winner, null);
  assert.equal(body.decision.ready, false);
  assert.equal(body.decision.matureCohortAvailable, false);
});

test("optional column loss does not drop a real signup or its first touch", async () => {
  const previousFbc = process.env.NOTION_META_FBC_PROPERTY;
  const previousFbclid = process.env.NOTION_FBCLID_PROPERTY;
  process.env.NOTION_META_FBC_PROPERTY = "Meta FBC";
  process.env.NOTION_FBCLID_PROPERTY = "FBCLID";
  const calls: Record<string, unknown>[] = [];
  try {
    const request: NotionRequest = async (_method, _path, body) => {
      calls.push((body ?? {}) as Record<string, unknown>);
      const properties = (body as { properties?: Record<string, unknown> }).properties ?? {};
      if (properties[FIELD_CONVERSION_EXPERIMENT]) {
        throw new (await import("../src/lib/verification/notionLead.ts")).NotionRequestError(
          400,
          JSON.stringify({
            code: "validation_error",
            message: "Conversion experiment is not a property that exists.",
          }),
        );
      }
      return { id: "page-1", properties: { Email: { title: [{ plain_text: "diver@example.com" }] } } };
    };
    const store = createNotionLeadStore(request, "wait-db");
    const record = await store.createPending({
      email: "diver@example.com",
      canonical: "diver@example.com",
      source: "hero",
      refCode: "abcd1234",
      flags: [],
      suspect: false,
      signedUpAt: new Date(NOW).toISOString(),
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
      expiresAt: new Date(NOW + 86_400_000).toISOString(),
      attribution: { utmSource: "meta", utmCampaign: "launch", landingPath: "/", fbclid: "click123" },
      metaFbc: FBC,
      measurementGranted: true,
      experiment: context(),
    });
    assert.equal(record.pageId, "page-1");
    assert.equal(calls.length, 2);
    const first = (calls[0].properties ?? {}) as Record<string, unknown>;
    const second = (calls[1].properties ?? {}) as Record<string, unknown>;
    assert.ok(FIELD_CONVERSION_EXPERIMENT in first);
    assert.equal(FIELD_CONVERSION_EXPERIMENT in second, false);
    assert.equal("UTM Source" in second, true);
    assert.equal("Meta FBC" in second, true);
    assert.equal(JSON.stringify(second).includes("diver@example.com"), true);
  } finally {
    if (previousFbc === undefined) delete process.env.NOTION_META_FBC_PROPERTY;
    else process.env.NOTION_META_FBC_PROPERTY = previousFbc;
    if (previousFbclid === undefined) delete process.env.NOTION_FBCLID_PROPERTY;
    else process.env.NOTION_FBCLID_PROPERTY = previousFbclid;
  }
});

test("a click-column validation keeps the experiment, and a 5xx is not retried", async () => {
  const previous = process.env.NOTION_META_FBC_PROPERTY;
  process.env.NOTION_META_FBC_PROPERTY = "Meta FBC";
  try {
    const kept: Record<string, unknown>[] = [];
    const request: NotionRequest = async (_method, _path, body) => {
      const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
      kept.push(properties);
      if (properties["Meta FBC"]) {
        const { NotionRequestError } = await import("../src/lib/verification/notionLead.ts");
        throw new NotionRequestError(
          400,
          JSON.stringify({ code: "validation_error", message: "Meta FBC is not a property that exists." }),
        );
      }
      return { id: "page-2", properties: { Email: { title: [{ plain_text: "diver@example.com" }] } } };
    };
    await createNotionLeadStore(request, "wait-db").createPending({
      email: "diver@example.com",
      canonical: "diver@example.com",
      source: "hero",
      refCode: "abcd1234",
      flags: [],
      suspect: false,
      signedUpAt: new Date(NOW).toISOString(),
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
      expiresAt: new Date(NOW + 86_400_000).toISOString(),
      metaFbc: FBC,
      measurementGranted: true,
      experiment: context(),
    });
    assert.equal(kept.length, 2);
    assert.equal(FIELD_CONVERSION_EXPERIMENT in kept[1], true);
    assert.equal("Meta FBC" in kept[1], false);

    let networkCalls = 0;
    const failing: NotionRequest = async () => {
      networkCalls += 1;
      throw new Error("socket hang up");
    };
    await assert.rejects(
      createNotionLeadStore(failing, "wait-db").createPending({
        email: "diver@example.com",
        canonical: "diver@example.com",
        source: "hero",
        refCode: "abcd1234",
        flags: [],
        suspect: false,
        signedUpAt: new Date(NOW).toISOString(),
        leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
        expiresAt: new Date(NOW + 86_400_000).toISOString(),
        metaFbc: FBC,
        measurementGranted: true,
        experiment: context(),
      }),
    );
    assert.equal(networkCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.NOTION_META_FBC_PROPERTY;
    else process.env.NOTION_META_FBC_PROPERTY = previous;
  }
});

test("first touch and experiment context are written once, and the response stays generic", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const clock = new Date("2026-10-08T12:00:00.000Z");
  const nextLeadId = leadIdFactory();
  const experiment = context({ assignedAt: clock.getTime() });
  const deps = () => ({
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: nextLeadId,
    refCode: () => "abcd1234",
    sleep: async () => {},
  });
  const base = {
    email: "diver@example.com",
    canonical: "diver@example.com",
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    attribution: { utmSource: "meta", utmCampaign: "launch", landingPath: "/" },
    experiment,
  };
  const created = await requestVerificationService(base, deps());
  assert.deepEqual(Object.keys(created).sort(), ["handle", "message", "ok", "status"]);
  assert.equal(JSON.stringify(created).includes("diver@example.com"), false);
  assert.equal(JSON.stringify(created).includes(SESSION), false);
  assert.equal(store.createPendingInputs.length, 1);
  assert.deepEqual(store.createPendingInputs[0].experiment, experiment);
  assert.equal(store.createPendingInputs[0].attribution?.utmSource, "meta");

  clock.setTime(clock.getTime() + 120_000);
  await requestVerificationService(
    { ...base, experiment: context({ variant: "form_first", assignedAt: clock.getTime() }) },
    deps(),
  );
  assert.equal(store.createPendingInputs.length, 1);
  assert.equal(store.startAttemptCalls, 1);
  assert.equal(store.createPendingInputs[0].experiment?.variant, "control");

  const noConsent = new FakeLeadStore();
  await requestVerificationService(
    { ...base, measurementConsent: false, experiment },
    { ...deps(), store: noConsent },
  );
  assert.equal(noConsent.createPendingInputs[0].experiment, undefined);

  const gpcStore = new FakeLeadStore();
  await requestVerificationService(
    { ...base, measurementConsent: true, experiment },
    { ...deps(), store: gpcStore, gpc: true },
  );
  assert.equal(gpcStore.createPendingInputs[0].experiment, undefined);
  assert.equal(gpcStore.createPendingInputs[0].measurementGranted, undefined);

  const suspectStore = new FakeLeadStore();
  await requestVerificationService(
    {
      ...base,
      email: "office@example.com",
      canonical: "office@example.com",
      suspect: true,
      flags: ["ip-repeat"],
      experiment,
    },
    { ...deps(), store: suspectStore },
  );
  assert.equal(suspectStore.createPendingInputs[0].experiment, undefined);

  const honeypot = new FakeLeadStore();
  await requestVerificationService(
    {
      ...base,
      email: "trap@example.com",
      canonical: "trap@example.com",
      suspect: true,
      flags: ["honeypot"],
      experiment,
    },
    { ...deps(), store: honeypot },
  );
  assert.equal(honeypot.createPendingInputs[0].experiment, undefined);
  assert.equal(honeypot.createPendingInputs[0].attribution?.utmCampaign, "launch");
});

test("clearing experiment context is best-effort and does not undo withdrawal", async () => {
  const patches: string[] = [];
  const request: NotionRequest = async (method, path, body) => {
    if (method === "GET") {
      return {
        id: "page-1",
        properties: {
          Email: { title: [{ plain_text: "diver@example.com" }] },
          Flags: { multi_select: [] },
        },
      };
    }
    const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
    if (properties[FIELD_CONVERSION_EXPERIMENT]) throw new Error("column missing");
    patches.push(path);
    return { id: "page-1", properties };
  };
  await createNotionLeadStore(request, "wait-db").recordMeasurementWithdrawal("page-1");
  assert.deepEqual(patches, ["pages/page-1"]);
});

test("malformed experiment text is ignored instead of counted", () => {
  const result = report(
    [behaviorPage(context(), funnel())],
    [leadPage({ ctx: context(), raw: "{not json" })],
  );
  assert.equal(result.total.counts.newEmails, 0);
  assert.equal(result.quality.malformedLeadRows, 1);
  assert.equal(result.total.counts.sessions, 1);
});

test("observed milestones are not filled in, and a saved email is not a frontend event", () => {
  const ctx = context();
  const focused = report([behaviorPage(ctx, funnel({ formFocused: true }))]);
  assert.equal(focused.total.counts.exposed, 1);
  assert.equal(focused.total.counts.formVisible, 0);
  assert.equal(focused.total.counts.formFocused, 1);
  assert.equal(focused.total.rates.formFocusedPerExposed, 1);
  assert.equal(focused.total.rates.formVisiblePerExposed, 0);
  assert.equal(focused.quality.milestoneGaps, 1);

  const submitted = report([
    behaviorPage(ctx, funnel({ formVisible: true, submitAttempted: true })),
  ]);
  assert.equal(submitted.total.counts.formFocused, 0);
  assert.equal(submitted.total.counts.submitAttempted, 1);
  assert.equal(submitted.quality.milestoneGaps, 1);

  const saved = report(
    [behaviorPage(ctx, funnel())],
    [leadPage({ ctx, email: "one@example.com" }), leadPage({ ctx, email: "two@example.com" })],
  );
  assert.equal(saved.total.counts.newEmails, 2);
  assert.equal(saved.total.counts.sessionsWithNewEmail, 1);
  assert.equal(saved.total.rates.newEmailSessionsPerSession, 1);
  assert.equal(saved.total.counts.formVisible, 0);
  assert.equal(saved.total.counts.formFocused, 0);
  assert.equal(saved.total.counts.submitAttempted, 0);
  assert.equal(saved.decision.ready, false);
  assert.equal(saved.decision.matureCohortAvailable, true);
});

test("a lead with no identity, a future signup, or a verification before signup is not counted as success", () => {
  const ctx = context();
  const blankIdentity = report(
    [behaviorPage(ctx, funnel())],
    [leadPage({ ctx, email: " ", canonical: " " })],
  );
  assert.equal(blankIdentity.total.counts.newEmails, 0);
  assert.equal(blankIdentity.quality.malformedLeadRows, 1);
  assert.equal(JSON.stringify(blankIdentity).includes("untagged"), false);

  const future = report(
    [behaviorPage(ctx, funnel())],
    [leadPage({ ctx, email: "future@example.com", signedUp: NOW + 11 * 60 * 1000 })],
  );
  assert.equal(future.total.counts.newEmails, 0);
  assert.equal(future.quality.futureTimestamps, 1);

  const earlyVerify = report(
    [behaviorPage(ctx, funnel())],
    [
      leadPage({
        ctx,
        email: "early@example.com",
        signedUp: ctx.assignedAt + 60_000,
        verifiedAt: ctx.assignedAt + 60_000 - 3 * 60 * 1000,
      }),
    ],
  );
  assert.equal(earlyVerify.total.counts.newEmails, 1);
  assert.equal(earlyVerify.total.counts.verifiedWithin48h, 0);
  assert.equal(earlyVerify.quality.verifiedBeforeSignup, 1);
});

test("obvious crawlers are discarded and Facebook or Instagram in-app browsers are kept", () => {
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36";
  const facebook = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/21F79 [FBAN/FBIOS;FBAV/460.0.0.0.0;]";
  const instagram = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/20G75 Instagram 312.0.0.0.0";
  assert.equal(shouldDiscardBehaviorUserAgent(chrome), false);
  assert.equal(shouldDiscardBehaviorUserAgent(facebook), false);
  assert.equal(shouldDiscardBehaviorUserAgent(instagram), false);
  assert.equal(shouldDiscardBehaviorUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(shouldDiscardBehaviorUserAgent("facebookexternalhit/1.1"), true);
  assert.equal(shouldDiscardBehaviorUserAgent("Mozilla/5.0 HeadlessChrome/129.0.0.0"), true);
  assert.equal(shouldDiscardBehaviorUserAgent("curl/8.7.1"), true);
  assert.equal(shouldDiscardBehaviorUserAgent(""), true);
  assert.equal(shouldDiscardBehaviorUserAgent(null), true);
  assert.equal(
    shouldDiscardBehaviorUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 WhatsApp/2.23.20.0"),
    true,
  );
});

test("a signup without experiment context does not duplicate an ambiguous page creation", async () => {
  const previous = process.env.NOTION_META_FBC_PROPERTY;
  process.env.NOTION_META_FBC_PROPERTY = "Meta FBC";
  try {
    let calls = 0;
    const request: NotionRequest = async (_method, _path, body) => {
      calls += 1;
      const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
      if (calls === 1) {
        assert.equal("Meta FBC" in properties, true);
        throw new Error("socket hang up");
      }
      assert.equal("Meta FBC" in properties, false);
      assert.equal(FIELD_CONVERSION_EXPERIMENT in properties, false);
      return { id: "page-legacy", properties: { Email: { title: [{ plain_text: "diver@example.com" }] } } };
    };
    await assert.rejects(
      createNotionLeadStore(request, "wait-db").createPending({
        email: "diver@example.com",
        canonical: "diver@example.com",
        source: "hero",
        refCode: "abcd1234",
        flags: [],
        suspect: false,
        signedUpAt: new Date(NOW).toISOString(),
        leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
        expiresAt: new Date(NOW + 86_400_000).toISOString(),
        metaFbc: FBC,
        measurementGranted: true,
      }),
      /socket hang up/,
    );
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.NOTION_META_FBC_PROPERTY;
    else process.env.NOTION_META_FBC_PROPERTY = previous;
  }
});
