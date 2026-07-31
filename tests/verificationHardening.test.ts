// Regressions for the two deployment-blocking findings and the exact fixes
// that shipped with them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import {
  GENERIC_PENDING_MESSAGE,
  POLL_CACHE_TTL_MS,
  POLL_MAX_STORE_READS_PER_HANDLE,
  type PollResponse,
} from "../src/lib/verification/contracts.ts";
import {
  assertVerificationEnv,
  checkVerificationEnv,
  formatEnvProblems,
} from "../src/lib/verification/envPreflight.ts";
import { describeNotionFailure } from "../src/lib/verification/notionLead.ts";
import {
  createNetworkGate,
  GLOBAL_SEND_BLOCK_THRESHOLD,
  GLOBAL_WINDOW_MS,
} from "../src/lib/verification/networkGate.ts";
import { createPollGate } from "../src/lib/verification/pollGate.ts";
import {
  pollVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import {
  nextPollDelayMs,
  totalScheduleMs,
  VERIFY_POLL_MAX_ATTEMPTS,
} from "../src/lib/verifyPolling.ts";
import {
  FakeLeadStore,
  FakeMailer,
  leadIdFactory,
  TEST_ENV,
  TEST_ORIGIN,
} from "./helpers/fakes.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const EMAIL = "diver@example.com";
const CANONICAL = canonicalEmail(EMAIL);

let store: FakeLeadStore;
let mailer: FakeMailer;
let clock: Date;

function deps(overrides: Record<string, unknown> = {}) {
  return {
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
    dispatchVerifiedLead: async () => {},
    ...overrides,
  };
}

function submit(overrides: Record<string, unknown> = {}) {
  return {
    email: EMAIL,
    canonical: CANONICAL,
    source: "hero",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    ...overrides,
  };
}

beforeEach(() => {
  store = new FakeLeadStore();
  mailer = new FakeMailer();
  clock = new Date("2026-07-30T09:00:00.000Z");
});

// ---------------------------------------------------------------------------
// P0-1a — the waiting tab's poll schedule
// ---------------------------------------------------------------------------

test("the schedule is twelve polls over roughly five minutes", () => {
  assert.equal(VERIFY_POLL_MAX_ATTEMPTS, 12);
  const total = totalScheduleMs();
  assert.ok(total >= 4.5 * 60_000, `schedule is only ${Math.round(total / 1000)}s`);
  assert.ok(total <= 6 * 60_000, `schedule runs ${Math.round(total / 1000)}s`);
});

test("the opening interval keeps a simultaneous crowd inside the store's quota", () => {
  // The first poll is the one every waiting tab makes at once. Reviewer floor
  // is 5-10s; at 8s twenty tabs are ~2.5 req/s rather than ~10.
  const first = nextPollDelayMs(1, () => 0.5);
  assert.ok(first >= 5000, `opening interval is ${first}ms`);
  assert.ok(first <= 10_000, `opening interval is ${first}ms`);

  const worstCaseFirstWave = 20 / (nextPollDelayMs(1, () => 0) / 1000);
  assert.ok(worstCaseFirstWave < 4, `first wave peaks at ${worstCaseFirstWave.toFixed(1)} req/s`);
});

test("delays back off and then hold at a ceiling", () => {
  const mid = () => 0.5; // no jitter
  const delays = Array.from({ length: VERIFY_POLL_MAX_ATTEMPTS }, (_, i) =>
    nextPollDelayMs(i + 1, mid),
  );

  assert.equal(delays[0], 8000);
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] >= delays[i - 1], `delay ${i} went backwards`);
  }
  assert.ok(Math.max(...delays) <= 30_000);
  // The old schedule was a flat 2s; the new one must be materially cheaper.
  assert.equal(delays[delays.length - 1], 30_000);
});

test("jitter spreads a crowd without ever collapsing to zero", () => {
  const low = nextPollDelayMs(5, () => 0);
  const high = nextPollDelayMs(5, () => 0.999);
  const mid = nextPollDelayMs(5, () => 0.5);

  assert.ok(low < mid && mid < high, "jitter is not applied");
  assert.ok(low >= 500, "jitter can starve the schedule");
  assert.ok(high <= mid * 1.3, "jitter overshoots its band");
});

