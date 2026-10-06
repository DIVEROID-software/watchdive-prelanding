import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAttribution,
  readAttribution,
  sanitizeSignupAttribution,
} from "../src/lib/attribution.ts";
import {
  acceptsCompetitionCapture,
  acceptsCompetitionSignup,
  competitionStorageKey,
  resolveCompetitionAttribution,
} from "../src/lib/competitionAttribution.ts";
import { competitionRegistry, type CompetitionRound } from "../src/lib/competitionRegistry.ts";

const START = Date.parse("2026-10-06T00:00:00Z");
const END = START + 72 * 60 * 60 * 1000;
const round: CompetitionRound = {
  experimentId: "watchdive-test",
  roundId: "r1",
  campaignId: "100",
  captureStartsAt: "2026-10-05T23:00:00Z",
  signupStartsAt: "2026-10-06T00:00:00Z",
  signupEndsAt: "2026-10-09T00:00:00Z",
  ads: [
    { armId: "A", strategyVersion: "A-1", adsetId: "201", adId: "301" },
    { armId: "A", strategyVersion: "A-1", adsetId: "201", adId: "302" },
    { armId: "B", strategyVersion: "B-1", adsetId: "202", adId: "303" },
    { armId: "C", strategyVersion: "C-1", adsetId: "203", adId: "304" },
  ],
};
const A = { utmCampaign: "100", utmTerm: "201", utmContent: "301" };
const B = { utmCampaign: "100", utmTerm: "202", utmContent: "303" };

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function resolve(store: ReturnType<typeof storage>, tuple = A, now = START, registry = [round]) {
  return resolveCompetitionAttribution({
    storage: store,
    rawTuple: tuple,
    incoming: { ...tuple, landingPath: "/" },
    now,
    registry,
  });
}

function query(tuple: typeof A): string {
  return `?utm_campaign=${tuple.utmCampaign}&utm_term=${tuple.utmTerm}&utm_content=${tuple.utmContent}`;
}

