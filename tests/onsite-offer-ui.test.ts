import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ONSITE_OFFER_COPY } from "../src/components/reservation/onsite-copy.ts";
import { reservationCopy } from "../src/components/reservation/copy.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import { normalizeInviteToken, statusRequestPath } from "../src/components/reservation/contract.ts";
import {
  rememberReservationEntry,
  RESERVATION_INVITE_STORAGE_KEY,
  RESERVATION_LANG_STORAGE_KEY,
  RESERVATION_INVALID_INVITE_KEY,
} from "../src/components/reservation/query.ts";
import { fetchReservationStatus } from "../src/components/reservation/client.ts";

// Run the real click handlers with deterministic React hook state, a fake server
// function, and a fake browser. Render the real view with React's server renderer.
// Neither this harness nor the components contact a service.
const root = resolve(import.meta.dirname, "..");
const cache = join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const temp = mkdtempSync(join(cache, "onsite-offer-ui-"));
const outfile = join(temp, "offer.mjs");
await build({
  stdin: {
    contents: `import {SignupReservationOffer} from "./src/components/reservation/SignupReservationOffer";
      import {beginRender} from "test:hooks";
      export {reset, setApi} from "test:hooks";
      export {ReservationOfferView} from "./src/components/reservation/ReservationOfferView";
      export const renderOffer=(props)=>{beginRender();return SignupReservationOffer(props).props;};`,
    resolveDir: root,
    loader: "tsx",
  },
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom"],
  alias: { "@": join(root, "src") },
  loader: { ".css": "empty" },
  plugins: [{
    name: "offline-onsite-ui",
    setup(b) {
      b.onResolve({ filter: /^react$/ }, (args) => args.namespace === "mock" ? undefined : { path: "hooks", namespace: "mock" });
      b.onResolve({ filter: /^test:hooks$/ }, () => ({ path: "hooks", namespace: "mock" }));
      b.onResolve({ filter: /onsiteReservation.functions$/ }, () => ({ path: "api", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
        contents: path === "api"
          ? 'import {callApi} from "test:hooks"; export const getOnsiteReservation=callApi;'
          : `export * from "react";
            let values=[],cursor=0,api;
            export const reset=()=>{values=[];cursor=0;api=()=>{throw Error("Unexpected API call")};};
            export const beginRender=()=>{cursor=0;};
            export const setApi=(fn)=>{api=fn;};
            export const callApi=(input)=>api(input);
            export const useState=(initial)=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=v;}];};
            export const useRef=(initial)=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];};
            export const useEffect=()=>{};`,
        loader: "js",
        resolveDir: root,
      }));
    },
  }],
  logLevel: "silent",
});
const ui = await import(pathToFileURL(outfile).href);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
after(() => {
  rmSync(temp, { recursive: true, force: true });
  for (const [key, descriptor] of [["window", originalWindow], ["document", originalDocument]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const pending = { kind: "pending", value: "pv1.offlinePendingPayload.offlineSignature" };
const stripeUrl = "https://checkout.stripe.com/c/pay/cs_test_offline";
const ready = { status: "ready", href: stripeUrl, statusToken: "pv1.offlineStatusPayload.offlineSignature" };
let navigations: string[];
let stored: Map<string, string>;
let storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
beforeEach(() => {
  ui.reset();
  navigations = [];
  stored = new Map();
  storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage, location: { assign: (href: string) => navigations.push(href) } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => null } });
});

function markup(props: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(ui.ReservationOfferView, props));
}

test("pending signup opens Stripe immediately, stores its status bearer and locale before leaving", async () => {
  stored.set(RESERVATION_INVALID_INVITE_KEY, "1");
  const props = { locale: "ko", credential: pending, verified: false, inboxId: "signup-inbox" };
  const calls: unknown[] = [];
  ui.setApi(async (input: unknown) => { calls.push(input); return ready; });
  window.location.assign = (href: string) => {
    assert.equal(stored.get(RESERVATION_INVITE_STORAGE_KEY), ready.statusToken);
    assert.equal(stored.get(RESERVATION_LANG_STORAGE_KEY), "ko");
    assert.equal(stored.get(RESERVATION_INVALID_INVITE_KEY), "0");
    navigations.push(href);
  };
  await ui.renderOffer(props).onContinue();
  assert.deepEqual(calls, [{ data: { credential: pending, locale: "ko" } }]);
  assert.deepEqual(navigations, [stripeUrl]);
  assert.equal(ui.renderOffer(props).error, "");
  assert.equal(ui.renderOffer(props).busy, true);
});

