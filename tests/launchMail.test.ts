// Launch-day mail: audience, idempotency, unsubscribe, locale, refusal paths
// and the dry run. Every dependency is a fake; nothing touches a network.
import assert from "node:assert/strict";
import { test } from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  launchLocale,
  launchSkipReason,
  parseLaunchMarker,
  selectAudience,
  type LaunchRow,
} from "../src/lib/launchMail/audience.ts";
import { main, parseCli } from "../src/lib/launchMail/cli.ts";
import { LAUNCH_COPY } from "../src/lib/launchMail/copy.ts";
import {
  createNotionLaunchStore,
  type LaunchSchema,
  type LaunchStore,
} from "../src/lib/launchMail/notionLaunchStore.ts";
import { renderLaunchMail } from "../src/lib/launchMail/render.ts";
import {
  formatLaunchSummary,
  launchIdempotencyKey,
  runLaunchMail,
  validateKickstarterUrl,
  waveTimingProblem,
  type LaunchMessage,
  type LaunchRunOptions,
} from "../src/lib/launchMail/run.ts";
import { handleUnsubscribe } from "../src/lib/launchMail/unsubscribe.ts";
import {
  createUnsubscribeToken,
  parseUnsubscribeToken,
  unsubscribeUrl,
} from "../src/lib/launchMail/unsubscribeToken.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import { TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const LAUNCH_AT = "2026-12-01T14:00:00Z";
const KS = "https://www.kickstarter.com/projects/diveroid/watch-dive";
const MISSING_PROPERTY = "Notion request failed (400): validation_error";
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => () => new Date(Date.parse(LAUNCH_AT) + offsetMs);

let leadCounter = 0;
function lead(): string {
  leadCounter += 1;
  return `aaaaaaaa-bbbb-4ccc-8ddd-${leadCounter.toString(16).padStart(12, "0")}`;
}

function row(overrides: Partial<LaunchRow> = {}): LaunchRow {
  const leadId = overrides.leadId ?? lead();
  return {
    pageId: `page-${leadId.slice(-4)}`,
    email: `diver-${leadId.slice(-4)}@example.com`,
    leadId,
    status: "verified",
    emailVerified: true,
    suspect: false,
    duplicate: false,
    landingPath: "/",
    ...overrides,
  };
}

const OK_SCHEMA: LaunchSchema = {
  launchMail: "ok",
  missingRequired: [],
  duplicateType: "checkbox",
  hasBrowserLanguage: false,
};

/** Rows plus Notion's filter, and a log of every call. */
class FakeLaunchStore implements LaunchStore {
  rows: LaunchRow[];
  schema: LaunchSchema = { ...OK_SCHEMA };
  writes: { pageId: string; value: string }[] = [];
  listCalls = 0;
  failWrites = 0;
  rejectWrites = false;

  constructor(rows: LaunchRow[]) {
    this.rows = rows;
  }

  async readSchema() {
    return { ...this.schema };
  }

  async listAudienceRows() {
    this.listCalls += 1;
    return this.rows
      .filter((r) => r.status === "verified" && r.emailVerified && !r.suspect && !r.duplicate)
      .map((r) => ({ ...r }));
  }

  async recordLaunchMail(pageId: string, value: string) {
    if (this.rejectWrites) throw new Error(MISSING_PROPERTY);
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error("Notion request failed (503)");
    }
    this.writes.push({ pageId, value });
    const target = this.rows.find((r) => r.pageId === pageId);
    if (target) target.launchMail = value;
  }

  async reread(pageId: string) {
    return this.rows.find((r) => r.pageId === pageId);
  }

  async findByLeadId(leadId: string) {
    return this.rows.find((r) => r.leadId === leadId);
  }
}

/** Resend, as far as idempotency goes: one message per key, ever. */
class FakeResend {
  calls: LaunchMessage[] = [];
  delivered = new Map<string, LaunchMessage>();
  fail = false;

