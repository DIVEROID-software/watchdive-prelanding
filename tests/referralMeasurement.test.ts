import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { measurementPermitted } from "../src/lib/metaPixel.ts";
import {
  REFERRAL_COPY_EVENT,
  REFERRAL_MEASUREMENT_ACTIONS,
  REFERRAL_MEASUREMENT_SURFACES,
  bindReferralMeasurement,
  copyInputFromDetail,
  createExposureStore,
  gaMeasurementId,
  pageKey,
  parseMeasurementInput,
  readSharedMeasurementPermission,
  recordReferralCopy,
  resolveClickMeasurement,
  safePageLocation,
  safePageReferrer,
  trackReferralMeasurement,
  vercelPageIsPublic,
  type MeasurementElement,
  type MeasurementHost,
  type MeasurementLocation,
  type ReferralMeasurementSinks,
} from "../src/lib/referral/measurement.ts";

const SECRET_URL = "https://watchdive.diveroid.com/r/SECRETCODE?token=abc#frag";
const SECRET_EMAIL = "person@example.com";
const GA_PARAMS = [
  "send_to",
  "surface",
  "locale",
  "phase",
  "page_location",
  "page_referrer",
  "page_title",
];

type FakeEl = MeasurementElement & {
  attrs: Record<string, string>;
  children: FakeEl[];
  querySelectorAll(selector: string): FakeEl[];
};

