// Segment routing into the reservation send. Fakes only. No network and no mailbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LOCALE_PATH_SEGMENTS, SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { RESERVATION_CAMPAIGN_ID, reservationIdempotencyKey } from "../src/lib/reservation-mail/campaign.ts";
import {
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
} from "../src/lib/reservation-mail/merchant.ts";
import { receiptPaths } from "../src/lib/reservation-mail/receipts.ts";
import { RESERVATION_COPY } from "../src/lib/reservation-mail/copy.ts";
import { deliverReservationMessage } from "../src/lib/reservation-mail/provider.ts";
import { renderReservationMail, type ReservationMailInput } from "../src/lib/reservation-mail/render.ts";
import {
  runReservationMail,
  type ReservationMessage,
  type ReservationRunOptions,
} from "../src/lib/reservation-mail/run.ts";
import {
  isReservationEmailSegment,
  resolveReservationEmailSegment,
  type ReservationEmailSegment,
} from "../src/lib/reservation-mail/segment.ts";
import type { ReservationRow } from "../src/lib/reservation-mail/audience.ts";
import type { ReservationSchema, ReservationStore } from "../src/lib/reservation-mail/store.ts";
import { DRIP_COPY } from "../src/lib/reservation-drip/copy.ts";
import { PERSONALIZED_COPY } from "../src/lib/reservation-drip/personalized-copy.ts";
import { DRIP_COPY_HASH, renderDripMail } from "../src/lib/reservation-drip/render.ts";
import { DRIP_DELAY, DRIP_FIELD, DRIP_STAGES, DAY } from "../src/lib/reservation-drip/policy.ts";
import { runReservationDrip } from "../src/lib/reservation-drip/run.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import { ResendDeliveryError } from "../src/lib/verification/resend.ts";
import type { StripeApi } from "../src/lib/reservation/stripeApi.ts";
import { TEST_ENV, TEST_ORIGIN } from "./helpers/fakes.ts";
import { FakeResend } from "./helpers/fakeNetwork.ts";

const POSTAL = RESERVATION_REGISTERED_OFFICE;
const LEGAL = RESERVATION_LEGAL_NAME;
const TOKEN = "reservation-token-secret-32bytes-min!!";
const MAIL_ENV = { ...TEST_ENV, WATCHDIVE_RESERVATION_TOKEN_SECRET: TOKEN };
const NOW = new Date("2026-10-18T04:00:00.000Z");
const VERIFIED_AT = "2026-10-18T03:00:00.000Z";
const NOT_BEFORE = "2026-10-18T00:00:00.000Z";

const SCHEMA: ReservationSchema = {
  reservationMail: "ok",
  launchMail: "ok",
  missingRequired: [],
  duplicateType: "checkbox",
  hasBrowserLanguage: true,
  hasCountryProperty: true,
  hasSmsConsentProperty: true,
  hasPhoneProperty: true,
  verifiedAt: "ok",
  reservationPaid: "ok",
  reservationMode: "ok",
};

let leadCounter = 0;
function lead(): string {
  leadCounter += 1;
  return `aaaaaaaa-bbbb-4ccc-8ddd-${leadCounter.toString(16).padStart(12, "0")}`;
}

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  const leadId = overrides.leadId ?? lead();
  return {
    pageId: `page-${leadId.slice(-4)}`,
    email: `segment-${leadId.slice(-4)}@example.com`,
    leadId,
    status: "verified",
    emailVerified: true,
    suspect: false,
    duplicate: false,
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
}

class FakeStore implements ReservationStore {
  rows: ReservationRow[];
  constructor(rows: ReservationRow[]) {
    this.rows = rows;
  }
  async readSchema() {
    return { ...SCHEMA };
  }
  async listRows() {
    return this.rows;
  }
  async readRow(pageId: string) {
    return this.rows.find((item) => item.pageId === pageId);
  }
  async recordReservationMail(pageId: string, value: string) {
    const target = this.rows.find((item) => item.pageId === pageId);
    if (target) target.reservationMail = value;
  }
}