function browser(store: ReturnType<typeof storage>, search: string, now = START) {
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const beforeStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const beforeNow = Date.now;
  const location = { search, pathname: "/" };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  Date.now = () => now;
  return {
    location,
    restore() {
      Date.now = beforeNow;
      if (beforeWindow) Object.defineProperty(globalThis, "window", beforeWindow);
      else Reflect.deleteProperty(globalThis, "window");
      if (beforeStorage) Object.defineProperty(globalThis, "localStorage", beforeStorage);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

test("competition supersedes an unrelated global first touch without changing legacy storage", () => {
  const store = storage();
  const old = JSON.stringify({ utmSource: "meta", utmCampaign: "999", utmContent: "old" });
  store.setItem("wd_attr", old);
  const env = browser(store, query(A));
  try {
    assert.equal(getAttribution([round]).utmContent, "301");
    assert.equal(store.getItem("wd_attr"), old);
    env.location.search = query(B);
    assert.equal(getAttribution([round]).utmContent, "301");
    env.location.search = "";
    env.location.pathname = "/privacy";
    assert.equal(getAttribution([round]).utmContent, "301");
    assert.equal(getAttribution([round]).landingPath, "/");
  } finally {
    env.restore();
  }
});

test("A then B or another A creative keeps the first exact tuple and click token", () => {
  const store = storage();
  resolveCompetitionAttribution({
    storage: store,
    rawTuple: A,
    incoming: readAttribution(`${query(A)}&fbclid=first_click`, "/", START),
    now: START,
    registry: [round],
  });
  for (const tuple of [B, { ...A, utmContent: "302" }]) {
    const result = resolve(store, tuple, START + 1000);
    assert.equal(result.kind, "competition");
    if (result.kind === "competition") {
      assert.equal(result.attribution.utmContent, "301");
      assert.equal(result.attribution.fbclid, "first_click");
      assert.equal(result.attribution.capturedAt, START);
    }
  }
});

test("every registered arm can acquire a first touch using its coherent tuple", () => {
  for (const ad of round.ads) {
    const tuple = { utmCampaign: round.campaignId, utmTerm: ad.adsetId, utmContent: ad.adId };
    const result = resolve(storage(), tuple);
    assert.equal(result.kind, "competition");
    if (result.kind === "competition") assert.equal(result.attribution.utmContent, ad.adId);
    assert.equal(acceptsCompetitionSignup(tuple, START, [round]), true);
  }
});

test("the next round starts fresh and an expired round cannot win blank navigation", () => {
  const store = storage();
  resolve(store);
  const next: CompetitionRound = {
    ...round,
    roundId: "r2",
    campaignId: "101",
    captureStartsAt: "2026-10-09T00:00:00Z",
    signupStartsAt: "2026-10-09T00:00:00Z",
    signupEndsAt: "2026-10-12T00:00:00Z",
    ads: [{ armId: "B", strategyVersion: "B-2", adsetId: "402", adId: "503" }],
  };
  const nextTuple = { utmCampaign: "101", utmTerm: "402", utmContent: "503" };
  const result = resolve(store, nextTuple, END, [round, next]);
  assert.equal(result.kind, "competition");
  if (result.kind === "competition")
    assert.deepEqual(result.attribution, { ...nextTuple, landingPath: "/" });
  assert.notEqual(competitionStorageKey(round), competitionStorageKey(next));
  assert.equal(
    resolveCompetitionAttribution({
      storage: store,
      incoming: {},
      rawTuple: {},
      now: END,
      registry: [round],
    }).kind,
    "legacy",
  );
});

test("unknown/incomplete/wrong-campaign/reused-ad-with-wrong-adset competition tuples are rejected", () => {
  for (const rawTuple of [
    { ...A, utmContent: "999" },
    { ...A, utmTerm: undefined },
    { ...A, utmCampaign: "999" },
    { ...A, utmTerm: "202" },
    { ...A, utmCampaign: "1@00" },
  ]) {
    const result = resolveCompetitionAttribution({
      rawTuple,
      incoming: {},
      now: START,
      registry: [round],
      storage: storage(),
    });
    assert.equal(result.kind, "rejected");
    assert.equal(sanitizeSignupAttribution(rawTuple, START, [round]).utmContent, undefined);
  }
});

test("invalid later touch does not invalidate the legitimate first arm", () => {
  const store = storage();
  resolve(store);
  const result = resolve(store, { ...B, utmContent: "301" });
  assert.equal(result.kind, "competition");
  if (result.kind === "competition") assert.equal(result.attribution.utmTerm, "201");
});

test("capture window permits explicit prelaunch QA while cohort window stays strict", () => {
  const qa = START - 30 * 60 * 1000;
  assert.equal(acceptsCompetitionCapture(A, qa, [round]), true);
  assert.equal(sanitizeSignupAttribution(A, qa, [round]).utmContent, "301");
  assert.equal(acceptsCompetitionSignup(A, qa, [round]), false);
  assert.equal(acceptsCompetitionSignup(A, START, [round]), true);
  assert.equal(acceptsCompetitionSignup(A, END - 1, [round]), true);
  for (const now of [START - 2 * 60 * 60 * 1000, END, END + 48 * 60 * 60 * 1000]) {
    assert.equal(acceptsCompetitionCapture(A, now, [round]), false);
    assert.equal(acceptsCompetitionSignup(A, now, [round]), false);
    assert.equal(sanitizeSignupAttribution(A, now, [round]).utmContent, undefined);
  }
});

test("future, pre-capture, nonfinite and click-time-inconsistent stored touches are ignored", () => {
  for (const mutation of [
    { firstTouchAt: START + 1 },
    { firstTouchAt: START - 2 * 60 * 60 * 1000 },
    { firstTouchAt: null },
    { firstTouchAt: "yesterday" },
    { attribution: { ...A, capturedAt: START + 1 } },
  ]) {
    const store = storage();
    resolve(store);
    const prior = JSON.parse(store.getItem(competitionStorageKey(round))!);
    store.setItem(competitionStorageKey(round), JSON.stringify({ ...prior, ...mutation }));
    assert.equal(
      resolveCompetitionAttribution({
        storage: store,
        incoming: {},
        rawTuple: {},
        now: START,
        registry: [round],
      }).kind,
      "legacy",
    );
    const fresh = resolve(store, B);
    assert.equal(fresh.kind, "competition");
    if (fresh.kind === "competition") assert.equal(fresh.attribution.utmContent, "303");
  }
});

test("server rejects future or pre-window competition click timestamps", () => {
  for (const capturedAt of [START + 1, START - 2 * 60 * 60 * 1000, NaN, Infinity, "yesterday"]) {
    const raw = { ...A, fbclid: "click", capturedAt };
    assert.equal(sanitizeSignupAttribution(raw, START, [round]).utmContent, undefined);
  }
  assert.equal(
    sanitizeSignupAttribution({ ...A, fbclid: "click", capturedAt: START }, START, [round])
      .utmContent,
    "301",
  );
});

test("malformed scoped/global storage cannot block a valid competition URL", () => {
  for (const malformed of [
    "{",
    "null",
    "[]",
    "42",
    JSON.stringify({ version: 999, attribution: A }),
  ]) {
    const store = storage();
    store.setItem(competitionStorageKey(round), malformed);
    store.setItem("wd_attr", malformed);
    const env = browser(store, query(A));
    try {
      assert.equal(getAttribution([round]).utmContent, "301");
    } finally {
      env.restore();
    }
  }
});

test("unavailable storage degrades to the current valid URL without fabricated continuity", () => {
  const unavailable = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(
    resolveCompetitionAttribution({
      storage: unavailable,
      incoming: A,
      rawTuple: A,
      now: START,
      registry: [round],
    }).kind,
    "competition",
  );
  assert.equal(
    resolveCompetitionAttribution({
      storage: unavailable,
      incoming: {},
      rawTuple: {},
      now: START,
      registry: [round],
    }).kind,
    "legacy",
  );
});

test("competition state ignores customer and arbitrary payload fields", () => {
  const store = storage();
  resolveCompetitionAttribution({
    storage: store,
    incoming: { ...A, email: "test@example.invalid", customer: { secret: "never" } } as typeof A,
    rawTuple: A,
    now: START,
    registry: [round],
  });
  const text = store.getItem(competitionStorageKey(round))!;
  assert.equal(text.includes("email"), false);
  assert.equal(text.includes("customer"), false);
  assert.equal(text.includes("secret"), false);
  const state = JSON.parse(text);
  state.attribution.email = "test@example.invalid";
  store.setItem(competitionStorageKey(round), JSON.stringify(state));
  const restored = resolve(store);
  assert.equal(JSON.stringify(restored).includes("example.invalid"), false);
});

test("registry has no placeholder ads or customer data", () => {
  // Works both before and after the operator populates the public registry.
  for (const item of competitionRegistry) {
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        "ads",
        "campaignId",
        "captureStartsAt",
        "experimentId",
        "roundId",
        "signupEndsAt",
        "signupStartsAt",
      ].sort(),
    );
    assert.match(item.campaignId, /^\d+$/);
    for (const ad of item.ads) {
      assert.deepEqual(
        Object.keys(ad).sort(),
        ["adId", "adsetId", "armId", "strategyVersion"].sort(),
      );
      assert.match(ad.adId, /^\d+$/);
      assert.match(ad.adsetId, /^\d+$/);
    }
  }
});

test("ambiguous registry mappings, bad time windows and overlong rounds fail closed", () => {
  for (const bad of [
    { ...round, ads: [...round.ads, { ...round.ads[0], adsetId: "202" }] },
    { ...round, signupEndsAt: "2026-10-10T00:00:00Z" },
    { ...round, captureStartsAt: "not-a-date" },
    { ...round, captureStartsAt: "2026-10-07T00:00:00Z" },
  ]) {
    assert.equal(resolve(storage(), A, START, [bad]).kind, "rejected");
    assert.equal(acceptsCompetitionCapture(A, START, [bad]), false);
  }
  assert.equal(resolve(storage(), A, START, [round, round]).kind, "rejected");
});

test("duplicate URL tuple keys cannot manufacture a competition attribution", () => {
  const env = browser(storage(), `${query(A)}&utm_content=303`);
  try {
    assert.equal(getAttribution([round]).utmContent, undefined);
  } finally {
    env.restore();
  }
});

test("legacy traffic keeps the existing global first-touch behavior", () => {
  const store = storage();
  store.setItem("wd_attr", JSON.stringify({ utmCampaign: "old-campaign" }));
  const env = browser(store, "?utm_campaign=new-noncompetition-campaign");
  try {
    assert.equal(getAttribution([round]).utmCampaign, "old-campaign");
  } finally {
    env.restore();
  }
});

test("expired competition IDs in the legacy key are not revived", () => {
  const store = storage();
  store.setItem("wd_attr", JSON.stringify(A));
  const env = browser(store, "", END);
  try {
    assert.equal(getAttribution([round]).utmContent, undefined);
  } finally {
    env.restore();
  }
});