test("the waiting tab pauses while hidden and never overlaps a request", () => {
  const source = read("src/routes/index.tsx");
  assert.ok(!source.includes("setInterval"), "the tab still polls on a fixed interval");
  assert.ok(source.includes('document.visibilityState === "hidden"'));
  assert.ok(source.includes('document.addEventListener("visibilitychange", onVisibilityChange)'));
  assert.ok(
    source.includes('document.removeEventListener("visibilitychange", onVisibilityChange)'),
  );
  // One request at a time, and a hard ceiling on how many there can be.
  assert.ok(source.includes("let inFlight = false;"));
  assert.ok(source.includes("if (!alive || inFlight) return;"));
  assert.ok(source.includes('if (document.visibilityState === "hidden") return;'));
  assert.ok(source.includes("inFlight = true;"));
  assert.ok(source.includes("inFlight = false;"));
  assert.ok(source.includes("attempts >= VERIFY_POLL_MAX_ATTEMPTS"));
  assert.ok(source.includes("nextPollDelayMs(attempts + 1)"));
});

// ---------------------------------------------------------------------------
// P0-1b — the server-side gate in front of the store
// ---------------------------------------------------------------------------

test("a replayed burst is answered from memory, not from the store", async () => {
  let reads = 0;
  const gate = createPollGate<string>({ now: () => clock.getTime() });
  const read = async () => {
    reads += 1;
    return "pending";
  };

  for (let i = 0; i < 50; i++) await gate.run("handle-a", read);
  assert.equal(reads, 1);
});

test("the cache holds at least as long as the client's opening interval", () => {
  assert.ok(
    POLL_CACHE_TTL_MS >= 8000,
    `cache TTL ${POLL_CACHE_TTL_MS}ms is under the 8s opening interval`,
  );
});

test("the cache expires so a real change is still noticed", async () => {
  let value = "pending";
  let now = 0;
  const gate = createPollGate<string>({ cacheTtlMs: 8000, now: () => now });
  const read = async () => value;

  assert.equal(await gate.run("h", read), "pending");
  value = "verified";
  assert.equal(await gate.run("h", read), "pending", "cache did not hold");
  now += 8001;
  assert.equal(await gate.run("h", read), "verified", "cache never expired");
});

test("one handle can never cost more than its lifetime read ceiling", async () => {
  let reads = 0;
  let now = 0;
  const gate = createPollGate<string>({ cacheTtlMs: 10, now: () => now });
  const read = async () => {
    reads += 1;
    return "pending";
  };

  for (let i = 0; i < POLL_MAX_STORE_READS_PER_HANDLE * 5; i++) {
    now += 100; // always past the cache window
    await gate.run("h", read);
  }
  assert.equal(reads, POLL_MAX_STORE_READS_PER_HANDLE);
});

test("concurrent polls on one handle share a single store read", async () => {
  let reads = 0;
  const gate = createPollGate<string>();
  const read = async () => {
    reads += 1;
    await new Promise((r) => setTimeout(r, 5));
    return "pending";
  };

  await Promise.all(Array.from({ length: 20 }, () => gate.run("h", read)));
  assert.equal(reads, 1);
});

test("a flood of distinct handles cannot grow the process heap", async () => {
  const gate = createPollGate<string>({ maxEntries: 10, cacheTtlMs: 0 });
  for (let i = 0; i < 500; i++) await gate.run(`handle-${i}`, async () => "pending");
  assert.ok(gate.size <= 10, `gate held ${gate.size} entries`);
});

test("the poll service routes its store read through the gate", async () => {
  const res = await requestVerificationService(submit(), deps());
  const gate = createPollGate<PollResponse>();

  const before = store.rows.size;
  for (let i = 0; i < 25; i++) await pollVerificationService(res.handle, deps({ pollGate: gate }));
  assert.equal(store.rows.size, before);

  const polled = await pollVerificationService(res.handle, deps({ pollGate: gate }));
  assert.equal(polled.status, "pending");
});