function el(attrs: Record<string, string> = {}, children: FakeEl[] = []): FakeEl {
  const node = {
    nodeType: 1,
    parentElement: null as FakeEl | null,
    attrs,
    children,
    getAttribute(name: string) {
      if (
        name === "data-confirmed-emails" ||
        name === "data-held-team" ||
        name === "data-price-total" ||
        name === "data-referral-program" ||
        name === "href" ||
        name === "value"
      ) {
        throw new Error(`measurement read a private attribute: ${name}`);
      }
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    querySelectorAll(selector: string) {
      if (selector !== "[data-analytics-hook]") return [];
      const found: FakeEl[] = [];
      const walk = (current: FakeEl) => {
        for (const child of current.children) {
          if (child.getAttribute("data-analytics-hook")) found.push(child);
          walk(child);
        }
      };
      walk(node);
      return found;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function location(overrides: Partial<MeasurementLocation> = {}): MeasurementLocation {
  return {
    origin: "https://watchdive.diveroid.com",
    pathname: "/scuba",
    search: "",
    hash: "",
    referrer: "",
    ...overrides,
  };
}

function sinks(overrides: Partial<ReferralMeasurementSinks> = {}) {
  const gtagCalls: unknown[][] = [];
  const vercelCalls: unknown[][] = [];
  let permitted = true;
  let gaId: string | undefined = "G-TEST1234";
  let gtagMissing = false;
  const queue: Array<() => void> = [];
  let now = 1_000;
  const current = location();
  const api: ReferralMeasurementSinks & {
    gtagCalls: unknown[][];
    vercelCalls: unknown[][];
    setPermitted: (value: boolean) => void;
    setGaId: (value: string | undefined) => void;
    setGtagMissing: (value: boolean) => void;
    flush: () => void;
    locationState: MeasurementLocation;
    advance: (ms: number) => void;
    loadCalls: number;
  } = {
    gtagCalls,
    vercelCalls,
    locationState: current,
    loadCalls: 0,
    permitted: () => permitted,
    setPermitted: (value) => {
      permitted = value;
    },
    gaId: () => gaId,
    setGaId: (value) => {
      gaId = value;
    },
    setGtagMissing: (value) => {
      gtagMissing = value;
    },
    gtag: () => {
      if (gtagMissing) return undefined;
      return (command, name, params) => {
        gtagCalls.push([command, name, params]);
      };
    },
    loadVercelTrack: async () => {
      api.loadCalls += 1;
      return (name, props) => {
        vercelCalls.push([name, props]);
      };
    },
    location: () => current,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    schedule: (callback) => {
      queue.push(callback);
    },
    flush: () => {
      while (queue.length) queue.shift()?.();
    },
    store: createExposureStore(),
    ...overrides,
  };
  return api;
}

function payloadText(calls: unknown[][]): string {
  return JSON.stringify(calls);
}

test("the shared permission function is the existing measurement gate", () => {
  assert.equal(readSharedMeasurementPermission, measurementPermitted);
});

test("event and surface names stay within 40 characters and exclude purchase", () => {
  for (const name of [...REFERRAL_MEASUREMENT_ACTIONS, ...REFERRAL_MEASUREMENT_SURFACES]) {
    assert.equal(name.length <= 40, true, name);
    assert.equal(/purchase|Lead|CompleteRegistration|generate_lead|sign_up|conversion/i.test(name), false);
  }
});

test("a GA4 id is accepted and an Ads id is not", () => {
  assert.equal(gaMeasurementId({ gaId: "G-ABC123XY" }), "G-ABC123XY");
  assert.equal(gaMeasurementId({ gaId: "AW-123456789" }), undefined);
  assert.equal(gaMeasurementId({}), undefined);
});

test("page location and referrer drop query, hash, and referral codes", () => {
  const page = safePageLocation(
    location({
      pathname: "/ko/r/SECRETCODE",
      search: "?token=abc&ref=1",
      hash: "#status",
      referrer: SECRET_URL,
    }),
  );
  assert.equal(page, "https://watchdive.diveroid.com/r");
  assert.equal(page?.includes("SECRET"), false);
  assert.equal(page?.includes("?"), false);
  assert.equal(page?.includes("#"), false);
  const referrer = safePageReferrer(SECRET_URL, "https://watchdive.diveroid.com");
  assert.equal(referrer, "https://watchdive.diveroid.com/r");
  assert.equal(referrer.includes("SECRET"), false);
  assert.equal(
    safePageReferrer(
      "https://news.example/reader/person@example.com/story?id=1#frag",
      "https://watchdive.diveroid.com",
    ),
    "https://news.example",
  );
  assert.equal(
    safePageReferrer("https://watchdive.diveroid.com/buddy/SECRETTOKEN#status", "https://watchdive.diveroid.com"),
    "https://watchdive.diveroid.com/",
  );
  assert.equal(safePageReferrer("https://user:secret@news.example/path", "https://watchdive.diveroid.com"), "");
  assert.equal(safePageReferrer("javascript:alert(1)", "https://watchdive.diveroid.com"), "");
  assert.equal(
    vercelPageIsPublic(location({ pathname: "/ko/scuba", search: "?utm_source=ig" })),
    false,
  );
  assert.equal(vercelPageIsPublic(location({ pathname: "/verify", hash: "#token" })), false);
  for (const pathname of ["/verify", "/reservation", "/buddy", "/ko/buddy", "/buddy/SECRET", "/admin/behavior"]) {
    assert.equal(vercelPageIsPublic(location({ pathname, search: "", hash: "" })), false, pathname);
  }
  assert.equal(vercelPageIsPublic(location({ pathname: "/zh-tw/scuba" })), true);
  assert.equal(pageKey("/zh-tw/scuba"), "zh-TW|/scuba");
});

test("unknown keys and identity fields are dropped, and blocked event names do not send", async () => {
  const api = sinks();
  const delivery = await trackReferralMeasurement(
    {
      action: "wd_price_path_view",
      surface: "price_public",
      locale: "ko",
      phase: "pre_signup",
      email: SECRET_EMAIL,
      url: SECRET_URL,
      ref: "SECRETCODE",
      value: 149,
      currency: "USD",
      transaction_id: "tx",
      items: [{ item_id: "housing" }],
      send_to: "AW-123456789/label",
    },
    api,
  );
  assert.equal(delivery.sent, true);
  assert.equal(delivery.ga, true);
  assert.equal(delivery.vercel, true);
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.deepEqual(Object.keys(params).sort(), [...GA_PARAMS].sort());
  assert.equal(params.send_to, "G-TEST1234");
  assert.equal(params.page_title, "WatchDive");
  assert.equal(params.locale, "ko");
  assert.equal(params.surface, "price_public");
  const text = payloadText([...api.gtagCalls, ...api.vercelCalls]);
  assert.equal(text.includes(SECRET_EMAIL), false);
  assert.equal(text.includes("SECRET"), false);
  assert.equal(text.includes("AW-"), false);
  assert.equal(text.includes("149"), false);
  assert.equal(text.includes("USD"), false);
  assert.equal(text.includes("transaction_id"), false);
  assert.equal(params.page_location.includes("?"), false);
  assert.equal(params.page_location.includes("#"), false);
  for (const action of ["purchase", "Lead", "CompleteRegistration", "generate_lead", "sign_up", "conversion"]) {
    const blocked = sinks();
    const result = await trackReferralMeasurement(
      { action, surface: "price_public", locale: "en", phase: "pre_signup", value: 3 },
      blocked,
    );
    assert.equal(result.reason, "invalid");
    assert.equal(blocked.gtagCalls.length, 0);
    assert.equal(blocked.vercelCalls.length, 0);
    assert.equal(blocked.loadCalls, 0);
  }
});

test("denial sends nothing and does not ask Vercel to load", async () => {
  const api = sinks();
  api.setPermitted(false);
  const delivery = await trackReferralMeasurement(
    { action: "wd_reservation_click", surface: "reservation_choice", locale: "en", phase: "post_verify" },
    api,
  );
  assert.equal(delivery.reason, "denied");
  assert.equal(api.gtagCalls.length, 0);
  assert.equal(api.vercelCalls.length, 0);
  assert.equal(api.loadCalls, 0);
});

test("withdrawal during Vercel loading does not deliver the Vercel event", async () => {
  let release: (track: (name: string, props: Record<string, string>) => void) => void = () => undefined;
  const api = sinks({
    loadVercelTrack: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = trackReferralMeasurement(
    { action: "wd_price_path_view", surface: "price_paths", locale: "en", phase: "pre_signup" },
    api,
  );
  await Promise.resolve();
  api.setPermitted(false);
  let vercelCalls = 0;
  release(() => {
    vercelCalls += 1;
  });
  const delivery = await pending;
  assert.equal(vercelCalls, 0);
  assert.equal(delivery.vercel, false);
  assert.equal(delivery.ga, true);
  assert.equal(api.gtagCalls[0]?.[0], "event");
  assert.equal(api.gtagCalls.some((call) => call[0] !== "event"), false);
});

test("a public URL with a query still reaches GA4 and skips Vercel", async () => {
  const api = sinks();
  api.locationState.search = "?utm_source=ig&utm_campaign=120";
  api.locationState.pathname = "/r/SECRETCODE";
  const delivery = await trackReferralMeasurement(
    { action: "wd_referral_offer_view", surface: "verify_card", locale: "en", phase: "post_verify" },
    api,
  );
  assert.equal(delivery.ga, true);
  assert.equal(delivery.vercel, false);
  assert.equal(api.loadCalls, 0);
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.page_location, "https://watchdive.diveroid.com/r");
  assert.equal(JSON.stringify(params).includes("SECRET"), false);
  assert.equal(JSON.stringify(params).includes("utm_"), false);
});

test("a private route does not load Vercel even when the fragment is empty", async () => {
  for (const pathname of ["/verify", "/reservation", "/buddy", "/ko/buddy", "/buddy/SECRETTOKEN"]) {
    const api = sinks();
    api.locationState.pathname = pathname;
    api.locationState.search = "";
    api.locationState.hash = "";
    const delivery = await trackReferralMeasurement(
      { action: "wd_referral_offer_view", surface: "verify_card", locale: "en", phase: "post_verify" },
      api,
    );
    assert.equal(api.loadCalls, 0, pathname);
    assert.equal(delivery.vercel, false, pathname);
    assert.equal(delivery.ga, true, pathname);
    const params = api.gtagCalls[0]?.[2] as Record<string, string>;
    assert.equal(params.page_location.includes("SECRET"), false, pathname);
    assert.equal(params.page_location.includes("#"), false, pathname);
    assert.equal(params.page_location.includes("?"), false, pathname);
  }
});

test("Vercel is not called when the page changes while its module loads", async () => {
  let release: (track: (name: string, props: Record<string, string>) => void) => void = () => undefined;
  const api = sinks({
    loadVercelTrack: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  api.locationState.pathname = "/scuba";
  const pending = trackReferralMeasurement(
    { action: "wd_price_path_view", surface: "price_paths", locale: "en", phase: "pre_signup" },
    api,
  );
  await Promise.resolve();
  api.locationState.pathname = "/verify";
  api.locationState.hash = "#token";
  let vercelCalls = 0;
  release(() => {
    vercelCalls += 1;
  });
  const delivery = await pending;
  assert.equal(vercelCalls, 0);
  assert.equal(delivery.vercel, false);
  assert.equal(delivery.ga, true);
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.page_location, "https://watchdive.diveroid.com/scuba");
  assert.equal(JSON.stringify(params).includes("token"), false);
});

test("the same view is sent once per page, and a route change can send it again", async () => {
  const api = sinks();
  const input = { action: "wd_price_path_view", surface: "price_buddy", locale: "ja", phase: "pre_signup" };
  assert.equal((await trackReferralMeasurement(input, api)).sent, true);
  assert.equal((await trackReferralMeasurement(input, api)).reason, "duplicate");
  api.locationState.pathname = "/ja/freediving";
  assert.equal((await trackReferralMeasurement(input, api)).sent, true);
  assert.equal(api.gtagCalls.length, 2);
});

test("a repeated click inside the dedupe window is one event, and a later click counts", async () => {
  const api = sinks();
  const input = { action: "wd_referral_share_click", surface: "signup_success", locale: "en", phase: "post_verify" };
  assert.equal((await trackReferralMeasurement(input, api)).sent, true);
  assert.equal((await trackReferralMeasurement(input, api)).reason, "duplicate");
  api.advance(40);
  assert.equal((await trackReferralMeasurement(input, api)).sent, true);
  assert.equal(api.gtagCalls.length, 2);
});

test("mismatched surface and action is invalid", () => {
  assert.equal(
    parseMeasurementInput({
      action: "wd_reservation_click",
      surface: "price_public",
      locale: "en",
      phase: "post_verify",
    }),
    null,
  );
  assert.equal(parseMeasurementInput({ action: "wd_referral_copy", surface: "verify_card", locale: "EN", phase: "post_verify" }), null);
});

type Listener = {
  type: string;
  capture: boolean;
  listener: (event: { type: string; target: MeasurementElement | null; key?: string | null; detail?: unknown }) => void;
};

function hostFor(root: FakeEl, api: ReturnType<typeof sinks>) {
  const listeners: Listener[] = [];
  const observed: FakeEl[] = [];
  let disconnects = 0;
  let constructed = 0;
  const mutations: Array<(records: Array<{ addedNodes: FakeEl[]; removedNodes: FakeEl[] }>) => void> = [];
  const intersections: Array<(entries: Array<{ target: FakeEl; intersectionRatio: number }>) => void> = [];
  const host: MeasurementHost = {
    root,
    location: () => api.locationState,
    addEventListener: (type, listener, capture) => {
      listeners.push({ type, capture: capture === true, listener });
    },
    removeEventListener: (type, listener, capture) => {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener && entry.capture === (capture === true),
      );
      if (index >= 0) listeners.splice(index, 1);
    },
    IntersectionObserver: class {
      constructor(callback: (entries: ReadonlyArray<{ target: MeasurementElement; intersectionRatio: number }>) => void) {
        constructed += 1;
        intersections.push(callback as (entries: Array<{ target: FakeEl; intersectionRatio: number }>) => void);
      }
      observe(element: MeasurementElement) {
        observed.push(element as FakeEl);
      }
      unobserve(element: MeasurementElement) {
        const index = observed.indexOf(element as FakeEl);
        if (index >= 0) observed.splice(index, 1);
      }
      disconnect() {
        disconnects += 1;
        observed.splice(0, observed.length);
      }
    },
    MutationObserver: class {
      constructor(
        callback: (
          records: ReadonlyArray<{ addedNodes: ArrayLike<MeasurementElement>; removedNodes: ArrayLike<MeasurementElement> }>,
        ) => void,
      ) {
        mutations.push(callback as (records: Array<{ addedNodes: FakeEl[]; removedNodes: FakeEl[] }>) => void);
      }
      observe() {}
      disconnect() {}
    },
  };
  return {
    host,
    listeners,
    observed,
    constructed: () => constructed,
    disconnects: () => disconnects,
    see(element: FakeEl, ratio: number) {
      for (const callback of intersections) callback([{ target: element, intersectionRatio: ratio }]);
    },
    add(element: FakeEl) {
      for (const callback of mutations) callback([{ addedNodes: [element], removedNodes: [] }]);
    },
    click(target: FakeEl, runTarget?: () => void) {
      for (const entry of listeners.filter((item) => item.type === "click" && item.capture)) {
        entry.listener({ type: "click", target });
      }
      runTarget?.();
      api.flush();
    },
    emit(type: string, detail?: unknown) {
      for (const entry of listeners.filter((item) => item.type === type)) {
        entry.listener({ type, target: null, detail });
      }
      api.flush();
    },
    grant() {
      api.setPermitted(true);
      for (const entry of [...listeners]) {
        if (entry.type === "watchdive:measurement-choice") entry.listener({ type: entry.type, target: null });
      }
      api.flush();
    },
  };
}

function tree() {
  const goal = el({
    "data-analytics-hook": "buddy_price_goal",
    "data-share-placement": "verify_card",
    "data-confirmed-emails": "4",
    "data-held-team": "held",
  });
  const share = el({
    "data-analytics-hook": "referral_share",
    "data-share-placement": "verify_card",
    "data-referral-program": "on",
  });
  const reservationButton = el({ "data-reservation-action": "pending" });
  const reservation = el({ "data-analytics-hook": "verify_choice", "data-verify-choice": "reservation" }, [reservationButton]);
  const phone = el({ "data-analytics-hook": "verify_choice", "data-verify-choice": "phone" }, [el({ "data-reservation-action": "pending" })]);
  const buddy = el({ "data-analytics-hook": "verify_choice", "data-verify-choice": "buddy" }, [share, goal]);
  const details = el({ "data-analytics-hook": "price_path_details", "data-price-path": "reservation" });
  const publicPath = el({ "data-analytics-hook": "price_path", "data-price-path": "public" });
  const reservationPath = el({ "data-analytics-hook": "price_path", "data-price-path": "reservation", "data-price-total": "152" }, [details]);
  const paths = el({ "data-analytics-hook": "price_paths", "data-referral-program": "on" }, [publicPath, reservationPath]);
  const root = el({}, [paths, buddy, reservation, phone]);
  return { root, goal, share, reservationButton, phone, publicPath, paths, details };
}

test("half visibility sends one view and ignores private attributes", async () => {
  const api = sinks();
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  const stop = bindReferralMeasurement({ host: ui.host, sinks: api });
  assert.equal(ui.observed.includes(nodes.paths), true);
  assert.equal(ui.observed.includes(nodes.publicPath), true);
  assert.equal(ui.observed.includes(nodes.goal), true);
  assert.equal(ui.observed.includes(nodes.share), false);
  ui.see(nodes.publicPath, 0.49);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 0);
  ui.see(nodes.publicPath, 0.5);
  ui.see(nodes.publicPath, 0.9);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  assert.equal(api.gtagCalls[0]?.[1], "wd_price_path_view");
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.surface, "price_public");
  assert.equal(params.phase, "pre_signup");
  assert.equal(JSON.stringify(params).includes("152"), false);
  assert.equal(JSON.stringify(params).includes("held"), false);
  ui.see(nodes.goal, 1);
  await Promise.resolve();
  ui.see(nodes.root.querySelectorAll("[data-analytics-hook]").find((node) => node.attrs["data-verify-choice"] === "buddy") as FakeEl, 1);
  await Promise.resolve();
  const offerCalls = api.gtagCalls.filter((call) => call[1] === "wd_referral_offer_view");
  assert.equal(offerCalls.length, 1);
  assert.equal((offerCalls[0]?.[2] as Record<string, string>).surface, "verify_card");
  stop();
});

test("late consent emits the visible card once and does not replay an earlier click or copy", async () => {
  const api = sinks();
  api.setPermitted(false);
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  bindReferralMeasurement({ host: ui.host, sinks: api });
  ui.see(nodes.goal, 1);
  ui.click(nodes.share);
  ui.emit(REFERRAL_COPY_EVENT, { surface: "verify_card", locale: "en", url: SECRET_URL });
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 0);
  assert.equal(api.loadCalls, 0);
  ui.grant();
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  assert.equal(api.gtagCalls[0]?.[1], "wd_referral_offer_view");
  assert.equal(api.gtagCalls.some((call) => call[1] === "wd_referral_share_click" || call[1] === "wd_referral_copy"), false);
  assert.equal(payloadText(api.gtagCalls).includes("SECRET"), false);
});

test("a share click is intent and does not intercept clipboard or native share", async () => {
  const api = sinks();
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  bindReferralMeasurement({ host: ui.host, sinks: api });
  const writes: string[] = [];
  let shareData: unknown = null;
  const navigatorLike = {
    share: async (data?: unknown) => {
      shareData = data;
    },
    clipboard: {
      writeText: async (text: string) => {
        writes.push(text);
      },
    },
  };
  const shareFn = navigatorLike.share;
  const writeFn = navigatorLike.clipboard.writeText;
  ui.click(nodes.share, () => {
    void navigatorLike.share({ url: SECRET_URL, text: SECRET_EMAIL });
    void navigatorLike.clipboard.writeText(SECRET_URL);
  });
  await Promise.resolve();
  assert.equal(navigatorLike.share, shareFn);
  assert.equal(navigatorLike.clipboard.writeText, writeFn);
  assert.deepEqual(writes, [SECRET_URL]);
  assert.equal(shareData !== null && typeof shareData === "object", true);
  assert.deepEqual(
    api.gtagCalls.map((call) => call[1]),
    ["wd_referral_share_click"],
  );
  assert.equal(payloadText(api.gtagCalls).includes("SECRET"), false);
  assert.equal(payloadText(api.gtagCalls).includes(SECRET_EMAIL), false);
});

test("copy is recorded only by an explicit call or event after clipboard success", async () => {
  const blocked = sinks();
  blocked.setPermitted(false);
  const denied = await recordReferralCopy("verify_card", "ko", blocked);
  assert.equal(denied.reason, "denied");
  assert.equal(blocked.gtagCalls.length, 0);
  assert.equal(blocked.loadCalls, 0);

  const api = sinks();
  const invalid = await recordReferralCopy("price_public", "ko", api);
  assert.equal(invalid.reason, "invalid");
  assert.equal(api.gtagCalls.length, 0);
  const copied = await recordReferralCopy("verify_card", "ko", api);
  assert.equal(copied.sent, true);
  assert.equal(api.gtagCalls[0]?.[1], "wd_referral_copy");
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.surface, "verify_card");
  assert.equal(params.locale, "ko");
  assert.equal(params.phase, "post_verify");
  assert.deepEqual(Object.keys(params).sort(), [...GA_PARAMS].sort());
  assert.equal((await recordReferralCopy("verify_card", "ko", api)).reason, "duplicate");

  api.advance(40);
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  bindReferralMeasurement({ host: ui.host, sinks: api });
  assert.deepEqual(copyInputFromDetail({ surface: "signup_success", locale: "de", url: SECRET_URL, email: SECRET_EMAIL }), {
    action: "wd_referral_copy",
    surface: "signup_success",
    locale: "de",
    phase: "post_verify",
  });
  assert.equal(copyInputFromDetail(SECRET_URL), null);
  ui.emit(REFERRAL_COPY_EVENT, {
    surface: "signup_success",
    locale: "de",
    url: SECRET_URL,
    email: SECRET_EMAIL,
    phase: "status",
    method: "copy",
  });
  await Promise.resolve();
  const eventParams = api.gtagCalls.at(-1)?.[2] as Record<string, string>;
  assert.equal(api.gtagCalls.at(-1)?.[1], "wd_referral_copy");
  assert.equal(eventParams.surface, "signup_success");
  assert.equal(eventParams.locale, "de");
  assert.equal(eventParams.phase, "post_verify");
  assert.equal(payloadText(api.gtagCalls).includes("SECRET"), false);
  assert.equal(payloadText(api.gtagCalls).includes(SECRET_EMAIL), false);
  assert.equal(JSON.stringify(eventParams).includes("method"), false);
  const before = api.gtagCalls.length;
  ui.emit(REFERRAL_COPY_EVENT, SECRET_URL);
  ui.emit(REFERRAL_COPY_EVENT, { surface: "verify_card" });
  ui.emit(REFERRAL_COPY_EVENT, { surface: "price_paths", locale: "en", url: SECRET_URL });
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, before);
});

