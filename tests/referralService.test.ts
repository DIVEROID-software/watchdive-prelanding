import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  LeaderboardSnapshot,
  LedgerResult,
  NicknameCheck,
  ReferralRow,
  ReferralSettingsInput,
  ReferralStatus,
  ReferralStore,
} from "../src/lib/referral/contract.ts";
import { LEADERBOARD_CACHE_SECONDS, referralProgramEnabled } from "../src/lib/referral/program.ts";
import {
  createLeaderboardCache,
  createRateLimiter,
  getLeaderboardService,
  getReferralProgressService,
  getReferralStatusService,
  leaderboardResponse,
  SETTINGS_WRITES_PER_WINDOW,
  updateReferralSettingsService,
  type ReferralServiceDeps,
} from "../src/lib/referral/service.server.ts";

// The core modules (ledger, token, nickname, store) are faked here on purpose:
// these tests pin the service's own rules — gate, token-before-store, the
// allow-listed responses, caching — independent of how core computes counts.

const SECRET = "s".repeat(40);
const ORIGIN = "https://watchdive.example";

function row(over: Partial<ReferralRow> & { refCode: string }): ReferralRow {
  return {
    pageId: `page-${over.refCode}`,
    canonicalEmail: `${over.refCode}@canonical.example`,
    email: `${over.refCode}@mail.example`,
    status: "verified",
    emailVerified: true,
    verifiedAt: "2026-10-22T00:00:00.000Z",
    suspect: false,
    duplicate: false,
    flags: [],
    leaderboard: false,
    nicknameHidden: false,
    noticesOff: false,
    notifiedCount: 0,
    ...over,
  };
}

const ROWS: ReferralRow[] = [
  row({ refCode: "owner001", nickname: "Reefy", leaderboard: true }),
  row({ refCode: "friend01", referredBy: "owner001" }),
  row({ refCode: "friend02", referredBy: "owner001" }),
  row({ refCode: "rival001", nickname: "Rival", leaderboard: true, nicknameHidden: true }),
  row({ refCode: "friend03", referredBy: "rival001" }),
];

class FakeStore implements ReferralStore {
  rows: ReferralRow[];
  listCalls = 0;
  findCalls = 0;
  writes: { pageId: string; input: unknown }[] = [];
  /** When set, listProgramRows waits for it (single-flight tests). */
  gate: Promise<void> | null = null;
  fail = false;
  constructor(rows = ROWS) {
    this.rows = rows.map((r) => ({ ...r }));
  }
  async listProgramRows() {
    this.listCalls += 1;
    if (this.gate) await this.gate;
    if (this.fail) throw new Error("notion said: secret detail page-owner001");
    return this.rows.map((r) => ({ ...r }));
  }
  async findByRefCode(refCode: string) {
    this.findCalls += 1;
    return this.rows.find((r) => r.refCode === refCode);
  }
  async writeSettings(pageId: string, input: ReferralSettingsInput) {
    this.writes.push({ pageId, input });
    const target = this.rows.find((r) => r.pageId === pageId);
    if (target) {
      target.nickname = input.nickname ?? undefined;
      target.leaderboard = input.leaderboard;
      target.noticesOff = input.noticesOff;
    }
  }
  async markNotified() {
    throw new Error("not used by the service");
  }
}

// Fake token: "tok." + refCode, signed by the secret's first char. Anything
// else verifies as null, the same as a forged HMAC.
const tokenFor = (code: string) => `tok.${SECRET[0]}.${code}`;
function fakeVerify(token: string, secret: string): string | null {
  const m = /^tok\.(.)\.([a-z0-9]{8})$/.exec(token);
  return m && m[1] === secret[0] ? m[2] : null;
}

function fakeLedger(rows: ReferralRow[]): LedgerResult {
  const standings: LedgerResult["standings"] = new Map();
  for (const r of rows) {
    if (!r.referredBy) continue;
    const s = standings.get(r.referredBy) ?? {
      refCode: r.referredBy,
      credited: 0,
      reachedAt: {},
      leaderOrder: null,
      lightEligible: false,
      lastCreditAt: null,
    };
    s.credited += 1;
    standings.set(r.referredBy, s);
  }
  return { standings, excluded: {} as LedgerResult["excluded"] };
}