test("a junk handle is rejected before it can occupy a gate entry", async () => {
  const gate = createPollGate<PollResponse>();
  const res = await pollVerificationService("not-a-handle", deps({ pollGate: gate }));

  assert.deepEqual(res, { ok: true, status: "expired" });
  assert.equal(gate.size, 0);
});

test("the shipped server dependencies install one process-wide gate", () => {
  const deps = read("src/lib/verification/deps.server.ts");
  assert.ok(deps.includes("const pollGate = createPollGate<PollResponse>();"));
  assert.ok(deps.includes("pollGate,"));
});

// ---------------------------------------------------------------------------
// P0-2 — build-time environment preflight
// ---------------------------------------------------------------------------

const COMPLETE_ENV = {
  NOTION_API_KEY: "secret_notion",
  NOTION_WAITLIST_DB_ID: "db-1",
  RESEND_API_KEY: "re_key",
  WATCHDIVE_EMAIL_FROM: "Watch Dive <hello@watchdive.example>",
  WATCHDIVE_PUBLIC_ORIGIN: TEST_ORIGIN,
  WATCHDIVE_VERIFICATION_SECRET: "a-verification-secret-of-32-bytes!!",
};

test("a complete environment passes", () => {
  assert.deepEqual(checkVerificationEnv(COMPLETE_ENV), []);
});

test("every required value is checked, and all gaps are reported at once", () => {
  const problems = checkVerificationEnv({});
  const named = problems.map((p) => p.name);

  for (const required of [
    "NOTION_API_KEY",
    "NOTION_WAITLIST_DB_ID",
    "RESEND_API_KEY",
    "WATCHDIVE_EMAIL_FROM",
    "WATCHDIVE_PUBLIC_ORIGIN",
    "WATCHDIVE_VERIFICATION_SECRET",
  ]) {
    assert.ok(named.includes(required), `${required} is not validated`);
  }
});

test("the origin rules match the ones the request path enforces", () => {
  for (const bad of [
    "http://watchdive.diveroid.com",
    "https://user:pw@watchdive.diveroid.com",
    "https://watchdive.diveroid.com/path",
    "https://watchdive.diveroid.com/?a=1",
    "watchdive.diveroid.com",
  ]) {
    const problems = checkVerificationEnv({ ...COMPLETE_ENV, WATCHDIVE_PUBLIC_ORIGIN: bad });
    assert.equal(problems.length, 1, `accepted origin: ${bad}`);
    assert.equal(problems[0].name, "WATCHDIVE_PUBLIC_ORIGIN");
  }
});

test("a too-short signing secret is caught before deployment", () => {
  const problems = checkVerificationEnv({
    ...COMPLETE_ENV,
    WATCHDIVE_VERIFICATION_SECRET: "short",
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /at least 32 bytes/);
});

test("a malformed sender is caught before deployment", () => {
  for (const bad of ["not-an-email", "Watch Dive <not-an-email>", "a@b"]) {
    const problems = checkVerificationEnv({ ...COMPLETE_ENV, WATCHDIVE_EMAIL_FROM: bad });
    assert.equal(problems.length, 1, `accepted sender: ${bad}`);
  }
  // Both accepted forms.
  assert.deepEqual(checkVerificationEnv({ ...COMPLETE_ENV, WATCHDIVE_EMAIL_FROM: "a@b.co" }), []);
});

test("a Vercel build with a gap fails, and names every gap", () => {
  assert.throws(
    () => assertVerificationEnv({ VERCEL: "1" }),
    (error: unknown) => {
      const text = String(error);
      return text.includes("RESEND_API_KEY") && text.includes("WATCHDIVE_PUBLIC_ORIGIN");
    },
  );
});

test("a local build still works, with a warning", () => {
  const warnings: string[] = [];
  assertVerificationEnv({}, (message) => warnings.push(message));

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /verification-env/);
});

test("a complete Vercel environment builds without complaint", () => {
  const warnings: string[] = [];
  assertVerificationEnv({ ...COMPLETE_ENV, VERCEL: "1" }, (m) => warnings.push(m));
  assert.deepEqual(warnings, []);
});

