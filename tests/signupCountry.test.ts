// Coarse signup country. The client attribution object cannot supply it, an
// untrusted process cannot trust x-vercel-ip-country, and a missing Notion
// column must not lose the signup or the 50:50 experiment cell.
import assert from "node:assert/strict";
import test from "node:test";

import {
  observeSignupCountry,
  persistableSignupCountry,
  readSignupCountryProbe,
  SIGNUP_COUNTRY_CODE_COUNT,
  type SignupCountryProbe,
} from "../src/lib/attribution.ts";
import {
  EXPERIMENT_ID,
  FIELD_CONVERSION_EXPERIMENT,
  type ExperimentContext,
} from "../src/lib/conversionExperimentContract.ts";
import {
  FIELD_SIGNUP_COUNTRY,
  FIELD_SIGNUP_COUNTRY_OBSERVED,
  FIELD_SIGNUP_COUNTRY_SOURCE,
  SIGNUP_COUNTRY_SOURCE_UNKNOWN,
  SIGNUP_COUNTRY_SOURCE_VERCEL,
  SIGNUP_COUNTRY_UNKNOWN,
  type SignupCountryObservation,
} from "../src/lib/verification/contracts.ts";
import { setCanonicalEmailShape } from "../src/lib/api/notionCanonicalEmail.ts";
import {
  createNotionLeadStore,
  NotionRequestError,
  signupCountryNotionPropertyPatch,
  signupCountryProperties,
  toLeadRecord,
  type NotionRequest,
} from "../src/lib/verification/notionLead.ts";
import { requestVerificationService } from "../src/lib/verification/service.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

const OBSERVED = new Date("2026-10-18T03:04:05.000Z");
const IP = "203.0.113.44";

function observation(
  country: string,
  source: SignupCountryObservation["countrySource"] = SIGNUP_COUNTRY_SOURCE_VERCEL,
): SignupCountryObservation {
  return { country, countrySource: source, countryObservedAt: OBSERVED.toISOString() };
}

function probe(trusted: boolean, header: string | null): SignupCountryProbe {
  return { trustedVercel: trusted, header };
}

test("the country allowlist is the ISO set plus Kosovo XK", () => {
  assert.equal(SIGNUP_COUNTRY_CODE_COUNT, 250);
  for (const code of ["US", "GB", "KR", "JP", "DE", "FR", "BR", "AU", "SG", "TW", "XK"]) {
    assert.equal(persistableSignupCountry(code), code, code);
  }
  for (const rejected of ["UK", "EU", "T1", "A1", "XX", "ZZ", "USA", "United States", IP, ""]) {
    assert.equal(persistableSignupCountry(rejected), undefined, rejected);
  }
  assert.equal(persistableSignupCountry("unknown"), "unknown");
  assert.equal(persistableSignupCountry(" us "), "US");
});

test("an untrusted process ignores a client country header", () => {
  let reads = 0;
  const ignored = readSignupCountryProbe({
    vercelEnv: undefined,
    readHeader: () => {
      reads += 1;
      return "KR";
    },
  });
  assert.equal(reads, 0);
  assert.deepEqual(ignored, { trustedVercel: false, header: null });

  const spoofed = observeSignupCountry({
    trustedVercel: false,
    header: "KR",
    observedAt: OBSERVED,
  });
  assert.deepEqual(spoofed, {
    country: SIGNUP_COUNTRY_UNKNOWN,
    countrySource: SIGNUP_COUNTRY_SOURCE_UNKNOWN,
    countryObservedAt: OBSERVED.toISOString(),
  });
  assert.equal(JSON.stringify(spoofed).includes("KR"), false);
  assert.equal(JSON.stringify(spoofed).includes(IP), false);
});

test("only VERCEL=1 reads the header, and a thrown read becomes no country", () => {
  assert.equal(
    readSignupCountryProbe({ vercelEnv: "true", readHeader: () => "US" }).trustedVercel,
    false,
  );
  let reads = 0;
  const trusted = readSignupCountryProbe({
    vercelEnv: "1",
    readHeader: () => {
      reads += 1;
      return " gb ";
    },
  });
  assert.equal(reads, 1);
  assert.deepEqual(trusted, { trustedVercel: true, header: " gb " });

  const thrown = readSignupCountryProbe({
    vercelEnv: "1",
    readHeader: () => {
      throw new Error("no request");
    },
  });
  assert.deepEqual(thrown, { trustedVercel: true, header: null });
});