function fakeStatusFor(
  r: ReferralRow,
  ledger: LedgerResult,
  options: { shareUrl: string; closed: boolean },
): ReferralStatus {
  const credited = ledger.standings.get(r.refCode)?.credited ?? 0;
  // Deliberately over-shares, as a careless core change might: the service
  // must strip these before anything reaches the browser.
  return {
    credited,
    highestTier: credited >= 1 ? "first" : null,
    nextTier: "buddy",
    remainingToNext: 3 - credited,
    earlyNoticeHours: credited >= 1 ? 1 : 0,
    lightEligible: false,
    rank: credited ? 1 : null,
    nickname: r.nickname ?? null,
    leaderboard: r.leaderboard,
    nicknameHidden: r.nicknameHidden,
    noticesOff: r.noticesOff,
    shareUrl: options.shareUrl,
    closed: options.closed,
    email: r.email,
    pageId: r.pageId,
    friends: [...ledger.standings.keys()],
  } as ReferralStatus;
}

function fakeBoard(
  rows: ReferralRow[],
  ledger: LedgerResult,
  options: { size: number; now: Date; closed: boolean },
): LeaderboardSnapshot {
  const entries = [...ledger.standings.values()]
    .sort((a, b) => b.credited - a.credited)
    .slice(0, options.size)
    .map((s, i) => {
      const r = rows.find((x) => x.refCode === s.refCode)!;
      const shown = r.leaderboard && !r.nicknameHidden && r.nickname ? r.nickname : null;
      return {
        rank: i + 1,
        nickname: shown,
        credited: s.credited,
        refCode: s.refCode,
        email: r.email,
      };
    });
  return {
    entries,
    asOf: options.now.toISOString(),
    closed: options.closed,
    pageIds: rows.map((r) => r.pageId),
  } as LeaderboardSnapshot;
}

function fakeNickname(raw: string): NicknameCheck {
  const value = raw.trim().replace(/\s+/g, " ");
  if (Array.from(value).length < 2) return { ok: false, reason: "too_short" };
  if (value.includes("@")) return { ok: false, reason: "contact_info" };
  return { ok: true, value };
}

function setup(over: Partial<ReferralServiceDeps> = {}) {
  const store = new FakeStore();
  let nowMs = Date.parse("2026-10-22T10:00:00.000Z");
  const clock = { advance: (ms: number) => (nowMs += ms) };
  const calls = { verify: 0, ledger: 0 };
  const deps: ReferralServiceDeps = {
    enabled: () => true,
    store,
    secret: SECRET,
    origin: ORIGIN,
    now: () => new Date(nowMs),
    closesAt: () => null,
    verifyStatusToken: (t, s) => {
      calls.verify += 1;
      return fakeVerify(t, s);
    },
    computeLedger: (rows) => {
      calls.ledger += 1;
      return fakeLedger(rows);
    },
    statusFor: fakeStatusFor,
    buildLeaderboard: fakeBoard,
    checkNickname: fakeNickname,
    shareUrl: (origin, code) => `${origin}/r/${code}`,
    leaderboardCache: createLeaderboardCache(),
    settingsLimiter: createRateLimiter(),
    ...over,
  };
  return { deps, store, clock, calls };
}

/** No email, page id, canonical email or foreign ref code anywhere in the JSON. */
function assertNoPrivateData(value: unknown, ownCode?: string) {
  const json = JSON.stringify(value);
  for (const r of ROWS) {
    assert.ok(!json.includes(r.email), `email leaked: ${json}`);
    assert.ok(!json.includes(r.canonicalEmail), `canonical email leaked: ${json}`);
    assert.ok(!json.includes(r.pageId), `page id leaked: ${json}`);
    if (r.refCode !== ownCode)
      assert.ok(!json.includes(r.refCode), `ref code ${r.refCode} leaked: ${json}`);
  }
  assert.ok(!json.includes("@"), `something address-like leaked: ${json}`);
}

test("a forged, malformed or oversized token is invalid without touching the store", async () => {
  for (const bad of [
    "",
    "nope",
    "tok.x.owner001",
    tokenFor("owner001") + "x",
    "t".repeat(5000),
    null,
    42,
  ]) {
    const { deps, store } = setup();
    const status = await getReferralStatusService(bad, "en", deps);
    assert.deepEqual(status, { status: "invalid" });
    const settings = await updateReferralSettingsService(
      bad,
      { nickname: "Hello", leaderboard: true, noticesOff: false },
      deps,
    );
    assert.deepEqual(settings, { status: "invalid" });
    assert.equal(store.listCalls + store.findCalls + store.writes.length, 0);
  }
});