test("the report tells an operator what to do", () => {
  const text = formatEnvProblems(checkVerificationEnv({}));
  assert.match(text, /would fail on the first signup/);
  assert.match(text, /Vercel project settings/);
});

test("the build wires the preflight in", () => {
  const config = read("vite.config.ts");
  assert.ok(config.includes("assertVerificationEnv(process.env)"));
  assert.ok(config.includes('apply: "build" as const'));
  assert.ok(config.includes("verificationEnvPreflight()"));
});

// ---------------------------------------------------------------------------
// Suppressed submits must not touch a live attempt
// ---------------------------------------------------------------------------

test("a suppressed submit never invalidates somebody's live link", async () => {
  // A genuine pending attempt exists.
  const first = await requestVerificationService(submit(), deps());
  const live = await store.findByEmail(CANONICAL, EMAIL);
  const liveLeadId = live!.leadId;
  const liveExpires = live!.expiresAt;
  const liveSentAt = live!.sentAt;
  assert.equal(mailer.sent.length, 1);

  clock = new Date(clock.getTime() + 61_000);
  const startAttemptsBefore = store.startAttemptCalls;

  // Somebody replays that address through the honeypot. Were this to arm a new
  // attempt, it would replace `Lead ID` and kill the real person's link.
  for (const flags of [["honeypot"], ["disposable"], ["headless"]]) {
    await requestVerificationService(submit({ flags, suspect: true }), deps());
  }
  await requestVerificationService(submit({ networkSendBlocked: true }), deps());

  const after = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(after!.leadId, liveLeadId, "a suppressed submit replaced the live attempt id");
  assert.equal(after!.expiresAt, liveExpires);
  assert.equal(after!.sentAt, liveSentAt);
  assert.equal(after!.sends, live!.sends, "a suppressed submit consumed a send");
  assert.equal(store.startAttemptCalls, startAttemptsBefore);
  assert.equal(mailer.sent.length, 1);
  assert.ok(first.handle);
});

test("a suppressed submit for a new address still leaves a reviewable row", async () => {
  await requestVerificationService(submit({ flags: ["honeypot"], suspect: true }), deps());

  const row = await store.findByEmail(CANONICAL, EMAIL);
  assert.equal(row?.status, "pending");
  assert.equal(row?.suspect, true);
  assert.deepEqual(row?.flags, ["honeypot"]);
  assert.equal(mailer.sent.length, 0);
});

// ---------------------------------------------------------------------------
// Remaining exact fixes
// ---------------------------------------------------------------------------

test("the pending message claims neither a delivery nor a spot", () => {
  const text = GENERIC_PENDING_MESSAGE.toLowerCase();
  for (const claim of ["spot", "held", "reserved", "we sent", "we've sent", "we have sent"]) {
    assert.ok(!text.includes(claim), `pending message claims: ${claim}`);
  }
  assert.match(GENERIC_PENDING_MESSAGE, /^If this address can receive email/);
});

test("a new attempt clears the previous attempt's send time", () => {
  const store = read("src/lib/verification/notionLead.ts");
  assert.ok(store.includes("[FIELD_VERIFICATION_SENT]: { date: null }"));
});

test("a Notion failure names the status and code but never echoes the body", () => {
  const body = JSON.stringify({
    object: "error",
    status: 400,
    code: "validation_error",
    message: "Canonical email is expected to be email. Got diver@example.com",
  });
  const described = describeNotionFailure(400, body);

  assert.ok(!described.includes("diver@example.com"), "the failure echoed an address");
  assert.ok(!described.includes("Got "), "the failure echoed the body");
  assert.match(described, /\(400\)/);
  assert.match(described, /validation_error/);
});

test("the dual-shape hotfix can still recognise its own error", () => {
  // withCanonicalEmailShape matches on "(400)", "validation_error" and the
  // column name. Sanitising the message must not take that signal away.
  const described = describeNotionFailure(
    400,
    JSON.stringify({
      code: "validation_error",
      message: "Canonical email is expected to be email.",
    }),
  );
  assert.ok(described.includes("(400)"));
  assert.ok(described.includes("validation_error"));
  assert.ok(described.includes("Canonical email"));
});