test("a trusted header stores a coarse ISO, and no-country stays explicit", () => {
  assert.deepEqual(
    observeSignupCountry({ trustedVercel: true, header: "us", observedAt: OBSERVED }),
    {
      country: "US",
      countrySource: SIGNUP_COUNTRY_SOURCE_VERCEL,
      countryObservedAt: OBSERVED.toISOString(),
    },
  );
  for (const header of [null, "", "XX", "UK", "T1", IP, "United States"]) {
    const seen = observeSignupCountry({ trustedVercel: true, header, observedAt: OBSERVED });
    assert.equal(seen.country, SIGNUP_COUNTRY_UNKNOWN, String(header));
    assert.equal(seen.countrySource, SIGNUP_COUNTRY_SOURCE_VERCEL);
    assert.equal(JSON.stringify(seen).includes(IP), false);
  }
});

test("country cells are explicit, and a client-labelled code cannot ride along", () => {
  const unknown = signupCountryProperties(
    observation(SIGNUP_COUNTRY_UNKNOWN, SIGNUP_COUNTRY_SOURCE_UNKNOWN),
  );
  assert.deepEqual(Object.keys(unknown).sort(), [
    FIELD_SIGNUP_COUNTRY,
    FIELD_SIGNUP_COUNTRY_OBSERVED,
    FIELD_SIGNUP_COUNTRY_SOURCE,
  ]);
  assert.deepEqual(unknown[FIELD_SIGNUP_COUNTRY], {
    rich_text: [{ text: { content: "unknown" } }],
  });
  assert.deepEqual(unknown[FIELD_SIGNUP_COUNTRY_SOURCE], {
    rich_text: [{ text: { content: "unknown" } }],
  });
  assert.deepEqual(unknown[FIELD_SIGNUP_COUNTRY_OBSERVED], {
    date: { start: OBSERVED.toISOString() },
  });

  const poisoned = signupCountryProperties({
    country: "KR",
    countrySource: "browser" as SignupCountryObservation["countrySource"],
    countryObservedAt: OBSERVED.toISOString(),
  });
  assert.equal(
    (poisoned[FIELD_SIGNUP_COUNTRY] as { rich_text: { text: { content: string } }[] }).rich_text[0]
      .text.content,
    "unknown",
  );
  assert.equal(JSON.stringify(poisoned).includes("KR"), false);

  const ip = signupCountryProperties(observation(IP));
  assert.equal(
    (ip[FIELD_SIGNUP_COUNTRY] as { rich_text: { text: { content: string } }[] }).rich_text[0].text
      .content,
    "unknown",
  );
  assert.equal(JSON.stringify(ip).includes(IP), false);
  assert.deepEqual(signupCountryProperties(undefined), {});
});

test("the schema patch adds only the three country properties", () => {
  const patch = signupCountryNotionPropertyPatch();
  assert.deepEqual(patch, {
    properties: {
      [FIELD_SIGNUP_COUNTRY]: { rich_text: {} },
      [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: {} },
      [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: {} },
    },
  });
  const names = Object.keys(patch.properties);
  for (const kept of [
    "Email",
    "Phone",
    "SMS consent",
    "Source",
    "UTM Source",
    "IP",
    "User agent",
  ]) {
    assert.equal(names.includes(kept), false, kept);
  }
});

test("an empty country cell is not read back as unknown", () => {
  const legacy = toLeadRecord({
    id: "page-legacy",
    properties: {
      Email: { title: [{ plain_text: "diver@example.com" }] },
      Source: { select: { name: "hero" } },
    },
  });
  assert.equal(legacy?.signupCountry, undefined);
  assert.equal(legacy?.signupCountrySource, undefined);
  assert.equal(legacy?.signupCountryObservedAt, undefined);
  assert.equal(legacy?.source, "hero");

  const observed = toLeadRecord({
    id: "page-new",
    properties: {
      Email: { title: [{ plain_text: "diver@example.com" }] },
      [FIELD_SIGNUP_COUNTRY]: { rich_text: [{ plain_text: "US" }] },
      [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: [{ plain_text: SIGNUP_COUNTRY_SOURCE_VERCEL }] },
      [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: { start: OBSERVED.toISOString() } },
    },
  });
  assert.equal(observed?.signupCountry, "US");
  assert.equal(observed?.signupCountrySource, SIGNUP_COUNTRY_SOURCE_VERCEL);
  assert.equal(observed?.signupCountryObservedAt, OBSERVED.toISOString());

  const junk = toLeadRecord({
    id: "page-junk",
    properties: {
      Email: { title: [{ plain_text: "diver@example.com" }] },
      [FIELD_SIGNUP_COUNTRY]: { rich_text: [{ plain_text: "diver@example.com" }] },
      [FIELD_SIGNUP_COUNTRY_SOURCE]: { rich_text: [{ plain_text: "browser" }] },
      [FIELD_SIGNUP_COUNTRY_OBSERVED]: { date: { start: "not-a-date" } },
    },
  });
  assert.equal(junk?.signupCountry, undefined);
  assert.equal(junk?.signupCountrySource, undefined);
  assert.equal(junk?.signupCountryObservedAt, undefined);
  assert.equal(JSON.stringify(junk).includes("diver@example.com"), true);
});

