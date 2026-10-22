import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ReferralRow, ReferralStore } from "../src/lib/referral/contract.ts";
import {
  claimShareCodeService,
  createLeaderboardCache,
  createRateLimiter,
  ensureShareCode,
  getMyShareCodeService,
  resolveShareCodeForSignup,
  SETTINGS_WRITES_PER_WINDOW,
  type ReferralServiceDeps,
} from "../src/lib/referral/service.server.ts";
import {
  SHARE_CODE_AUTO_ALPHABET,
  SHARE_CODE_AUTO_LENGTH,
  canonicalShareCode,
  checkShareCode,
  claimDecision,
  decideAttribution,
  decideShareLinkTarget,
  generateShareCode,
  legacyShareLocation,
} from "../src/lib/referral/shareCode.ts";
import { resolveShareLinkLocation } from "../src/lib/referral/shareLink.server.ts";

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

class MemoryStore implements ReferralStore {
  rows: ReferralRow[];
  constructor(rows: ReferralRow[]) {
    this.rows = rows.map((r) => ({ ...r }));
  }
  async listProgramRows() {
    return this.rows.map((r) => ({ ...r }));
  }
  async findByRefCode(refCode: string) {
    return this.rows.find((r) => r.refCode === refCode);
  }
  async findByShareCode(shareCode: string) {
    return this.rows
      .filter((r) => r.shareCode === shareCode)
      .sort((a, b) => (a.pageId < b.pageId ? -1 : 1))[0];
  }
  async writeShareCode(
    pageId: string,
    input: { code: string; custom: boolean; locked: boolean },
  ) {
    const target = this.rows.find((r) => r.pageId === pageId);
    if (!target) return;
    if (!input.code) {
      delete target.shareCode;
      delete target.shareCodeCustom;
      delete target.shareCodeLocked;
      return;
    }
    target.shareCode = input.code;
    if (input.custom) target.shareCodeCustom = true;
    else delete target.shareCodeCustom;
    if (input.locked) target.shareCodeLocked = true;
    else delete target.shareCodeLocked;
  }
  async writeSettings() {}
  async markNotified() {}
  async missingColumns() {
    return [];
  }
}

function depsFor(rows: ReferralRow[]) {
  const store = new MemoryStore(rows);
  const deps: ReferralServiceDeps = {
    enabled: () => true,
    store,
    secret: "s".repeat(40),
    origin: "https://watchdive.example",
    now: () => new Date("2026-10-22T10:00:00.000Z"),
    closesAt: () => null,
    verifyStatusToken: async (token) => (typeof token === "string" ? token : null),
    computeLedger: () => ({ standings: new Map(), excluded: {} }) as never,
    statusFor: () => {
      throw new Error("unused");
    },
    buildLeaderboard: () => {
      throw new Error("unused");
    },
    checkNickname: () => ({ ok: true, value: "x" }),
    shareUrl: (origin, code) => `${origin}/r/${code}`,
    leaderboardCache: createLeaderboardCache(),
    settingsLimiter: createRateLimiter(),
  };
  return { deps, store };
}

test("auto codes are 6 unambiguous characters", () => {
  assert.equal(SHARE_CODE_AUTO_ALPHABET.includes("0"), false);
  assert.equal(SHARE_CODE_AUTO_ALPHABET.includes("O"), false);
  assert.equal(SHARE_CODE_AUTO_ALPHABET.includes("1"), false);
  assert.equal(SHARE_CODE_AUTO_ALPHABET.includes("I"), false);
  assert.equal(SHARE_CODE_AUTO_ALPHABET.includes("L"), false);
  let seed = 1;
  const codes = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    const code = generateShareCode((max) => {
      seed = (seed * 16807) % 2147483647;
      return seed % max;
    });
    assert.match(code, new RegExp(`^[${SHARE_CODE_AUTO_ALPHABET}]{${SHARE_CODE_AUTO_LENGTH}}$`));
    codes.add(code);
  }
  assert.equal(codes.size, 40);
  assert.throws(() => generateShareCode(() => 99));
});

