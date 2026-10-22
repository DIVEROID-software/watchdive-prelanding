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

const SCAN_ENV = {
  ...env,
  NOTION_API_KEY: "fake-notion-key",
  NOTION_WAITLIST_DB_ID: "db",
  WATCHDIVE_VERIFICATION_SECRET: "a".repeat(40),
  WATCHDIVE_PUBLIC_ORIGIN: "https://watchdive.diveroid.com",
  WATCHDIVE_SENDER_PHONE: "+82 10-0000-0000",
  RESEND_API_KEY: "re_test_key_not_real",
  WATCHDIVE_EMAIL_FROM: "help@diveroid.com",
};
const LEAD_A = "11111111-1111-4111-8111-111111111111";
const LEAD_B = "22222222-2222-4222-8222-222222222222";
const CREATED_SORT = [{ timestamp: "created_time", direction: "ascending" }];

function notionPage(id: string, email: string, leadId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    properties: {
      Email: { title: [{ plain_text: email }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      "Verified at": { date: { start: "2026-10-20T00:00:00.000Z" } },
      "Ref code": { rich_text: [{ plain_text: "abcd1234" }] },
      "Lead ID": { rich_text: [{ plain_text: leadId }] },
      Suspect: { checkbox: false },
      "Signup locale": { rich_text: [{ plain_text: "en" }] },
      "Referral announce": { rich_text: [] },
      ...extra,
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

async function withNotion(pages: Record<string, unknown>[], run: (calls: { url: string; body?: unknown }[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: { url: string; body?: unknown }[] = [];
  let query = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const parsed = init?.body ? JSON.parse(String(init.body)) as unknown : undefined;
    calls.push({ url, body: parsed });
    if (url.endsWith("/query")) return jsonResponse(pages[query++] ?? { results: [], has_more: false });
    if (url.includes("api.resend.com")) return jsonResponse({ id: "email_should_not_send" });
    return jsonResponse({ properties: { "Referral announce": { type: "rich_text" } } });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test("a short, missing, or oversized bearer is rejected and a 15-character secret is not configured", async () => {
  let reads = 0;
  const assemble = async () => { reads++; return fixture().deps; };
  assert.equal((await handleReferralAnnounce(request({}, "Bearer x"), env, assemble)).status, 401);
  assert.equal((await handleReferralAnnounce(request({}, `Bearer ${"z".repeat(5000)}`), env, assemble)).status, 401);
  const bare = new Request("https://x.test/api/cron/referral-announce", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await handleReferralAnnounce(bare, env, assemble)).status, 401);
  assert.equal((await handleReferralAnnounce(request(), { ...env, WATCHDIVE_REMINDER_CRON_SECRET: "123456789012345" }, assemble)).status, 503);
  assert.equal(reads, 0);
});

test("one request sends at most the requested limit", async () => {
  const rows = [0, 1, 2].map((i) => ({ ...row, pageId: `p${i}`, leadId: `1111111${i}-1111-4111-8111-111111111111`, email: `u${i}@example.com`, refCode: `abcd123${i}` }));
  const { deps, events } = fixture(rows);
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), limit: 1 }, deps);
  assert.equal(result.sent, 1);
  assert.equal(result.deferred, 2);
  assert.equal(events.filter((event) => event === "provider").length, 1);
});

test("self-test holds an inbox that already has an intent or sent marker and writes nothing", async () => {
  const intent = fixture([{ ...row, announceMarker: "intent 2026-10-21T00:00:00.000Z abcdef0123456789abcdef" }]);
  const held = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), only: "ONE@example.com" }, intent.deps);
  assert.equal(held.sent, 0);
  assert.equal(held.heldUnresolved, 1);
  assert.deepEqual(intent.events, []);
  const sentMark = fixture([{ ...row, announceMarker: "sent 2026-10-21T00:00:00.000Z abcdef0123456789abcdef" }]);
  const already = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), only: row.email }, sentMark.deps);
  assert.equal(already.sent, 0);
  assert.equal(already.alreadySent, 1);
  assert.deepEqual(sentMark.events, []);
});