function pendingInput(signupCountry?: SignupCountryObservation) {
  return {
    email: "diver@example.com",
    canonical: "diver@example.com",
    phone: "+821012345678",
    source: "offer",
    refCode: "abcd1234",
    flags: [] as string[],
    suspect: false,
    signedUpAt: OBSERVED.toISOString(),
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    expiresAt: "2026-10-19T03:04:05.000Z",
    attribution: {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: "launch",
      landingPath: "/",
    },
    measurementState: "WD-AD-MEASUREMENT-CONSENT-V1:granted",
    experiment: {
      experimentId: EXPERIMENT_ID,
      variant: "control",
      sessionId: "11111111-1111-4111-8111-111111111111",
      assignedAt: OBSERVED.getTime(),
      team: "organic",
      qa: false,
    } satisfies ExperimentContext,
    ...(signupCountry ? { signupCountry } : {}),
  };
}

test("a new row stores source, UTM, and country, and drops country columns together", async () => {
  setCanonicalEmailShape("email");
  const bodies: Record<string, unknown>[] = [];
  const request: NotionRequest = async (_method, _path, body) => {
    const properties = ((body ?? {}) as { properties?: Record<string, unknown> }).properties ?? {};
    bodies.push(properties);
    if (properties[FIELD_SIGNUP_COUNTRY_SOURCE]) {
      throw new NotionRequestError(
        400,
        JSON.stringify({
          code: "validation_error",
          message: `${FIELD_SIGNUP_COUNTRY_SOURCE} is not a property that exists.`,
        }),
      );
    }
    return {
      id: "page-1",
      properties: { Email: { title: [{ plain_text: "diver@example.com" }] } },
    };
  };

  const record = await createNotionLeadStore(request, "wait-db").createPending(
    pendingInput(observation("US")),
  );
  assert.equal(record.pageId, "page-1");
  assert.equal(bodies.length, 2);
  const first = bodies[0];
  const second = bodies[1];
  assert.deepEqual(first.Source, { select: { name: "offer" } });
  assert.equal("UTM Source" in first, true);
  assert.equal("UTM Campaign" in first, true);
  assert.equal(FIELD_CONVERSION_EXPERIMENT in first, true);
  assert.equal("Phone" in first, true);
  assert.equal(FIELD_SIGNUP_COUNTRY in first, true);
  assert.equal(JSON.stringify(first).includes(IP), false);
  assert.equal("IP" in first, false);
  assert.equal("User agent" in first, false);

  assert.equal(FIELD_SIGNUP_COUNTRY in second, false);
  assert.equal(FIELD_SIGNUP_COUNTRY_SOURCE in second, false);
  assert.equal(FIELD_SIGNUP_COUNTRY_OBSERVED in second, false);
  assert.equal(FIELD_CONVERSION_EXPERIMENT in second, true);
  assert.equal("UTM Source" in second, true);
  assert.deepEqual(second.Source, { select: { name: "offer" } });
  assert.equal("SMS consent" in second, false);
});

test("a country-column 5xx is not retried", async () => {
  setCanonicalEmailShape("email");
  let calls = 0;
  const request: NotionRequest = async () => {
    calls += 1;
    throw new NotionRequestError(
      500,
      JSON.stringify({
        code: "internal_server_error",
        message: `${FIELD_SIGNUP_COUNTRY} exploded`,
      }),
    );
  };
  await assert.rejects(() =>
    createNotionLeadStore(request, "wait-db").createPending(pendingInput(observation("US"))),
  );
  assert.equal(calls, 1);
});