  send = async (message: LaunchMessage) => {
    this.calls.push(message);
    if (this.fail) {
      const { ResendDeliveryError } = await import("../src/lib/verification/resend.ts");
      throw new ResendDeliveryError("Resend delivery failed (422)", 422);
    }
    const previous = this.delivered.get(message.idempotencyKey);
    if (previous && previous.html !== message.html) {
      const { ResendDeliveryError } = await import("../src/lib/verification/resend.ts");
      throw new ResendDeliveryError("Resend delivery failed (409)", 409);
    }
    this.delivered.set(message.idempotencyKey, message);
  };
}

function options(overrides: Partial<LaunchRunOptions> = {}): LaunchRunOptions {
  return {
    wave: "t-1d",
    kickstarterUrl: KS,
    launchAt: LAUNCH_AT,
    mode: "send",
    postalAddress: "DIVEROID LTD, Test Street 1, Test City",
    ratePerSecond: 50,
    ...overrides,
  };
}

const noSleep = async () => {};

// --- audience -------------------------------------------------------------

test("only verified, email-verified, non-suspect, non-duplicate rows are mailed", () => {
  const good = row();
  const rows = [
    good,
    row({ status: "pending", emailVerified: false }),
    row({ status: "verified", emailVerified: false }),
    row({ status: "", emailVerified: true }), // legacy single opt-in
    row({ status: "unsubscribed" }),
    row({ suspect: true }),
    row({ duplicate: true }),
    row({ launchMail: "unsubscribed 2026-11-30T00:00:00.000Z" }),
    row({ launchMail: "Unsubscribe (asked by email)" }),
    row({ email: "not-an-address" }),
    row({ leadId: "not-a-uuid" }),
  ];
  const { recipients, skipped } = selectAudience(rows, "t-1d");
  assert.deepEqual(
    recipients.map((r) => r.row.pageId),
    [good.pageId],
  );
  assert.deepEqual(skipped, {
    not_verified: 4,
    suspect: 1,
    duplicate: 1,
    unsubscribed: 2,
    no_address: 1,
    no_lead_id: 1,
  });
});

test("wave markers: never the same wave twice, never an earlier wave after a later one", () => {
  assert.equal(
    launchSkipReason(row({ launchMail: "t-1d sent 2026-11-30T14:00:00.000Z" }), "t-1d"),
    "already_sent",
  );
  assert.equal(
    launchSkipReason(row({ launchMail: "t-1d sent 2026-11-30T14:00:00.000Z" }), "t-1h"),
    undefined,
  );
  assert.equal(
    launchSkipReason(row({ launchMail: "t-1h sent 2026-12-01T13:00:00.000Z" }), "t-1d"),
    "later_wave_recorded",
  );
  assert.equal(
    launchSkipReason(
      row({ launchMail: "t-0 failed provider_rejected 2026-12-01T14:00:00.000Z" }),
      "t-1h",
    ),
    "later_wave_recorded",
  );
  // A failure of the same wave may be retried; the idempotency key keeps it single.
  assert.equal(
    launchSkipReason(
      row({ launchMail: "t-1h failed transport_error 2026-12-01T13:00:00.000Z" }),
      "t-1h",
    ),
    undefined,
  );
  // Anything a human typed that we do not understand holds the row back.
  assert.equal(
    launchSkipReason(row({ launchMail: "call me instead" }), "t-0"),
    "unrecognised_marker",
  );
  assert.deepEqual(parseLaunchMarker(""), { kind: "none" });
});

test("one address on two rows gets one mail, and an unsubscribe on either row holds both", () => {
  const first = row({ email: "Same@Example.com" });
  const second = row({ email: "same@example.com" });
  assert.equal(selectAudience([first, second], "t-0").recipients.length, 1);

  const unsubscribed = row({
    email: "x@example.com",
    launchMail: "unsubscribed 2026-11-30T00:00:00.000Z",
  });
  const twin = row({ email: "X@example.com" });
  const result = selectAudience([twin, unsubscribed], "t-0");
  assert.equal(result.recipients.length, 0);

  const sent = row({ email: "y@example.com", launchMail: "t-0 sent 2026-12-01T14:00:00.000Z" });
  const sentTwin = row({ email: "y@example.com" });
  assert.equal(selectAudience([sentTwin, sent], "t-0").recipients.length, 0);
});

// --- locale ---------------------------------------------------------------