test("self-test of an unmarked address writes no marker and still skips an opt-out", async () => {
  const clean = fixture();
  const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), only: row.email }, clean.deps);
  assert.equal(result.sent, 1);
  assert.deepEqual(clean.events, ["provider"]);
  assert.equal(clean.deps.rows[0].announceMarker, undefined);
  const opted = fixture([{ ...row, launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" }]);
  const blocked = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt), only: row.email }, opted.deps);
  assert.equal(blocked.sent, 0);
  assert.equal(blocked.skipped.unsubscribed, 1);
  assert.deepEqual(opted.events, []);
});

test("announce scan sorts by created time and a later-page opt-out blocks the inbox", async () => {
  await withNotion([
    { results: [notionPage("p1", "diver@example.com", LEAD_A)], has_more: true, next_cursor: "page-2" },
    { results: [notionPage("p2", "Diver@Example.com", LEAD_B, { "Launch mail": { rich_text: [{ plain_text: "unsubscribed 2026-10-21T00:00:00.000Z" }] } })], has_more: false },
  ], async (calls) => {
    const deps = await createAnnounceDeps(SCAN_ENV, AbortSignal.timeout(5000), false);
    const queries = calls.filter((call) => call.url.endsWith("/query"));
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[0].body, { page_size: 100, sorts: CREATED_SORT });
    assert.deepEqual(queries[1].body, { page_size: 100, sorts: CREATED_SORT, start_cursor: "page-2" });
    let sent = 0;
    deps.send = async () => { sent += 1; };
    const result = await runAnnounce({ apply: true, confirm: REFERRAL_PROGRAM_ID, releasedAt: new Date(body.releasedAt) }, deps);
    assert.equal(deps.rows.length, 2);
    assert.equal(result.sent, 0);
    assert.equal(sent, 0);
    assert.equal(calls.some((call) => call.url.includes("api.resend.com")), false);
  });
});

test("a missing, non-boolean, or repeated cursor sends nothing", async () => {
  const broken = [
    [{ results: [notionPage("p1", "one@example.com", LEAD_A)] }],
    [{ results: [notionPage("p1", "one@example.com", LEAD_A)], has_more: "false" }],
    [
      { results: [notionPage("p1", "one@example.com", LEAD_A)], has_more: true, next_cursor: "same" },
      { results: [], has_more: true, next_cursor: "same" },
    ],
  ];
  for (const pages of broken) {
    await withNotion(pages, async () => {
      await assert.rejects(createAnnounceDeps(SCAN_ENV, AbortSignal.timeout(5000), false), /invalid_cursor/);
    });
    await withNotion(pages, async (calls) => {
      const response = await handleReferralAnnounce(request({ mode: "apply" }), SCAN_ENV);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false });
      assert.equal(calls.some((call) => call.url.includes("api.resend.com")), false);
      assert.equal(JSON.stringify(calls).includes("@"), false);
    });
  }
});

test("an incomplete query cap sends nothing even when has_more is false", async () => {
  const pages = [{ results: [notionPage("p1", "one@example.com", LEAD_A)], has_more: false, request_status: { type: "incomplete" } }];
  await withNotion(pages, async () => {
    await assert.rejects(createAnnounceDeps(SCAN_ENV, AbortSignal.timeout(5000), false), /scan_incomplete/);
  });
  await withNotion(pages, async (calls) => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args) => { errors.push(args.map(String).join(" ")); };
    try {
      const response = await handleReferralAnnounce(request({ mode: "apply" }), SCAN_ENV);
      assert.equal(response.status, 503);
      assert.equal(JSON.stringify(await response.json()).includes("@"), false);
      assert.equal(errors.join("").includes("@"), false);
      assert.equal(calls.some((call) => call.url.includes("api.resend.com")), false);
    } finally { console.error = original; }
  });
});