test("canonical form and claim checks", () => {
  assert.equal(canonicalShareCode("  jejubuddy "), "JEJUBUDDY");
  assert.equal(canonicalShareCode("ＪＥＪＵ"), "JEJU");
  assert.equal(canonicalShareCode("ab"), undefined);
  assert.equal(canonicalShareCode("abcdefghijklm"), undefined);
  for (const ok of ["JEJUBUDDY", "REEF", "SCUBA", "MARINE", "BUSAN", "CLASS", "12345"]) {
    const check = checkShareCode(ok);
    assert.equal(check.ok, true, ok);
  }
  assert.equal(checkShareCode("WATCHDIVE").ok && false, false);
  assert.equal((checkShareCode("WATCHDIVE") as { reason: string }).reason, "reserved");
  assert.equal((checkShareCode("ADMIN") as { reason: string }).reason, "reserved");
  assert.equal((checkShareCode("0FFICIAL") as { reason: string }).reason, "reserved");
  assert.equal((checkShareCode("ADM1N") as { reason: string }).reason, "reserved");
  assert.equal((checkShareCode("123456") as { reason: string }).reason, "contact_info");
  assert.equal((checkShareCode("me@ab.co") as { reason: string }).reason, "invalid_chars");
  assert.equal((checkShareCode("http://x.co") as { reason: string }).reason, "invalid_chars");
  assert.equal((checkShareCode("JEJU-DIVE") as { reason: string }).reason, "invalid_chars");
  assert.equal((checkShareCode("FUCK") as { reason: string }).reason, "profanity");
  assert.equal((checkShareCode("DISPUTA") as { reason: string }).reason, "profanity");
  assert.equal((checkShareCode("AB") as { reason: string }).reason, "too_short");
  assert.equal((checkShareCode("A".repeat(13)) as { reason: string }).reason, "too_long");
});

test("claim decision: locked before already-claimed", () => {
  assert.equal(claimDecision({ shareCodeLocked: true, shareCodeCustom: true }), "locked");
  assert.equal(claimDecision({ shareCodeCustom: true }), "already_claimed");
  assert.equal(claimDecision({}), "ok");
});

test("attribution: the link wins, an unknown code does not block, off ignores the field", () => {
  assert.deepEqual(
    decideAttribution({
      enabled: false,
      linkRef: "abcdefgh",
      typed: "REEF42",
      resolvedRef: "zzzzzzzz",
    }),
    { referredBy: "abcdefgh", note: null },
  );
  assert.deepEqual(
    decideAttribution({ enabled: false, typed: "REEF42", resolvedRef: "zzzzzzzz" }),
    { note: null },
  );
  assert.equal(
    "referredBy" in decideAttribution({ enabled: false, typed: "REEF42", resolvedRef: "zzzzzzzz" }),
    false,
  );
  assert.deepEqual(
    decideAttribution({
      enabled: true,
      linkRef: "abcdefgh",
      typed: "REEF42",
      resolvedRef: "zzzzzzzz",
    }),
    { referredBy: "abcdefgh", note: null },
  );
  assert.deepEqual(
    decideAttribution({ enabled: true, typed: "REEF42", resolvedRef: "zzzzzzzz" }),
    { referredBy: "zzzzzzzz", note: null },
  );
  assert.deepEqual(decideAttribution({ enabled: true, typed: "NOPE" }), { note: "ignored" });
  assert.deepEqual(decideAttribution({ enabled: true }), { note: null });
});

test("share link target: off is the legacy redirect, on prefers a ref row", () => {
  assert.equal(
    decideShareLinkTarget({
      home: "/ko",
      raw: "reef42",
      enabled: false,
      refOwnerFound: true,
      shareOwnerRef: "abcdefgh",
    }),
    legacyShareLocation("/ko", "reef42"),
  );
  assert.equal(legacyShareLocation("/ko", "abcd1234"), "/ko?ref=abcd1234");
  assert.equal(
    decideShareLinkTarget({
      home: "/",
      raw: "abcd1234",
      enabled: true,
      refOwnerFound: true,
      shareOwnerRef: "zzzzzzzz",
    }),
    "/?ref=abcd1234",
  );
  assert.equal(
    decideShareLinkTarget({
      home: "/",
      raw: "REEF42",
      enabled: true,
      refOwnerFound: false,
      shareOwnerRef: "abcd1234",
    }),
    "/?ref=abcd1234",
  );
  assert.equal(
    decideShareLinkTarget({
      home: "/",
      raw: "REEF42",
      enabled: true,
      refOwnerFound: false,
    }),
    "/",
  );
  assert.equal(
    decideShareLinkTarget({
      home: "/",
      raw: "abcd1234",
      enabled: true,
      refOwnerFound: false,
    }),
    "/?ref=abcd1234",
  );
});

