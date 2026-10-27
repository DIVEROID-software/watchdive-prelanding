import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DRIP_STAGES, DRIP_FIELD, DAY, dripHold, dripEnabled } from "../src/lib/reservation-drip/policy.ts";
import { DRIP_COPY_HASH, renderDripMail } from "../src/lib/reservation-drip/render.ts";
import { createDripStore } from "../src/lib/reservation-drip/store.ts";
import { stripeAllowsDrip } from "../src/lib/reservation-drip/payment.ts";
import { runReservationDrip } from "../src/lib/reservation-drip/run.ts";
import { sentMarker, RESERVATION_CAMPAIGN_ID } from "../src/lib/reservation-mail/campaign.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { RESERVATION_COPY } from "../src/lib/reservation-mail/copy.ts";
import { renderReservationMail } from "../src/lib/reservation-mail/render.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import type { StripeApi } from "../src/lib/reservation/stripeApi.ts";
import { TEST_ENV } from "./helpers/fakes.ts";

const verifiedAt = "2026-10-26T00:00:00.000Z";
const NOW = Date.parse(verifiedAt) + 8 * DAY;
const marker = (at: number) => sentMarker(new Date(at));
const rich = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] });
function fixture() {
  const properties: any = {
    Email: { type: "title", title: [{ plain_text: "fixture@example.com" }] },
    "Lead ID": rich("aaaaaaaa-bbbb-4ccc-8ddd-000000000001"),
    "Verification status": { type: "select", select: { name: "verified" } },
    "Email verified": { type: "checkbox", checkbox: true },
    Suspect: { type: "checkbox", checkbox: false },
    "Verified at": { type: "date", date: { start: verifiedAt } },
    "Launch mail": rich(""),
    "Reservation paid": { type: "checkbox", checkbox: false },
    "Reservation mode": { type: "select", select: { name: "live" } },
    "Signup locale": rich("ko"),
  };
  for (const stage of DRIP_STAGES) properties[DRIP_FIELD[stage]] = rich("");
  const page = { id: "page-fixture", properties };
  const writes: any[] = [];
  const request: NotionRequest = async (method, path, body) => {
    if (method === "GET" && path.startsWith("databases/")) return { properties };
    if (method === "GET") return page;
    if (method === "POST") return { results: [page], has_more: false };
    if (method === "PATCH") {
      writes.push(body);
      for (const [key, value] of Object.entries((body as any).properties)) {
        properties[key] = rich((value as any).rich_text[0].text.content);
      }
      return page;
    }
    throw new Error("Unexpected operation");
  };
  return { page, request, writes };
}

test("drip preserves sequence, 24-hour gap and global opt-out", () => {
  assert.equal(dripHold("d0", {}, NOW), null);
  assert.equal(dripHold("d1", {}, NOW), "previous_not_sent");
  assert.equal(dripHold("d1", { d0: marker(NOW - DAY + 1) }, NOW), "minimum_gap");
  assert.equal(dripHold("d1", { d0: marker(NOW - DAY) }, NOW), null);
  assert.equal(dripHold("d3", { d0: marker(NOW - 4 * DAY) }, NOW), "previous_not_sent");
  assert.equal(dripHold("d7", { d0: "unsubscribed" }, NOW), "history_held");
  assert.equal(dripHold("d0", { d7: "unknown manual status" }, NOW), "history_held");
  assert.equal(dripHold("d1", { d0: marker(NOW + 1) }, NOW), "previous_time_invalid");
});