test("the submit lock prevents duplicate clicks before state rerenders and during navigation", async () => {
  let resolveRequest!: (value: unknown) => void;
  let calls = 0;
  ui.setApi(() => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); });
  const props = { locale: "en", credential: pending };
  const view = ui.renderOffer(props);
  const request = view.onContinue();
  await view.onContinue();
  assert.equal(calls, 1);
  assert.equal(ui.renderOffer(props).busy, true);
  resolveRequest(ready);
  await request;
  await ui.renderOffer(props).onContinue();
  assert.equal(calls, 1);
});

for (const kind of ["attempt", "confirmation"]) {
  test(`verified ${kind} uses the server-issued status bearer for its Stripe return`, async () => {
    const credential = { kind, value: "private-verification-credential" };
    ui.setApi(async (input: unknown) => {
      assert.deepEqual(input, { data: { credential, locale: "ja" } });
      return { ...ready, statusToken: "v1.offlineVerifiedPayload.offlineSignature" };
    });
    await ui.renderOffer({ locale: "ja", verified: true, credential }).onContinue();
    assert.equal(stored.get(RESERVATION_INVITE_STORAGE_KEY), "v1.offlineVerifiedPayload.offlineSignature");
    assert.equal(stored.get(RESERVATION_LANG_STORAGE_KEY), "ja");
    assert.deepEqual(navigations, [stripeUrl]);
  });
}

test("already_paid disables payment, shows localized confirmation and retains secondary verification", async () => {
  let calls = 0;
  ui.setApi(async () => { calls++; return { status: "already_paid" }; });
  const props = { locale: "ko", credential: pending, inboxId: "signup-inbox" };
  await ui.renderOffer(props).onContinue();
  const view = ui.renderOffer(props);
  const html = markup(view);
  assert.equal(view.alreadyPaid, true);
  assert.equal(view.busy, false);
  assert.equal(view.error, "");
  assert.match(html, /class="wd-onsite-cta" disabled=""/);
  assert.ok(html.includes(ONSITE_OFFER_COPY.ko.alreadyPaid));
  assert.ok(html.includes(ONSITE_OFFER_COPY.ko.paidStatus));
  assert.match(html, /class="wd-onsite-verify"/);
  await view.onContinue();
  assert.equal(calls, 1);
  assert.deepEqual(navigations, []);
});

for (const result of [{ status: "verification_required" }, { status: "unavailable" }, new Error("offline failure")]) {
  test(`${result instanceof Error ? "thrown error" : result.status} shows a localized error and permits retry`, async () => {
    const props = { locale: "fr", credential: pending };
    ui.setApi(async () => { if (result instanceof Error) throw result; return result; });
    await ui.renderOffer(props).onContinue();
    const view = ui.renderOffer(props);
    assert.equal(view.error, !(result instanceof Error) && result.status === "verification_required" ? ONSITE_OFFER_COPY.fr.expired : ONSITE_OFFER_COPY.fr.error);
    assert.equal(view.busy, false);
    assert.equal(view.alreadyPaid, false);
    assert.match(markup(view), /role="alert"/);
    ui.setApi(async () => ready);
    await ui.renderOffer(props).onContinue();
    assert.deepEqual(navigations, [stripeUrl]);
  });
}

test("secondary verification focuses and scrolls the inbox without requesting checkout", () => {
  const actions: unknown[] = [];
  const inbox = { focus: (options: unknown) => actions.push(["focus", options]), scrollIntoView: (options: unknown) => actions.push(["scroll", options]) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: (id: string) => { assert.equal(id, "signup-inbox"); return inbox; } } });
  const view = ui.renderOffer({ locale: "en", credential: pending, inboxId: "signup-inbox" });
  view.onVerify();
  assert.deepEqual(actions, [["focus", { preventScroll: true }], ["scroll", { block: "start", behavior: "smooth" }]]);
  assert.match(markup(view), /aria-controls="signup-inbox"/);
  assert.deepEqual(navigations, []);
  assert.equal(ui.renderOffer({ locale: "en", credential: pending, verified: true, inboxId: "signup-inbox" }).onVerify, undefined);
});