test("language comes from the landing path prefix, then browser language, then English", () => {
  assert.equal(launchLocale({ landingPath: "/ko" }), "ko");
  assert.equal(launchLocale({ landingPath: "/zh-tw/r/abc12345?utm_source=x" }), "zh-TW");
  assert.equal(launchLocale({ landingPath: "/pt-br/", browserLanguage: "de-DE" }), "pt-BR");
  assert.equal(launchLocale({ landingPath: "/", browserLanguage: "ja-JP" }), "ja");
  assert.equal(launchLocale({ browserLanguage: "zh-Hant-HK" }), "zh-TW");
  assert.equal(launchLocale({ landingPath: "/", browserLanguage: "nl-NL" }), "en");
  assert.equal(launchLocale({ landingPath: "https://evil.example/ko" }), "en");
  assert.equal(launchLocale({}), "en");
});

// --- unsubscribe token ------------------------------------------------------

test("unsubscribe tokens round-trip and reject any tampering", () => {
  const leadId = lead();
  const token = createUnsubscribeToken(leadId, "zh-CN", TEST_SECRET);
  assert.deepEqual(parseUnsubscribeToken(token, TEST_SECRET), { leadId, locale: "zh-CN" });
  assert.equal(parseUnsubscribeToken(token, `${TEST_SECRET}-other`), undefined);
  assert.equal(parseUnsubscribeToken(token.replace(".zh-cn.", ".ko."), TEST_SECRET), undefined);
  const other = lead();
  assert.equal(parseUnsubscribeToken(token.replace(leadId, other), TEST_SECRET), undefined);
  assert.equal(parseUnsubscribeToken(`${token.slice(0, -1)}A`, TEST_SECRET), undefined);
  assert.equal(parseUnsubscribeToken("u1.garbage", TEST_SECRET), undefined);
  assert.equal(parseUnsubscribeToken(undefined, TEST_SECRET), undefined);

  const url = unsubscribeUrl(TEST_ORIGIN, token);
  assert.ok(url.startsWith(`${TEST_ORIGIN}/unsubscribe/u1.`));
  // No `=` for quoted-printable to eat, no address in the link.
  assert.ok(!url.includes("="));
  assert.ok(!url.includes("@"));
});

test("GET only asks; POST records the opt-out once; bad tokens and a missing property fail safe", async () => {
  const target = row();
  const store = new FakeLaunchStore([target]);
  const token = createUnsubscribeToken(target.leadId, "de", TEST_SECRET);
  const deps = { store, env: TEST_ENV, now: () => new Date("2026-11-30T12:00:00.000Z") };

  const get = await handleUnsubscribe("GET", token, deps);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /<form method="post">/);
  assert.equal(store.writes.length, 0, "a link scanner's GET must not unsubscribe anybody");

  const post = await handleUnsubscribe("POST", token, deps);
  assert.equal(post.status, 200);
  assert.match(await post.text(), /abgemeldet/);
  assert.deepEqual(store.writes, [
    { pageId: target.pageId, value: "unsubscribed 2026-11-30T12:00:00.000Z" },
  ]);
  await handleUnsubscribe("POST", token, deps);
  assert.equal(store.writes.length, 1, "a second click writes nothing");
  assert.equal(selectAudience(store.rows, "t-0").recipients.length, 0);

  assert.equal((await handleUnsubscribe("POST", `${token.slice(0, -1)}A`, deps)).status, 400);
  const stranger = createUnsubscribeToken(lead(), "en", TEST_SECRET);
  assert.equal((await handleUnsubscribe("POST", stranger, deps)).status, 404);

  const broken = new FakeLaunchStore([row({ leadId: target.leadId })]);
  broken.rejectWrites = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handleUnsubscribe("POST", token, { ...deps, store: broken });
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
});

// --- refusal --------------------------------------------------------------

