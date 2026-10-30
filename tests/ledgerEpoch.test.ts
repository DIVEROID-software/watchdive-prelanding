import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  initializeLedgerEpoch,
  readLedgerMarker,
} from "../src/lib/analytics/activationPreflight.ts";
import {
  createGoogleConversions,
  LEDGER_EPOCH_KEY,
  LEDGER_SCRIPTS,
  LedgerEpochRejected,
} from "../src/lib/analytics/googleConversions.server.ts";
import { createMetaPurchases } from "../src/lib/analytics/metaPurchases.server.ts";

const EPOCH = "watchdive-ledger-20261030";
const OTHER = "watchdive-ledger-other-2026";
const NOW = Date.parse("2026-10-30T00:00:00Z");
const EMAIL = "diver@example.test";
const ENV = {
  WATCHDIVE_GA4_CONVERSIONS_ENABLED: "true",
  VITE_GA4_SERVER_CONVERSIONS_ENABLED: "true",
  VITE_GA_MEASUREMENT_ID: "G-TEST1234",
  GA4_API_SECRET: "fixture-only",
  WATCHDIVE_VERIFICATION_SECRET: "x".repeat(32),
  WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
  WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
  WATCHDIVE_CONVERSION_LEDGER_EPOCH: EPOCH,
};
const SIGNUP = { name: "sign_up" as const, key: "record-one", params: { method: "email" } };

function occupied(db: Map<string, string>, pattern: string): boolean {
  const prefix = pattern.replace("*", "");
  for (const key of db.keys()) if (key.startsWith(prefix)) return true;
  return false;
}

/** Branch model of the Lua scripts. Production sends the script text itself. */
function apply(script: string, keys: string[], argv: string[], db: Map<string, string>): string {
  const marker = () => (db.has(keys[0]) ? db.get(keys[0])! : false);
  if (script === LEDGER_SCRIPTS.claim) {
    const current = marker();
    if (current !== argv[0]) return current === false ? "missing" : "mismatch";
    if (db.has(keys[1])) return "held";
    db.set(keys[1], argv[1]);
    return "claimed";
  }
  if (script === LEDGER_SCRIPTS.capture) {
    const current = marker();
    if (current !== argv[0]) return current === false ? "missing" : "mismatch";
    db.set(keys[1], argv[1]);
    return "ok";
  }
  if (script === LEDGER_SCRIPTS.release) {
    const current = marker();
    if (current !== argv[0]) return current === false ? "missing" : "mismatch";
    db.delete(keys[1]);
    return "released";
  }
  if (script === LEDGER_SCRIPTS.finish) {
    const current = marker();
    if (current !== argv[0]) return current === false ? "missing" : "mismatch";
    const value = db.get(keys[1]);
    if (value !== "uncertain" && value !== "accepted") return "absent";
    db.set(keys[1], argv[1]);
    return "ok";
  }
  if (script === LEDGER_SCRIPTS.init) {
    const current = db.has(keys[0]) ? db.get(keys[0])! : false;
    if (current === argv[0]) return "already";
    if (current !== false) return "mismatch";
    if (occupied(db, "wdconv:event:*") || occupied(db, "wdconv:context:*")) return "nonempty";
    if (db.has(keys[0])) return "conflict";
    db.set(keys[0], argv[0]);
    return "initialized";
  }
  throw new Error("unknown ledger script");
}

type Mode = "stable" | "wipe-before-claim" | "wipe-after-claim" | "drop-claim-before-finish";