function segmentOf(input: ReservationMailInput): ReservationEmailSegment | "omitted" {
  const value = (input as ReservationMailInput & { segment?: ReservationEmailSegment }).segment;
  return value ?? "omitted";
}

function spyRender(seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[]) {
  return (input: ReservationMailInput) => {
    const segment = segmentOf(input);
    seen.push({ segment, locale: input.locale, inviteUrl: input.inviteUrl });
    const mail = renderReservationMail(input);
    const stamp = `SEGMENT:${segment}`;
    return { subject: mail.subject, html: `${mail.html}<!--${stamp}-->`, text: `${mail.text}\n${stamp}` };
  };
}

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "email-segment-"));
}

function options(receiptDir: string, overrides: Partial<ReservationRunOptions> = {}): ReservationRunOptions {
  return {
    mode: "send",
    postalAddress: POSTAL,
    legalName: LEGAL,
    receiptDir,
    ratePerSecond: 50,
    notBefore: NOT_BEFORE,
    ...overrides,
  };
}

function deps(
  store: ReservationStore,
  messages: ReservationMessage[],
  seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[],
  now = NOW,
) {
  return {
    store,
    send: async (message: ReservationMessage) => {
      messages.push(message);
    },
    signInvite: () => "signed-invite-segment-test",
    env: MAIL_ENV,
    liveGate: async () => ({ ok: true as const }),
    now: () => now,
    sleep: async () => undefined,
    renderMail: spyRender(seen),
  };
}