test("missing credentials disable payment without a false expired error; a missing inbox never crashes", async () => {
  const props = { locale: "en", inboxId: "missing-inbox" };
  await ui.renderOffer(props).onContinue();
  assert.equal(ui.renderOffer(props).error, "");
  assert.equal(ui.renderOffer(props).paymentAvailable, false);
  assert.match(markup(ui.renderOffer(props)), /class="wd-onsite-cta" disabled=""/);
  assert.doesNotThrow(() => ui.renderOffer(props).onVerify());
  assert.equal(ui.renderOffer({ locale: "en" }).onVerify, undefined);
});

test("only Stripe-hosted ready URLs can navigate", async () => {
  for (const href of ["/reservation#invite=secret", "https://evil.example/pay", "javascript:alert(1)"]) {
    ui.reset();
    ui.setApi(async () => ({ ...ready, href }));
    const props = { locale: "en", credential: pending };
    await ui.renderOffer(props).onContinue();
    assert.equal(ui.renderOffer(props).error, ONSITE_OFFER_COPY.en.error);
  }
  assert.deepEqual(navigations, []);
  assert.equal(stored.size, 0);
});

test("all nine locales retain pricing, disclosures and terms with independent payment and verification controls", () => {
  assert.deepEqual(Object.keys(ONSITE_OFFER_COPY).sort(), [...SUPPORTED_LOCALES].sort());
  assert.equal(ONSITE_OFFER_COPY.ko.cta, "$3로 최저가 보장받기");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = ONSITE_OFFER_COPY[locale];
    for (const value of Object.values(copy)) assert.ok(value.trim());
    assert.match(copy.body, /149/);
    assert.match(copy.nextPrice, /100/);
    assert.match(copy.nextPrice, /200/);
    const html = markup({ locale, onContinue() {}, onVerify() {}, inboxId: "signup-inbox" });
    for (const text of [copy.cta, copy.verifyCta, copy.pending, copy.separate, copy.refund, copy.noCharge, reservationCopy(locale).siteTerms]) assert.ok(html.includes(text), `${locale}: ${text}`);
    assert.match(html, /<strong>\$3<\/strong>/);
    assert.ok(html.includes(`/terms?lang=${locale}`));
    assert.doesNotMatch(html, /disabled=""|type="(?:email|tel|number)"/);
    const paid = markup({ locale, alreadyPaid: true, onContinue() {} });
    assert.ok(paid.includes(copy.alreadyPaid));
    assert.ok(paid.includes(copy.paidStatus));
    assert.match(paid, /disabled=""/);
    const verified = markup({ locale, verified: true, onContinue() {}, onVerify() {} });
    assert.ok(verified.includes(copy.cta));
    assert.ok(verified.includes(copy.verified));
    assert.doesNotMatch(verified, /wd-onsite-verify/);
  }
});

test("a pending bearer survives Stripe return and travels only in the status Authorization header", async () => {
  assert.equal(normalizeInviteToken(pending.value), pending.value);
  assert.equal(normalizeInviteToken("pv1.invalid@payload.signature"), null);
  assert.equal(normalizeInviteToken("pv2.offlinePayload.offlineSignature"), null);
  stored.set(RESERVATION_INVITE_STORAGE_KEY, pending.value);
  stored.set(RESERVATION_LANG_STORAGE_KEY, "ja");
  const first = rememberReservationEntry({ href: "https://example.com/reservation?session_id=cs_test_return", storage });
  assert.ok(first.replaceUrl);
  assert.equal(new URL(first.replaceUrl).searchParams.get("lang"), "ja");
  assert.equal(first.replaceUrl.includes(pending.value), false);
  const entry = rememberReservationEntry({ href: first.replaceUrl, storage });
  assert.equal(entry.inviteToken, pending.value);
  await fetchReservationStatus({ inviteToken: entry.inviteToken, sessionId: "cs_test_return" }, async (input, init) => {
    assert.equal(input, statusRequestPath("cs_test_return"));
    assert.equal(input.includes(pending.value), false);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${pending.value}`);
    return new Response("{}", { status: 503 });
  });
});