test("a send run refuses before reading the audience when `Launch mail` is missing", async () => {
  const store = new FakeLaunchStore([row(), row()]);
  store.schema = { ...OK_SCHEMA, launchMail: "missing" };
  const resend = new FakeResend();
  const result = await runLaunchMail(options(), {
    store,
    send: resend.send,
    env: TEST_ENV,
    now: at(-24 * HOUR),
    sleep: noSleep,
  });
  assert.equal(result.aborted, "launch_mail_property_missing");
  assert.match(result.detail ?? "", /no `Launch mail` property/);
  assert.equal(store.listCalls, 0);
  assert.equal(resend.calls.length, 0);
  assert.match(formatLaunchSummary(result), /REFUSED: launch_mail_property_missing/);

  store.schema = { ...OK_SCHEMA, launchMail: "wrong_type" };
  const wrong = await runLaunchMail(options(), {
    store,
    send: resend.send,
    env: TEST_ENV,
    now: at(-24 * HOUR),
  });
  assert.equal(wrong.aborted, "launch_mail_property_missing");
  assert.equal(resend.calls.length, 0);
});

test("a dry run without the property still previews, and says a send would refuse", async () => {
  const store = new FakeLaunchStore([row()]);
  store.schema = { ...OK_SCHEMA, launchMail: "missing" };
  const result = await runLaunchMail(options({ mode: "dry-run" }), {
    store,
    send: async () => assert.fail("dry run must not send"),
    env: TEST_ENV,
    now: at(-24 * HOUR),
  });
  assert.equal(result.aborted, undefined);
  assert.equal(result.eligible, 1);
  assert.ok(result.sendBlockers.some((b) => b.includes("Launch mail")));
});

test("each wave refuses to send outside the window where its words are true", async () => {
  const launch = new Date(LAUNCH_AT);
  assert.equal(waveTimingProblem("t-1d", launch, at(-24 * HOUR)()), undefined);
  assert.match(waveTimingProblem("t-1d", launch, at(-3 * HOUR)()) ?? "", /too late/);
  assert.equal(waveTimingProblem("t-1h", launch, at(-HOUR)()), undefined);
  assert.match(waveTimingProblem("t-1h", launch, at(-5 * HOUR)()) ?? "", /too early/);
  assert.match(waveTimingProblem("t-0", launch, at(-60_000)()) ?? "", /too early/);
  assert.equal(waveTimingProblem("t-0", launch, at(60_000)()), undefined);

  const store = new FakeLaunchStore([row()]);
  const resend = new FakeResend();
  const result = await runLaunchMail(options({ wave: "t-0" }), {
    store,
    send: resend.send,
    env: TEST_ENV,
    now: at(-10 * 60_000),
  });
  assert.equal(result.aborted, "off_schedule");
  assert.equal(resend.calls.length, 0);
});

test("bad inputs refuse: non-Kickstarter URL, zone-less time, no postal address", async () => {
  assert.throws(() => validateKickstarterUrl("https://kickstarter.evil.example/projects/a/b"));
  assert.throws(() => validateKickstarterUrl("http://www.kickstarter.com/projects/a/b"));
  assert.throws(() => validateKickstarterUrl("https://www.kickstarter.com/discover"));
  assert.throws(() => validateKickstarterUrl(`${KS}?ref=ab12`), /hex/);
  assert.equal(validateKickstarterUrl(`${KS}?ref=launchmail`), `${KS}?ref=launchmail`);

  const store = new FakeLaunchStore([row()]);
  const send = async () => assert.fail("must not send");
  const deps = { store, send, env: TEST_ENV, now: at(-24 * HOUR) };
  assert.equal(
    (await runLaunchMail(options({ launchAt: "2026-12-01T14:00" }), deps)).aborted,
    "invalid_input",
  );
  assert.equal(
    (await runLaunchMail(options({ kickstarterUrl: "https://example.com" }), deps)).aborted,
    "invalid_input",
  );
  assert.equal(
    (await runLaunchMail(options({ postalAddress: " " }), deps)).aborted,
    "postal_address_missing",
  );
  assert.equal((await runLaunchMail(options(), { ...deps, env: {} })).aborted, "not_configured");
});

// --- dry run ----------------------------------------------------------------