async function lines(dir: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(receiptPaths(dir).file, "utf8");
  assert.equal(/@|token=|invite=|https?:\/\//i.test(raw), false);
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("supported localized scuba and freediving paths resolve, and lookalikes do not", () => {
  const prefixes = ["", ...SUPPORTED_LOCALES.map((locale) => `/${LOCALE_PATH_SEGMENTS[locale]}`)];
  assert.equal(prefixes.length, 1 + SUPPORTED_LOCALES.length);
  for (const prefix of prefixes) {
    for (const page of ["scuba", "freediving"] as const) {
      assert.equal(resolveReservationEmailSegment(`${prefix}/${page}`), page);
      assert.equal(resolveReservationEmailSegment(`${prefix}/${page}/`), page);
      assert.equal(resolveReservationEmailSegment(`${prefix}/${page}?utm_campaign=freediving#scuba`), page);
      assert.equal(resolveReservationEmailSegment(`${prefix}/${page.toUpperCase()}/?x=1#y`), page);
    }
  }
  assert.equal(resolveReservationEmailSegment("/ko/%73cuba"), "scuba");
  assert.equal(resolveReservationEmailSegment("/%66reediving"), "freediving");
  assert.equal(resolveReservationEmailSegment("/pt-br/%66reediving/?ref=scuba#top"), "freediving");
  assert.equal(resolveReservationEmailSegment("/zh-cn/scuba?next=/freediving"), "scuba");
  assert.equal(resolveReservationEmailSegment("/zh-tw/freediving#section"), "freediving");
  assert.equal(resolveReservationEmailSegment("/KO/Scuba/"), "scuba");
  assert.equal(resolveReservationEmailSegment("/zh-CN/scuba"), "scuba");
  assert.equal(resolveReservationEmailSegment("/en/freediving"), "freediving");

  for (const path of [
    undefined,
    null,
    "",
    "   ",
    "/",
    "/ko",
    "/privacy",
    "/ko/privacy",
    "/buddy",
    "/scuba-diving",
    "/freedivings",
    "/ko/scuba/extra",
    "/ko/scuba/../freediving",
    "/not-a-locale/scuba",
    "/zh-hans/scuba",
    "https://watchdive.diveroid.com/ko/scuba",
    "http://evil.example/scuba",
    "//evil.example/scuba",
    "/?segment=scuba",
    "/ko?interest=freediving",
    "/ko%2Fscuba",
    "/ko/%2Fscuba",
    "/ko/%",
    "/ko/%73cuba%73",
    "/scuba%20",
    "/%2Fscuba",
    "/+821012345678/scuba",
  ]) {
    assert.equal(resolveReservationEmailSegment(path), "general", `expected general for ${String(path)}`);
  }
  assert.equal(isReservationEmailSegment("general"), true);
  assert.equal(isReservationEmailSegment("country"), false);
});

test("first send passes the landing segment and a missing path stays general", async () => {
  const dir = await directory();
  const messages: ReservationMessage[] = [];
  const seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[] = [];
  const scuba = row({ landingPath: "/ko/scuba?utm_content=freediving#top", browserLanguage: "en", signupCountry: "US" });
  const freediving = row({ landingPath: "/freediving/", signupCountry: "KR" });
  const legacy = row({ signupCountry: "KR", browserLanguage: "de-DE" });
  const paid = row({ landingPath: "/ko/scuba", payment: "live" });
  const held = row({ landingPath: "/ko/freediving", status: "unsubscribed" });
  const tooSoon = row({ landingPath: "/ja/scuba", verifiedAt: "2026-10-18T03:59:00.000Z" });
  const store = new FakeStore([scuba, freediving, legacy, paid, held, tooSoon]);
  const result = await runReservationMail(options(dir), deps(store, messages, seen));
  assert.equal(result.aborted, undefined);
  assert.equal(result.sent, 3);
  assert.equal(messages.length, 3);
  assert.deepEqual(seen.map((item) => item.segment), ["scuba", "freediving", "general"]);
  // Unprefixed /freediving does not set a language. Signup country may still
  // choose Korean. It must not choose the segment.
  assert.deepEqual(seen.map((item) => item.locale), ["ko", "ko", "de"]);
  assert.match(seen[0].inviteUrl, /^https:\/\/watchdive\.diveroid\.com\/reservation\?lang=ko#invite=/);
  assert.match(messages[0].html, /<!--SEGMENT:scuba-->/);
  assert.match(messages[0].html, /DIVEROID LTD/);
  assert.match(messages[1].text, /SEGMENT:freediving/);
  assert.match(messages[2].text, /SEGMENT:general/);
  assert.equal(messages[0].idempotencyKey, reservationIdempotencyKey(scuba.leadId));
  const written = await lines(dir);
  assert.deepEqual(
    written.filter((line) => line.leadId === scuba.leadId.toLowerCase()).map((line) => line.segment),
    ["scuba", "scuba", "scuba"],
  );
  assert.ok(written.every((line) => line.leadId !== paid.leadId && line.leadId !== held.leadId));

  await runReservationMail(options(dir), deps(store, messages, seen));
  assert.equal(messages.length, 3);
});

test("an in-window resume keeps the frozen segment when the path changes or disappears", async () => {
  const dir = await directory();
  const person = row({ landingPath: "/ko/freediving" });
  const intentAt = NOW.toISOString();
  await writeFile(
    receiptPaths(dir).file,
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: person.leadId,
      state: "intent",
      at: intentAt,
      firstIntentAt: intentAt,
      notion: "pending",
      segment: "scuba",
    })}\n`,
  );
  const messages: ReservationMessage[] = [];
  const seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[] = [];
  const store = new FakeStore([person]);
  const first = await runReservationMail(options(dir), deps(store, messages, seen));
  assert.equal(first.aborted, undefined);
  assert.equal(first.sent, 1);
  assert.equal(seen[0]?.segment, "scuba");
  assert.match(messages[0].html, /<!--SEGMENT:scuba-->/);
  assert.equal(messages[0].idempotencyKey, reservationIdempotencyKey(person.leadId));
  const written = (await lines(dir)).filter((line) => line.leadId === person.leadId);
  assert.equal(written.at(-1)?.segment, "scuba");
  assert.ok(written.every((line) => line.segment === "scuba"));

  person.landingPath = undefined;
  await runReservationMail(options(dir), deps(store, messages, seen));
  assert.equal(messages.length, 1);
});

test("a legacy receipt without a segment does not adopt the current path on resume", async () => {
  const dir = await directory();
  const person = row({ landingPath: "/ko/scuba", signupCountry: "KR" });
  const intentAt = NOW.toISOString();
  await mkdir(dir, { recursive: true });
  await writeFile(
    receiptPaths(dir).file,
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: person.leadId,
      state: "intent",
      at: intentAt,
      firstIntentAt: intentAt,
      notion: "pending",
    })}\n`,
  );
  const messages: ReservationMessage[] = [];
  const seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[] = [];
  const first = await runReservationMail(options(dir), deps(new FakeStore([person]), messages, seen));
  assert.equal(first.sent, 1);
  assert.equal(seen[0]?.segment, "omitted");
  assert.match(messages[0].text, /SEGMENT:omitted/);
  const written = (await lines(dir)).filter((line) => line.leadId === person.leadId);
  assert.equal(written.length > 1, true);
  assert.ok(written.every((line) => !Object.prototype.hasOwnProperty.call(line, "segment")));
  await runReservationMail(options(dir), deps(new FakeStore([person]), messages, seen));
  assert.equal(messages.length, 1);
});