function redis(mode: Mode = "stable") {
  const db = new Map<string, string>([[LEDGER_EPOCH_KEY, EPOCH]]);
  const commands: (string | number)[][] = [];
  const posts: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://www.google-analytics.com/") || url.includes("facebook.com")) {
      posts.push(url);
      if (mode === "drop-claim-before-finish") {
        for (const key of [...db.keys()]) if (key.startsWith("wdconv:event:")) db.delete(key);
      }
      return new Response(null, { status: 204 });
    }
    const args = JSON.parse(String(init?.body)) as (string | number)[];
    commands.push(args);
    const [cmd, key] = args;
    if (cmd === "SET") throw new Error("runtime SET is not a ledger command");
    if (cmd === "GET") {
      return Response.json({ result: db.get(String(key)) ?? null });
    }
    if (cmd === "DEL") {
      return Response.json({ result: db.delete(String(key)) ? 1 : 0 });
    }
    if (cmd === "EVAL") {
      const script = String(args[1]);
      assert.notEqual(script, LEDGER_SCRIPTS.init);
      const numkeys = Number(args[2]);
      const keys = args.slice(3, 3 + numkeys).map(String);
      const argv = args.slice(3 + numkeys).map(String);
      if (script === LEDGER_SCRIPTS.claim && mode === "wipe-before-claim") db.delete(LEDGER_EPOCH_KEY);
      const result = apply(script, keys, argv, db);
      if (script === LEDGER_SCRIPTS.claim && result === "claimed" && mode === "wipe-after-claim") {
        db.delete(LEDGER_EPOCH_KEY);
      }
      return Response.json({ result });
    }
    return Response.json({ error: "unexpected" });
  };
  const google = createGoogleConversions({ env: ENV, fetchImpl, now: () => NOW });
  return { db, commands, posts, fetchImpl, google };
}

function noEpochWrite(commands: (string | number)[][], db: Map<string, string>, expected: string | undefined) {
  assert.equal(
    commands.some((args) => args[0] === "SET" || args[1] === LEDGER_SCRIPTS.init),
    false,
  );
  if (expected === undefined) assert.equal(db.has(LEDGER_EPOCH_KEY), false);
  else assert.equal(db.get(LEDGER_EPOCH_KEY), expected);
}

test("the epoch scripts check the marker before any write and do not reset it", () => {
  assert.ok(LEDGER_SCRIPTS.claim.indexOf('redis.call("GET"') < LEDGER_SCRIPTS.claim.indexOf('redis.call("SET"'));
  assert.match(LEDGER_SCRIPTS.claim, /"NX"/);
  assert.doesNotMatch(LEDGER_SCRIPTS.claim, /EX/);
  assert.doesNotMatch(LEDGER_SCRIPTS.claim, /SET", KEYS\[1\]/);
  assert.ok(LEDGER_SCRIPTS.init.indexOf("SCAN") < LEDGER_SCRIPTS.init.lastIndexOf('redis.call("SET"'));
  assert.match(LEDGER_SCRIPTS.init, /return "nonempty"/);
  assert.match(LEDGER_SCRIPTS.init, /"NX"/);
  for (const script of [
    LEDGER_SCRIPTS.claim,
    LEDGER_SCRIPTS.capture,
    LEDGER_SCRIPTS.release,
    LEDGER_SCRIPTS.finish,
  ]) {
    assert.equal(script.includes("wdconv-op:init"), false);
    assert.doesNotMatch(script, /SET", KEYS\[1\]/);
  }
});

test("a known epoch sends once and a second call holds the accepted claim", async () => {
  const h = redis();
  await h.google.capture(EMAIL, "123.456", true);
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "accepted");
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "duplicate");
  assert.equal(h.posts.length, 1);
  assert.equal([...h.db.values()].filter((value) => value === "accepted").length, 1);
  const claim = h.commands.find((args) => args[1] === LEDGER_SCRIPTS.claim);
  assert.equal(claim?.[0], "EVAL");
  assert.equal(h.commands.filter((args) => args[1] === LEDGER_SCRIPTS.claim).length, 2);
  noEpochWrite(h.commands, h.db, EPOCH);
});

test("missing and mismatched epochs do not post sign_up, purchase, or refund", async () => {
  for (const name of ["sign_up", "purchase", "refund"] as const) {
    for (const marker of [undefined, OTHER]) {
      const h = redis();
      if (marker === undefined) h.db.delete(LEDGER_EPOCH_KEY);
      else h.db.set(LEDGER_EPOCH_KEY, marker);
      await assert.rejects(
        h.google.capture(EMAIL, "123.456", true),
        (error: unknown) => error instanceof LedgerEpochRejected && error.message === "conversion_ledger_epoch",
      );
      assert.equal(
        await h.google.send(EMAIL, { ...SIGNUP, name, key: `${name}-1` }, async () => true),
        "retry",
      );
      assert.equal(h.posts.length, 0);
      assert.equal([...h.db.keys()].some((key) => key.startsWith("wdconv:event:")), false);
      noEpochWrite(h.commands, h.db, marker);
    }
  }
});

