// Reservation invitation: disclosure, eligibility, dry run, and resumable send.
// Every dependency is a fake. Nothing touches a network or a live mailbox.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  reservationLocale,
  reservationSkipReason,
  selectAudience,
  type ReservationRow,
} from "../src/lib/reservation-mail/audience.ts";
import {
  RESERVATION_CAMPAIGN_ID,
  reservationIdempotencyKey,
} from "../src/lib/reservation-mail/campaign.ts";
import { main, parseCli } from "../src/lib/reservation-mail/cli.ts";
import { RESERVATION_COPY, copyParagraphs } from "../src/lib/reservation-mail/copy.ts";
import {
  INVITE_LINK_TTL_MS,
  UNSIGNED_PREVIEW_TOKEN,
  buildReservationInviteUrl,
  mintReservationInviteUrl,
  reservationInviteJti,
  reservationMailLang,
  type ReservationInviteSigner,
} from "../src/lib/reservation-mail/inviteLink.ts";
import { deliverReservationMessage } from "../src/lib/reservation-mail/provider.ts";
import { decideMailAction } from "../src/lib/reservation-mail/receipts.ts";
import {
  RESERVATION_COMPANY_NUMBER,
  RESERVATION_LEGAL_NAME,
  RESERVATION_REGISTERED_OFFICE,
} from "../src/lib/reservation-mail/merchant.ts";
import { renderReservationMail } from "../src/lib/reservation-mail/render.ts";
import {
  PREVIEW_LEAD_ID,
  formatReservationSummary,
  runReservationMail,
  type ReservationMessage,
  type ReservationRunOptions,
} from "../src/lib/reservation-mail/run.ts";
import {
  createNotionReservationStore,
  toReservationRow,
  type ReservationSchema,
  type ReservationStore,
} from "../src/lib/reservation-mail/store.ts";
import { createUnsubscribeToken } from "../src/lib/launchMail/unsubscribeToken.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import { ResendDeliveryError } from "../src/lib/verification/resend.ts";
import { verifyReservationInvite } from "../src/lib/reservation/invite.ts";
import { TEST_ENV, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";

const POSTAL = RESERVATION_REGISTERED_OFFICE;
const LEGAL = RESERVATION_LEGAL_NAME;
const RESERVATION_TOKEN_SECRET = "reservation-token-secret-32bytes-min!!";
const MAIL_ENV = {
  ...TEST_ENV,
  WATCHDIVE_RESERVATION_TOKEN_SECRET: RESERVATION_TOKEN_SECRET,
};
const NOW = new Date("2026-10-18T04:00:00.000Z");
const VERIFIED_AT = "2026-10-18T03:00:00.000Z";
const NOT_BEFORE = "2026-10-18T00:00:00.000Z";
const passLiveGate = async () => ({ ok: true as const });
const SECRET_EMAIL = "person-secret@example.com";
const SECRET_TOKEN = "signed-invite-SECRETTOKENVALUE";

let leadCounter = 0;
function lead(): string {
  leadCounter += 1;
  return `aaaaaaaa-bbbb-4ccc-8ddd-${leadCounter.toString(16).padStart(12, "0")}`;
}

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
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
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
}

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
  reservationPaid: "missing",
  reservationMode: "missing",
};

class FakeStore implements ReservationStore {
  rows: ReservationRow[];
  schema: ReservationSchema;
  writes: { pageId: string; value: string }[] = [];
  failWrites = 0;
  rejectWrites = false;

  constructor(rows: ReservationRow[], schema: ReservationSchema = SCHEMA) {
    this.rows = rows;
    this.schema = { ...schema };
  }

  async readSchema() {
    return { ...this.schema };
  }

  async listRows() {
    return this.rows;
  }

  async readRow(pageId: string) {
    return this.rows.find((item) => item.pageId === pageId);
  }

  async recordReservationMail(pageId: string, value: string) {
    if (this.rejectWrites) throw new Error("Notion request failed (400): validation_error");
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error("Notion request failed (503)");
    }
    this.writes.push({ pageId, value });
    const target = this.rows.find((item) => item.pageId === pageId);
    if (target) target.reservationMail = value;
  }
}

class FakeResend {
  calls: ReservationMessage[] = [];
  status: number | null = null;
  boom: Error | null = null;

  send = async (message: ReservationMessage) => {
    this.calls.push(message);
    if (this.boom) throw this.boom;
    if (this.status !== null) throw new ResendDeliveryError("Resend delivery failed", this.status);
  };
}

function signerFor(
  tokenFor: (leadId: string) => string = (leadId) => `signed-invite-${leadId}`,
): ReservationInviteSigner {
  return (input) => {
    if (input.emailVerified !== true) throw new Error("emailVerified must be true");
    if (!input.email.trim()) throw new Error("email is required");
    return tokenFor(input.leadId);
  };
}

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reservation-mail-"));
}