test("the same inbox is mailed once, and an invalid frozen segment refuses the send", async () => {
  const dir = await directory();
  const firstLead = lead();
  const secondLead = lead();
  const messages: ReservationMessage[] = [];
  const seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[] = [];
  const store = new FakeStore([
    row({ leadId: firstLead, email: "segment.route@gmail.com", landingPath: "/ko/scuba" }),
    row({ leadId: secondLead, email: "segmentroute@googlemail.com", landingPath: "/ko/freediving" }),
  ]);
  const result = await runReservationMail(options(dir), deps(store, messages, seen));
  assert.equal(result.sent, 1);
  assert.equal(messages.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(messages[0].idempotencyKey, reservationIdempotencyKey(firstLead));

  const badDir = await directory();
  const badLead = lead();
  await mkdir(badDir, { recursive: true });
  await writeFile(
    receiptPaths(badDir).file,
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: badLead,
      state: "intent",
      at: NOW.toISOString(),
      firstIntentAt: NOW.toISOString(),
      notion: "pending",
      segment: "dive",
    })}\n`,
  );
  const badMessages: ReservationMessage[] = [];
  const bad = await runReservationMail(
    options(badDir),
    deps(new FakeStore([row({ leadId: badLead, landingPath: "/scuba" })]), badMessages, []),
  );
  assert.equal(bad.aborted, "receipt_unsafe");
  assert.equal(badMessages.length, 0);
});

test("d1, d3, and d7 retries use the same resolver and do not send a second copy", async () => {
  for (const stage of ["d1", "d3", "d7"] as const) {
    const dir = await directory();
    const person = row({ landingPath: "/ja/freediving?utm_term=scuba" });
    const messages: ReservationMessage[] = [];
    const seen: { segment: ReservationEmailSegment | "omitted"; locale: string; inviteUrl: string }[] = [];
    const now = new Date(Date.parse(VERIFIED_AT) + DRIP_DELAY[stage]);
    const result = await runReservationMail(
      options(dir, { delayMs: DRIP_DELAY[stage] }),
      deps(new FakeStore([person]), messages, seen, now),
    );
    assert.equal(result.aborted, undefined, stage);
    assert.equal(result.sent, 1, stage);
    assert.equal(seen[0]?.segment, "freediving", stage);
    assert.equal(seen[0]?.locale, "ja", stage);
    assert.match(messages[0].html, /<!--SEGMENT:freediving-->/);
    await runReservationMail(
      options(dir, { delayMs: DRIP_DELAY[stage] }),
      deps(new FakeStore([person]), messages, seen, now),
    );
    assert.equal(messages.length, 1, stage);
    assert.equal((await lines(dir)).at(-1)?.segment, "freediving");
  }
});

test("drip d0 and a later d1 resume keep the frozen segment and do not duplicate", async () => {
  const verifiedAt = "2026-10-26T00:00:00.000Z";
  const start = Date.parse(verifiedAt) + 8 * DAY;
  const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] });
  const properties: Record<string, unknown> = {
    Email: { type: "title", title: [{ plain_text: "segment-drip@example.com" }] },
    "Lead ID": rich("aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab"),
    "Verification status": { type: "select", select: { name: "verified" } },
    "Email verified": { type: "checkbox", checkbox: true },
    Suspect: { type: "checkbox", checkbox: false },
    "Verified at": { type: "date", date: { start: verifiedAt } },
    "Launch mail": rich(""),
    "Reservation paid": { type: "checkbox", checkbox: false },
    "Reservation mode": { type: "select", select: { name: "live" } },
    "Landing path": rich("/ko/scuba?utm_campaign=freediving"),
    "Signup country": rich("US"),
  };
  for (const stage of DRIP_STAGES) properties[DRIP_FIELD[stage]] = rich("");
  const page = { id: "page-segment-drip", properties };
  const request: NotionRequest = async (method, path, body) => {
    if (method === "GET" && path.startsWith("databases/")) return { properties };
    if (method === "GET") return page;
    if (method === "POST") return { results: [page], has_more: false };
    if (method === "PATCH") {
      for (const [key, value] of Object.entries((body as { properties: Record<string, { rich_text: { text: { content: string } }[] }> }).properties)) {
        properties[key] = rich(value.rich_text[0].text.content);
      }
      return page;
    }
    throw new Error("Unexpected operation");
  };
  const root = await directory();
  const legacyReceiptDir = join(root, "legacy");
  await mkdir(legacyReceiptDir);
  await writeFile(
    join(legacyReceiptDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000099",
      state: "accepted",
      at: verifiedAt,
      firstIntentAt: verifiedAt,
      notion: "ok",
    })}\n`,
  );
  const messages: ReservationMessage[] = [];
  let nowMs = start;
  const env = {
    ...MAIL_ENV,
    WATCHDIVE_RESERVATION_DRIP_ENABLED: "true",
    WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: DRIP_COPY_HASH,
    WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true",
  };
  const dripOptions = {
    mode: "send" as const,
    legacyReceiptDir,
    dripReceiptDir: join(root, "drip"),
    notBefore: verifiedAt,
    postalAddress: POSTAL,
    legalName: LEGAL,
    ratePerSecond: 50,
  };
  const dripDeps = {
    env,
    request,
    databaseId: "db",
    stripe: { listCustomersByEmail: async () => [] } as unknown as StripeApi,
    now: () => new Date(nowMs),
    sleep: async () => undefined,
    liveGate: async () => ({ ok: true as const }),
    signInvite: () => "signed-invite-segment-test",
    send: async (message: ReservationMessage) => {
      messages.push(message);
    },
  };
  const first = await runReservationDrip(dripOptions, dripDeps);
  assert.equal(first.aborted, undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].idempotencyKey.endsWith("-d1"), false);
  const d0 = (await lines(legacyReceiptDir)).filter((line) => line.leadId === "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab");
  assert.ok(d0.length > 0);
  assert.ok(d0.every((line) => line.segment === "scuba"));
  await runReservationDrip(dripOptions, dripDeps);
  assert.equal(messages.length, 1);

  nowMs = start + DAY;
  const d1Dir = join(root, "drip", "d1");
  await mkdir(d1Dir, { recursive: true });
  const resumedAt = new Date(nowMs).toISOString();
  await writeFile(
    receiptPaths(d1Dir).file,
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab",
      state: "intent",
      at: resumedAt,
      firstIntentAt: resumedAt,
      notion: "pending",
      segment: "scuba",
    })}\n`,
  );
  properties["Landing path"] = rich("/ko/freediving");
  const second = await runReservationDrip(dripOptions, dripDeps);
  assert.equal(second.aborted, undefined);
  assert.equal(messages.length, 2);
  assert.ok(messages[1].idempotencyKey.endsWith("-d1"));
  assert.equal(messages[1].idempotencyKey, `${reservationIdempotencyKey("aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab")}-d1`);
  const d1 = (await lines(d1Dir)).filter((line) => line.leadId === "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ab");
  assert.ok(d1.length > 1);
  assert.ok(d1.every((line) => line.segment === "scuba"));
  await runReservationDrip(dripOptions, dripDeps);
  assert.equal(messages.length, 2);
  assert.equal(TEST_ORIGIN.startsWith("https://"), true);
});

function payloadHash(mail: { subject: string; html: string; text: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ subject: mail.subject, html: mail.html, text: mail.text }))
    .digest("hex");
}

async function seedIntent(dir: string, leadId: string, at: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    receiptPaths(dir).file,
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId,
      state: "intent",
      at,
      firstIntentAt: at,
      notion: "pending",
    })}\n`,
  );
}

