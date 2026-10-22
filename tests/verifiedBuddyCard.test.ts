import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmVerificationService,
  requestVerificationService,
} from "../src/lib/verification/service.ts";
import { referralSecret, verifyStatusToken } from "../src/lib/referral/statusToken.ts";
import { FakeLeadStore, FakeMailer, leadIdFactory, TEST_ENV } from "./helpers/fakes.ts";

async function fixture(enabled: boolean) {
  const store = new FakeLeadStore();
  const mailer = new FakeMailer();
  const env = { ...TEST_ENV, WATCHDIVE_REFERRAL_PROGRAM_ENABLED: enabled ? "1" : "0" };
  const deps = {
    store,
    mailer,
    env,
    now: () => new Date("2026-10-22T01:00:00Z"),
    leadId: leadIdFactory(),
    refCode: () => "abcd1234",
    sleep: async () => {},
  };
  await requestVerificationService(
    {
      email: "diver@example.com",
      canonical: "diver@example.com",
      source: "hero",
      flags: [],
      suspect: false,
      measurementConsent: false,
      networkSendBlocked: false,
    },
    deps,
  );
  return { deps, token: new URL(mailer.lastUrl!).hash.slice(1) };
}

for (const enabled of [false, true]) {
  test(`confirm status token is scoped to row and switch ${enabled}`, async () => {
    const { deps, token } = await fixture(enabled);
    for (const status of ["verified", "already_verified"]) {
      const result = await confirmVerificationService(token, deps);
      assert.equal(result.status, status);
      if (enabled)
        assert.equal(verifyStatusToken(result.statusToken, referralSecret(deps.env)), "abcd1234");
      else assert.equal(Object.hasOwn(result, "statusToken"), false);
    }
  });
}

test("invalid and expired attempts never receive a Buddy status credential", async () => {
  const { deps, token } = await fixture(true);
  assert.deepEqual(await confirmVerificationService("invalid", deps), {
    ok: true,
    status: "invalid",
  });
  const row = await deps.store.findByEmail("diver@example.com", "diver@example.com");
  assert.ok(row);
  row.expiresAt = "2026-10-21T00:00:00Z";
  const result = await confirmVerificationService(token, deps);
  assert.equal(result.status, "expired");
  assert.equal(Object.hasOwn(result, "statusToken"), false);
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { after } from "node:test";

const root = resolve(import.meta.dirname, "..");
const cache = join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const temp = mkdtempSync(join(cache, "verify-card-"));
after(() => rmSync(temp, { recursive: true, force: true }));

async function renderVerify(on = false) {
  const outfile = join(temp, `verify-${on}.mjs`);
  const source = readFileSync(join(root, "src/routes/verify.tsx"), "utf8");
  await build({
    stdin: { contents: source, resolveDir: root, loader: "tsx" },
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    define: { "import.meta.env": "{}" },
    alias: { "@": join(root, "src") },
    plugins: [
      {
        name: "fake-confirmed-page",
        setup(b) {
          b.onResolve({ filter: /^react$/ }, (args) =>
            args.namespace === "mock" ? undefined : { path: "react-hooks", namespace: "mock" },
          );
          b.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
            path: "router",
            namespace: "mock",
          }));
          b.onResolve({ filter: /use-current-locale$/ }, () => ({
            path: "locale",
            namespace: "mock",
          }));
          b.onResolve({ filter: /waitlist.functions$/ }, () => ({
            path: "api",
            namespace: "mock",
          }));
          b.onResolve({ filter: /VerifiedBuddyCard$/ }, () => ({
            path: "card",
            namespace: "mock",
          }));
          b.onResolve({ filter: /phone-optin-card$/ }, () => ({
            path: "phone",
            namespace: "mock",
          }));
          b.onResolve({ filter: /measurement-ask$/ }, () => ({
            path: "measurement",
            namespace: "mock",
          }));
          b.onResolve({ filter: /price-claim-loader$/ }, () => ({
            path: "price",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => {
            const contents: Record<string, string> = {
              "react-hooks": `export * from "react"; let strings=0; export const useState=(v)=>[v==="reading"?"verified":v===""?(++strings===1?"abcd1234":${JSON.stringify(on ? "private-status-credential" : "")}):v,()=>{}]; export const useEffect=()=>{};`,
              router:
                'import {createElement} from "react"; export const createFileRoute=()=>x=>x; export const Link=({to,children,...p})=>createElement("a",{...p,href:to},children);',
              locale: `import {EN_FROZEN_LANDING_MESSAGES as m} from "${join(root, "src/lib/i18n/frozen-landing-en.ts")}"; export const useCurrentLocale=()=>"en"; export const useFrozenLandingMessages=()=>m;`,
              api: "export const withdrawAttemptMeasurement=()=>{}; export const confirmVerification=()=>{}; export const grantConfirmationMeasurement=()=>{}; export const withdrawConfirmationMeasurement=()=>{};",
              card: 'import {createElement} from "react"; export const VerifiedBuddyCard=()=>createElement("section",null,"Buddy Invite enabled");',
              phone: "export const PhoneOptInCard=()=>null;",
              measurement:
                "export const markWithdrawalRecorded=()=>{}; export const MeasurementAsk=()=>null; export const clearWithdrawalRecorded=()=>{}; export const measurementAskEligible=()=>false; export const withdrawalNeedsRetry=()=>false;",
              price: "export const loadReferralPriceClaimOnly=()=>{};",
            };
            return { contents: contents[path], loader: "js", resolveDir: root };
          });
        },
      },
    ],
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(outfile).href);
  return renderToStaticMarkup(createElement(module.VerifyPage));
}

test("OFF successful verify markup is byte-identical to the original page", async () => {
  // Frozen from origin/main before this change; portable to shallow CI checkouts.
  const expected = readFileSync(join(root, "tests/fixtures/verifiedBuddyOff.html"), "utf8");
  assert.equal(await renderVerify(false), expected);
});

test("ON confirmation mounts Buddy card without serializing its credential", async () => {
  const html = await renderVerify(true);
  assert.match(html, /Buddy Invite enabled/);
  assert.ok(!html.includes("private-status-credential"));
});
