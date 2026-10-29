/** First-click signup jump. Executes the helper against the router's commit order.
 * No dev server, signup, mail, or ads calls. The 390x664 geometry is the
 * production first-click measurement: panel at the top leaves the button offscreen.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, test } from "node:test";
import ts from "typescript";

const viewHeight = 664;
const panelTop = 4000;
const inputTop = panelTop + 653;
const inputHeight = 54;
const buttonTop = panelTop + 719;
const buttonHeight = 54;
const formTop = inputTop;
const formHeight = buttonTop + buttonHeight - inputTop;

type Box = { id: string; top: number; bottom: number };
type JumpOptions = { href: string; resetScroll: false; hashScrollIntoView: false };
type JumpFn = (event: {
  preventDefault(): void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}, navigate: (options: JumpOptions) => Promise<void>) => Promise<void>;

class HTMLElement {
  id = "";
  pageTop = 0;
  height = 0;
  form: HTMLElement | null = null;
  focus(options?: { preventScroll?: boolean }) {
    state.focusCalls.push({ id: this.id, preventScroll: options?.preventScroll === true });
    state.active = this;
  }
  scrollIntoView(options?: ScrollIntoViewOptions | boolean) {
    const block = typeof options === "object" && options?.block ? options.block : "start";
    state.scrolls.push({ id: this.id, block, committed: state.committed });
    if (block === "center") state.scrollY = this.pageTop + this.height / 2 - viewHeight / 2;
    else state.scrollY = this.pageTop;
  }
  querySelector(selector: string) {
    return selector === "form[data-wd-signup]" ? this.form : null;
  }
  getBoundingClientRect() {
    return {
      top: this.pageTop - state.scrollY,
      bottom: this.pageTop - state.scrollY + this.height,
      left: 0,
      right: 390,
      width: 390,
      height: this.height,
      x: 0,
      y: this.pageTop - state.scrollY,
    };
  }
}

const nodes = new Map<string, HTMLElement>();
const state = {
  scrollY: 0,
  active: null as HTMLElement | null,
  focusCalls: [] as Array<{ id: string; preventScroll: boolean }>,
  scrolls: [] as Array<{ id: string; block: string; committed: boolean }>,
  committed: false,
  pushStateCalls: 0,
};

function place(id: string, pageTop: number, height: number) {
  const node = new HTMLElement();
  node.id = id;
  node.pageTop = pageTop;
  node.height = height;
  nodes.set(id, node);
  return node;
}

function box(id: string): Box {
  const rect = nodes.get(id)!.getBoundingClientRect();
  return { id, top: rect.top, bottom: rect.bottom };
}

function inside(id: string) {
  const rect = box(id);
  assert.ok(rect.top >= 0 && rect.bottom <= viewHeight, `${id} ${rect.top}..${rect.bottom} outside ${viewHeight}`);
  return rect;
}

/** Same order as router-core scroll restoration: reset, then hash scroll unless disabled. */
function commitLikeInstalledRouter(options: { href: string; resetScroll?: boolean; hashScrollIntoView?: boolean | ScrollIntoViewOptions }) {
  if (options.resetScroll !== false) state.scrollY = 0;
  if (options.hashScrollIntoView !== false) {
    const hash = options.href.slice(options.href.indexOf("#") + 1);
    nodes.get(hash)?.scrollIntoView(typeof options.hashScrollIntoView === "object" ? options.hashScrollIntoView : undefined);
  }
}

const pathname = "/en/scuba";
const search = "?utm_source=ig&utm_medium=paid&utm_campaign=120251732986720215&utm_term=dive%20computer";
let focusMiddleSignup: JumpFn;
let commitMiddleSignup: (router: {
  state: { location: { href: string } & Record<string, unknown> };
  commitLocation: (options: { publicHref: string; href: string; hash: string; resetScroll: false; hashScrollIntoView: false }) => Promise<void>;
}, options: JumpOptions) => Promise<void>;

before(async () => {
  const source = readFileSync(new URL("../src/components/segments/SegmentHeroJump.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("history.pushState"), false);
  assert.equal(source.includes("requestAnimationFrame"), false);
  assert.equal(source.includes("setTimeout"), false);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    fileName: "SegmentHeroJump.tsx",
  }).outputText;
  const directory = mkdtempSync(join(tmpdir(), "wd-signup-jump-"));
  const file = join(directory, "jump.mjs");
  writeFileSync(file, compiled.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(join(dirname(fileURLToPath(import.meta.url)), "../node_modules/react/jsx-runtime.js"))}`));
  try {
    const loaded = await import(pathToFileURL(file).href);
    focusMiddleSignup = loaded.focusMiddleSignup;
    commitMiddleSignup = loaded.commitMiddleSignup;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const landing = readFileSync(new URL("../src/components/segments/SegmentLanding.tsx", import.meta.url), "utf8");
  assert.match(landing, /useRouter\(\)/);
  assert.match(landing, /commitMiddleSignup\(router, options\)/);
  assert.equal(landing.includes("router.navigate"), false);
  assert.equal(landing.includes("history.pushState"), false);
  assert.equal(landing.includes("onClick={focusMiddleSignup}"), false);
});

function installDocument() {
  nodes.clear();
  state.scrollY = 1400;
  state.active = null;
  state.focusCalls = [];
  state.scrolls = [];
  state.committed = false;
  state.pushStateCalls = 0;
  const panel = place("signup-middle", panelTop, 900);
  place("signup-title-middle", panelTop, 48);
  const form = place("middle-form", formTop, formHeight);
  place("hero-email", inputTop, inputHeight);
  place("middle-submit", buttonTop, buttonHeight);
  panel.form = form;
  const documentMock = {
    getElementById(id: string) { return nodes.get(id) ?? null; },
    get activeElement() { return state.active; },
  };
  const windowMock = {
    location: { pathname, search, hash: "" },
    history: { pushState() { state.pushStateCalls += 1; } },
  };
  Object.assign(globalThis, { HTMLElement, document: documentMock, window: windowMock });
}

test("default hash restoration leaves the submit button below a 664px viewport", () => {
  installDocument();
  commitLikeInstalledRouter({ href: `${pathname}${search}#signup-middle` });
  assert.deepEqual(box("hero-email"), { id: "hero-email", top: 653, bottom: 707 });
  assert.deepEqual(box("middle-submit"), { id: "middle-submit", top: 719, bottom: 773 });
  assert.ok(box("middle-submit").top > viewHeight);
});