test("an unparseable Notion body contributes nothing", () => {
  assert.equal(describeNotionFailure(502, "<html>gateway</html>"), "Notion request failed (502)");
  assert.equal(describeNotionFailure(500, ""), "Notion request failed (500)");
});

test("Notion requests are bounded by a timeout", () => {
  const store = read("src/lib/verification/notionLead.ts");
  assert.ok(store.includes("signal: AbortSignal.timeout(NOTION_TIMEOUT_MS)"));
});

test("the browser lead shape is defined once", () => {
  const contracts = read("src/lib/verification/contracts.ts");
  assert.equal(contracts.split("eventId: string; source: string; hasPhone: boolean").length - 1, 1);
  for (const path of ["src/lib/verification/service.ts", "src/lib/verification/contracts.ts"]) {
    const source = read(path);
    const inlineCopies =
      source.split("{ eventId: string; source: string; hasPhone: boolean }").length - 1;
    assert.ok(inlineCopies <= 1, `${path} still inlines the shape ${inlineCopies} times`);
  }
});

// ---------------------------------------------------------------------------
// Mail-bomb protection now lives in memory only
// ---------------------------------------------------------------------------

test("repeat submits from one network are flagged, then stop producing mail", () => {
  let now = 0;
  const gate = createNetworkGate({ now: () => now });
  const verdicts = Array.from({ length: 10 }, () => {
    now += 1000;
    return gate.record("network-digest-a");
  });

  assert.equal(verdicts[0].repeat, false);
  assert.equal(verdicts[0].blocked, false);
  // Fourth submit is worth review, eighth stops the mail.
  assert.equal(verdicts[3].repeat, true);
  assert.equal(verdicts[3].blocked, false);
  assert.equal(verdicts[7].blocked, true);
});

test("a network's history ages out of the window", () => {
  let now = 0;
  const gate = createNetworkGate({ windowMs: 60_000, now: () => now });
  for (let i = 0; i < 9; i++) {
    now += 1000;
    gate.record("k");
  }
  assert.equal(gate.record("k").blocked, true);

  now += 61_000;
  const afterWindow = gate.record("k");
  assert.equal(afterWindow.blocked, false);
  assert.equal(afterWindow.repeat, false);
});

test("an attacker rotating networks still hits a global ceiling", () => {
  let now = 0;
  const gate = createNetworkGate({ globalThreshold: 20, now: () => now });
  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    now += 10;
    if (gate.record(`network-${i}`).blocked) blocked += 1;
  }
  assert.ok(blocked > 0, "rotating networks bypassed every ceiling");
});

test("the global ceiling is a circuit breaker, not a rate limit", () => {
  assert.equal(GLOBAL_WINDOW_MS, 60 * 60 * 1000);
  assert.equal(GLOBAL_SEND_BLOCK_THRESHOLD, 500);

  // A paid burst of a few hundred genuine signups in an hour, each from its own
  // network, must not lose its verification mail.
  let now = 0;
  const gate = createNetworkGate({ now: () => now });
  for (let i = 0; i < 400; i++) {
    now += 9000; // 400 signups spread across an hour
    assert.equal(gate.record(`network-${i}`).blocked, false, `blocked a real signup at ${i}`);
  }
});

test("per-network stays at eight an hour", () => {
  let now = 0;
  const gate = createNetworkGate({ now: () => now });
  for (let i = 0; i < 7; i++) {
    now += 60_000;
    assert.equal(gate.record("k").blocked, false, `blocked early at ${i}`);
  }
  now += 60_000;
  assert.equal(gate.record("k").blocked, true);
});

test("a request with no usable address still counts globally", () => {
  let now = 0;
  const gate = createNetworkGate({ globalThreshold: 5, now: () => now });
  for (let i = 0; i < 6; i++) {
    now += 10;
    gate.record(undefined);
  }
  assert.equal(gate.record(undefined).blocked, true);
});