test("a throwing verifier reads as invalid, identical to a bad signature", async () => {
  const { deps, store } = setup({
    verifyStatusToken: () => {
      throw new Error("bad base64");
    },
  });
  assert.deepEqual(await getReferralStatusService(tokenFor("owner001"), "en", deps), {
    status: "invalid",
  });
  assert.equal(store.listCalls, 0);
});

test("a valid token whose row is gone has the same invalid shape", async () => {
  const { deps } = setup();
  assert.deepEqual(await getReferralStatusService(tokenFor("gone0000"), "en", deps), {
    status: "invalid",
  });
});

test("status: one Notion pass, own data only, allow-listed fields", async () => {
  const { deps, store, calls } = setup();
  const response = await getReferralStatusService(tokenFor("owner001"), "ko", deps);
  assert.equal(store.listCalls, 1);
  assert.equal(calls.ledger, 1);
  assert.equal(response.status, "ok");
  if (response.status !== "ok") return;
  assert.equal(response.referral.credited, 2);
  assert.equal(response.referral.shareUrl, `${ORIGIN}/r/owner001`);
  assert.deepEqual(Object.keys(response.referral).sort(), [
    "closed",
    "credited",
    "earlyNoticeHours",
    "highestTier",
    "leaderboard",
    "lightEligible",
    "nextTier",
    "nickname",
    "nicknameHidden",
    "noticesOff",
    "rank",
    "remainingToNext",
    "shareUrl",
  ]);
  assertNoPrivateData(response, "owner001");
});

test("closed is derived from referralClosesAt at the server clock", async () => {
  const { deps, clock } = setup({ closesAt: () => new Date("2026-10-22T10:00:01.000Z") });
  let r = await getReferralStatusService(tokenFor("owner001"), "en", deps);
  assert.equal(r.status === "ok" && r.referral.closed, false);
  clock.advance(1000);
  r = await getReferralStatusService(tokenFor("owner001"), "en", deps);
  assert.equal(r.status === "ok" && r.referral.closed, true);
});

test("settings: a rejected nickname returns its reason and writes nothing", async () => {
  const { deps, store } = setup();
  const r = await updateReferralSettingsService(
    tokenFor("owner001"),
    { nickname: "me@x.io", leaderboard: true, noticesOff: false },
    deps,
  );
  assert.deepEqual(r, { status: "rejected", reason: "contact_info" });
  const short = await updateReferralSettingsService(
    tokenFor("owner001"),
    { nickname: "a", leaderboard: true, noticesOff: false },
    deps,
  );
  assert.deepEqual(short, { status: "rejected", reason: "too_short" });
  assert.equal(store.writes.length, 0);
});

test("settings: the normalized nickname is written; blank clears it", async () => {
  const { deps, store } = setup();
  const r = await updateReferralSettingsService(
    tokenFor("owner001"),
    { nickname: "  Deep   Blue ", leaderboard: true, noticesOff: true },
    deps,
  );
  assert.deepEqual(r, {
    status: "ok",
    settings: { nickname: "Deep Blue", leaderboard: true, noticesOff: true },
  });
  assert.deepEqual(store.writes.at(-1), {
    pageId: "page-owner001",
    input: { nickname: "Deep Blue", leaderboard: true, noticesOff: true },
  });
  await updateReferralSettingsService(
    tokenFor("owner001"),
    { nickname: "   ", leaderboard: false, noticesOff: false },
    deps,
  );
  assert.deepEqual(store.writes.at(-1)?.input, {
    nickname: null,
    leaderboard: false,
    noticesOff: false,
  });
  assertNoPrivateData(r, "owner001");
});

