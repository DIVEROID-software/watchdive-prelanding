import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consentedPhone,
  phoneRetryDraft,
  recordInitialPhoneConsent,
  type InitialPhoneSave,
} from "../src/components/initial-phone-consent.ts";
import { PHONE_CONSENT_VERSION } from "../src/lib/phoneOptInCopy.ts";
import { savePhoneOptInService, type PhoneOptInInput } from "../src/lib/verification/phoneOptIn.ts";
import { signPollHandle } from "../src/lib/verification/token.ts";
import { FakeLeadStore, TEST_ENV, TEST_SECRET } from "./helpers/fakes.ts";

const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const now = new Date("2026-10-26T01:00:00Z");
const handle = signPollHandle(leadId, now.getTime(), false, TEST_SECRET);
const credential = { kind: "attempt" as const, value: handle };
const draft = {
  phone: "07700 900123",
  country: "GB",
  consent: true,
  locale: "en" as const,
};

function setup() {
  const store = new FakeLeadStore();
  const row = store.seed({
    email: "test@example.com",
    canonical: "test@example.com",
    leadId,
    emailVerified: false,
    status: "pending",
  });
  let writes = 0;
  const write = store.recordPhoneOptIn.bind(store);
  store.recordPhoneOptIn = async (pageId, phone, consent) => {
    writes += 1;
    return write(pageId, phone, consent);
  };
  const save: InitialPhoneSave = (input) =>
    savePhoneOptInService(input, {
      store,
      env: TEST_ENV,
      now: () => now,
      sleep: async () => {},
      gate: () => true,
    });
  return { store, row, save, writes: () => writes };
}

test("a consented initial phone completes only from the confirmed save", async () => {
  const { store, row, save } = setup();
  const outcome = await recordInitialPhoneConsent(draft, credential, save);
  assert.deepEqual(outcome, { action: "saved", completed: true, retry: false, status: "accepted" });
  const saved = (await store.reread(row.pageId))!;
  assert.equal(saved.phone, "+447700900123");
  assert.equal(JSON.parse(saved.smsConsent!).version, PHONE_CONSENT_VERSION);
  assert.equal(consentedPhone({ ...draft, consent: false }), null);
});

test("missing consent, a blank number, and an invalid number never call save", async () => {
  const save: InitialPhoneSave = async () => {
    throw new Error("save must not be called");
  };
  for (const candidate of [
    { ...draft, consent: false },
    { ...draft, phone: "   " },
    { ...draft, phone: "not-a-number" },
  ]) {
    assert.equal(consentedPhone(candidate), null);
    assert.deepEqual(await recordInitialPhoneConsent(candidate, credential, save), {
      action: "skipped",
      completed: false,
      retry: false,
    });
  }
  assert.deepEqual(await recordInitialPhoneConsent(draft, null, save), {
    action: "skipped",
    completed: false,
    retry: false,
  });
});

test("a refused, unconfirmed, or thrown save stays incomplete and asks for retry", async () => {
  const { save, row } = setup();
  for (const status of ["invalid", "expired", "retry"] as const) {
    const refused: InitialPhoneSave = async () => ({ status });
    const outcome = await recordInitialPhoneConsent(draft, credential, refused);
    assert.equal(outcome.completed, false);
    assert.equal(outcome.retry, true);
    assert.equal(outcome.action, "retry");
  }
  const thrown = await recordInitialPhoneConsent(draft, credential, async () => {
    throw new Error("network");
  });
  assert.deepEqual(thrown, { action: "retry", completed: false, retry: true, status: "failed" });
  const lost = await recordInitialPhoneConsent(draft, credential, (input: PhoneOptInInput) =>
    savePhoneOptInService(input, {
      store: {
        ...setup().store,
        findByLeadId: async () => row,
        recordPhoneOptIn: async () => {
          throw new Error("notion down");
        },
        reread: async () => row,
      },
      env: TEST_ENV,
      now: () => now,
      sleep: async () => {},
      gate: () => true,
    }),
  );
  assert.equal(lost.completed, false);
  assert.equal(lost.retry, true);
  assert.equal(row.phone, "");
  assert.deepEqual(
    phoneRetryDraft({ phone: draft.phone, country: "GB", consent: true }, true, false),
    { phone: draft.phone, country: "GB", consent: true, unsuccessful: true },
  );
  assert.equal(
    phoneRetryDraft({ phone: draft.phone, country: "GB", consent: true }, true, true),
    undefined,
  );
  assert.equal(
    phoneRetryDraft({ phone: draft.phone, country: "GB", consent: false }, true, false),
    undefined,
  );
});

test("repeating a confirmed save does not write another consent", async () => {
  const { store, row, save, writes } = setup();
  const first = await recordInitialPhoneConsent(draft, credential, save);
  const consent = (await store.reread(row.pageId))!.smsConsent;
  const second = await recordInitialPhoneConsent(draft, credential, save);
  assert.equal(first.completed, true);
  assert.equal(second.completed, true);
  assert.equal(writes(), 1);
  assert.equal((await store.reread(row.pageId))!.smsConsent, consent);
  assert.equal((await store.reread(row.pageId))!.phone, "+447700900123");
});

test("the signup form does not send a phone on join or complete the card from the checkbox", () => {
  const page = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const form = page.slice(page.indexOf("export function EmailForm("), page.indexOf("function HeroProof("));
  const submit = form.slice(
    form.indexOf("const submit = async"),
    form.indexOf("async function allowMeasurementAfterSubmit"),
  );
  assert.equal(/\bphone\s*:/.test(submit), false);
  assert.equal(form.includes("phoneAdded || Boolean(phone.trim() && smsConsent)"), false);
  assert.ok(form.includes("recordInitialPhoneConsent("));
  assert.ok(form.includes("complete={phoneAdded}"));
  assert.ok(form.includes("phoneRetryDraft("));
  const card = readFileSync(new URL("../src/components/phone-optin-card.tsx", import.meta.url), "utf8");
  assert.ok(card.includes('error === "retry"'));
  assert.ok(card.includes("if (busy || saving.current) return;"));
  assert.ok(card.includes("onSaved?.(result.status)"));
});