test("a dry run sends nothing, writes nothing, renders every language and prints no address", async () => {
  const rows = [
    row({ landingPath: "/ko" }),
    row({ landingPath: "/ko" }),
    row({ landingPath: "/ja" }),
    row({ landingPath: "/", browserLanguage: "fr-FR" }),
    row({ suspect: true }),
  ];
  const store = new FakeLaunchStore(rows);
  const samples: string[] = [];
  const result = await runLaunchMail(options({ mode: "dry-run" }), {
    store,
    send: async () => assert.fail("dry run must not send"),
    env: TEST_ENV,
    now: at(-24 * HOUR),
    writeSample: async (locale, mail) => {
      samples.push(locale);
      assert.ok(!mail.html.includes("@example.com"), "samples carry no recipient");
    },
  });
  assert.equal(store.writes.length, 0);
  assert.deepEqual(samples, [...SUPPORTED_LOCALES]);
  assert.deepEqual(result.byLocale, { ko: 2, ja: 1, fr: 1 });
  assert.equal(result.eligible, 4);
  const summary = formatLaunchSummary(result);
  assert.match(summary, /DRY RUN/);
  assert.ok(!summary.includes("@"), "summary prints no address");
  assert.ok(!summary.includes("page-"), "summary prints no page id");
  assert.ok(!rows.some((r) => summary.includes(r.leadId)), "summary prints no lead id");
});

test("the CLI defaults to a dry run and needs --confirm-wave to send", () => {
  const base = ["--wave", "t-1h", "--kickstarter-url", KS, "--launch-at", LAUNCH_AT];
  const dry = parseCli(base, {});
  assert.ok(dry.ok && dry.options.mode === "dry-run");
  const unconfirmed = parseCli([...base, "--send"], {});
  assert.ok(!unconfirmed.ok && /--confirm-wave t-1h/.test(unconfirmed.error));
  const mismatched = parseCli([...base, "--send", "--confirm-wave", "t-0"], {});
  assert.ok(!mismatched.ok);
  const confirmed = parseCli([...base, "--send", "--confirm-wave", "t-1h"], {
    WATCHDIVE_POSTAL_ADDRESS: "Somewhere",
  });
  assert.ok(
    confirmed.ok &&
      confirmed.options.mode === "send" &&
      confirmed.options.postalAddress === "Somewhere",
  );
  assert.ok(!parseCli([...base, "--send", "--dry-run", "--confirm-wave", "t-1h"], {}).ok);
  assert.ok(
    !parseCli(["--wave", "t-2d", "--kickstarter-url", KS, "--launch-at", LAUNCH_AT], {}).ok,
  );
});

test("the CLI refuses without Notion configuration and never reaches the network", async () => {
  const lines: string[] = [];
  const code = await main(
    ["--wave", "t-0", "--kickstarter-url", KS, "--launch-at", LAUNCH_AT],
    {},
    (line) => lines.push(line),
  );
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /NOTION_API_KEY and NOTION_WAITLIST_DB_ID must be set/);
});

// --- send and idempotency --------------------------------------------------