test("settings: nicknameHidden (or any other key) can never be set by the person", async () => {
  const { deps, store } = setup();
  const sneaky = {
    // Same nickname as stored, so the server has no reason to lift the hide.
    nickname: "Rival",
    leaderboard: true,
    noticesOff: false,
    nicknameHidden: false,
    refCode: "rival001",
    pageId: "page-rival001",
  } as unknown as { nickname: string; leaderboard: boolean; noticesOff: boolean };
  await updateReferralSettingsService(tokenFor("rival001"), sneaky, deps);
  assert.equal(store.writes.length, 1);
  assert.deepEqual(Object.keys(store.writes[0].input as object).sort(), [
    "leaderboard",
    "nickname",
    "noticesOff",
  ]);
  assert.equal(store.writes[0].pageId, "page-rival001");
  assert.equal(store.rows.find((r) => r.refCode === "rival001")?.nicknameHidden, true);
});

test("settings: choosing a new nickname lifts an ops hide server-side; keeping it does not", async () => {
  const { deps, store } = setup();
  await updateReferralSettingsService(
    tokenFor("rival001"),
    { nickname: "Rival2", leaderboard: true, noticesOff: false },
    deps,
  );
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].input.clearHidden, true);
  assert.equal(store.writes[0].input.nickname, "Rival2");
  // Clearing the nickname is not a new nickname: the hide stays.
  await updateReferralSettingsService(
    tokenFor("rival001"),
    { nickname: null, leaderboard: true, noticesOff: false },
    deps,
  );
  assert.equal(store.writes[1].input.clearHidden, undefined);
});

test("settings: the zod schema in the server fn does not accept nicknameHidden either", () => {
  const source = readFileSync(
    new URL("../src/lib/api/referral.functions.ts", import.meta.url),
    "utf8",
  );
  const schema = source.slice(
    source.indexOf("export const updateReferralSettings"),
    source.indexOf(".handler", source.indexOf("export const updateReferralSettings")),
  );
  assert.ok(!/nicknameHidden\s*:/.test(schema), "nicknameHidden must not be a validated input");
});

test("settings: writes are rate-limited per code, and the window resets", async () => {
  const { deps, store, clock } = setup();
  const input = { nickname: "Reefy", leaderboard: true, noticesOff: false };
  for (let i = 0; i < SETTINGS_WRITES_PER_WINDOW; i += 1) {
    assert.equal(
      (await updateReferralSettingsService(tokenFor("owner001"), input, deps)).status,
      "ok",
    );
  }
  assert.deepEqual(await updateReferralSettingsService(tokenFor("owner001"), input, deps), {
    status: "rate_limited",
  });
  // Another person is unaffected.
  assert.equal(
    (await updateReferralSettingsService(tokenFor("rival001"), input, deps)).status,
    "ok",
  );
  assert.equal(store.writes.length, SETTINGS_WRITES_PER_WINDOW + 1);
  clock.advance(60_000);
  assert.equal(
    (await updateReferralSettingsService(tokenFor("owner001"), input, deps)).status,
    "ok",
  );
});

test("rate limiter stays bounded under a flood of keys", () => {
  const limiter = createRateLimiter(1, 60_000, 3);
  for (const k of ["a", "b", "c", "d", "e"]) assert.equal(limiter.take(k, 0), true);
  assert.equal(limiter.take("e", 1), false);
});

test("leaderboard: concurrent readers share one Notion pass", async () => {
  const { deps, store } = setup();
  let release!: () => void;
  store.gate = new Promise((resolve) => (release = resolve));
  const readers = Array.from({ length: 25 }, () => getLeaderboardService(deps));
  readers.push(
    getReferralProgressService("owner001", deps).then(() => ({}) as LeaderboardSnapshot),
  );
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const boards = await Promise.all(readers);
  assert.equal(store.listCalls, 1);
  assert.deepEqual(boards[0], boards[24]);
});

test("leaderboard: cached for LEADERBOARD_CACHE_SECONDS, then refreshed", async () => {
  const { deps, store, clock } = setup();
  await getLeaderboardService(deps);
  clock.advance(LEADERBOARD_CACHE_SECONDS * 1000 - 1);
  await getLeaderboardService(deps);
  await getReferralProgressService("owner001", deps);
  assert.equal(store.listCalls, 1);
  clock.advance(1);
  await getLeaderboardService(deps);
  assert.equal(store.listCalls, 2);
});