test("the first submit freezes country and the form-first experiment; a resend does not", async () => {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const clock = new Date("2026-10-18T03:04:05.000Z");
  const experiment: ExperimentContext = {
    experimentId: EXPERIMENT_ID,
    variant: "control",
    sessionId: "11111111-1111-4111-8111-111111111111",
    assignedAt: clock.getTime(),
    team: "organic",
    qa: false,
  };
  const deps = () => ({
    store,
    mailer,
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
  });
  const base = {
    email: "diver@example.com",
    canonical: "diver@example.com",
    source: "hero" as const,
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
    attribution: { utmSource: "meta", utmCampaign: "launch", landingPath: "/" },
    experiment,
    signupCountryProbe: probe(true, "US"),
  };

  const created = await requestVerificationService(base, deps());
  assert.equal(created.status, "pending");
  assert.equal("signupCountry" in created, false);
  assert.equal(created.message.includes("US"), false);
  assert.equal(store.createPendingInputs.length, 1);
  assert.equal(store.createPendingInputs[0].source, "hero");
  assert.equal(store.createPendingInputs[0].attribution?.utmSource, "meta");
  assert.equal(store.createPendingInputs[0].experiment?.variant, "control");
  assert.deepEqual(store.createPendingInputs[0].signupCountry, {
    country: "US",
    countrySource: SIGNUP_COUNTRY_SOURCE_VERCEL,
    countryObservedAt: clock.toISOString(),
  });
  assert.equal(
    store.createPendingInputs[0].signupCountry?.countryObservedAt,
    store.createPendingInputs[0].signedUpAt,
  );

  clock.setTime(clock.getTime() + 120_000);
  await requestVerificationService(
    {
      ...base,
      experiment: { ...experiment, variant: "form_first", assignedAt: clock.getTime() },
      signupCountryProbe: probe(true, "DE"),
      attribution: { utmSource: "newsletter", landingPath: "/privacy" },
    },
    deps(),
  );
  assert.equal(store.createPendingInputs.length, 1);
  assert.equal(store.startAttemptCalls, 1);
  assert.equal(store.createPendingInputs[0].signupCountry?.country, "US");
  assert.equal(store.createPendingInputs[0].experiment?.variant, "control");
  assert.equal(store.createPendingInputs[0].attribution?.utmSource, "meta");
  const row = await store.findByEmail("diver@example.com", "diver@example.com");
  assert.equal(row?.signupCountry, "US");
  assert.equal(row?.signupCountrySource, SIGNUP_COUNTRY_SOURCE_VERCEL);
});

test("no probe writes no country, and a withheld experiment still stores country", async () => {
  const clock = new Date("2026-10-18T03:04:05.000Z");
  const depsFor = (store: FakeLeadStore) => ({
    store,
    mailer: new FakeMailer(),
    env: TEST_ENV,
    now: () => clock,
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
  });
  const base = {
    email: "diver@example.com",
    canonical: "diver@example.com",
    phone: "+821012345678",
    source: "offer",
    flags: [] as string[],
    suspect: false,
    measurementConsent: true,
    networkSendBlocked: false,
  };

  const bare = new FakeLeadStore();
  await requestVerificationService(base, depsFor(bare));
  assert.equal(bare.createPendingInputs[0].signupCountry, undefined);
  // The initial signup may receive a legacy payload, but phone and SMS
  // consent must only be recorded through authenticated phone opt-in.
  assert.equal(bare.createPendingInputs[0].phone, undefined);

  const gpc = new FakeLeadStore();
  await requestVerificationService(
    { ...base, signupCountryProbe: probe(false, "KR"), measurementConsent: true },
    { ...depsFor(gpc), gpc: true },
  );
  assert.equal(gpc.createPendingInputs[0].experiment, undefined);
  assert.equal(gpc.createPendingInputs[0].signupCountry?.country, SIGNUP_COUNTRY_UNKNOWN);
  assert.equal(
    gpc.createPendingInputs[0].signupCountry?.countrySource,
    SIGNUP_COUNTRY_SOURCE_UNKNOWN,
  );
  assert.equal(JSON.stringify(gpc.createPendingInputs[0].signupCountry).includes("KR"), false);

  const suspectMailer = new FakeMailer();
  const suspect = new FakeLeadStore();
  await requestVerificationService(
    {
      ...base,
      flags: ["honeypot"],
      suspect: true,
      signupCountryProbe: probe(true, "JP"),
    },
    { ...depsFor(suspect), mailer: suspectMailer },
  );
  assert.equal(suspect.createPendingInputs[0].signupCountry?.country, "JP");
  assert.equal(suspect.createPendingInputs[0].source, "offer");
  assert.equal(suspectMailer.sent.length, 1);
});
