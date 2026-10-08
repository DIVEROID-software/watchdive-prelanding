import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import {
  experimentBootstrap,
  variantFromRandomByte,
  experimentTeam,
  EXPERIMENT_STORAGE_KEY,
} from "../src/lib/conversionExperimentClient.ts";
import { CONSENT_STORAGE_KEY } from "../src/lib/consentRegion.ts";
import { competitionRegistry } from "../src/lib/competitionRegistry.ts";

test("128 of 256 random byte values select each arm", () => {
  const variants = Array.from({ length: 256 }, (_, n) => variantFromRandomByte(n));
  assert.equal(variants.filter((v) => v === "control").length, 128);
  assert.equal(variants.filter((v) => v === "form_first").length, 128);
});

function bootstrap({
  cookie = "wd_geo=GB",
  choice = null,
  random = 0,
  query = "",
  stored = "form_first",
  gpc = false,
}: {
  cookie?: string;
  choice?: string | null;
  random?: number;
  query?: string;
  stored?: string;
  gpc?: boolean;
} = {}) {
  const read: string[] = [];
  const document = { cookie, documentElement: { dataset: {} as Record<string, string> } };
  const window: Record<string, unknown> = {};
  const localStorage = {
    getItem(key: string) {
      read.push(key);
      if (key === CONSENT_STORAGE_KEY) return choice;
      return JSON.stringify({ variant: stored, expiresAt: Date.now() + 86400_000 });
    },
    setItem() {
      throw new Error("head bootstrap must not persist data");
    },
  };
  vm.runInNewContext(experimentBootstrap(true), {
    URLSearchParams,
    location: { search: query },
    document,
    window,
    navigator: { globalPrivacyControl: gpc },
    localStorage,
    crypto: {
      getRandomValues(a: Uint8Array) {
        a[0] = random;
        return a;
      },
    },
  });
  return { window, read, document };
}

test("EU unknown and denied visitors get ephemeral visual assignment without stored variant read", () => {
  for (const opts of [
    {},
    { cookie: "" },
    { cookie: "wd_geo=US", choice: "denied" },
    { cookie: "wd_geo=US", gpc: true },
  ]) {
    const r = bootstrap(opts);
    assert.equal(r.window.__wdLandingVariant, "control");
    assert.ok(!r.read.includes(EXPERIMENT_STORAGE_KEY));
  }
});

test("permitted return visits keep the saved variant; QA does not change saved assignment", () => {
  assert.equal(bootstrap({ choice: "granted" }).window.__wdLandingVariant, "form_first");
  assert.equal(bootstrap({ cookie: "wd_geo=US" }).window.__wdLandingVariant, "form_first");
  const qa = bootstrap({ choice: "granted", query: "?wd_qa=1&wd_variant=control" });
  assert.equal(qa.window.__wdLandingVariant, "control");
  assert.equal(qa.window.__wdLandingQa, true);
  assert.ok(!qa.read.includes(EXPERIMENT_STORAGE_KEY));
  assert.equal(bootstrap({ query: "?wd_variant=form_first" }).window.__wdLandingVariant, "control");
});

test("only registered campaign/adset/ad combinations receive paid team labels", () => {
  for (const round of competitionRegistry)
    for (const ad of round.ads) {
      const search = `?utm_campaign=${round.campaignId}&utm_term=${ad.adsetId}&utm_content=${ad.adId}`;
      assert.equal(experimentTeam(search), ad.armId);
      assert.equal(experimentTeam(search + "&utm_term=wrong"), "organic");
      assert.equal(experimentTeam(search.replace(ad.adId, "wrong")), "organic");
    }
  assert.equal(experimentTeam("?team=A"), "organic");
  assert.equal(experimentBootstrap(false), "");
});

// Execute the actual browser module with its build flag enabled, isolated per
// visitor. Storage and permission are the browser boundaries under test.
function visitor(initialPermission: boolean) {
  let permitted = initialPermission;
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value),
    removeItem: (key: string) => map.delete(key),
  });
  const browser = Object.assign(new EventTarget(), {
    __wdLandingVariant: "form_first",
    __wdLandingQa: false,
  });
  const source = readFileSync(
    new URL("../src/lib/conversionExperimentClient.ts", import.meta.url),
    "utf8",
  ).replace("import.meta.env?.VITE_CONVERSION_EXPERIMENT_ENABLED", '"true"');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) =>
      name.includes("consentRegion")
        ? { measurementAllowed: () => permitted, INLINE_MEASUREMENT_ALLOWED_JS: "true" }
        : { competitionRegistry },
    window: browser,
    location: { hostname: "watchdive.diveroid.com", search: "" },
    localStorage: storage(local),
    sessionStorage: storage(session),
    crypto: webcrypto,
    URLSearchParams,
    Event,
  });
  return {
    api: exports,
    local,
    session,
    permit: (value: boolean) => {
      permitted = value;
    },
  };
}

test("inbox permission cannot enroll a visitor whose first submit was unmeasured", () => {
  const v = visitor(false);
  assert.equal(v.api.getConversionExperiment(), undefined);
  assert.equal(v.local.size + v.session.size, 0);
  v.api.closeExperimentEnrollmentOnSubmit();
  v.permit(true);
  assert.equal(v.api.getConversionExperiment(), undefined);
  assert.equal(v.local.size + v.session.size, 0);
});

test("observed stages stay independent and a withdrawal ends the measured session", () => {
  const v = visitor(true);
  const context = v.api.getConversionExperiment() as { variant: string };
  assert.equal(context.variant, "form_first");
  v.api.markConversionMilestone("formFocused");
  const funnel = v.api.getConversionFunnel() as { formFocused: boolean; formVisible: boolean };
  assert.equal(funnel.formFocused, true);
  assert.equal(funnel.formVisible, false);
  assert.ok(v.local.size > 0 && v.session.size > 0);
  v.permit(false);
  v.api.revokeConversionExperiment();
  assert.equal(v.local.size + v.session.size, 0);
  v.permit(true);
  assert.equal(v.api.getConversionExperiment(), undefined);
});