test("leaderboard: a failed pass is not cached and its detail is not exposed", async () => {
  const { deps, store } = setup();
  store.fail = true;
  await assert.rejects(getLeaderboardService(deps));
  const res = await leaderboardResponse(true, async () => deps);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assert.ok(!body.includes("secret") && !body.includes("page-"), body);
  store.fail = false;
  await getLeaderboardService(deps);
  assert.equal(store.listCalls, 3);
});

test("leaderboard: a settings write invalidates the cached board", async () => {
  const { deps, store } = setup();
  await getLeaderboardService(deps);
  await updateReferralSettingsService(
    tokenFor("owner001"),
    { nickname: "NewName", leaderboard: true, noticesOff: false },
    deps,
  );
  const board = await getLeaderboardService(deps);
  assert.equal(store.listCalls, 2);
  assert.equal(board.entries[0].nickname, "NewName");
});

test("leaderboard JSON: nicknames and counts only, hidden names never shown", async () => {
  const { deps } = setup();
  const res = await leaderboardResponse(true, async () => deps);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("cache-control"),
    "public, s-maxage=300, stale-while-revalidate=600",
  );
  const body = (await res.json()) as LeaderboardSnapshot;
  assert.deepEqual(Object.keys(body).sort(), ["asOf", "closed", "entries"]);
  for (const entry of body.entries)
    assert.deepEqual(Object.keys(entry).sort(), ["credited", "nickname", "rank"]);
  assert.deepEqual(
    body.entries.map((e) => e.nickname),
    ["Reefy", null],
  );
  assertNoPrivateData(body);
});

test("progress: credited count for a code, 0 for unknown or malformed codes", async () => {
  const { deps } = setup();
  assert.deepEqual(await getReferralProgressService("owner001", deps), {
    enabled: true,
    credited: 2,
  });
  assert.deepEqual(await getReferralProgressService("nobody00", deps), {
    enabled: true,
    credited: 0,
  });
  assert.deepEqual(await getReferralProgressService("x", deps), { enabled: true, credited: 0 });
});

test("switched off: every surface answers as absent and nothing reads Notion", async () => {
  const { deps, store } = setup({ enabled: () => false });
  assert.deepEqual(await getReferralStatusService(tokenFor("owner001"), "en", deps), {
    status: "disabled",
  });
  assert.deepEqual(
    await updateReferralSettingsService(
      tokenFor("owner001"),
      { nickname: "Reefy", leaderboard: true, noticesOff: false },
      deps,
    ),
    { status: "disabled" },
  );
  assert.deepEqual(await getReferralProgressService("owner001", deps), { enabled: false });
  await assert.rejects(getLeaderboardService(deps));
  let built = 0;
  const res = await leaderboardResponse(false, async () => {
    built += 1;
    return deps;
  });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { enabled: false });
  assert.equal(built, 0);
  assert.equal(store.listCalls + store.findCalls + store.writes.length, 0);
});

test("the switch reads exactly WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1", () => {
  assert.equal(referralProgramEnabled({}), false);
  assert.equal(referralProgramEnabled({ WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "true" }), false);
  assert.equal(referralProgramEnabled({ WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" }), true);
});

test("server fns and routes check the switch before building Notion deps", () => {
  const fns = readFileSync(
    new URL("../src/lib/api/referral.functions.ts", import.meta.url),
    "utf8",
  );
  for (const name of ["getReferralStatus", "updateReferralSettings", "getReferralProgress"]) {
    const start = fns.indexOf(`export const ${name} =`);
    const body = fns.slice(
      start,
      fns.indexOf("export const", start + 10) === -1
        ? undefined
        : fns.indexOf("export const", start + 10),
    );
    const gate = body.indexOf("referralProgramEnabled(process.env)");
    assert.ok(gate > 0 && gate < body.indexOf("referralServiceDeps()"), `${name} must gate first`);
  }
  assert.match(fns, /export const getReferralProgramState = createServerFn/);
  for (const file of ["../src/routes/buddy.tsx", "../src/routes/$locale.buddy.tsx"]) {
    const route = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(route, /requireReferralProgram/);
    assert.match(route, /no-referrer|BUDDY_PAGE_META/);
  }
  // The shared loader 404s while off and the shared meta keeps the token page private.
  assert.match(fns, /if \(!enabled\) throw notFound\(\)/);
  assert.match(fns, /"no-referrer"/);
  assert.match(fns, /noindex, nofollow/);
});