test("resolveShareLinkLocation rate-limits and hides the owner", async () => {
  const limiter = createRateLimiter(1, 60_000);
  const store = {
    async findByRefCode() {
      return undefined;
    },
    async findByShareCode() {
      return {
        refCode: "abcd1234",
        email: "secret@example.com",
        nickname: "Secret",
      };
    },
  };
  const request = new Request("https://watchdive.example/r/REEF42", {
    headers: { "x-forwarded-for": "203.0.113.5" },
  });
  const first = await resolveShareLinkLocation({
    request,
    home: "/",
    raw: "REEF42",
    enabled: true,
    limiter,
    nowMs: 1_000,
    store,
  });
  assert.equal(first, "/?ref=abcd1234");
  assert.equal(first.includes("secret"), false);
  assert.equal(first.includes("Secret"), false);
  const second = await resolveShareLinkLocation({
    request,
    home: "/",
    raw: "REEF42",
    enabled: true,
    limiter,
    nowMs: 1_000,
    store,
  });
  assert.equal(second, "/");
  const off = await resolveShareLinkLocation({
    request,
    home: "/",
    raw: "abcd1234",
    enabled: false,
    limiter,
    nowMs: 1_000,
    store: {
      async findByRefCode() {
        throw new Error("off must not read");
      },
      async findByShareCode() {
        throw new Error("off must not read");
      },
    },
  });
  assert.equal(off, "/?ref=abcd1234");
});

test("assign is unique, claim is once, and a lookup names no one", async () => {
  const owner = row({ refCode: "owner001" });
  const other = row({ refCode: "other001", shareCode: "TAKEN1" });
  const { deps, store } = depsFor([owner, other]);
  const first = await ensureShareCode(owner, deps, () => "REEF42");
  assert.equal(first, "REEF42");
  const rival = row({ refCode: "rival001" });
  store.rows.push(rival);
  assert.equal(await ensureShareCode(rival, deps, () => "REEF42"), null);
  assert.equal(store.rows.find((r) => r.refCode === "owner001")?.shareCode, "REEF42");

  const same = await claimShareCodeService("owner001", "reef42", deps);
  assert.deepEqual(same, { status: "ok", code: "REEF42", custom: false });
  assert.equal(store.rows.find((r) => r.refCode === "owner001")?.shareCodeCustom, undefined);

  const taken = await claimShareCodeService("owner001", "taken1", deps);
  assert.deepEqual(taken, { status: "rejected", reason: "taken" });

  const ownRef = await claimShareCodeService("owner001", "OWNER001", deps);
  assert.deepEqual(ownRef, { status: "ok", code: "OWNER001", custom: true });

  const foreignRef = await claimShareCodeService("rival001", "OTHER001", deps);
  assert.deepEqual(foreignRef, { status: "rejected", reason: "taken" });

  const again = await claimShareCodeService("owner001", "BUSANDIVE", deps);
  assert.deepEqual(again, { status: "rejected", reason: "already_claimed" });

  const locked = row({ refCode: "lock0001", shareCode: "LOCKED1", shareCodeLocked: true });
  const lockedDeps = depsFor([locked]);
  assert.deepEqual(await claimShareCodeService("lock0001", "LOCKED1", lockedDeps.deps), {
    status: "ok",
    code: "LOCKED1",
    custom: false,
  });
  assert.deepEqual(await claimShareCodeService("lock0001", "BUSAN", lockedDeps.deps), {
    status: "rejected",
    reason: "locked",
  });

  const looked = await resolveShareCodeForSignup(
    "owner001",
    deps,
    createRateLimiter(),
    "203.0.113.8",
  );
  assert.equal(looked && looked !== "limited" && looked.refCode, "abcdefgh".slice(0, 0) || "owner001");
  if (looked && looked !== "limited") {
    const json = JSON.stringify(looked);
    assert.equal(json.includes("mail.example"), false);
    assert.equal(json.includes("@"), false);
    assert.equal(json.includes("nickname"), false);
  }

  const card = await getMyShareCodeService("owner001", deps);
  assert.equal(JSON.stringify(card).includes("@"), false);
});