test("a legacy ambiguous retry keeps omitted bytes and refuses a general payload", async () => {
  let providerSample: { legacy: ReservationMessage; mutated: ReservationMessage } | undefined;
  for (const locale of ["en", "ko"] as const) {
    const dir = await directory();
    const person = row({ browserLanguage: locale, signupCountry: locale === "ko" ? "KR" : "US" });
    await seedIntent(dir, person.leadId, NOW.toISOString());
    const seen: ReservationMailInput[] = [];
    const messages: ReservationMessage[] = [];
    const result = await runReservationMail(options(dir), {
      ...deps(new FakeStore([person]), messages, [], NOW),
      renderMail: (input) => {
        seen.push(input);
        return renderReservationMail(input);
      },
    });
    assert.equal(result.aborted, undefined, locale);
    assert.equal(result.sent, 1, locale);
    const omitted = seen.find((input) => input.segment === undefined);
    assert.ok(omitted, locale);
    assert.equal(omitted.locale, locale);
    const legacy = renderReservationMail(omitted);
    const general = renderReservationMail({ ...omitted, segment: "general" });
    assert.equal(messages[0].subject, legacy.subject);
    assert.equal(messages[0].html, legacy.html);
    assert.equal(messages[0].text, legacy.text);
    assert.equal(messages[0].subject, RESERVATION_COPY[locale].subject);
    assert.equal(payloadHash(messages[0]), payloadHash(legacy));
    assert.notEqual(payloadHash(legacy), payloadHash(general));
    assert.equal(messages[0].html.includes("/brand/reservation/segmented/"), false);
    assert.notEqual(messages[0].subject, general.subject);
    if (locale === "en") {
      providerSample = {
        legacy: { ...messages[0] },
        mutated: { ...messages[0], subject: general.subject, html: general.html, text: general.text },
      };
    }
    const written = (await lines(dir)).filter((line) => line.leadId === person.leadId);
    assert.ok(written.every((line) => !Object.prototype.hasOwnProperty.call(line, "segment")));
    await runReservationMail(options(dir), {
      ...deps(new FakeStore([person]), messages, [], NOW),
      renderMail: (input) => renderReservationMail(input),
    });
    assert.equal(messages.length, 1, locale);
  }

  if (!providerSample) throw new Error("legacy sample was not captured");
  const sample = providerSample;
  const resend = new FakeResend();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) =>
    resend.handle(String(input), init ?? {})) as typeof fetch;
  const providerEnv = {
    RESEND_API_KEY: "re_test_key",
    WATCHDIVE_EMAIL_FROM: "verify@mail.oceanwick.ai",
  };
  await deliverReservationMessage(providerEnv, sample.legacy, fetchImpl, async () => undefined);
  await deliverReservationMessage(providerEnv, sample.legacy, fetchImpl, async () => undefined);
  assert.equal(resend.messages.length, 1);
  assert.equal(resend.collapsed, 1);
  await assert.rejects(
    () => deliverReservationMessage(providerEnv, sample.mutated, fetchImpl, async () => undefined),
    (error: unknown) => error instanceof ResendDeliveryError && error.status === 409,
  );
  assert.equal(resend.messages.length, 1);
  assert.equal(resend.messages[0]?.body.html, sample.legacy.html);
});