test("a rotating attacker cannot grow the process heap", () => {
  const gate = createNetworkGate({ maxEntries: 50 });
  for (let i = 0; i < 5000; i++) gate.record(`network-${i}`);
  assert.ok(gate.size <= 50, `gate held ${gate.size} networks`);
});

test("the counter key is a keyed digest, never the address", () => {
  const gate = read("src/lib/verification/networkGate.ts");
  // The gate is given a key; it never derives one, so it cannot see an address.
  assert.ok(!gate.includes("x-forwarded-for"));
  assert.ok(!gate.includes("createHmac"));
  assert.ok(gate.includes("record(key: string | undefined)"));

  const fns = read("src/lib/api/waitlist.functions.ts");
  assert.ok(fns.includes("networkKey(ip, requireSecret(process.env))"));
});

test("the digest never reaches a lead record or the store", () => {
  const contracts = read("src/lib/verification/contracts.ts");
  assert.ok(!contracts.includes("networkKey"));
  const store = read("src/lib/verification/notionLead.ts");
  assert.ok(!store.includes("networkKey"));
});

// ---------------------------------------------------------------------------
// Remaining ship-readiness fixes
// ---------------------------------------------------------------------------

test("the submit source is constrained to the placements that exist", () => {
  const fns = read("src/lib/api/waitlist.functions.ts");
  assert.ok(fns.includes('source: z.enum(["hero", "offer"])'));

  const form = read("src/routes/index.tsx");
  assert.ok(form.includes('type FormPlacement = "hero" | "offer"'));
  assert.ok(form.includes("id: FormPlacement"));
});

test("a mail that went out is never reported as a failure", async () => {
  store.markSent = async () => {
    throw new Error("Notion request failed (502)");
  };

  const res = await requestVerificationService(submit(), deps());

  // The message is already in someone's inbox; telling them it broke would only
  // invite a resend of a link they already hold.
  assert.equal(res.status, "pending");
  assert.equal(res.message, GENERIC_PENDING_MESSAGE);
  assert.equal(mailer.sent.length, 1);
});

test("a lost markSent still leaves the cooldown in force", async () => {
  store.markSent = async () => {
    throw new Error("Notion request failed (502)");
  };
  await requestVerificationService(submit(), deps());
  assert.equal(mailer.sent.length, 1);

  // The row has no send time, but the attempt's start is recoverable from
  // expiresAt, so a resend inside the window is still refused.
  clock = new Date(clock.getTime() + 30_000);
  await requestVerificationService(submit(), deps());
  assert.equal(mailer.sent.length, 1, "a second message went out for one attempt");
});

test("the confirmation page does not auto-confirm for a prerender or a hidden tab", () => {
  const route = read("src/routes/verify.tsx");

  assert.ok(route.includes("doc.prerendering"));
  assert.ok(route.includes('document.visibilityState === "visible"'));
  // The auto path is gated on presence, and there is a manual path when it
  // never arrives.
  assert.ok(route.includes("if (isUserPresent()) {"));
  assert.ok(route.includes('document.addEventListener("visibilitychange", confirmWhenPresent)'));
  assert.ok(route.includes('document.addEventListener("prerenderingchange", confirmWhenPresent)'));
  assert.ok(route.includes('setState("waiting")'));
  // A manual button, so a tab that is never brought to the front is not a
  // dead end.
  const waitingCard = route.slice(route.indexOf('state === "waiting"'));
  assert.match(
    waitingCard.slice(0, 1_000),
    /onClick=\{confirm\}[\s\S]*(?:\{(?:copy|m\.verify)\.confirmButton\}|Confirm my email)/,
  );
  // And it still strips the fragment first, regardless of presence — the
  // presence check happens after, at the call site inside the effect.
  const strip = route.indexOf("window.history.replaceState");
  const presenceCheck = route.indexOf("if (isUserPresent()) {");
  assert.ok(strip > 0, "the fragment is never stripped");
  assert.ok(strip < presenceCheck, "presence is checked before the fragment is stripped");
});