function options(
  receiptDir: string,
  overrides: Partial<ReservationRunOptions> = {},
): ReservationRunOptions {
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

test("every locale keeps checkout facts in disclosure and a short marketing mail", () => {
  const englishFacts = RESERVATION_COPY.en.disclosure;
  const legalKeys = ["pay", "notDeducted", "laterManual", "total", "independence", "cancellation", "mandatory"] as const;
  for (const locale of SUPPORTED_LOCALES) {
    const copy = RESERVATION_COPY[locale];
    const marketing = copyParagraphs(copy).join("\n");
    assert.equal(marketing.includes(copy.disclosure), false, locale);
    assert.equal(copy.reason.includes(copy.anchors.thanks), true, locale);
    assert.equal(marketing.includes(copy.anchors.thanks), true, locale);
    for (const key of legalKeys) {
      assert.equal(copy.disclosure.includes(copy.anchors[key]), true, `${locale} ${key}`);
      assert.equal(marketing.includes(copy.anchors[key]), false, `${locale} ${key} stayed out of the mail`);
    }
    assert.match(copy.disclosure, /152/);
    assert.match(marketing, locale === "fr" ? /3 \$/ : /\$3/);
    assert.match(marketing, locale === "fr" ? /149 \$/ : /\$149/);
    assert.doesNotMatch(
      `${marketing}\n${copy.disclosure}`,
      /\$299|December|12월|재고|free shipping|체크아웃|크레딧|영수증|チェックアウト|not a receipt|not itself a reservation/i,
    );
    if (locale !== "en") assert.equal(copy.disclosure.includes(englishFacts), false, locale);
  }
  assert.equal(RESERVATION_COPY.ko.subject, "선착순 걱정 없이 $149, 예약은 $3로");
  assert.equal(RESERVATION_COPY.ko.button, "$3로 $149 보장받기");
  assert.match(RESERVATION_COPY.en.subject, /\$149/);
  assert.match(RESERVATION_COPY.en.button, /\$3/);
});

test("rendered mail stays short and rejects a country claim", () => {
  const invite = buildReservationInviteUrl(TEST_ORIGIN, "ko", SECRET_TOKEN);
  const unsub = `${TEST_ORIGIN}/unsubscribe/example-token-value-0001`;
  const mail = renderReservationMail({
    locale: "ko",
    inviteUrl: invite,
    unsubscribeUrl: unsub,
    privacyUrl: `${TEST_ORIGIN}/ko/privacy`,
    termsUrl: `${TEST_ORIGIN}/ko/terms`,
    postalAddress: POSTAL,
  });
  assert.equal(
    renderReservationMail({
      locale: "ko",
      inviteUrl: invite,
      unsubscribeUrl: unsub,
      privacyUrl: `${TEST_ORIGIN}/ko/privacy`,
      termsUrl: `${TEST_ORIGIN}/ko/terms`,
      postalAddress: POSTAL,
    }).html,
    mail.html,
  );
  assert.match(mail.text, /\$3/);
  assert.match(mail.text, /\$149/);
  assert.equal(mail.text.includes("US$152"), false);
  assert.equal(mail.text.includes("차감되지 않으며"), false);
  assert.equal(mail.text.includes("자동 결제되지 않습니다"), false);
  assert.equal(mail.text.includes("선착순 100명 혜택과 별도로"), false);
  assert.equal(mail.text.includes(RESERVATION_COPY.ko.feeNote), false);
  assert.equal(mail.html.includes(RESERVATION_COPY.ko.feeNote), false);
  assert.match(mail.html, /#201748/);
  assert.match(mail.html, /#3D2683/);
  assert.match(mail.html, /#EEF9FF/);
  assert.match(mail.html, /#F6FAFC/);
  assert.match(mail.html, /watchdive-primary@1x\.png\?v=2\.6\.1/);
  assert.equal(mail.html.includes("diveroid-wordmark"), false);
  assert.match(mail.html, /alt="WatchDive"/);
  assert.match(mail.html, /\/brand\/reservation\/watchdive-underwater\.jpg/);
  assert.match(mail.html, /\$3로 \$149 보장받기/);
  assert.equal(mail.html.includes("font-size:64px"), false);
  assert.match(mail.text, /모든 다이빙이, 바다의 지도가 됩니다/);
  assert.equal(mail.html.includes("Work Sans"), false);
  assert.equal(mail.html.includes("#08021f"), false);
  assert.equal(mail.html.includes("#6dcaf8"), false);
  assert.match(mail.html, /DIVEROID LTD/);
  assert.match(mail.html, new RegExp(RESERVATION_COMPANY_NUMBER));
  assert.match(mail.text, /E6 2JA/);
  assert.equal(mail.text.split("예약금 US$3을 결제하면").length, 1);
  assert.equal(mail.subject, "선착순 걱정 없이 $149, 예약은 $3로");
  const linkedMatch = mail.text.match(
    /https:\/\/watchdive\.diveroid\.com\/reservation\?lang=ko#invite=\S+/,
  );
  assert.ok(linkedMatch);
  const linked = new URL(linkedMatch[0]);
  assert.deepEqual([...linked.searchParams.keys()], ["lang"]);
  assert.equal(linked.searchParams.get("lang"), "ko");
  assert.equal(linked.hash.startsWith("#invite="), true);
  assert.equal(linked.search.includes(SECRET_TOKEN), false);
  assert.equal(mail.html.includes("inviteToken="), false);
  assert.equal(mail.html.includes(SECRET_TOKEN), true);
  assert.equal(mail.html.includes(SECRET_EMAIL), false);
  assert.equal(mail.text.includes("Korea"), false);
  assert.throws(() =>
    renderReservationMail({
      locale: "en",
      inviteUrl: "http://watchdive.diveroid.com/reservation?token=signed-invite-SECRETTOKENVALUE",
      unsubscribeUrl: unsub,
      privacyUrl: `${TEST_ORIGIN}/privacy`,
      termsUrl: `${TEST_ORIGIN}/terms`,
    }),
  );
});

test("eligibility does not treat locale as country or SMS as consent to mail", () => {
  assert.equal(reservationLocale({ landingPath: "/ko/r/abc", browserLanguage: "en-US" }), "ko");
  assert.equal(reservationLocale({ landingPath: "/", browserLanguage: "de-DE" }), "de");
  assert.equal(reservationLocale({ landingPath: "/", browserLanguage: "und" }), "en");
  assert.equal(reservationLocale({ locale: "en", landingPath: "/ko", signupCountry: "KR" }), "en");
  assert.equal(
    reservationLocale({ landingPath: "/en", browserLanguage: "ko", signupCountry: "KR" }),
    "en",
  );
  assert.equal(reservationLocale({ landingPath: "/ja", signupCountry: "KR" }), "ja");
  assert.equal(
    reservationLocale({ landingPath: "/", browserLanguage: "de-DE", signupCountry: "KR" }),
    "de",
  );
  assert.equal(reservationLocale({ landingPath: "/", signupCountry: "KR" }), "ko");
  assert.equal(reservationLocale({ signupCountry: "KR" }), "ko");
  assert.equal(reservationLocale({ signupCountry: "JP" }), "ja");
  assert.equal(reservationLocale({ signupCountry: "BR" }), "pt-BR");
  assert.equal(reservationLocale({ signupCountry: "US" }), "en");
  assert.equal(reservationLocale({ signupCountry: "CA" }), "en");
  assert.equal(reservationLocale({ signupCountry: "CH" }), "en");
  assert.equal(reservationLocale({ signupCountry: "BE" }), "en");
  assert.equal(reservationLocale({ signupCountry: "unknown" }), "en");
  assert.equal(reservationLocale({ browserLanguage: "zh-TW", signupCountry: "KR" }), "zh-TW");
  const verified = row({ browserLanguage: "ko-KR" });
  assert.equal(reservationSkipReason(verified), undefined);
  assert.equal(reservationLocale(verified), "ko");
  assert.equal(
    reservationSkipReason(row({ status: "pending", emailVerified: false })),
    "not_verified",
  );
  assert.equal(
    reservationSkipReason(row({ status: "legacy", emailVerified: false })),
    "not_verified",
  );
  assert.equal(reservationSkipReason(row({ emailVerified: false })), "not_verified");
  assert.equal(reservationSkipReason(row({ suspect: true })), "suspect");
  assert.equal(reservationSkipReason(row({ duplicate: true })), "duplicate");
  assert.equal(reservationSkipReason(row({ status: "suppressed" })), "suppressed");
  assert.equal(
    reservationSkipReason(row({ launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" })),
    "unsubscribed",
  );
  assert.equal(
    reservationSkipReason(
      row({ reservationMail: `${RESERVATION_CAMPAIGN_ID} sent 2026-10-01T00:00:00.000Z` }),
    ),
    "already_sent",
  );
  assert.equal(
    reservationSkipReason(row({ reservationMail: "call this person" })),
    "unrecognised_marker",
  );
  assert.equal(reservationSkipReason(row({ email: "not-an-email" })), "no_address");
  assert.equal(reservationSkipReason(row({ leadId: "nope" })), "no_lead_id");

  const clean = row({ email: SECRET_EMAIL });
  const unsubscribed = row({
    email: SECRET_EMAIL,
    launchMail: "Unsubscribe",
  });
  const audience = selectAudience([
    unsubscribed,
    clean,
    row({ email: "other@example.com", status: "pending", emailVerified: false }),
  ]);
  assert.equal(audience.recipients.length, 0);
  assert.equal(audience.skipped.unsubscribed, 1);
  assert.equal(audience.skipped.unsubscribed_address, 1);
  assert.equal(audience.skipped.not_verified, 1);

  const first = row({ email: "same@example.com" });
  const second = row({ email: "same@example.com" });
  const deduped = selectAudience([first, second]);
  assert.deepEqual(
    deduped.recipients.map((item) => item.row.leadId),
    [first.leadId],
  );
  assert.equal(deduped.skipped.duplicate_address, 1);
});

test("Notion row reader uses Signup country and ignores phone, SMS, and the legacy Country select", async () => {
  const page = {
    id: "page-1",
    properties: {
      Email: { title: [{ plain_text: SECRET_EMAIL }] },
      "Verification status": { select: { name: "verified" } },
      "Email verified": { checkbox: true },
      Suspect: { checkbox: false },
      "Lead ID": { rich_text: [{ plain_text: "aaaaaaaa-bbbb-4ccc-8ddd-0000000000aa" }] },
      "Landing path": { rich_text: [{ plain_text: "/ja" }] },
      "Signup locale": { rich_text: [{ plain_text: "en" }] },
      "Signup country": { rich_text: [{ plain_text: "kr" }] },
      Country: { select: { name: "ZZ" } },
      Phone: { rich_text: [{ plain_text: "+821012345678" }] },
      "SMS consent": { rich_text: [{ plain_text: "sms-consent-sentinel" }] },
    },
  };
  const parsed = toReservationRow(page);
  const encoded = JSON.stringify(parsed);
  assert.equal(parsed?.signupCountry, "KR");
  assert.equal(parsed?.locale, "en");
  assert.equal(reservationLocale(parsed ?? {}), "en");
  assert.equal(encoded.includes("ZZ"), false);
  assert.equal(encoded.includes("+821012345678"), false);
  assert.equal(encoded.includes("sms-consent-sentinel"), false);
  assert.equal(parsed?.email, SECRET_EMAIL);
  const blank = toReservationRow({ id: "page-2", properties: { Email: { title: [] } } });
  assert.equal(blank?.signupCountry, undefined);
  assert.equal(blank?.locale, undefined);

  const request: NotionRequest = async (method, path) => {
    if (method === "GET" && path.startsWith("databases/")) {
      return {
        properties: {
          Email: { type: "title" },
          "Verification status": { type: "select" },
          "Email verified": { type: "checkbox" },
          Suspect: { type: "checkbox" },
          "Lead ID": { type: "rich_text" },
          "Landing path": { type: "rich_text" },
          "Launch mail": { type: "rich_text" },
          "Reservation mail": { type: "rich_text" },
          Duplicate: { type: "checkbox" },
          "Browser language": { type: "rich_text" },
          Country: { type: "select" },
          "Signup country": { type: "rich_text" },
          "Signup locale": { type: "rich_text" },
          Phone: { type: "rich_text" },
          "SMS consent": { type: "rich_text" },
        },
      };
    }
    return { results: [page], has_more: false };
  };
  const store = createNotionReservationStore(request, "db");
  const schema = await store.readSchema();
  assert.equal(schema.hasCountryProperty, true);
  assert.equal(schema.hasSmsConsentProperty, true);
  assert.equal(schema.reservationMail, "ok");
  const listed = await store.listRows(schema);
  assert.equal(JSON.stringify(listed).includes("+821012345678"), false);
  assert.equal(JSON.stringify(listed).includes("sms-consent-sentinel"), false);
  assert.equal(listed[0]?.landingPath, "/ja");
  assert.equal(listed[0]?.signupCountry, "KR");
  assert.equal(listed[0]?.locale, "en");
});

test("dry run sends nothing and does not write a receipt", async () => {
  const dir = await directory();
  const store = new FakeStore([row({ email: SECRET_EMAIL })]);
  const resend = new FakeResend();
  const result = await runReservationMail(options(dir, { mode: "dry-run" }), {
    store,
    send: resend.send,
    signInvite: signerFor(() => SECRET_TOKEN),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(resend.calls.length, 0);
  assert.equal(store.writes.length, 0);
  assert.equal(result.eligible, 1);
  assert.equal(result.planned.deliver, 1);
  assert.equal(result.samples.length, SUPPORTED_LOCALES.length);
  await assert.rejects(readFile(join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "utf8"));
  const summary = formatReservationSummary(result);
  assert.equal(summary.includes(SECRET_EMAIL), false);
  assert.equal(summary.includes(SECRET_TOKEN), false);
  assert.match(summary, /Language \(not country\)/);
  assert.match(summary, /Not inferred from phone or IP/);
  assert.match(summary, /Blanks are not backfilled/);
  assert.doesNotMatch(summary, /country=KR|SMS consent sentinel/);
});

test("send records a receipt and a second run does not send again", async () => {
  const dir = await directory();
  const person = row({ email: SECRET_EMAIL, landingPath: "/ko" });
  const store = new FakeStore([person]);
  const resend = new FakeResend();
  const deps = {
    store,
    send: resend.send,
    signInvite: signerFor(() => SECRET_TOKEN),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  };
  const first = await runReservationMail(options(dir), deps);
  assert.equal(first.sent, 1);
  assert.equal(resend.calls.length, 1);
  assert.equal(resend.calls[0]?.idempotencyKey, reservationIdempotencyKey(person.leadId));
  assert.match(resend.calls[0]?.html ?? "", /\$3/);
  assert.match(resend.calls[0]?.text ?? "", /\/reservation\?lang=ko#invite=/);
  assert.equal((resend.calls[0]?.text ?? "").includes("/ko/reservation"), false);
  assert.equal((resend.calls[0]?.text ?? "").includes("inviteToken="), false);
  assert.equal((resend.calls[0]?.text ?? "").includes("?token="), false);
  assert.equal((resend.calls[0]?.html ?? "").includes("email="), false);
  const mailedMatch = (resend.calls[0]?.text ?? "").match(
    /https:\/\/watchdive\.diveroid\.com\/reservation\?lang=ko#invite=\S+/,
  );
  assert.ok(mailedMatch);
  const mailed = new URL(mailedMatch[0]);
  assert.deepEqual([...mailed.searchParams.keys()], ["lang"]);
  assert.equal(mailed.search.includes(SECRET_TOKEN), false);
  assert.match(store.writes[0]?.value ?? "", new RegExp(`^${RESERVATION_CAMPAIGN_ID} sent `));
  const ledger = await readFile(join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "utf8");
  assert.equal(ledger.includes(SECRET_EMAIL), false);
  assert.equal(ledger.includes(SECRET_TOKEN), false);
  assert.match(ledger, /"state":"accepted"/);

  const second = await runReservationMail(options(dir), deps);
  assert.equal(second.sent, 0);
  assert.equal(resend.calls.length, 1);
  assert.equal(second.skipped.already_sent, 1);
  const summary = formatReservationSummary(second);
  assert.equal(summary.includes(SECRET_EMAIL), false);
  assert.equal(summary.includes(person.leadId), false);
  assert.equal(summary.includes(SECRET_TOKEN), false);
  const unsubscribe = createUnsubscribeToken(person.leadId, "ko", TEST_SECRET);
  assert.equal(summary.includes(unsubscribe), false);
});

test("an old intent is not sent again, and a fresh one retries the same key", async () => {
  const oldDir = await directory();
  const freshDir = await directory();
  const oldPerson = row();
  const freshPerson = row();
  const oldIntent = {
    v: 1,
    campaignId: RESERVATION_CAMPAIGN_ID,
    leadId: oldPerson.leadId,
    state: "intent",
    at: "2026-10-16T00:00:00.000Z",
    firstIntentAt: "2026-10-16T00:00:00.000Z",
    notion: "pending",
  };
  const freshIntent = {
    ...oldIntent,
    leadId: freshPerson.leadId,
    at: "2026-10-18T03:00:00.000Z",
    firstIntentAt: "2026-10-18T03:00:00.000Z",
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(oldDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify(oldIntent)}\n`,
  );
  await writeFile(
    join(freshDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify(freshIntent)}\n`,
  );
  const oldResend = new FakeResend();
  const freshResend = new FakeResend();
  const oldStore = new FakeStore([oldPerson]);
  const freshStore = new FakeStore([freshPerson]);
  const oldResult = await runReservationMail(options(oldDir), {
    store: oldStore,
    send: oldResend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  const freshResult = await runReservationMail(options(freshDir), {
    store: freshStore,
    send: freshResend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(oldResend.calls.length, 0);
  assert.equal(oldResult.expired, 1);
  assert.match(oldStore.writes.at(-1)?.value ?? "", /hold expired_intent/);
  assert.equal(freshResend.calls.length, 1);
  assert.equal(freshResend.calls[0]?.idempotencyKey, reservationIdempotencyKey(freshPerson.leadId));
  assert.equal(freshResult.sent, 1);
});

test("an accepted receipt reconciles Notion and does not call the provider", async () => {
  const dir = await directory();
  const person = row();
  const accepted = {
    v: 1,
    campaignId: RESERVATION_CAMPAIGN_ID,
    leadId: person.leadId,
    state: "accepted",
    at: "2026-10-18T03:00:00.000Z",
    firstIntentAt: "2026-10-18T03:00:00.000Z",
    notion: "failed",
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), `${JSON.stringify(accepted)}\n`);
  const resend = new FakeResend();
  const store = new FakeStore([person]);
  const result = await runReservationMail(options(dir), {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(resend.calls.length, 0);
  assert.equal(result.reconciled, 1);
  assert.match(store.writes[0]?.value ?? "", / sent /);
});

test("a provider conflict is held and a later run does not retry it", async () => {
  const dir = await directory();
  const person = row();
  const store = new FakeStore([person]);
  const resend = new FakeResend();
  resend.status = 409;
  const deps = {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  };
  const first = await runReservationMail(options(dir), deps);
  assert.equal(first.unresolved, 1);
  assert.equal(first.sent, 0);
  assert.match(store.writes.at(-1)?.value ?? "", /hold provider_conflict/);
  resend.status = null;
  const second = await runReservationMail(options(dir), deps);
  assert.equal(resend.calls.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped.held, 1);
});

test("a bad invite does not block a different recipient", async () => {
  const dir = await directory();
  const bad = row({ email: "bad@example.com" });
  const good = row({ email: "good@example.com" });
  const store = new FakeStore([bad, good]);
  const resend = new FakeResend();
  const result = await runReservationMail(options(dir), {
    store,
    send: resend.send,
    signInvite: (input) => {
      if (input.leadId === bad.leadId) return "bad token with spaces!!";
      return SECRET_TOKEN;
    },
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(result.inviteRejected, 1);
  assert.equal(result.sent, 1);
  assert.equal(resend.calls.length, 1);
  assert.equal(resend.calls[0]?.to, "good@example.com");
  assert.equal(formatReservationSummary(result).includes(SECRET_EMAIL), false);
});

test("omitted identity uses the verified company, and a conflicting identity is refused", async () => {
  const dir = await directory();
  const store = new FakeStore([row()]);
  const conflict = await runReservationMail(options(dir, { legalName: "Not The Company Ltd" }), {
    store,
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(conflict.aborted, "merchant_identity_mismatch");
  assert.equal(conflict.sent, 0);
  assert.equal((conflict.detail ?? "").includes("Not The Company"), false);

  const malformed = await runReservationMail(options(dir, { legalName: "Bad<script>" }), {
    store,
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(malformed.aborted, "invalid_input");
  assert.equal(malformed.sent, 0);

  store.schema = { ...SCHEMA, reservationMail: "missing" };
  const missingColumn = await runReservationMail(options(dir), {
    store,
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(missingColumn.aborted, "reservation_mail_property_missing");
  const dry = await runReservationMail(options(dir, { mode: "dry-run" }), {
    store,
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(dry.aborted, undefined);
  assert.equal(dry.eligible, 1);
  assert.ok(dry.sendBlockers.some((line) => /Reservation mail/.test(line)));

  const sendDir = await directory();
  const resend = new FakeResend();
  const omitted = await runReservationMail(
    options(sendDir, { postalAddress: undefined, legalName: undefined }),
    {
      store: new FakeStore([row()]),
      send: resend.send,
      signInvite: signerFor(),
      env: MAIL_ENV,
    liveGate: passLiveGate,
      now: () => NOW,
      sleep: async () => undefined,
    },
  );
  assert.equal(omitted.aborted, undefined);
  assert.equal(omitted.sent, 1);
  assert.match(resend.calls[0]?.html ?? "", new RegExp(RESERVATION_COMPANY_NUMBER));
  assert.match(resend.calls[0]?.text ?? "", /DIVEROID LTD/);
  assert.match(resend.calls[0]?.text ?? "", /E6 2JA/);
});

test("a corrupt or unsafe ledger refuses the send", async () => {
  const dir = await directory();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "not-json\n");
  const corrupt = await runReservationMail(options(dir), {
    store: new FakeStore([row()]),
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(corrupt.aborted, "receipt_unsafe");

  const unsafeDir = await directory();
  await writeFile(
    join(unsafeDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify({ email: SECRET_EMAIL })}\n`,
  );
  const unsafe = await runReservationMail(options(unsafeDir), {
    store: new FakeStore([row()]),
    send: async () => {
      throw new Error("should not send");
    },
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
  });
  assert.equal(unsafe.aborted, "receipt_unsafe");
});

test("--limit holds the rest back", async () => {
  const dir = await directory();
  const store = new FakeStore([row(), row(), row()]);
  const resend = new FakeResend();
  const result = await runReservationMail(options(dir, { limit: 1 }), {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(result.sent, 1);
  assert.equal(result.heldBack, 2);
  assert.equal(resend.calls.length, 1);
});

test("a fresh recipient is deliverable, and the mailed lang is the signup locale", () => {
  const action = decideMailAction(undefined, undefined, NOW);
  assert.equal(action.type, "deliver");
  assert.equal(reservationMailLang("ko"), "ko");
  assert.equal(reservationMailLang("ja"), "ja");
  assert.equal(reservationMailLang("zh-CN"), "zh-CN");
  for (const locale of SUPPORTED_LOCALES) {
    const linked = new URL(buildReservationInviteUrl(TEST_ORIGIN, locale, UNSIGNED_PREVIEW_TOKEN));
    assert.equal(linked.pathname, "/reservation", locale);
    assert.deepEqual([...linked.searchParams.keys()], ["lang"], locale);
    assert.equal(linked.searchParams.get("lang"), locale, locale);
    assert.equal(linked.hash, `#invite=${UNSIGNED_PREVIEW_TOKEN}`, locale);
    assert.equal(linked.search.includes(UNSIGNED_PREVIEW_TOKEN), false, locale);
  }
  const ja = new URL(buildReservationInviteUrl(TEST_ORIGIN, "ja", SECRET_TOKEN));
  assert.equal(ja.pathname, "/reservation");
  assert.deepEqual([...ja.searchParams.keys()], ["lang"]);
  assert.equal(ja.searchParams.get("lang"), "ja");
  assert.equal(ja.hash.startsWith("#invite="), true);
  assert.equal(ja.search.includes(SECRET_TOKEN), false);
  assert.throws(() => buildReservationInviteUrl(TEST_ORIGIN, "en", "short"));
});

test("the same first intent mints one fragment link, and a moved clock does not", () => {
  const input = {
    leadId: PREVIEW_LEAD_ID,
    email: "Preview.User+tag@gmail.com",
    locale: "ko" as const,
    publicOrigin: TEST_ORIGIN,
    secret: RESERVATION_TOKEN_SECRET,
    firstIntentAtMs: NOW.getTime(),
    nowMs: NOW.getTime(),
  };
  const first = mintReservationInviteUrl(input);
  const retry = mintReservationInviteUrl({
    ...input,
    nowMs: NOW.getTime() + 60 * 60 * 1000,
  });
  const shifted = mintReservationInviteUrl({
    ...input,
    firstIntentAtMs: NOW.getTime() + 1000,
  });
  assert.equal(first === retry, true);
  assert.equal(first === shifted, false);
  const url = new URL(first);
  assert.equal(url.origin, TEST_ORIGIN);
  assert.equal(url.pathname, "/reservation");
  assert.deepEqual([...url.searchParams.keys()], ["lang"]);
  assert.equal(url.searchParams.get("lang"), "ko");
  assert.equal(url.hash.startsWith("#invite="), true);
  const token = decodeURIComponent(url.hash.slice("#invite=".length));
  assert.equal(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token), true);
  assert.equal(token.includes("@"), false);
  assert.equal(url.search.includes(token), false);
  assert.equal(first.includes("inviteToken="), false);
  assert.equal(first.includes("email="), false);
  assert.equal(first.includes("Preview.User"), false);
  assert.equal(first.includes(RESERVATION_TOKEN_SECRET), false);
  const claims = verifyReservationInvite(token, RESERVATION_TOKEN_SECRET, NOW.getTime());
  assert.equal(claims?.leadId, PREVIEW_LEAD_ID);
  assert.equal(claims?.email, "previewuser@gmail.com");
  assert.equal(claims?.emailVerified, true);
  assert.equal(claims?.expiresAtMs, NOW.getTime() + INVITE_LINK_TTL_MS);
  assert.equal(claims?.jti === reservationInviteJti(PREVIEW_LEAD_ID), true);
  assert.equal(verifyReservationInvite(token, TEST_SECRET, NOW.getTime()), undefined);
  assert.equal(url.search.includes("utm_"), false);
});

test("a send keeps the invite expiry tied to the frozen first intent", async () => {
  const dir = await directory();
  const person = row({ email: "diver@example.com" });
  let tick = 0;
  const clock = () => {
    tick += 1;
    return new Date(NOW.getTime() + tick * 1000);
  };
  const resend = new FakeResend();
  const result = await runReservationMail(options(dir), {
    store: new FakeStore([person]),
    send: resend.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: clock,
    sleep: async () => undefined,
  });
  assert.equal(result.sent, 1);
  assert.equal(result.aborted, undefined);
  const html = resend.calls[0]?.html ?? "";
  const found = html.match(
    /https:\/\/watchdive\.diveroid\.com\/reservation\?lang=en#invite=([^"<\s]+)/,
  );
  assert.equal(Boolean(found), true);
  const token = decodeURIComponent(found?.[1] ?? "");
  assert.equal(html.includes("inviteToken="), false);
  assert.equal(html.includes("?token="), false);
  assert.equal(html.includes("email="), false);
  assert.equal(html.includes(RESERVATION_TOKEN_SECRET), false);
  const linked = new URL(found?.[0] ?? "https://watchdive.diveroid.com/reservation");
  assert.equal(linked.search.includes(token), false);
  const ledger = await readFile(join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "utf8");
  assert.equal(ledger.includes("@"), false);
  assert.equal(ledger.includes("v1."), false);
  const accepted = ledger
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { state: string; firstIntentAt: string })
    .filter((line) => line.state === "accepted");
  assert.equal(accepted.length > 0, true);
  const claims = verifyReservationInvite(token, RESERVATION_TOKEN_SECRET, NOW.getTime());
  assert.equal(claims?.leadId, person.leadId);
  assert.equal(claims?.email, "diver@example.com");
  assert.equal(
    claims?.expiresAtMs,
    Date.parse(accepted[0]?.firstIntentAt ?? "") + INVITE_LINK_TTL_MS,
  );
  const again = mintReservationInviteUrl({
    leadId: person.leadId,
    email: person.email,
    locale: "en",
    publicOrigin: TEST_ORIGIN,
    secret: RESERVATION_TOKEN_SECRET,
    firstIntentAtMs: Date.parse(accepted[0]?.firstIntentAt ?? ""),
    nowMs: NOW.getTime() + 60 * 60 * 1000,
  });
  const againToken = decodeURIComponent(new URL(again).hash.slice("#invite=".length));
  assert.equal(againToken === token, true);
  assert.equal(again.includes("inviteToken="), false);
  const summary = formatReservationSummary(result);
  assert.equal(summary.includes("v1."), false);
  assert.equal(summary.includes("#invite="), false);
});

test("send refuses when the reservation token secret is missing", async () => {
  const dir = await directory();
  let sent = false;
  const missing = await runReservationMail(options(dir), {
    store: new FakeStore([row()]),
    send: async () => {
      sent = true;
    },
    signInvite: signerFor(),
    env: TEST_ENV,
    now: () => NOW,
  });
  assert.equal(missing.aborted, "invite_secret_missing");
  assert.equal(sent, false);
  assert.equal(missing.tokenSecretReady, false);
  const dry = await runReservationMail(options(dir, { mode: "dry-run" }), {
    store: new FakeStore([row()]),
    send: async () => {
      sent = true;
    },
    signInvite: signerFor(),
    env: TEST_ENV,
    now: () => NOW,
  });
  assert.equal(dry.aborted, undefined);
  assert.equal(dry.eligible, 1);
  assert.equal(dry.samplesUnsigned, true);
  assert.equal(sent, false);
  assert.ok(dry.sendBlockers.some((line) => /WATCHDIVE_RESERVATION_TOKEN_SECRET/.test(line)));
  assert.equal(formatReservationSummary(dry).includes(RESERVATION_TOKEN_SECRET), false);
});

test("provider send goes through Resend with the stable idempotency key", async () => {
  let idempotency = "";
  let operationLogged = false;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    operationLogged = JSON.stringify(args).includes("reservation_mail");
  };
  try {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      idempotency = headers["Idempotency-Key"] ?? "";
      return new Response(JSON.stringify({ id: "msg_test_1" }), { status: 200 });
    }) as typeof fetch;
    await deliverReservationMessage(
      { RESEND_API_KEY: "re_test_key", WATCHDIVE_EMAIL_FROM: "verify@mail.oceanwick.ai" },
      {
        to: "person@example.com",
        subject: "Reserve WatchDive — USD $3, then USD $149",
        html: "<p>USD $3</p>",
        text: "The $3 reservation fee is extra.",
        headers: {},
        tags: [{ name: "campaign", value: RESERVATION_CAMPAIGN_ID }],
        idempotencyKey: reservationIdempotencyKey(PREVIEW_LEAD_ID),
      },
      fetchImpl,
      async () => undefined,
    );
  } finally {
    console.error = original;
  }
  assert.equal(idempotency, reservationIdempotencyKey(PREVIEW_LEAD_ID));
  assert.equal(operationLogged, false);
});

test("CLI defaults to dry run and refuses an unconfirmed send", async () => {
  const parsed = parseCli([]);
  assert.equal(parsed.ok && parsed.options.mode, "dry-run");
  const send = parseCli(["--send"]);
  assert.equal(send.ok, false);
  const confirmed = parseCli([
    "--send",
    "--confirm-campaign",
    RESERVATION_CAMPAIGN_ID,
    "--postal-address",
    POSTAL,
  ]);
  assert.equal(confirmed.ok && confirmed.options.mode, "send");
  if (confirmed.ok) {
    assert.equal(confirmed.options.postalAddress, RESERVATION_REGISTERED_OFFICE);
    assert.equal(confirmed.options.legalName, RESERVATION_LEGAL_NAME);
  }
  const mismatch = parseCli(["--postal-address", "1 Wrong Road, Test City"]);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.error.includes("Wrong Road"), false);
  const wrong = parseCli(["--send", "--confirm-campaign", "other-campaign"]);
  assert.equal(wrong.ok, false);
  const lines: string[] = [];
  const code = await main(["--help"], {}, (line) => lines.push(line));
  assert.equal(code, 0);
  assert.match(lines.join("\n"), new RegExp(RESERVATION_CAMPAIGN_ID));
  assert.match(lines.join("\n"), /WATCHDIVE_RESERVATION_TOKEN_SECRET/);
  assert.match(lines.join("\n"), /issueReservationInvite/);
  assert.match(lines.join("\n"), /fragment/);
  assert.equal(lines.join("\n").includes("inviteToken"), false);
  const missing = await main(
    ["--send", "--confirm-campaign", RESERVATION_CAMPAIGN_ID],
    {},
    () => undefined,
  );
  assert.equal(missing, 2);
  assert.equal(UNSIGNED_PREVIEW_TOKEN.includes("@"), false);
});

test("an unknown provider outcome is held and is not retried inside the window", async () => {
  const dir = await directory();
  const person = row();
  const store = new FakeStore([person]);
  const resend = new FakeResend();
  resend.status = 0;
  const deps = {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  };
  const first = await runReservationMail(options(dir), deps);
  assert.equal(first.unresolved, 1);
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 0);
  assert.match(store.writes.at(-1)?.value ?? "", /hold unknown_outcome/);
  resend.status = null;
  const second = await runReservationMail(options(dir), deps);
  assert.equal(resend.calls.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped.held, 1);
});

test("a clear provider rejection is not replayed inside the window", async () => {
  const dir = await directory();
  const person = row();
  const store = new FakeStore([person]);
  const resend = new FakeResend();
  resend.status = 400;
  const deps = {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  };
  const first = await runReservationMail(options(dir), deps);
  assert.equal(first.failed, 1);
  assert.equal(first.sent, 0);
  assert.match(store.writes.at(-1)?.value ?? "", /failed provider_rejected/);
  resend.status = null;
  const second = await runReservationMail(options(dir), deps);
  assert.equal(resend.calls.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.unresolved, 1);
});

test("an unexpected error is the same hold as an unknown outcome", async () => {
  const dir = await directory();
  const store = new FakeStore([row()]);
  const resend = new FakeResend();
  resend.boom = new Error("socket hang up");
  const first = await runReservationMail(options(dir), {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(first.unresolved, 1);
  assert.equal(first.failureClasses.unexpected_error, 1);
  assert.match(store.writes.at(-1)?.value ?? "", /hold unknown_outcome/);
  resend.boom = null;
  const second = await runReservationMail(options(dir), {
    store,
    send: resend.send,
    signInvite: signerFor(),
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(resend.calls.length, 1);
  assert.equal(second.sent, 0);
});

const LOWEST_WORD: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  en: "lowest",
  ko: "최저",
  "zh-CN": "最低",
  "zh-TW": "最低",
  ja: "最安",
  es: "mínimo",
  fr: "plus bas",
  de: "niedrigst",
  "pt-BR": "menor",
};

function claimsEmail(html: string): string | undefined {
  const linked = html.match(/#invite=([^"'&\s]+)/);
  if (!linked?.[1]) return undefined;
  const token = decodeURIComponent(linked[1]);
  return verifyReservationInvite(token, RESERVATION_TOKEN_SECRET, NOW.getTime())?.email;
}

test("every preview names the company number and the lowest launch price", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const mail = renderReservationMail({
      locale,
      inviteUrl: buildReservationInviteUrl(TEST_ORIGIN, locale, SECRET_TOKEN),
      unsubscribeUrl: `${TEST_ORIGIN}/unsubscribe/example-token-value-0001`,
      privacyUrl: `${TEST_ORIGIN}/${locale}/privacy`,
      termsUrl: `${TEST_ORIGIN}/${locale}/terms`,
    });
    const visible = `${mail.html}\n${mail.text}`;
    assert.match(visible, /DIVEROID LTD/, locale);
    assert.match(visible, new RegExp(RESERVATION_COMPANY_NUMBER), locale);
    assert.match(visible, /E6 2JA/, locale);
    assert.equal(visible.includes(LOWEST_WORD[locale]), true, locale);
    assert.equal(mail.html.includes(RESERVATION_COPY[locale].preheader), true, locale);
  }
  assert.throws(
    () =>
      renderReservationMail({
        locale: "en",
        inviteUrl: buildReservationInviteUrl(TEST_ORIGIN, "en", SECRET_TOKEN),
        unsubscribeUrl: `${TEST_ORIGIN}/unsubscribe/example-token-value-0001`,
        privacyUrl: `${TEST_ORIGIN}/en/privacy`,
        termsUrl: `${TEST_ORIGIN}/en/terms`,
        legalName: "Not The Company Ltd",
      }),
    /merchant identity mismatch/,
  );
});

test("custom-domain plus and dotted addresses stay distinct, and Gmail aliases do not", async () => {
  const dir = await directory();
  const tagged = row({ email: "  Diver+tag@example.com " });
  const plain = row({ email: "diver@example.com" });
  const dotted = row({ email: "a.b@example.com" });
  const undotted = row({ email: "ab@example.com" });
  const resend = new FakeResend();
  const sent = await runReservationMail(options(dir), {
    store: new FakeStore([tagged, plain, dotted, undotted]),
    send: resend.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(sent.sent, 4);
  assert.deepEqual(
    resend.calls.map((call) => call.to),
    ["Diver+tag@example.com", "diver@example.com", "a.b@example.com", "ab@example.com"],
  );
  assert.equal(claimsEmail(resend.calls[0]?.html ?? ""), "diver+tag@example.com");
  assert.equal(claimsEmail(resend.calls[2]?.html ?? ""), "a.b@example.com");
  assert.equal(claimsEmail(resend.calls[3]?.html ?? ""), "ab@example.com");

  const gmailDir = await directory();
  const alias = row({ email: "A.B+left@gmail.com" });
  const collapsed = row({ email: "ab@gmail.com" });
  const gmail = new FakeResend();
  const once = await runReservationMail(options(gmailDir), {
    store: new FakeStore([alias, collapsed]),
    send: gmail.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(once.sent, 1);
  assert.equal(once.skipped.duplicate_address, 1);
  assert.equal(gmail.calls[0]?.to, "A.B+left@gmail.com");
  assert.equal(claimsEmail(gmail.calls[0]?.html ?? ""), "ab@gmail.com");

  const held = selectAudience([
    row({ email: "a.b+x@gmail.com", launchMail: "unsubscribed 2026-10-01T00:00:00.000Z" }),
    row({ email: "ab@gmail.com" }),
    row({ email: "a.b@googlemail.com" }),
  ]);
  assert.equal(held.recipients.length, 0);
  assert.equal(held.skipped.unsubscribed_address, 2);

  const separate = selectAudience([
    row({ email: "person@example.com", status: "unsubscribed" }),
    row({ email: "person+tag@example.com" }),
  ]);
  assert.deepEqual(
    separate.recipients.map((item) => item.row.email),
    ["person+tag@example.com"],
  );
});

test("a Gmail receipt holds the alias, and a sent marker still blocks when the ledger is missing", async () => {
  const dir = await directory();
  const older = row({ email: "A.B+left@gmail.com" });
  const younger = row({ email: "ab@gmail.com" });
  await writeFile(
    join(dir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: younger.leadId,
      state: "accepted",
      at: "2026-10-18T03:00:00.000Z",
      firstIntentAt: "2026-10-18T03:00:00.000Z",
      notion: "ok",
    })}\n`,
  );
  const resend = new FakeResend();
  const store = new FakeStore([older, younger]);
  const result = await runReservationMail(options(dir), {
    store,
    send: resend.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(resend.calls.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.unresolved, 0);
  assert.equal(older.reservationMail, undefined);
  assert.equal(
    store.writes.some((write) => write.pageId === older.pageId),
    false,
  );

  const stalledDir = await directory();
  const eligible = row({ email: "ab@gmail.com" });
  const hidden = row({ email: "a.b+x@gmail.com", duplicate: true });
  await writeFile(
    join(stalledDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`),
    `${JSON.stringify({
      v: 1,
      campaignId: RESERVATION_CAMPAIGN_ID,
      leadId: hidden.leadId,
      state: "failed",
      at: "2026-10-18T03:00:00.000Z",
      firstIntentAt: "2026-10-18T03:00:00.000Z",
      notion: "ok",
      failureClass: "provider_rejected",
    })}\n`,
  );
  const stalledSend = new FakeResend();
  const stalledStore = new FakeStore([eligible, hidden]);
  const stalled = await runReservationMail(options(stalledDir), {
    store: stalledStore,
    send: stalledSend.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(stalledSend.calls.length, 0);
  assert.equal(stalled.sent, 0);
  assert.equal(stalled.unresolved, 0);
  assert.equal(eligible.reservationMail, undefined);

  const markedDir = await directory();
  const marked = row({
    reservationMail: `${RESERVATION_CAMPAIGN_ID} sent 2026-10-18T03:00:00.000Z`,
  });
  const markedSend = new FakeResend();
  const markedResult = await runReservationMail(options(markedDir), {
    store: new FakeStore([marked]),
    send: markedSend.send,
    env: MAIL_ENV,
    liveGate: passLiveGate,
    now: () => NOW,
    sleep: async () => undefined,
  });
  assert.equal(markedSend.calls.length, 0);
  assert.equal(markedResult.sent, 0);
  assert.equal(markedResult.eligible, 0);

  const olderAlias = row({ email: "ab@gmail.com" });
  const other = row({ email: "other@example.com" });
  const youngerAlias = row({ email: "a.b@gmail.com" });
  const ordered = selectAudience([olderAlias, other, youngerAlias], {
    leadHasReceipt: (leadId) => leadId === youngerAlias.leadId,
  });
  assert.deepEqual(
    ordered.recipients.map((item) => item.row.leadId),
    [youngerAlias.leadId, other.leadId],
  );

  const readme = await readFile(
    new URL("../docs/reservation-mail-operations/README.md", import.meta.url),
    "utf8",
  );
  assert.match(readme, /operator destruction of the only two records/);
  assert.match(readme, /does not add a third production store/);
});