test("a wipe between the epoch read and the claim does not let SET NX succeed", async () => {
  const h = redis("wipe-before-claim");
  await h.google.capture(EMAIL, "123.456", true);
  h.posts.length = 0;
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "retry");
  assert.equal(h.posts.length, 0);
  assert.equal([...h.db.keys()].some((key) => key.startsWith("wdconv:event:")), false);
  assert.equal(h.db.has(LEDGER_EPOCH_KEY), false);
});

test("an epoch that disappears after the claim does not post and keeps the tombstone", async () => {
  const h = redis("wipe-after-claim");
  await h.google.capture(EMAIL, "123.456", true);
  h.posts.length = 0;
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "uncertain");
  assert.equal(h.posts.length, 0);
  assert.equal([...h.db.values()].includes("uncertain"), true);
  assert.equal(h.db.has(LEDGER_EPOCH_KEY), false);
  noEpochWrite(h.commands, h.db, undefined);
});

test("clearing an accepted ledger does not post again and does not recreate the epoch", async () => {
  const h = redis();
  await h.google.capture(EMAIL, "123.456", true);
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "accepted");
  h.db.clear();
  h.posts.length = 0;
  // A wiped marker fails closed on capture. Checkout already turns that throw
  // into HTTP 503. The sender must not stamp a new epoch to recover.
  await assert.rejects(h.google.capture(EMAIL, "123.456", true), LedgerEpochRejected);
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "retry");
  assert.equal(h.posts.length, 0);
  assert.equal(h.db.has(LEDGER_EPOCH_KEY), false);
  noEpochWrite(h.commands, h.db, undefined);
});

test("refusal still deletes context when the epoch is missing and does not post", async () => {
  const h = redis();
  await h.google.capture(EMAIL, "123.456", true);
  assert.equal([...h.db.keys()].some((key) => key.startsWith("wdconv:context:")), true);
  h.db.delete(LEDGER_EPOCH_KEY);
  h.posts.length = 0;
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => false), "skipped");
  assert.equal([...h.db.keys()].some((key) => key.startsWith("wdconv:context:")), false);
  assert.equal(h.posts.length, 0);
  await h.google.capture(EMAIL, "123.456", false);
  assert.equal(h.posts.length, 0);
});

test("a lost tombstone after the analytics response is not recreated", async () => {
  const h = redis("drop-claim-before-finish");
  await h.google.capture(EMAIL, "123.456", true);
  h.posts.length = 0;
  assert.equal(await h.google.send(EMAIL, SIGNUP, async () => true), "uncertain");
  assert.equal(h.posts.length, 1);
  assert.equal([...h.db.keys()].some((key) => key.startsWith("wdconv:event:")), false);
  assert.equal(h.db.get(LEDGER_EPOCH_KEY), EPOCH);
});

test("Meta purchase does not post when the epoch marker is missing", async () => {
  const h = redis();
  h.db.delete(LEDGER_EPOCH_KEY);
  const meta = createMetaPurchases({
    env: {
      ...ENV,
      WATCHDIVE_META_PURCHASE_ENABLED: "true",
      META_CAPI_ENABLED: "true",
      VITE_META_TRACKING_ENABLED: "true",
      META_PIXEL_ID: "1028181916616055",
      VITE_META_PIXEL_ID: "1028181916616055",
      META_CAPI_ACCESS_TOKEN: "fixture-only",
    },
    fetchImpl: h.fetchImpl,
    now: () => NOW,
  });
  await assert.rejects(meta.capture(EMAIL, true), LedgerEpochRejected);
  assert.equal(await meta.send(EMAIL, "cs_test_session", Math.floor(NOW / 1000) - 60, async () => true), "retry");
  assert.equal(h.posts.length, 0);
  assert.equal(await meta.send(EMAIL, "cs_test_session", Math.floor(NOW / 1000) - 60, async () => false), "skipped");
});