test("a reservation button click is not a purchase, and phone or detail clicks are not events", async () => {
  const api = sinks();
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  bindReferralMeasurement({ host: ui.host, sinks: api });
  ui.click(nodes.reservationButton);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  assert.equal(api.gtagCalls[0]?.[1], "wd_reservation_click");
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.surface, "reservation_choice");
  assert.equal(Object.hasOwn(params, "value"), false);
  assert.equal(JSON.stringify(params).includes("pending"), false);
  const before = api.gtagCalls.length;
  ui.click(nodes.phone.children[0] as FakeEl);
  ui.click(nodes.details);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, before);
});

test("a card mounted after verification can be observed once", async () => {
  const api = sinks();
  api.locationState.pathname = "/verify";
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  bindReferralMeasurement({ host: ui.host, sinks: api });
  const added = el({ "data-analytics-hook": "buddy_price_goal", "data-share-placement": "signup_success" });
  ui.add(added);
  assert.equal(ui.observed.includes(added), true);
  ui.see(added, 1);
  ui.see(added, 1);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  const params = api.gtagCalls[0]?.[2] as Record<string, string>;
  assert.equal(params.surface, "signup_success");
  assert.equal(params.phase, "post_verify");
});

test("strict mode shares one observer and does not repeat a view after remount", async () => {
  const api = sinks();
  const nodes = tree();
  const ui = hostFor(nodes.root, api);
  const stopA = bindReferralMeasurement({ host: ui.host, sinks: api });
  const stopB = bindReferralMeasurement({ host: ui.host, sinks: api });
  assert.equal(ui.constructed(), 1);
  ui.see(nodes.publicPath, 1);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  stopA();
  assert.equal(ui.disconnects(), 0);
  stopB();
  assert.equal(ui.disconnects(), 1);
  assert.equal(ui.listeners.length, 0);
  const stopC = bindReferralMeasurement({ host: ui.host, sinks: api });
  assert.equal(ui.constructed(), 2);
  ui.see(nodes.publicPath, 1);
  await Promise.resolve();
  assert.equal(api.gtagCalls.length, 1);
  stopC();
});