test("d1 d3 and d7 legacy retries stay on the omitted follow-up, including the drip runner", async () => {
  for (const stage of ["d1", "d3", "d7"] as const) {
    for (const locale of ["en", "ko"] as const) {
      const dir = await directory();
      const person = row({ browserLanguage: locale, signupCountry: locale === "ko" ? "KR" : "US" });
      const now = new Date(Date.parse(VERIFIED_AT) + DRIP_DELAY[stage]);
      await seedIntent(dir, person.leadId, now.toISOString());
      const seen: ReservationMailInput[] = [];
      const messages: ReservationMessage[] = [];
      const result = await runReservationMail(options(dir, { delayMs: DRIP_DELAY[stage] }), {
        ...deps(new FakeStore([person]), messages, [], now),
        renderMail: (input) => {
          seen.push(input);
          return renderDripMail(stage, input);
        },
      });
      assert.equal(result.sent, 1, `${stage} ${locale}`);
      const omitted = seen.find((input) => input.segment === undefined);
      assert.ok(omitted);
      const legacy = renderDripMail(stage, omitted);
      const general = renderDripMail(stage, { ...omitted, segment: "general" });
      assert.equal(messages[0].subject, DRIP_COPY[locale][stage].subject);
      assert.equal(messages[0].html, legacy.html);
      assert.notEqual(messages[0].subject, PERSONALIZED_COPY.general[locale][stage].subject);
      assert.notEqual(payloadHash(messages[0]), payloadHash(general));
      assert.equal(messages[0].html.includes("/brand/reservation/segmented/"), false);
      assert.ok((await lines(dir)).every((line) => !Object.prototype.hasOwnProperty.call(line, "segment")));
    }
  }

  const verifiedAt = "2026-10-26T00:00:00.000Z";
  const sentAt = "2026-10-26T00:04:00.000Z";
  const nowMs = Date.parse(verifiedAt) + DRIP_DELAY.d1 + DAY;
  const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000ac";
  const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] });
  const properties: Record<string, unknown> = {
    Email: { type: "title", title: [{ plain_text: "segment-legacy-d1@example.com" }] },
    "Lead ID": rich(leadId),
    "Verification status": { type: "select", select: { name: "verified" } },
    "Email verified": { type: "checkbox", checkbox: true },
    Suspect: { type: "checkbox", checkbox: false },
    "Verified at": { type: "date", date: { start: verifiedAt } },
    "Launch mail": rich(""),
    "Reservation paid": { type: "checkbox", checkbox: false },
    "Reservation mode": { type: "select", select: { name: "live" } },
    "Landing path": rich(""),
    "Browser language": rich("en"),
    "Signup country": rich("US"),
    "Reservation mail": rich(`${RESERVATION_CAMPAIGN_ID} sent ${sentAt}`),
  };
  for (const stage of DRIP_STAGES) {
    if (stage !== "d0") properties[DRIP_FIELD[stage]] = rich("");
  }
  const page = { id: "page-segment-legacy-d1", properties };
  const request: NotionRequest = async (method, path, body) => {
    if (method === "GET" && path.startsWith("databases/")) return { properties };
    if (method === "GET") return page;
    if (method === "POST") return { results: [page], has_more: false };
    if (method === "PATCH") {
      for (const [key, value] of Object.entries(
        (body as { properties: Record<string, { rich_text: { text: { content: string } }[] }> }).properties,
      )) {
        properties[key] = rich(value.rich_text[0].text.content);
      }
      return page;
    }
    throw new Error("Unexpected operation");
  };
  const root = await directory();
  const legacyReceiptDir = join(root, "legacy");
  await mkdir(legacyReceiptDir);
  await writeFile(
    join(legacyReceiptDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId,
      state: "accepted",
      at: sentAt,
      firstIntentAt: sentAt,
      notion: "ok",
    })}\n`,
  );
  const d1Dir = join(root, "drip", "d1");
  await seedIntent(d1Dir, leadId, new Date(nowMs).toISOString());
  const messages: ReservationMessage[] = [];
  const env = {
    ...MAIL_ENV,
    WATCHDIVE_RESERVATION_DRIP_ENABLED: "true",
    WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: DRIP_COPY_HASH,
    WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true",
  };
  const dripOptions = {
    mode: "send" as const,
    legacyReceiptDir,
    dripReceiptDir: join(root, "drip"),
    notBefore: verifiedAt,
    postalAddress: POSTAL,
    legalName: LEGAL,
    ratePerSecond: 50,
  };
  const dripDeps = {
    env,
    request,
    databaseId: "db",
    stripe: { listCustomersByEmail: async () => [] } as unknown as StripeApi,
    now: () => new Date(nowMs),
    sleep: async () => undefined,
    liveGate: async () => ({ ok: true as const }),
    signInvite: () => "signed-invite-segment-test",
    send: async (message: ReservationMessage) => {
      messages.push(message);
    },
  };
  const stale = await runReservationDrip(dripOptions, {
    ...dripDeps,
    env: { ...env, WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: "0".repeat(64) },
  });
  assert.equal(stale.aborted, "drip_not_approved_or_cutover_incomplete");
  assert.equal(messages.length, 0);
  const resumed = await runReservationDrip(dripOptions, dripDeps);
  assert.equal(resumed.aborted, undefined);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].subject, DRIP_COPY.en.d1.subject);
  assert.equal(messages[0].html.includes("/brand/reservation/segmented/"), false);
  assert.ok(messages[0].idempotencyKey.endsWith("-d1"));
  const d1Lines = (await lines(d1Dir)).filter((line) => line.leadId === leadId);
  assert.ok(d1Lines.length > 1);
  assert.ok(d1Lines.every((line) => !Object.prototype.hasOwnProperty.call(line, "segment")));
  await runReservationDrip(dripOptions, dripDeps);
  assert.equal(messages.length, 1);
});

test("a collapsed general default refuses the legacy retry, and a mutated body is held", async () => {
  const collapsedDir = await directory();
  const collapsedPerson = row({ browserLanguage: "en", signupCountry: "US" });
  await seedIntent(collapsedDir, collapsedPerson.leadId, NOW.toISOString());
  const collapsedMessages: ReservationMessage[] = [];
  const collapsed = await runReservationMail(options(collapsedDir), {
    ...deps(new FakeStore([collapsedPerson]), collapsedMessages, [], NOW),
    renderMail: (input) => renderReservationMail({ ...input, segment: "general" }),
  });
  assert.equal(collapsed.aborted, "template_rejected");
  assert.equal(collapsed.sent, 0);
  assert.equal(collapsedMessages.length, 0);

  const dir = await directory();
  const person = row({ browserLanguage: "en", signupCountry: "US" });
  await seedIntent(dir, person.leadId, NOW.toISOString());
  let sends = 0;
  const store = new FakeStore([person]);
  const run = async () =>
    runReservationMail(options(dir), {
      ...deps(store, [], [], NOW),
      renderMail: (input) =>
        renderReservationMail({ ...input, segment: input.segment === "general" ? "scuba" : "general" }),
      send: async (message) => {
        sends += 1;
        if (message.subject !== RESERVATION_COPY.en.subject || message.html.includes("/brand/reservation/segmented/")) {
          throw new ResendDeliveryError("Resend delivery failed (409)", 409);
        }
      },
    });
  const first = await run();
  assert.equal(first.sent, 0);
  assert.equal(first.unresolved, 1);
  assert.equal(first.failureClasses.provider_conflict, 1);
  assert.match(person.reservationMail ?? "", /hold provider_conflict/);
  assert.equal(sends, 1);
  const second = await run();
  assert.equal(second.sent, 0);
  assert.equal(sends, 1);
  assert.equal(second.skipped.held, 1);
});
