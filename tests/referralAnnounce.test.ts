import assert from "node:assert/strict";
import test from "node:test";
import { handleReferralAnnounce, createAnnounceDeps } from "../src/lib/referral/announce.server.ts";
import { runAnnounce, type AnnounceDeps, type AnnounceRow } from "../src/lib/referral/announce.ts";
import { REFERRAL_PROGRAM_ID } from "../src/lib/referral/program.ts";

const env = { WATCHDIVE_REMINDER_CRON_SECRET: "test-cron-secret-long-enough", WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "1" };
const body = { releasedAt: "2026-10-22T00:00:00Z", mode: "dry-run", confirm: REFERRAL_PROGRAM_ID };
const row: AnnounceRow = { pageId: "page", leadId: "11111111-1111-4111-8111-111111111111", email: "one@example.com", status: "verified", emailVerified: true, suspect: false, duplicate: false, verifiedAt: "2026-10-20T00:00:00Z", refCode: "abcd1234" };
function request(over: Record<string, unknown> = {}, auth = `Bearer ${env.WATCHDIVE_REMINDER_CRON_SECRET}`) {
  return new Request("https://x.test/api/cron/referral-announce", { method: "POST", headers: { authorization: auth }, body: JSON.stringify({ ...body, ...over }) });
}
function fixture(rows = [{ ...row }]) {
  const events: string[] = [];
  const deps: AnnounceDeps = { rows, env, links: () => ({ share: "https://x.test/r/abcd1234", status: "https://x.test/buddy#token", rules: "https://x.test/buddy-rules", unsubscribe: "https://x.test/unsubscribe/token" }),
    mark: async (r, marker) => { events.push(marker.split(" ")[0]); r.announceMarker = marker; },
    send: async () => { events.push("provider"); }, sleep: async () => {},
  };
  return { deps, events };
}
test("cron auth, switch and confirmation gates precede all Notion reads", async () => {
  let reads = 0;
  const assemble = async () => { reads++; return fixture().deps; };
  assert.equal((await handleReferralAnnounce(request({}, "wrong"), env, assemble)).status, 401);
  assert.equal((await handleReferralAnnounce(request(), { ...env, WATCHDIVE_REMINDER_CRON_SECRET: "" }, assemble)).status, 503);
  assert.equal((await handleReferralAnnounce(request(), { ...env, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: "0" }, assemble)).status, 404);
  assert.equal((await handleReferralAnnounce(request({ confirm: undefined }), env, assemble)).status, 400);
  for (const input of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { releasedAt: "yesterday" }, { mode: "send" }, { only: "a@example.com,b@example.com" }]) {
    assert.equal((await handleReferralAnnounce(request(input), env, assemble)).status, 400);
  }
  assert.equal(reads, 0);
});
test("dry-run counts only; apply writes intent before provider then sent; rerun skips", async () => {
  const { deps, events } = fixture();
  const assemble = async () => deps;
  const dry = await (await handleReferralAnnounce(request(), env, assemble)).json();
  assert.equal(dry.planned, 1);
  assert.equal(dry.sent, 0);
  assert.deepEqual(events, []);
  assert.equal(JSON.stringify(dry).includes("@"), false);
  const applied = await (await handleReferralAnnounce(request({ mode: "apply" }), env, assemble)).json();
  assert.equal(applied.sent, 1);
  assert.deepEqual(events, ["intent", "provider", "sent"]);
  assert.match(deps.rows[0].announceMarker!, /^sent \S+ [0-9a-f]{24}$/);
  assert.equal((await (await handleReferralAnnounce(request({ mode: "apply" }), env, assemble)).json()).alreadySent, 1);
});
test("a marker on any duplicate row holds the inbox even if that row is ineligible", async () => {
  const { deps, events } = fixture([{ ...row }, { ...row, pageId: "p2", status: "pending", announceMarker: "intent 2026-10-21T00:00:00Z hash" }]);
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt) }, deps);
  assert.equal(result.heldUnresolved, 1);
  assert.deepEqual(events, []);
});
test("failed intent write prevents provider; failed sent write leaves held intent", async () => {
  const { deps, events } = fixture();
  const opts = { apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt) };
  assert.equal((await runAnnounce(opts, { ...deps, mark: async () => { throw Error(); } })).failed, 1);
  assert.deepEqual(events, []);
  const mark = deps.mark;
  deps.mark = async (r, marker) => { if (marker.startsWith("sent")) throw Error(); await mark(r, marker); };
  const result = await runAnnounce(opts, deps);
  assert.equal(result.sent, 1);
  assert.equal(result.heldUnresolved, 1);
  assert.equal((await runAnnounce(opts, deps)).sent, 0);
});
test("time budget defers all sends without writing intents", async () => {
  const { deps, events } = fixture();
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), budgetMs: 0 }, deps);
  assert.equal(result.deferred, 1);
  assert.deepEqual(events, []);
});
test("production adapter refuses missing schema before row scan (fake fetch only)", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => { calls.push(String(input)); return new Response(JSON.stringify({ properties: {} })); };
  try {
    await assert.rejects(createAnnounceDeps({ ...env, NOTION_API_KEY: "fake", NOTION_WAITLIST_DB_ID: "db", WATCHDIVE_VERIFICATION_SECRET: "a".repeat(40), WATCHDIVE_PUBLIC_ORIGIN: "https://watchdive.diveroid.com" }, AbortSignal.timeout(5000), false));
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});
test("HTTP caller keeps bearer server-side, posts defaults and prints no addresses", async () => {
  const { mkdtemp, writeFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { main } = await import("../scripts/referral-announce.ts");
  const dir = await mkdtemp(join(tmpdir(), "announce-caller-"));
  const config = join(dir, "config.json");
  await writeFile(config, JSON.stringify({ secret: env.WATCHDIVE_REMINDER_CRON_SECRET }), { mode: 0o600 });
  const original = globalThis.fetch;
  const log = console.log;
  const lines: string[] = [];
  console.log = (line) => { lines.push(String(line)); };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://watchdive.diveroid.com/api/cron/referral-announce");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${env.WATCHDIVE_REMINDER_CRON_SECRET}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { releasedAt: body.releasedAt, confirm: REFERRAL_PROGRAM_ID, mode: "dry-run", limit: 20 });
    return new Response(JSON.stringify({ ok: true, sent: 0, eligible: 1, sample: { to: row.email } }));
  };
  try {
    assert.equal(await main(["--config", config, "--released-at", body.releasedAt, "--confirm", REFERRAL_PROGRAM_ID]), 0);
    assert.deepEqual(JSON.parse(lines[0]), { ok: true, sent: 0, eligible: 1 });
    assert.equal(lines.join().includes("@"), false);
    await assert.rejects(access(`${config}.referral-announce.lock`));
  } finally { globalThis.fetch = original; console.log = log; await rm(dir, { recursive: true, force: true }); }
});