test("the first plain click keeps the raw query and centers the form after commit", async () => {
  installDocument();
  let prevented = false;
  let scrollAtCommit = -1;
  await focusMiddleSignup({
    preventDefault() { prevented = true; },
  }, async (options) => {
    assert.equal(options.href, `${pathname}${search}#signup-middle`);
    assert.equal(options.resetScroll, false);
    assert.equal(options.hashScrollIntoView, false);
    state.committed = false;
    commitLikeInstalledRouter(options);
    scrollAtCommit = state.scrollY;
    state.committed = true;
  });
  assert.equal(prevented, true);
  assert.equal(state.pushStateCalls, 0);
  assert.equal(scrollAtCommit, 1400);
  assert.deepEqual(state.scrolls.map(entry => entry.committed), [true]);
  assert.equal(state.scrolls[0].id, "middle-form");
  assert.equal(state.scrolls[0].block, "center");
  assert.deepEqual(inside("hero-email"), { id: "hero-email", top: 272, bottom: 326 });
  assert.deepEqual(inside("middle-submit"), { id: "middle-submit", top: 338, bottom: 392 });
  assert.equal(state.active?.id, "signup-title-middle");
  assert.deepEqual(state.focusCalls, [{ id: "signup-title-middle", preventScroll: true }]);
});

test("a second click on the same hash still centers after the router commit", async () => {
  installDocument();
  const navigate = async (options: JumpOptions) => {
    commitLikeInstalledRouter(options);
    state.committed = true;
  };
  await focusMiddleSignup({ preventDefault() {} }, navigate);
  state.scrollY = 80;
  state.committed = false;
  state.scrolls = [];
  await focusMiddleSignup({ preventDefault() {} }, navigate);
  inside("hero-email");
  inside("middle-submit");
  assert.equal(state.scrolls.at(-1)?.block, "center");
  assert.equal(state.scrolls.at(-1)?.committed, true);
});

test("modifier and non-primary clicks stay native links", async () => {
  for (const event of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    installDocument();
    let prevented = false;
    let navigated = false;
    await focusMiddleSignup({
      ...event,
      preventDefault() { prevented = true; },
    }, async () => { navigated = true; });
    assert.equal(prevented, false, JSON.stringify(event));
    assert.equal(navigated, false, JSON.stringify(event));
    assert.equal(state.scrollY, 1400);
    assert.equal(state.focusCalls.length, 0);
  }
});

test("a rejected navigation still reveals the form after the attempt", async () => {
  installDocument();
  await focusMiddleSignup({ preventDefault() {} }, async () => {
    throw new Error("navigation failed");
  });
  inside("middle-submit");
  assert.equal(state.focusCalls[0]?.preventScroll, true);
});

test("the real router keeps the raw campaign id and still centers the form", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  installDocument();
  const view = globalThis as typeof globalThis & {
    window: { origin?: string; document?: unknown; location: { pathname: string; search: string; hash: string } };
    self?: unknown;
    document: unknown;
  };
  view.window.origin = "https://watchdive.diveroid.com";
  view.window.document = view.document;
  view.self = globalThis;
  const raw = `${pathname}${search}#signup-middle`;
  try {
    const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router");
    const root = createRootRoute();
    const scuba = createRoute({ getParentRoute: () => root, path: "/en/scuba" });
    const tree = root.addChildren([scuba]);
    async function boot() {
      const history = createMemoryHistory({ initialEntries: [`${pathname}${search}`] });
      const router = createRouter({ routeTree: tree, history, isServer: false, scrollRestoration: false });
      await router.load();
      return { history, router };
    }
    const navigated = await boot();
    await navigated.router.navigate({ href: raw, resetScroll: false, hashScrollIntoView: false });
    assert.equal(navigated.history.location.href.includes("120251732986720210"), true);
    assert.notEqual(navigated.history.location.href, raw);

    view.window.location.hash = "";
    const preserved = await boot();
    let pushes = 0;
    const originalPush = preserved.history.push.bind(preserved.history);
    preserved.history.push = (href: string, historyState?: unknown) => {
      pushes += 1;
      return originalPush(href, historyState);
    };
    await focusMiddleSignup({ preventDefault() {} }, (options) => commitMiddleSignup(preserved.router, options));
    assert.equal(preserved.history.location.href, raw);
    assert.equal(preserved.history.location.state.__hashScrollIntoViewOptions, false);
    assert.equal(preserved.router._scroll.n, false);
    assert.equal(pushes, 1);
    inside("hero-email");
    inside("middle-submit");
    assert.equal(state.active?.id, "signup-title-middle");
    view.window.location.hash = "#signup-middle";
    state.scrollY = 80;
    state.scrolls = [];
    state.committed = false;
    await focusMiddleSignup({ preventDefault() {} }, (options) => commitMiddleSignup(preserved.router, options));
    assert.equal(pushes, 1);
    assert.equal(preserved.history.location.href, raw);
    inside("hero-email");
    inside("middle-submit");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