test("the helper source does not hardcode a measurement id, wrap the clipboard, or touch consent storage", () => {
  const source = readFileSync(new URL("../src/lib/referral/measurement.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../src/components/referral/ReferralMeasurement.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("G-JFZR"), false);
  assert.equal(source.includes("AW-"), false);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("document.cookie"), false);
  assert.equal(source.includes("fbq"), false);
  assert.equal(source.includes("observeShareOutcome"), false);
  assert.equal(source.includes("NavigatorLike"), false);
  assert.equal(source.includes("navigator.clipboard"), false);
  assert.equal(source.includes("navigator.share"), false);
  assert.equal(/\.writeText\s*=/.test(source), false);
  assert.equal(/\.share\s*=/.test(source), false);
  assert.equal(component.includes("bindReferralMeasurement"), true);
  assert.equal(component.includes("return null"), true);
});

test("signup success and the verify card are mounted only after verification", () => {
  const index = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const verify = readFileSync(new URL("../src/routes/verify.tsx", import.meta.url), "utf8");
  const card = readFileSync(new URL("../src/components/referral/VerifiedBuddyCard.tsx", import.meta.url), "utf8");
  const successStart = index.indexOf("function ReferralSuccess");
  const success = index.slice(successStart, index.indexOf("\nfunction ", successStart + 10));
  const writeAt = success.indexOf("await navigator.clipboard.writeText(shareUrl)");
  const recordAt = success.indexOf('recordReferralCopy("signup_success", locale)');
  const shareAt = success.indexOf("navigator.share");
  assert.equal(writeAt > shareAt && recordAt > writeAt, true);
  const verifiedAt = index.indexOf("if (verified)");
  const alreadyAt = index.indexOf("if (alreadyVerified)");
  assert.equal(alreadyAt > 0 && verifiedAt > alreadyAt, true);
  assert.equal(index.slice(alreadyAt, verifiedAt).includes("ReferralSuccess"), false);
  assert.equal(index.slice(alreadyAt, verifiedAt).includes("signup_success"), false);
  assert.equal(index.slice(verifiedAt, verifiedAt + 900).includes("ReferralSuccess"), true);
  const verifiedState = verify.indexOf('state === "verified"');
  assert.equal(verifiedState > 0, true);
  assert.equal(verify.slice(0, verifiedState).includes("<VerifiedBuddyCard"), false);
  assert.equal(verify.slice(verifiedState).includes("<VerifiedBuddyCard"), true);
  const shareStart = card.indexOf("async function share()");
  const shareFn = card.slice(shareStart, card.indexOf("async function submit", shareStart));
  const cardWrite = shareFn.indexOf("await navigator.clipboard.writeText(shareUrl)");
  const cardRecord = shareFn.indexOf('recordReferralCopy("verify_card", locale)');
  assert.equal(cardWrite > shareFn.indexOf("navigator.share") && cardRecord > cardWrite, true);
  assert.equal(shareFn.slice(0, cardWrite).includes("recordReferralCopy"), false);
});


test("signup reservation clicks keep pending and verified stages distinct without changing the action", () => {
  const pending = el({ "data-reservation-action": "pending" });
  assert.deepEqual(resolveClickMeasurement(pending, "/ko/scuba"), {
    action: "wd_reservation_click", surface: "signup_reservation", locale: "ko", phase: "post_signup",
  });
  const verified = el({ "data-reservation-action": "verified" });
  assert.equal(resolveClickMeasurement(verified, "/zh-tw/freediving")?.phase, "post_verify");
  assert.equal(resolveClickMeasurement(verified, "/buddy/private-token"), null);
  const unknown = el({ "data-reservation-action": "arbitrary" });
  assert.equal(resolveClickMeasurement(unknown, "/scuba"), null);
});
