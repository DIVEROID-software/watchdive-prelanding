import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import { FakeLeadStore, FakeMailer, TEST_ORIGIN, TEST_SECRET } from "./helpers/fakes.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { parseVerificationToken } from "../src/lib/verification/token.ts";
import { MEASUREMENT_CONSENT_WITHHELD } from "../src/lib/verification/contracts.ts";
import type { ConfirmationDeps, ConfirmationResult } from "../src/lib/instantForm/relay/adapter.ts";
import { parseAllowlist, type AllowlistForm } from "../src/lib/instantForm/relay/allowlist.ts";
import { signConfirmation, memoryNonces } from "../src/lib/instantForm/relay/auth.ts";
import { EMAIL_CONSENT_KEY, EMAIL_CONSENT_VERSION, registryNames, SIGNATURE_HEADER } from "../src/lib/instantForm/relay/constants.ts";
import { confirmationIdempotencyKey, emailKey } from "../src/lib/instantForm/relay/intent.ts";
import { memoryLedger } from "../src/lib/instantForm/relay/ledger.ts";
import { handleNativeConfirmation } from "../src/lib/instantForm/relay/server.ts";
import { NATIVE_FORMS } from "../src/lib/instantForm/relay/registry.ts";
const NOW = new Date("2026-10-29T20:00:00.000Z");
const CONFIRMATION_SECRET = "instant-form-confirmation-secret-32b";
const MARKETS = [
  ["KR", "ko", "/ko"],
  ["SG", "en", "/"],
  ["NL", "nl", "/nl"],
  ["HK", "zh-TW", "/zh-tw"],
  ["JP", "ja", "/ja"],
  ["TW", "zh-TW", "/zh-tw"],
] as const;

const allowlist = parseAllowlist(
  MARKETS.map(([market, locale, path], index) => {
    const names = registryNames(market);
    const n = String(index + 1);
    return {
      form_id: `81000000000000${n}`,
      market,
      locale,
      campaign_id: `91000000000000${n}`,
      campaign_name: names.campaign_name,
      utm_campaign: names.utm_campaign,
      adset_id: `92000000000000${n}`,
      adset_name: names.adset_name,
      landing_path: path,
      test: false,
      ads: [
        {
          ad_id: `93000000000000${n}`,
          adset_id: `92000000000000${n}`,
          campaign_id: `91000000000000${n}`,
          segment: index % 2 === 0 ? "scuba" : "freediving",
        },
      ],
    };
  }),
);
if (!allowlist.ok) throw new Error("fixture allowlist rejected");
const forms = allowlist.forms;

