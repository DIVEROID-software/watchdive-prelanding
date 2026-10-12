import assert from "node:assert/strict";
import test from "node:test";
import { phoneCountries, searchPhoneCountries, normalizePhone } from "../src/lib/phoneNumbers.ts";
import { savePhoneOptInService, type PhoneOptInInput } from "../src/lib/verification/phoneOptIn.ts";
import { signPollHandle, createVerificationToken } from "../src/lib/verification/token.ts";
import { FakeLeadStore, TEST_ENV, TEST_SECRET } from "./helpers/fakes.ts";
import { createNotionLeadStore } from "../src/lib/verification/notionLead.ts";

const leadId = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const now = new Date("2026-10-12T00:00:00Z");
const handle = signPollHandle(leadId, now.getTime(), false, TEST_SECRET);
const token = createVerificationToken(leadId, now.getTime() + 86_400_000, false, TEST_SECRET, "en");
const input: PhoneOptInInput = {
  credential: { kind: "attempt", value: handle },
  phone: "07700 900123",
  country: "GB",
  consent: true,
  locale: "en",
};
function setup(verified = false) {
  const store = new FakeLeadStore();
  const row = store.seed({
    email: "test@example.com",
    canonical: "test@example.com",
    leadId,
    emailVerified: verified,
    status: verified ? "verified" : "pending",
  });
  return {
    store,
    row,
    deps: { store, env: TEST_ENV, now: () => now, sleep: async () => {}, gate: () => true },
  };
}

test("country search accepts localized names, English names, aliases, ISO and numeric prefixes", () => {
  const list = phoneCountries("ko");
  assert.ok(list.length > 200);
  for (const term of ["한국", "대한민국", "Korea", "KR", "+82", "82"])
    assert.ok(
      searchPhoneCountries(list, term).some((r) => r.code === "KR"),
      term,
    );
  for (const term of ["UK", "United Kingdom", "영국", "+44"])
    assert.ok(
      searchPhoneCountries(list, term).some((r) => r.code === "GB"),
      term,
    );
  assert.ok(searchPhoneCountries(phoneCountries("de"), "Deutschland").some((r) => r.code === "DE"));
  const shared = searchPhoneCountries(list, "+1");
  assert.ok(shared.some((r) => r.code === "US") && shared.some((r) => r.code === "CA"));
  assert.deepEqual(searchPhoneCountries(list, "not-a-country-xyz"), []);
});

test("national and pasted international numbers normalize without duplicated country/trunk codes", () => {
  assert.equal(normalizePhone("010-1234-5678", "KR"), "+821012345678");
  assert.equal(normalizePhone("07700 900123", "GB"), "+447700900123");
  assert.equal(normalizePhone("+44 7700 900123", "US"), "+447700900123");
  assert.equal(normalizePhone("0044 7700 900123", "KR"), "+447700900123");
  assert.equal(normalizePhone("06 12 34 56 78", "FR"), "+33612345678");
  for (const value of ["1", "+999123456789", "call 07700 900123", "07700900123 ext 4", "<script>"])
    assert.equal(normalizePhone(value, "GB"), null);
});

test("post-submit opt-in saves normalized phone and versioned consent without confirming or reattributing signup", async () => {
  const { store, row, deps } = setup();
  const before = { ...row };
  assert.deepEqual(await savePhoneOptInService(input, deps), { status: "accepted" });
  const saved = (await store.reread(row.pageId))!;
  assert.equal(saved.phone, "+447700900123");
  assert.deepEqual(JSON.parse(saved.smsConsent!), {
    version: "WD-SMS-CONSENT-V2",
    at: now.toISOString(),
    locale: "en",
    surface: "attempt",
  });
  const { phone: _p, smsConsent: _c, ...unchanged } = saved;
  const { phone: _old, ...original } = before;
  assert.deepEqual(unchanged, original);
  assert.equal(store.markVerifiedCalls, 0);
});

test("no consent, bad signature and expired credentials never write", async () => {
  const { store, row, deps } = setup();
  assert.equal((await savePhoneOptInService({ ...input, consent: false }, deps)).status, "invalid");
  assert.equal(
    (
      await savePhoneOptInService(
        { ...input, credential: { kind: "attempt", value: handle + "bad" } },
        deps,
      )
    ).status,
    "expired",
  );
  assert.equal(
    (
      await savePhoneOptInService(input, {
        ...deps,
        now: () => new Date(now.getTime() + 172_800_000),
      })
    ).status,
    "expired",
  );
  assert.equal((await store.reread(row.pageId))?.phone, "");
});

test("decoy, unsubscribed and suspect attempt handles have the same acknowledgement and no write", async () => {
  for (const state of ["decoy", "unsubscribed", "suspect"]) {
    const { store, row, deps } = setup();
    if (state === "decoy") store.rows.clear();
    if (state === "unsubscribed") row.status = "unsubscribed";
    if (state === "suspect") row.suspect = true;
    assert.deepEqual(await savePhoneOptInService(input, deps), { status: "accepted" });
    assert.equal(row.phone, "");
  }
});

test("email token saves only after verification, and lost/readback failures are never success", async () => {
  const { store, row, deps } = setup();
  const confirmed: PhoneOptInInput = {
    ...input,
    credential: { kind: "confirmation", value: token },
  };
  assert.equal((await savePhoneOptInService(confirmed, deps)).status, "expired");
  row.emailVerified = true;
  row.status = "verified";
  assert.equal((await savePhoneOptInService(confirmed, deps)).status, "saved");
  store.reread = async () => undefined;
  assert.equal((await savePhoneOptInService(confirmed, deps)).status, "retry");
});

test("Notion phone patch contains only Phone and SMS consent; no verified or campaign fields", async () => {
  const requests: unknown[] = [];
  const store = createNotionLeadStore(async (method, path, body) => {
    requests.push({ method, path, body });
    return {};
  }, "test-db");
  await store.recordPhoneOptIn!("test-row", "+447700900123", "consent-receipt");
  assert.deepEqual(requests, [
    {
      method: "PATCH",
      path: "pages/test-row",
      body: {
        properties: {
          Phone: { rich_text: [{ text: { content: "+447700900123" } }] },
          "SMS consent": { rich_text: [{ text: { content: "consent-receipt" } }] },
        },
      },
    },
  ]);
});