test("ten thousand rows without an explicit complete status send nothing", async () => {
  const original = globalThis.fetch;
  let queries = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.endsWith("/query")) return jsonResponse({ properties: { "Referral announce": { type: "rich_text" } } });
    const index = queries++;
    const results = Array.from({ length: 100 }, (_, offset) => notionPage(`p${index}-${offset}`, `u${index}-${offset}@example.com`, LEAD_A));
    if (index < 99) return jsonResponse({ results, has_more: true, next_cursor: `cursor-${index}` });
    return jsonResponse({ results, has_more: false });
  };
  try {
    await assert.rejects(createAnnounceDeps(SCAN_ENV, AbortSignal.timeout(5000), false), /scan_incomplete/);
    assert.equal(queries, 100);
  } finally { globalThis.fetch = original; }
});

test("the scan stops at 200 pages and an accepted send is marked only after the provider accepts", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { logs.push(args.map(String).join(" ")); };
  console.error = (...args) => { logs.push(args.map(String).join(" ")); };
  let queries = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const parsed = init?.body ? JSON.parse(String(init.body)) as { properties?: { "Referral announce"?: { rich_text?: { text?: { content?: string } }[] } } } : undefined;
    if (url.endsWith("/query")) {
      queries += 1;
      assert.deepEqual(parsed, queries === 1 ? { page_size: 100, sorts: CREATED_SORT } : { page_size: 100, sorts: CREATED_SORT, start_cursor: `cursor-${queries - 2}` });
      if (queries < 200) return jsonResponse({ results: [], has_more: true, next_cursor: `cursor-${queries - 1}` });
      return jsonResponse({ results: [notionPage("p1", "one@example.com", LEAD_A)], has_more: true, next_cursor: "cursor-199" });
    }
    if (url.includes("api.resend.com")) {
      seen.push(`resend:${new Headers(init?.headers).get("Idempotency-Key")}`);
      return jsonResponse({ id: "email_1" });
    }
    const marker = parsed?.properties?.["Referral announce"]?.rich_text?.[0]?.text?.content;
    if (marker) seen.push(marker.split(" ")[0]);
    return jsonResponse({ properties: { "Referral announce": { type: "rich_text" } } });
  };
  try {
    await assert.rejects(createAnnounceDeps(SCAN_ENV, AbortSignal.timeout(5000), false), /scan_limit/);
    assert.equal(queries, 200);
    queries = 0;
    const response = await handleReferralAnnounce(request({ mode: "apply", limit: 1 }), SCAN_ENV);
    // The capped walk throws before a send. A separate one-page apply is below.
    assert.equal(response.status, 503);
    assert.equal(seen.some((item) => item.startsWith("resend")), false);
  } finally {
    globalThis.fetch = original;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("sent marker is written only after an accepted send and the response and logs omit addresses", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => { logs.push(args.map(String).join(" ")); };
  console.error = (...args) => { logs.push(args.map(String).join(" ")); };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const parsed = init?.body ? JSON.parse(String(init.body)) as { properties?: { "Referral announce"?: { rich_text?: { text?: { content?: string } }[] } } } : undefined;
    if (url.endsWith("/query")) {
      assert.deepEqual(parsed, { page_size: 100, sorts: CREATED_SORT });
      return jsonResponse({ results: [notionPage("p1", "one@example.com", LEAD_A, { "Signup locale": { rich_text: [{ plain_text: "ko" }] } })], has_more: false, request_status: { type: "complete" } });
    }
    if (url.includes("api.resend.com")) {
      const key = new Headers(init?.headers).get("Idempotency-Key");
      seen.push(`resend:${key}`);
      const payload = JSON.parse(String(init?.body)) as { subject?: string; to?: string[] };
      assert.equal(payload.subject?.startsWith("(광고) "), true);
      assert.deepEqual(payload.to, ["one@example.com"]);
      return jsonResponse({ id: "email_1" });
    }
    const marker = parsed?.properties?.["Referral announce"]?.rich_text?.[0]?.text?.content;
    if (marker) seen.push(marker.split(" ")[0]);
    return jsonResponse({ properties: { "Referral announce": { type: "rich_text" } } });
  };
  try {
    const response = await handleReferralAnnounce(request({ mode: "apply", limit: 1 }), SCAN_ENV);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.sent, 1);
    assert.deepEqual(seen, ["intent", `resend:${REFERRAL_PROGRAM_ID}-announce-${LEAD_A}`, "sent"]);
    assert.equal(JSON.stringify(payload).includes("@"), false);
    assert.equal(logs.join("\n").includes("@"), false);
  } finally {
    globalThis.fetch = original;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("checklist step 8 and the ops commands run against a fake endpoint without the verification secret", async () => {
  const { mkdtemp, writeFile, readFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(new URL("../scripts/referral-announce.ts", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "announce-cli-"));
  const config = join(dir, "config.json");
  const capture = join(dir, "capture.json");
  await writeFile(config, JSON.stringify({ secret: env.WATCHDIVE_REMINDER_CRON_SECRET }), { mode: 0o600 });
  await writeFile(join(dir, "fake-fetch.mjs"), `import { writeFileSync } from "node:fs";
globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
    url: String(input), redirect: init?.redirect ?? null,
    authorization: headers.get("authorization"), body: JSON.parse(String(init?.body)),
  }));
  return new Response(JSON.stringify({ ok: true, sent: 0, eligible: 1, failed: 0, heldUnresolved: 0, sample: { to: "leak@example.com" } }), { status: 200 });
};
`);
  await writeFile(join(dir, "no-fetch.mjs"), "globalThis.fetch = async () => { throw new Error(\"network_forbidden\"); };\n");
  const childEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: dir, LANG: "C" };
  assert.equal("WATCHDIVE_VERIFICATION_SECRET" in childEnv, false);
  assert.equal("NOTION_API_KEY" in childEnv, false);
  assert.equal("RESEND_API_KEY" in childEnv, false);
  const run = (preload: string, args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", `--import=${join(dir, preload)}`, script, ...args], {
    cwd: root, env: childEnv, encoding: "utf8", timeout: 20000,
  });
  try {
    const help = run("no-fetch.mjs", ["--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--config <private\.json>/);
    assert.match(help.stdout, /--released-at <ISO>/);
    assert.match(help.stdout, /--confirm wd-buddy-invite-20261022/);
    assert.match(help.stdout, /\[--dry-run\]/);
    assert.match(help.stdout, /\[--apply\] \[--limit <1\.\.200>\]/);
    assert.match(help.stdout, /\[--only <email>\]/);
    assert.equal(help.stdout.includes("@"), false);
    const released = "2026-10-22T00:00:00Z";
    const commands = [
      ["--config", config, "--released-at", released, "--confirm", REFERRAL_PROGRAM_ID, "--dry-run"],
      ["--config", config, "--released-at", released, "--only", "owner@example.com", "--apply", "--confirm", REFERRAL_PROGRAM_ID],
      ["--config", config, "--released-at", released, "--limit", "20", "--apply", "--confirm", REFERRAL_PROGRAM_ID],
      ["--config", config, "--released-at", released, "--confirm", REFERRAL_PROGRAM_ID, "--only", "me@example.com", "--apply"],
      ["--config", config, "--released-at", released, "--confirm", REFERRAL_PROGRAM_ID, "--limit", "20", "--apply"],
    ];
    for (const args of commands) {
      const result = run("fake-fetch.mjs", args);
      assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
      assert.equal(result.stdout.includes("@"), false);
      assert.equal(result.stdout.includes(env.WATCHDIVE_REMINDER_CRON_SECRET), false);
      const onlyAt = args.indexOf("--only");
      const limitAt = args.indexOf("--limit");
      const recorded = JSON.parse(await readFile(capture, "utf8")) as { url: string; redirect: string; authorization: string; body: Record<string, unknown> };
      assert.equal(recorded.url, "https://watchdive.diveroid.com/api/cron/referral-announce");
      assert.equal(recorded.redirect, "error");
      assert.equal(recorded.authorization, `Bearer ${env.WATCHDIVE_REMINDER_CRON_SECRET}`);
      assert.deepEqual(recorded.body, {
        releasedAt: released, confirm: REFERRAL_PROGRAM_ID, mode: args.includes("--apply") ? "apply" : "dry-run",
        limit: limitAt >= 0 ? Number(args[limitAt + 1]) : 20,
        ...(onlyAt >= 0 ? { only: args[onlyAt + 1] } : {}),
      });
      await assert.rejects(access(`${config}.referral-announce.lock`));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