function env(overrides: Record<string, string> = {}) {
  return {
    INSTANT_FORM_CONFIRMATION_ENABLED: "1",
    RESEND_API_KEY: "fake", NOTION_API_KEY: "fake", NOTION_WAITLIST_DB_ID: "fake",
    INSTANT_FORM_CONFIRMATION_DRY_RUN: "0",
    INSTANT_FORM_CONFIRMATION_SECRET: CONFIRMATION_SECRET,
    INSTANT_FORM_PROSPECTIVE_NOT_BEFORE: "2026-10-29T00:00:00.000Z",
    WATCHDIVE_VERIFICATION_SECRET: TEST_SECRET,
    WATCHDIVE_PUBLIC_ORIGIN: TEST_ORIGIN,
    WATCHDIVE_EMAIL_FROM: "DIVEROID <help@diveroid.com>",
    ...overrides,
  };
}

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}${String(sequence).padStart(6, "0")}`;
}

function bodyFor(form: AllowlistForm, patch: Record<string, unknown> = {}): string {
  const email = `diver${sequence}@example.com`;
  sequence += 1;
  const ad = form.ads[0];
  if (!ad) throw new Error("fixture ad missing");
  const canonical = email;
  const intent = {
    submitted_at: NOW.toISOString(),
    canonical_email: canonical,
    submitted_email: email,
    locale: form.locale,
    market: form.market,
    source: "meta_instant_form",
    notion_source_select: "instant-form",
    acquisition_path: "instant_form",
    utm_source: "meta",
    utm_medium: "paid_social",
    utm_campaign: form.utm_campaign,
    landing_path: form.landing_path,
    leadgen_id: nextId("94"),
    form_id: form.form_id,
    ad_id: ad.ad_id,
    adset_id: ad.adset_id,
    campaign_id: ad.campaign_id,
    segment: ad.segment,
    observed_campaign_id: ad.campaign_id,
    paid_attribution: true,
    resend: false,
    phone_present: false,
    phone_e164: null,
    phone_unparsed: false,
    sms_consent_claimed: false,
    sms_consent_version: null,
    sms_send: false,
    email_consent_key: EMAIL_CONSENT_KEY,
    email_consent_version: EMAIL_CONSENT_VERSION,
    email_key: emailKey(canonical),
    idempotency_key: confirmationIdempotencyKey(canonical),
    email_verified: false,
    measurement_consent: false,
    stage_score_emit: false,
    custom_conversion_emit: false,
    verified_count_delta: 0,
    ...patch,
  };
  if (patch.canonical_email || patch.submitted_email) {
    const submitted = String(intent.submitted_email);
    const canonicalEmailValue = String(intent.canonical_email);
    intent.email_key = emailKey(canonicalEmailValue);
    intent.idempotency_key = confirmationIdempotencyKey(canonicalEmailValue);
    intent.submitted_email = submitted;
  }
  return JSON.stringify(intent);
}

function signature(raw: string, nonce = `nonce${String(sequence).padStart(18, "0")}`): string {
  return signConfirmation(CONFIRMATION_SECRET, raw, Math.floor(NOW.getTime() / 1000), nonce);
}

function harness(rawEnv = env()): {
  deps: ConfirmationDeps;
  store: FakeLeadStore;
  mailer: FakeMailer & { sent: Array<{ idempotencyKey?: string; token: string; leadId: string; locale: string }> };
  holds: string[];
  attributions: Record<string, unknown>[];
} {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const holds: string[] = [];
  const attributions: Record<string, unknown>[] = [];
  const deps: ConfirmationDeps = {
    env: rawEnv,
    now: () => NOW,
    allowlist: forms,
    store,
    mailer,
    requestVerification: requestVerificationService,
    writeAttribution: async (_pageId, properties) => {
      attributions.push(properties);
    },
    reminderSkipReason: (record) => (record.source === "instant-form" ? "native_one_mail" : undefined),
    ledger: memoryLedger(),
    nonces: memoryNonces(),
    sleep: async () => undefined,
    phoneHold: async (hold) => {
      holds.push(hold.phone_e164);
    },
  };
  return { deps, store, mailer, holds, attributions };
}


async function http(raw: string, deps: ConfirmationDeps, signatureValue?: string) {
 const signature = signatureValue ?? signConfirmation(CONFIRMATION_SECRET, raw, NOW.getTime()/1000, randomBytes(24).toString("base64url"));
 const response = await handleNativeConfirmation(new Request("https://test/api/internal/native-confirmation", {method:"POST",headers:{[SIGNATURE_HEADER]:signature},body:raw}), deps.env, deps);
 assert.match(response.headers.get("cache-control") ?? "", /no-store/);
 return {status:response.status, result: await response.json() as ConfirmationResult};
}
for (const form of NATIVE_FORMS) test(`native relay ${form.market}: one localized signed confirmation, atomic source, no conversion`, async () => {
 const {deps,store,mailer}=harness(); deps.allowlist=NATIVE_FORMS;
 const raw=bodyFor(form);
 const first=await http(raw,deps);
 assert.equal(first.result.result,"confirmation_requested"); assert.equal(first.result.mail_provider_sends,1);
 assert.equal(mailer.sent.length,1); assert.equal(mailer.sent[0].locale,form.locale);
 const token=parseVerificationToken(mailer.sent[0].token,TEST_SECRET,NOW.getTime());
 assert.equal(token?.locale,form.locale); assert.equal(token?.measurementConsent,false);
 assert.equal(store.createPendingInputs[0].source,"instant-form");
 assert.equal(store.createPendingInputs[0].nativeCrm?.adId,form.ads[0].ad_id);
 assert.equal(store.createPendingInputs[0].measurementState,MEASUREMENT_CONSENT_WITHHELD);
 const again=await http(raw,deps); assert.equal(again.result.result,"duplicate"); assert.equal(mailer.sent.length,1);
 assert.equal(first.result.custom_conversion_emit,false); assert.equal(first.result.email_verified,false);
});
test("unauthorized, stale, altered campaign, withdrawn email checkbox and legacy custom phone cannot send",async()=>{
 for(const patch of [{campaign_id:"120251732832820215"},{email_consent_key:""},{phone_present:true},{resend:true},{submitted_at:undefined}]){
  const {deps,mailer}=harness(); const got=await http(bodyFor(forms[0],patch),deps); assert.equal(got.result.mail_sent,false); assert.equal(mailer.sent.length,0);
 }
 const {deps,mailer}=harness(); const raw=bodyFor(forms[0]);
 assert.equal((await http(raw,deps,"bad")).status,401);
 const stale=signConfirmation(CONFIRMATION_SECRET,raw,NOW.getTime()/1000-301,"abcdefghijklmnopqrstuvwx");
 assert.equal((await http(raw,deps,stale)).status,401); assert.equal(mailer.sent.length,0);
});
test("CRM lookup failure does not send; an existing website source is not attached to a paid ad",async()=>{
 const a=harness();a.store.failListByAddress=true; const got=await http(bodyFor(forms[0]),a.deps);assert.equal(got.result.outcome,"known_not_sent");assert.equal(a.mailer.sent.length,0);
 const b=harness();b.store.seed({email:"prior@example.com",canonical:"prior@example.com",source:"hero"});
 const repeat=await http(bodyFor(forms[0],{submitted_email:"prior@example.com",canonical_email:"prior@example.com"}),b.deps);
 assert.equal(repeat.result.result,"website_row_untouched");assert.equal(b.mailer.sent.length,0);assert.equal(b.store.createPendingInputs.length,0);
});
test("owner fixture requires exact private recipient hash and has no paid IDs",async()=>{
 const {deps,store,mailer}=harness();const email="owner-qa@example.com";
 const raw=JSON.stringify({qa:true,email,locale:"nl"});
 assert.equal((await http(raw,deps)).status,403);
 deps.env.INSTANT_FORM_OWNER_QA_HASH=createHash("sha256").update(email).digest("hex");
 const result=await http(raw,deps);assert.equal(result.result.mail_provider_sends,1);
 assert.equal(store.createPendingInputs[0].nativeCrm,undefined); assert.equal(store.createPendingInputs[0].suspect,true);
 assert.equal(store.createPendingInputs[0].source,"instant-form"); assert.equal(store.createPendingInputs[0].attribution?.utmCampaign,"instant_form_qa_20261030");
 assert.equal(mailer.sent[0].locale,"nl"); assert.equal((await http(raw,deps)).result.mail_provider_sends,0);
});
