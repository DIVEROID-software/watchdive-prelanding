import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getAttribution,
  mergeAttribution,
  readAttribution,
  sanitizeAttribution,
  sanitizeAttributionValue,
  sanitizeSignupAttribution,
  toLeadAttribution,
} from "../src/lib/attribution.ts";
import { rememberMeasurementChoice, CONSENT_STORAGE_KEY } from "../src/lib/consentRegion.ts";
import { attributionProperties } from "../src/lib/verification/notionLead.ts";

const NOW = 1_784_000_000_000;
const CAMPAIGN = "120251732986720215";
const AD = "120251733099300215";
const ADSET = "120251732990240215";
const MACRO =
  "?utm_source=ig&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}";
const ENCODED =
  "?utm_source=ig&utm_medium=paid&utm_campaign=%7B%7Bcampaign.id%7D%7D&utm_content=%7B%7Bad.id%7D%7D&utm_term=%7B%7Badset.id%7D%7D";
const NUMERIC = `?utm_source=ig&utm_medium=paid&utm_campaign=${CAMPAIGN}&utm_content=${AD}&utm_term=${ADSET}`;

const originals = new Map(
  ["window", "document", "localStorage", "navigator"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);

afterEach(() => {
  rememberMeasurementChoice(null);
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function browser(search: string, pathname = "/scuba") {
  const values: Record<string, string> = {};
  const storage = Object.create(null) as Storage & Record<string, string>;
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => values[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        values[key] = value;
        Object.defineProperty(storage, key, { value, enumerable: true, configurable: true });
      },
    },
    removeItem: {
      value: (key: string) => {
        delete values[key];
        delete storage[key];
      },
    },
  });
  const location = { search, pathname };
  for (const [key, value] of Object.entries({
    window: { localStorage: storage, location },
    localStorage: storage,
    document: { cookie: "wd_geo=KR" },
    navigator: { globalPrivacyControl: false },
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  storage.setItem(CONSENT_STORAGE_KEY, "granted");
  return { storage, location };
}

test("raw, encoded, and already-stripped Meta macros are not campaign values", () => {
  for (const token of ["campaign.id", "ad.id", "adset.id", " campaign.id ", "campaign.id\n"]) {
    assert.equal(sanitizeAttributionValue(token), "");
  }
  assert.equal(sanitizeAttributionValue("{{campaign.id}}"), "");
  assert.equal(sanitizeAttributionValue("{{ad.id}}"), "");
  assert.equal(sanitizeAttributionValue("{{adset.id}}"), "");
  assert.equal(sanitizeAttributionValue("%7B%7Bcampaign.id%7D%7D"), "");
  assert.equal(sanitizeAttributionValue("%7b%7bad.id%7d%7d"), "");
  assert.equal(sanitizeAttributionValue("{{campaign.id}}<script>alert(1)</script>"), "");
  const strippedTag = sanitizeAttributionValue('campaign.id"><img src=x onerror=alert(1)>');
  assert.equal(strippedTag.includes("<"), false);
  assert.equal(strippedTag.includes('"'), false);
  assert.equal(strippedTag.includes("="), false);
  assert.notEqual(strippedTag, "campaign.id");
  assert.equal(sanitizeAttributionValue("launch"), "launch");
  assert.equal(sanitizeAttributionValue("202607_en_wd"), "202607_en_wd");
  assert.equal(sanitizeAttributionValue("paid_social"), "paid_social");
  assert.equal(sanitizeAttributionValue("v4"), "v4");
  assert.equal(sanitizeAttributionValue("campaign.id.spring"), "campaign.id.spring");
  assert.equal(sanitizeAttributionValue("ad.identity"), "ad.identity");
  assert.equal(sanitizeAttributionValue(CAMPAIGN), CAMPAIGN);
  assert.equal(typeof sanitizeAttributionValue(CAMPAIGN), "string");
  assert.notEqual(String(Number(CAMPAIGN)), CAMPAIGN);
  assert.equal(
    sanitizeAttributionValue('meta"><script>alert(1)</script>'),
    "metascriptalert1/script",
  );
});

test("a macro URL keeps source and medium and does not keep the id tokens", () => {
  for (const search of [MACRO, ENCODED, `?utm_campaign=%257B%257Bcampaign.id%257D%257D`]) {
    const captured = readAttribution(search, "/scuba", NOW);
    assert.equal(captured.utmCampaign, undefined);
    assert.equal(captured.utmContent, undefined);
    assert.equal(captured.utmTerm, undefined);
    assert.equal(captured.unresolvedPlacement, true);
    assert.equal(JSON.stringify(captured).includes("campaign.id"), false);
  }
  const tagged = readAttribution(MACRO, "/scuba", NOW);
  assert.equal(tagged.utmSource, "ig");
  assert.equal(tagged.utmMedium, "paid");
  assert.equal(tagged.landingPath, "/scuba");
  const lead = toLeadAttribution(tagged);
  assert.equal("unresolvedPlacement" in lead, false);
  const properties = attributionProperties(lead);
  assert.equal(properties["UTM Campaign"], undefined);
  assert.equal(properties["UTM Content"], undefined);
  assert.equal(properties["UTM Term"], undefined);
  assert.deepEqual(properties["UTM Source"], { rich_text: [{ text: { content: "ig" } }] });
});

test("an exact 18-digit id and a real campaign name stay strings and own first touch", () => {
  const numeric = readAttribution(NUMERIC, "/scuba", NOW);
  assert.deepEqual(numeric, {
    utmSource: "ig",
    utmMedium: "paid",
    utmCampaign: CAMPAIGN,
    utmContent: AD,
    utmTerm: ADSET,
    landingPath: "/scuba",
  });
  const named = readAttribution(
    "?utm_source=meta&utm_medium=paid_social&utm_campaign=202607_en_wd&utm_content=v4&utm_term=divers",
    "/",
    NOW,
  );
  assert.equal(named.utmCampaign, "202607_en_wd");
  assert.equal(named.unresolvedPlacement, undefined);
  const later = readAttribution(NUMERIC, "/scuba", NOW + 1000);
  assert.equal(mergeAttribution(named, later).utmCampaign, "202607_en_wd");
  assert.equal(mergeAttribution(named, later).utmContent, "v4");
});

test("a poisoned touch yields to a later real placement and keeps source until then", () => {
  const poisoned = readAttribution(`${MACRO}&fbclid=IwAR0broken`, "/scuba", NOW);
  assert.equal(poisoned.fbclid, "IwAR0broken");
  assert.equal(poisoned.unresolvedPlacement, true);
  const internal = readAttribution("", "/privacy", NOW + 1000);
  const held = mergeAttribution(poisoned, internal);
  assert.equal(held.utmSource, "ig");
  assert.equal(held.landingPath, "/scuba");
  assert.equal(held.unresolvedPlacement, true);
  assert.equal(held.fbclid, "IwAR0broken");
  const sourceOnly = readAttribution("?utm_source=newsletter", "/", NOW + 2000);
  assert.equal(mergeAttribution(poisoned, sourceOnly).utmSource, "ig");
  const recovered = mergeAttribution(poisoned, readAttribution(NUMERIC, "/scuba", NOW + 3000));
  assert.equal(recovered.utmCampaign, CAMPAIGN);
  assert.equal(recovered.utmContent, AD);
  assert.equal(recovered.utmTerm, ADSET);
  assert.equal(recovered.fbclid, undefined);
  assert.equal(recovered.unresolvedPlacement, undefined);
});

test("one real placement field survives beside a poisoned field and still locks", () => {
  const mixed = readAttribution(
    "?utm_source=ig&utm_medium=paid&utm_campaign=launch&utm_content={{ad.id}}&utm_term=adset.id",
    "/scuba",
    NOW,
  );
  assert.equal(mixed.utmCampaign, "launch");
  assert.equal(mixed.utmContent, undefined);
  assert.equal(mixed.utmTerm, undefined);
  assert.equal(mixed.unresolvedPlacement, undefined);
  assert.equal(mergeAttribution(mixed, readAttribution(NUMERIC, "/scuba", NOW + 1)).utmCampaign, "launch");
});

test("fbclid without a poisoned placement still beats a later source", () => {
  const first = readAttribution("?fbclid=IwAR0abc", "/", NOW);
  const later = readAttribution("?utm_source=google", "/", NOW + 1000);
  assert.equal(first.unresolvedPlacement, undefined);
  assert.equal(mergeAttribution(first, later).fbclid, "IwAR0abc");
  assert.equal(mergeAttribution(first, later).utmSource, undefined);
});

test("a posted signup cannot store the macro tokens or the storage marker", () => {
  const clean = sanitizeSignupAttribution({
    utmSource: "ig",
    utmMedium: "paid",
    utmCampaign: "campaign.id",
    utmContent: "{{ad.id}}",
    utmTerm: "%7B%7Badset.id%7D%7D",
    landingPath: "/scuba",
    unresolvedPlacement: true,
    fbclid: "IwAR0abc",
  });
  assert.deepEqual(clean, {
    utmSource: "ig",
    utmMedium: "paid",
    landingPath: "/scuba",
    fbclid: "IwAR0abc",
  });
  assert.deepEqual(
    sanitizeAttribution({ utmCampaign: "launch", unresolvedPlacement: true, landingPath: "/" }),
    { utmCampaign: "launch", landingPath: "/" },
  );
});

test("stale campaign.id storage recovers after the marker is what remains", () => {
  const { storage, location } = browser(NUMERIC);
  storage.setItem(
    "wd_attr",
    JSON.stringify({
      utmSource: "ig",
      utmMedium: "paid",
      utmCampaign: "campaign.id",
      utmContent: "ad.id",
      utmTerm: "adset.id",
      landingPath: "/scuba",
      fbclid: "IwAR0old",
    }),
  );
  const recovered = getAttribution([]);
  assert.equal(recovered.utmCampaign, CAMPAIGN);
  assert.equal(recovered.utmContent, AD);
  assert.equal(recovered.utmTerm, ADSET);
  assert.equal(recovered.fbclid, undefined);
  assert.equal("unresolvedPlacement" in recovered, false);
  const saved = JSON.parse(storage.getItem("wd_attr") ?? "{}") as Record<string, unknown>;
  assert.equal(saved.utmCampaign, CAMPAIGN);
  assert.equal(saved.unresolvedPlacement, undefined);
  assert.equal(JSON.stringify(saved).includes("campaign.id"), false);

  location.search = "";
  location.pathname = "/privacy";
  assert.equal(getAttribution([]).utmCampaign, CAMPAIGN);

  location.search = MACRO;
  location.pathname = "/scuba";
  assert.equal(getAttribution([]).utmCampaign, CAMPAIGN);
});

test("a rewritten poisoned visit still accepts the next real click", () => {
  const { storage, location } = browser(`${MACRO}&fbclid=IwAR0broken`);
  const first = getAttribution([]);
  assert.equal(first.utmSource, "ig");
  assert.equal(first.utmMedium, "paid");
  assert.equal(first.utmCampaign, undefined);
  assert.equal(first.fbclid, "IwAR0broken");
  assert.equal("unresolvedPlacement" in first, false);
  const marked = JSON.parse(storage.getItem("wd_attr") ?? "{}") as Record<string, unknown>;
  assert.equal(marked.unresolvedPlacement, true);
  assert.equal(marked.utmCampaign, undefined);
  assert.equal(marked.fbclid, "IwAR0broken");

  location.search = "";
  location.pathname = "/ko/scuba";
  const internal = getAttribution([]);
  assert.equal(internal.utmSource, "ig");
  assert.equal(internal.landingPath, "/scuba");
  assert.equal(JSON.parse(storage.getItem("wd_attr") ?? "{}").unresolvedPlacement, true);

  location.search = NUMERIC;
  location.pathname = "/scuba";
  const recovered = getAttribution([]);
  assert.equal(recovered.utmCampaign, CAMPAIGN);
  assert.equal(recovered.utmContent, AD);
  assert.equal(recovered.utmTerm, ADSET);
  assert.equal(recovered.utmSource, "ig");
  const persisted = JSON.parse(storage.getItem("wd_attr") ?? "{}") as Record<string, unknown>;
  assert.equal(persisted.utmCampaign, CAMPAIGN);
  assert.equal(persisted.unresolvedPlacement, undefined);
  assert.equal(JSON.stringify(persisted).includes("{{"), false);

  location.search = "";
  assert.equal(getAttribution([]).utmCampaign, CAMPAIGN);
  assert.equal(getAttribution([]).utmContent, AD);
});

test("a real stored name or source is not replaced by a later id", () => {
  const named = browser(NUMERIC);
  named.storage.setItem(
    "wd_attr",
    JSON.stringify({ utmSource: "meta", utmCampaign: "202607_en_wd", landingPath: "/" }),
  );
  assert.equal(getAttribution([]).utmCampaign, "202607_en_wd");
  assert.equal(getAttribution([]).utmSource, "meta");

  const sourceOnly = browser(`?utm_campaign=${CAMPAIGN}&utm_content=${AD}&utm_term=${ADSET}`);
  sourceOnly.storage.setItem("wd_attr", JSON.stringify({ utmSource: "meta", landingPath: "/" }));
  const kept = getAttribution([]);
  assert.equal(kept.utmSource, "meta");
  assert.equal(kept.utmCampaign, undefined);

  const click = browser("?utm_source=google");
  click.storage.setItem("wd_attr", JSON.stringify({ fbclid: "IwAR0abc", landingPath: "/", capturedAt: NOW }));
  assert.equal(getAttribution([]).fbclid, "IwAR0abc");
  assert.equal(getAttribution([]).utmSource, undefined);
});

test("a stored real placement ignores a forged unresolved marker", () => {
  const { storage } = browser(NUMERIC);
  storage.setItem(
    "wd_attr",
    JSON.stringify({ utmCampaign: "launch", unresolvedPlacement: true, landingPath: "/" }),
  );
  const kept = getAttribution([]);
  assert.equal(kept.utmCampaign, "launch");
  assert.equal(JSON.parse(storage.getItem("wd_attr") ?? "{}").unresolvedPlacement, undefined);
});

test("measurement withdrawal keeps the poisoned marker and drops only click ids", () => {
  const { storage, location } = browser(`${MACRO}&fbclid=IwAR0broken`);
  getAttribution([]);
  storage.setItem(CONSENT_STORAGE_KEY, "denied");
  rememberMeasurementChoice("denied");
  location.search = "";
  const hidden = getAttribution([]);
  assert.equal(hidden.fbclid, undefined);
  assert.equal(hidden.utmSource, "ig");
  const saved = JSON.parse(storage.getItem("wd_attr") ?? "{}") as Record<string, unknown>;
  assert.equal(saved.fbclid, undefined);
  assert.equal(saved.unresolvedPlacement, true);
  assert.equal(JSON.stringify(saved).includes("IwAR0broken"), false);

  rememberMeasurementChoice(null);
  storage.setItem(CONSENT_STORAGE_KEY, "granted");
  location.search = NUMERIC;
  location.pathname = "/scuba";
  assert.equal(getAttribution([]).utmCampaign, CAMPAIGN);
});