test("assign rate limit is separate from the claim limiter", async () => {
  const person = row({ refCode: "owner001" });
  const { deps, store } = depsFor([person]);
  for (let i = 0; i < 8; i += 1) {
    delete person.shareCode;
    const target = store.rows[0]!;
    delete target.shareCode;
    const code = await ensureShareCode(person, deps, () => `REEF${i}X`.slice(0, 6));
    assert.equal(code === null, false, `attempt ${i}`);
  }
  delete person.shareCode;
  delete store.rows[0]!.shareCode;
  assert.equal(await ensureShareCode(person, deps, () => "REEF99"), null);

  const claimer = row({ refCode: "claim001" });
  const claimDeps = depsFor([claimer]);
  for (let i = 0; i < SETTINGS_WRITES_PER_WINDOW; i += 1) {
    const rejected = await claimShareCodeService("claim001", "NO", claimDeps.deps);
    assert.equal(rejected.status, "rejected");
  }
  assert.equal(
    (await claimShareCodeService("claim001", "REEF42", claimDeps.deps)).status,
    "rate_limited",
  );
  assert.equal(
    claimDeps.deps.settingsLimiter.take("claim001", claimDeps.deps.now().getTime()),
    true,
  );
});

test("signup and routes keep the code out of the off payload", () => {
  const index = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  assert.match(
    index,
    /programOn && refReady && !getRef\(\) && typedCode\.trim\(\)/,
  );
  const waitlist = readFileSync(
    new URL("../src/lib/api/waitlist.functions.ts", import.meta.url),
    "utf8",
  );
  const gate = waitlist.indexOf("referralProgramEnabled(process.env) &&");
  const note = waitlist.indexOf("shareCodeNote ? { ...result, shareCodeNote } : result");
  assert.ok(gate > 0, "signup resolves a code only while the program is on");
  assert.ok(note > gate, "the note is attached only when one was set");
  for (const file of ["../src/routes/r.$code.tsx", "../src/routes/$locale.r.$code.tsx"]) {
    const route = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(route, /X-Robots-Tag": "noindex, nofollow"/);
    const off = route.indexOf("if (!referralProgramEnabled(process.env))");
    const load = route.indexOf('import("@/lib/referral/shareLink.server")');
    assert.ok(off > 0 && load > off, `${file} loads Notion only after the switch`);
  }
});

test("the welcome guide names a code only when one is passed", async () => {
  const { buddyGuideBody } = await import("../src/lib/verification/resend.ts");
  const footer = { unsubscribeUrl: "https://x.test/unsub", korean: false as const };
  const links = {
    shareUrl: "https://x.test/r/abcd1234",
    statusUrl: "https://x.test/buddy#t",
    rulesUrl: "https://x.test/buddy-rules",
  };
  const plain = buddyGuideBody(links, "en", footer);
  assert.equal(buddyGuideBody(links, "en", footer, undefined).text, plain.text);
  assert.equal(buddyGuideBody(links, "en", footer, "nope").html, plain.html);
  const withCode = buddyGuideBody(links, "en", footer, "REEF42");
  assert.match(withCode.text, /Your referral code: REEF42/);
  assert.match(withCode.html, /Your referral code:/);
  assert.match(withCode.html, /REEF42/);
  assert.equal(withCode.text.includes(plain.text), false);
  const hostile = buddyGuideBody(links, "en", footer, "REEF<42");
  assert.equal(hostile.html, plain.html);
});