test("init writes only an empty ledger and refuses a different or nonempty one", async () => {
  const base = {
    WATCHDIVE_VERIFICATION_SECRET: "x".repeat(32),
    WATCHDIVE_CONVERSION_REDIS_REST_URL: "https://store.example.test",
    WATCHDIVE_CONVERSION_REDIS_REST_TOKEN: "fixture-only",
    WATCHDIVE_CONVERSION_LEDGER_EPOCH: EPOCH,
  };
  const scripted = (db: Map<string, string>) => {
    const commands: (string | number)[][] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const args = JSON.parse(String(init?.body)) as (string | number)[];
      commands.push(args);
      assert.equal(args[0], "EVAL");
      assert.equal(args[1], LEDGER_SCRIPTS.init);
      const result = apply(String(args[1]), [String(args[3])], [String(args[4])], db);
      return Response.json({ result });
    };
    return { commands, fetchImpl };
  };

  const empty = new Map<string, string>();
  const born = scripted(empty);
  const first = await initializeLedgerEpoch({ env: base, fetchImpl: born.fetchImpl });
  assert.deepEqual(first, { wrote: true, result: "initialized" });
  assert.equal(empty.get(LEDGER_EPOCH_KEY), EPOCH);
  const again = await initializeLedgerEpoch({ env: base, fetchImpl: born.fetchImpl });
  assert.deepEqual(again, { wrote: false, result: "already" });
  assert.equal(born.commands.length, 2);

  const other = new Map<string, string>([[LEDGER_EPOCH_KEY, OTHER]]);
  const mismatch = await initializeLedgerEpoch({ env: base, fetchImpl: scripted(other).fetchImpl });
  assert.deepEqual(mismatch, { wrote: false, result: "mismatch" });
  assert.equal(other.get(LEDGER_EPOCH_KEY), OTHER);

  const historical = new Map<string, string>([["wdconv:event:historical", "accepted"]]);
  const refused = await initializeLedgerEpoch({
    env: base,
    fetchImpl: scripted(historical).fetchImpl,
  });
  assert.deepEqual(refused, { wrote: false, result: "nonempty" });
  assert.equal(historical.get("wdconv:event:historical"), "accepted");
  assert.equal(historical.has(LEDGER_EPOCH_KEY), false);

  const context = new Map<string, string>([["wdconv:context:historical", "{}"]]);
  assert.equal(
    (await initializeLedgerEpoch({ env: base, fetchImpl: scripted(context).fetchImpl })).result,
    "nonempty",
  );

  const probe = new Map<string, string>([["wdconv:preflight:abc:claim", "uncertain"]]);
  assert.equal(
    (await initializeLedgerEpoch({ env: base, fetchImpl: scripted(probe).fetchImpl })).result,
    "initialized",
  );
  assert.equal(
    (await initializeLedgerEpoch({ env: { ...base, WATCHDIVE_CONVERSION_LEDGER_EPOCH: "" }, fetchImpl: born.fetchImpl }))
      .result,
    "unconfigured",
  );
  assert.equal((await readLedgerMarker({ env: base, fetchImpl: async () => Response.json({ result: EPOCH }) })), "matched");
  assert.equal(
    (await readLedgerMarker({
      env: base,
      fetchImpl: async () => Response.json({ result: OTHER }),
    })),
    "mismatched",
  );
  const markerText = JSON.stringify(
    await readLedgerMarker({ env: base, fetchImpl: async () => Response.json({ result: null }) }),
  );
  assert.equal(markerText.includes(EPOCH), false);
});

test("the init CLI rejects repair flags before reading a planted secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-ledger-init-"));
  const envFile = join(dir, "secrets.env");
  const planted = "planted-ledger-token-9f3a";
  writeFileSync(
    envFile,
    [
      `WATCHDIVE_CONVERSION_REDIS_REST_TOKEN=${planted}`,
      `WATCHDIVE_CONVERSION_LEDGER_EPOCH=${EPOCH}`,
      "WATCHDIVE_CONVERSION_REDIS_REST_URL=https://store.example.test",
      `WATCHDIVE_VERIFICATION_SECRET=${"x".repeat(32)}`,
    ].join("\n"),
  );
  const run = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/conversion-ledger-init.ts",
      "--env-file",
      envFile,
      "--repair",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    },
  );
  assert.equal(run.status, 3);
  assert.equal(run.stdout.includes(planted), false);
  assert.equal(run.stdout.includes(EPOCH), false);
  assert.equal(run.stderr.includes(planted), false);
  const body = JSON.parse(run.stdout) as { wrote: boolean; result: string; sendsAnalytics: boolean };
  assert.equal(body.result, "rejected");
  assert.equal(body.wrote, false);
  assert.equal(body.sendsAnalytics, false);
});