test("sender stays off without matching copy approval and verified scheduler cutover", () => {
  assert.equal(dripEnabled({}, DRIP_COPY_HASH), false);
  const env = { WATCHDIVE_RESERVATION_DRIP_ENABLED: "true", WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: DRIP_COPY_HASH };
  assert.equal(dripEnabled(env, DRIP_COPY_HASH), false);
  assert.equal(dripEnabled({ ...env, WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true" }, DRIP_COPY_HASH), true);
  assert.equal(dripEnabled({ ...env, WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true" }, "changed-copy"), false);
});

test("36 localized drafts retain terms and D0 is byte-identical to legacy", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const input = { locale, inviteUrl: `https://watchdive.diveroid.com/reservation?lang=${locale}#invite=preview`, unsubscribeUrl: "https://watchdive.diveroid.com/unsubscribe", privacyUrl: "https://watchdive.diveroid.com/privacy", termsUrl: "https://watchdive.diveroid.com/terms" };
    for (const stage of DRIP_STAGES) {
      const mail = renderDripMail(stage, input);
      const blob = `${mail.subject}\n${mail.text}\n${mail.html}`;
      assert.equal(blob.includes(RESERVATION_COPY[locale].disclosure), false, `${locale} ${stage} disclosure`);
      assert.ok(mail.html.includes(RESERVATION_COPY[locale].unsubscribe), `${locale} ${stage}`);
      assert.ok(mail.html.includes("DIVEROID LTD"));
      assert.ok(mail.html.includes("https://watchdive.diveroid.com/unsubscribe"));
      assert.ok(mail.html.includes("watchdive-underwater.jpg"));
      assert.equal(mail.html.includes("font-size:64px"), false);
      assert.equal(/[\r\n]/.test(mail.subject), false);
      assert.equal(/\$179\b|179 \$/.test(blob), false, `${locale} ${stage}`);
      assert.doesNotMatch(blob, /regardless of your place|순서에 관계없이|not a product|제품이 아닙니다|100 backers|last chance|ends tonight|only today/i);
      if (stage === "d3") assert.match(`${mail.subject}\n${mail.text}`, locale === "fr" ? /200 \$/ : /\$200/);
      if (stage === "d7") assert.doesNotMatch(mail.subject, /마감|最后机会|最後機會|最後のチャンス|dernière chance|última oportunidad|letzte Chance|última chance/i);
      if (stage === "d0") assert.deepEqual(mail, renderReservationMail(input));
    }
  }
});

test("stage adapter persists only its own field and preserves verification timestamp", async () => {
  const f = fixture();
  f.page.properties[DRIP_FIELD.d0] = rich(marker(NOW - 2 * DAY));
  const store = createDripStore(f.request, "db", "d1", () => new Date(NOW));
  const row = await store.readRow("page-fixture");
  assert.equal(row?.verifiedAt, verifiedAt);
  assert.equal(row?.reservationMail, undefined);
  await store.recordReservationMail("page-fixture", marker(NOW));
  assert.deepEqual(Object.keys(f.writes[0].properties), [DRIP_FIELD.d1]);
  assert.equal(f.page.properties[DRIP_FIELD.d0].rich_text[0].plain_text, marker(NOW - 2 * DAY));
});

test("missing stage schema and legacy unsubscribe fail closed", async () => {
  const f = fixture();
  delete f.page.properties[DRIP_FIELD.d7];
  const store = createDripStore(f.request, "db", "d1", () => new Date(NOW));
  assert.equal((await store.readSchema()).reservationMail, "missing");
  f.page.properties[DRIP_FIELD.d0] = rich("unsubscribed");
  assert.equal((await store.readRow("page-fixture"))?.reservationMail, "drip history hold");
});

test("Stripe preflight suppresses any completed reservation and does not create or refund", async () => {
  let paid = true;
  const stripe = {
    listCustomersByEmail: async () => [{ id: "cus_fixture", email: "fixture@example.com", metadata: {} }],
    listCheckoutSessions: async () => [{ livemode: true, metadata: { product: "watchdive_reservation_fee" }, paymentStatus: paid ? "paid" : "unpaid", status: paid ? "complete" : "expired" }],
  } as unknown as StripeApi;
  assert.equal(await stripeAllowsDrip(stripe, "fixture@example.com"), false);
  paid = false;
  assert.equal(await stripeAllowsDrip(stripe, "fixture@example.com"), true);
  await assert.rejects(() => stripeAllowsDrip({ listCustomersByEmail: async () => { throw new Error("Stripe offline"); } } as unknown as StripeApi, "fixture@example.com"));
});

async function runnerFixture() {
  const f = fixture();
  const root = await mkdtemp(join(tmpdir(), "wd-drip-test-"));
  const legacyReceiptDir = join(root, "legacy");
  await mkdir(legacyReceiptDir);
  await writeFile(join(legacyReceiptDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), JSON.stringify({v:1,campaignId:RESERVATION_CAMPAIGN_ID,leadId:"aaaaaaaa-bbbb-4ccc-8ddd-000000000099",state:"accepted",at:verifiedAt,firstIntentAt:verifiedAt,notion:"ok"})+"\n");
  const env = { ...TEST_ENV, WATCHDIVE_RESERVATION_TOKEN_SECRET: "fixture-reservation-secret-32characters", WATCHDIVE_RESERVATION_DRIP_ENABLED: "true", WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: DRIP_COPY_HASH, WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true" };
  const messages: any[] = [];
  const options = { mode: "send" as const, legacyReceiptDir, dripReceiptDir: join(root, "drip"), notBefore: verifiedAt };
  const deps = { env, request: f.request, databaseId: "db", stripe: { listCustomersByEmail: async () => [] } as unknown as StripeApi, now: () => new Date(NOW), liveGate: async () => ({ ok: true as const }), send: async (m: any) => { messages.push(m); } };
  return { ...f, options, deps, messages };
}

test("late signup gets only D0, rerun does not resend and D1 uses distinct provider identity", async () => {
  const f = await runnerFixture();
  const first = await runReservationDrip(f.options, f.deps);
  assert.equal(first.aborted, undefined);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].idempotencyKey.endsWith("-d1"), false);
  await runReservationDrip(f.options, f.deps);
  assert.equal(f.messages.length, 1);
  f.deps.now = () => new Date(NOW + DAY);
  await runReservationDrip(f.options, f.deps);
  assert.equal(f.messages.length, 2);
  assert.ok(f.messages[1].idempotencyKey.endsWith("-d1"));
  assert.match(`${f.messages[1].text}\n${f.messages[1].html}`, /\$3로 \$149 보장받기/);
  assert.ok(f.page.properties[DRIP_FIELD.d1].rich_text[0].plain_text.includes("sent"));
});

test("a fresh Stripe payment or unknown Stripe state prevents provider delivery", async () => {
  const f = await runnerFixture();
  let reads = 0;
  f.deps.stripe = {
    listCustomersByEmail: async () => { reads++; return [{ id: "cus", email: "fixture@example.com", metadata: {} }]; },
    listCheckoutSessions: async () => [{ livemode: true, metadata: { product: "watchdive_reservation_fee" }, paymentStatus: "paid", status: "complete" }],
  } as unknown as StripeApi;
  await runReservationDrip(f.options, f.deps);
  assert.ok(reads > 0);
  assert.equal(f.messages.length, 0);
  f.deps.stripe = { listCustomersByEmail: async () => { throw new Error("offline"); } } as unknown as StripeApi;
  await runReservationDrip(f.options, f.deps);
  assert.equal(f.messages.length, 0);
});

test("dry-run never calls Stripe or provider and does not write Notion", async () => {
  const f = await runnerFixture();
  f.deps.stripe = { listCustomersByEmail: async () => { throw new Error("must not call"); } } as unknown as StripeApi;
  const result = await runReservationDrip({ ...f.options, mode: "dry-run" }, f.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(result.stages.length, 4);
  assert.equal(f.messages.length, 0);
  assert.equal(f.writes.length, 0);
});


test("empty legacy ledger refuses send instead of silently resetting history", async () => {
  const f = await runnerFixture();
  await writeFile(join(f.options.legacyReceiptDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`), "");
  const result = await runReservationDrip(f.options, f.deps);
  assert.equal(result.aborted, "existing_d0_receipt_ledger_required");
  assert.equal(f.messages.length, 0);
});

test("paid history with missing or changed product metadata still suppresses acquisition", async () => {
  for (const metadata of [{}, {product:"old_offer"}]) {
    const stripe = {listCustomersByEmail:async()=>[{id:"cus",email:"fixture@example.com"}],listCheckoutSessions:async()=>[{livemode:true,metadata,paymentStatus:"paid",status:"complete"}]} as unknown as StripeApi;
    assert.equal(await stripeAllowsDrip(stripe,"fixture@example.com"),false);
  }
});

test("all four delayed stages send once and failed history stops later stages", async () => {
  const f = await runnerFixture();
  for (let n=0;n<4;n++) {
    f.deps.now=()=>new Date(NOW+n*DAY);
    await runReservationDrip(f.options,f.deps);
    assert.equal(f.messages.length,n+1);
  }
  await runReservationDrip(f.options,f.deps);
  assert.equal(f.messages.length,4);
  assert.ok(f.messages[2].idempotencyKey.endsWith("-d3"));
  assert.ok(f.messages[3].idempotencyKey.endsWith("-d7"));
  const blocked = await runnerFixture();
  blocked.page.properties[DRIP_FIELD.d0]=rich("failed unknown_outcome");
  await runReservationDrip(blocked.options,blocked.deps);
  assert.equal(blocked.messages.length,0);
});

test("fresh sibling alias unsubscribe prevents a previously selected inbox send", async () => {
  const f=fixture();
  f.page.properties.Email={type:"title",title:[{plain_text:"a.b+one@gmail.com"}]};
  const sibling=structuredClone(f.page);sibling.id="sibling";
  sibling.properties.Email={type:"title",title:[{plain_text:"ab+two@googlemail.com"}]};
  sibling.properties["Lead ID"]=rich("aaaaaaaa-bbbb-4ccc-8ddd-000000000002");
  const request:NotionRequest=async(method,path,body)=>method==="POST"?{results:[f.page,sibling],has_more:false}:method==="GET"&&path==="pages/sibling"?sibling:f.request(method,path,body);
  const store=createDripStore(request,"db","d0",()=>new Date(NOW));
  const rows=await store.listRows(await store.readSchema());
  assert.equal(await store.recheckInbox(rows[0]),true);
  sibling.properties["Launch mail"]=rich("unsubscribed");
  assert.equal(await store.recheckInbox(rows[0]),false);
});