test("a send mails each recipient once with a per-recipient, per-wave key and records it", async () => {
  const rows = [row({ landingPath: "/es" }), row(), row({ suspect: true })];
  const store = new FakeLaunchStore(rows);
  const resend = new FakeResend();
  const deps = { store, send: resend.send, env: TEST_ENV, now: at(-24 * HOUR), sleep: noSleep };

  const first = await runLaunchMail(options(), deps);
  assert.equal(first.sent, 2);
  assert.equal(resend.calls.length, 2);
  const keys = resend.calls.map((m) => m.idempotencyKey).sort();
  assert.deepEqual(
    keys,
    [rows[0], rows[1]].map((r) => launchIdempotencyKey("t-1d", r.leadId)).sort(),
  );
  assert.deepEqual(
    store.writes.map((w) => w.value),
    ["t-1d sent 2026-11-30T14:00:00.000Z", "t-1d sent 2026-11-30T14:00:00.000Z"],
  );
  const spanish = resend.calls.find((m) => m.to === rows[0].email);
  assert.equal(spanish?.subject, LAUNCH_COPY.es.waves["t-1d"].subject);
  assert.equal(spanish?.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(
    spanish?.headers["List-Unsubscribe"] ?? "",
    /^<https:\/\/watchdive\.diveroid\.com\/unsubscribe\/u1\.[^>]+>, <mailto:help@diveroid\.com\?subject=unsubscribe>$/,
  );
  assert.match(spanish?.html ?? "", /\/unsubscribe\/u1\./);

  // Re-running the same wave sends nothing.
  const again = await runLaunchMail(options(), deps);
  assert.equal(again.sent, 0);
  assert.equal(again.skipped.already_sent, 2);
  assert.equal(resend.calls.length, 2);

  // The next wave goes to the same people under new keys.
  const next = await runLaunchMail(options({ wave: "t-1h" }), { ...deps, now: at(-HOUR) });
  assert.equal(next.sent, 2);
  assert.equal(resend.delivered.size, 4);
});

test("a send whose Notion record failed is re-run safely: same key, same bytes, one message", async () => {
  const rows = [row(), row()];
  const store = new FakeLaunchStore(rows);
  store.failWrites = 6; // both rows exhaust their three attempts
  const resend = new FakeResend();
  const deps = { store, send: resend.send, env: TEST_ENV, now: at(-24 * HOUR), sleep: noSleep };

  const first = await runLaunchMail(options(), deps);
  assert.equal(first.sent, 2);
  assert.equal(first.unrecorded, 2);
  assert.match(formatLaunchSummary(first), /sent but not recorded/);

  const rerun = await runLaunchMail(options(), { ...deps, now: at(-23 * HOUR) });
  assert.equal(rerun.sent, 2, "the provider answers the repeated key as accepted");
  assert.equal(resend.delivered.size, 2, "but only two messages ever exist");
  assert.equal(resend.calls[0].html, resend.calls[2].html, "the re-run payload is byte-identical");
});

test("a provider rejection is recorded as failed and may be retried; a Notion rejection stops the run", async () => {
  const store = new FakeLaunchStore([row()]);
  const resend = new FakeResend();
  resend.fail = true;
  const deps = { store, send: resend.send, env: TEST_ENV, now: at(-24 * HOUR), sleep: noSleep };
  const failed = await runLaunchMail(options(), deps);
  assert.equal(failed.failed, 1);
  assert.deepEqual(failed.failureClasses, { "provider_rejected (HTTP 422)": 1 });
  assert.match(store.writes[0].value, /^t-1d failed provider_rejected /);
  resend.fail = false;
  assert.equal((await runLaunchMail(options(), deps)).sent, 1);

  const rejecting = new FakeLaunchStore([row(), row(), row(), row()]);
  rejecting.rejectWrites = true;
  const stopping = new FakeResend();
  const stopped = await runLaunchMail(options(), {
    ...deps,
    store: rejecting,
    send: stopping.send,
  });
  assert.equal(stopped.aborted, "launch_mail_write_rejected");
  assert.ok(stopping.calls.length <= 2, "no new send starts after the rejection");
});

test("--limit sends a canary and holds the rest back for the next run", async () => {
  const store = new FakeLaunchStore([row(), row(), row()]);
  const resend = new FakeResend();
  const deps = { store, send: resend.send, env: TEST_ENV, now: at(-24 * HOUR), sleep: noSleep };
  const canary = await runLaunchMail(options({ limit: 1 }), deps);
  assert.equal(canary.sent, 1);
  assert.equal(canary.heldBack, 2);
  const rest = await runLaunchMail(options(), deps);
  assert.equal(rest.sent, 2);
  assert.equal(resend.delivered.size, 3);
});

test("sends are paced at the requested rate", async () => {
  const store = new FakeLaunchStore([row(), row(), row(), row()]);
  const resend = new FakeResend();
  let clock = Date.parse(LAUNCH_AT) - 24 * HOUR;
  const waits: number[] = [];
  await runLaunchMail(options({ ratePerSecond: 2 }), {
    store,
    send: resend.send,
    env: TEST_ENV,
    now: () => new Date(clock),
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  assert.equal(resend.calls.length, 4);
  // Four sends at 2/s need 1.5 s of spacing in total.
  assert.equal(
    waits.reduce((a, b) => a + b, 0),
    1500,
  );
});

// --- copy and rendering ---------------------------------------------------

test("every language states both prices and the first-100 condition, and nothing invented", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const wave of ["t-1d", "t-1h", "t-0"] as const) {
      const copy = LAUNCH_COPY[locale].waves[wave];
      assert.match(copy.price, /149/, `${locale} ${wave}`);
      assert.match(copy.price, /299/, `${locale} ${wave}`);
      assert.match(copy.price, /100/, `${locale} ${wave}`);
      const all = Object.values(copy).join(" ");
      assert.ok(
        !/%|December|Dezember|décembre|diciembre|dezembro|12월|12月/.test(all),
        `${locale} ${wave}: no discount % or month`,
      );
      // Only the numbers the page states (plus the "1" of one hour).
      for (const number of all.match(/\d+/g) ?? []) {
        assert.ok(
          ["149", "299", "100", "1"].includes(number),
          `${locale} ${wave}: unexpected number ${number}`,
        );
      }
      if (wave !== "t-0")
        assert.ok(copy.body.includes("{time}"), `${locale} ${wave} names the time`);
    }
  }
});

test("rendering is deterministic and carries the URL, time, unsubscribe link and footer", () => {
  const input = {
    wave: "t-1h" as const,
    locale: "ko" as const,
    kickstarterUrl: KS,
    launchAt: new Date(LAUNCH_AT),
    unsubscribeUrl: `${TEST_ORIGIN}/unsubscribe/u1.test`,
    postalAddress: "Postal <line>",
  };
  const a = renderLaunchMail(input);
  assert.equal(a.html, renderLaunchMail(input).html);
  assert.match(a.html, /lang="ko"/);
  assert.match(a.html, /2026년 12월 1일/);
  assert.match(a.html, /keep-all/);
  assert.ok(a.html.includes(KS));
  assert.ok(a.html.includes("/unsubscribe/u1.test"));
  assert.ok(a.html.includes("Postal &lt;line&gt;"), "footer text is escaped");
  assert.ok(!/<img|<script|https:\/\/fonts\./.test(a.html), "no remote image, script or font");
  assert.match(a.text, /US\$149/);
});

// --- Notion adapter ---------------------------------------------------------

test("the Notion adapter reads the schema, filters the audience and parses rows", async () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const page = {
    id: "page-1",
    properties: {
      Email: { title: [{ plain_text: "a@example.com" }] },
      "Lead ID": { rich_text: [{ plain_text: "aaaaaaaa-bbbb-4ccc-8ddd-000000000999" }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      Suspect: { checkbox: false },
      Duplicate: { checkbox: false },
      "Landing path": { rich_text: [{ plain_text: "/fr" }] },
      "Launch mail": { rich_text: [] },
    },
  };
  let databaseProperties: Record<string, { type: string }> = {
    Email: { type: "title" },
    "Verification status": { type: "select" },
    "Email verified": { type: "checkbox" },
    Suspect: { type: "checkbox" },
    "Lead ID": { type: "rich_text" },
    Duplicate: { type: "checkbox" },
  };
  const request: NotionRequest = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") return { properties: databaseProperties };
    if (path.endsWith("/query")) return { results: [page], has_more: false };
    return {};
  };
  const store = createNotionLaunchStore(request, "db");

  const missing = await store.readSchema();
  assert.equal(missing.launchMail, "missing");
  assert.equal(missing.duplicateType, "checkbox");

  databaseProperties = { ...databaseProperties, "Launch mail": { type: "rich_text" } };
  const schema = await store.readSchema();
  assert.equal(schema.launchMail, "ok");

  const rows = await store.listAudienceRows(schema);
  assert.equal(rows.length, 1);
  assert.equal(launchLocale(rows[0]), "fr");
  const filter = JSON.stringify(calls.at(-1)?.body);
  for (const clause of ["Verification status", "Email verified", "Suspect", "Duplicate"]) {
    assert.ok(filter.includes(clause), `query filters on ${clause}`);
  }

  await store.recordLaunchMail("page-1", "t-0 sent 2026-12-01T14:00:00.000Z");
  assert.deepEqual(calls.at(-1), {
    method: "PATCH",
    path: "pages/page-1",
    body: {
      properties: {
        "Launch mail": { rich_text: [{ text: { content: "t-0 sent 2026-12-01T14:00:00.000Z" } }] },
      },
    },
  });
  await assert.rejects(store.recordLaunchMail("page-1", " "));
});
