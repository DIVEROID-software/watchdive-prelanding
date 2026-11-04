import assert from "node:assert/strict";
import test from "node:test";
import {
  hasInlineSignupCollision,
  inlineSignupGeometryCollides,
  startEntryCapture,
} from "../src/components/retargeting/entry-policy.ts";
import { ENTRY_COPY } from "../src/components/retargeting/entry-copy.ts";

const rect = (left = 0, top = 0, width = 390, height = 100) => ({ left, top, width, height, right: left + width, bottom: top + height });
const viewport = { top: 0, left: 0, width: 390, height: 800 };

test("inline geometry uses both full actions or at least 40% of the visible viewport", () => {
  const section = rect(0, 700, 390, 500);
  assert.equal(inlineSignupGeometryCollides(section, rect(10, 700, 370, 48), rect(10, 752, 370, 48), viewport), true);
  assert.equal(inlineSignupGeometryCollides(section, rect(10, 700, 370, 48), rect(10, 753, 370, 48), viewport), false);
  assert.equal(inlineSignupGeometryCollides(section, rect(-1, 700, 370, 48), rect(10, 752, 370, 48), viewport), false);
  assert.equal(inlineSignupGeometryCollides(section, rect(10, 700, 381, 48), rect(10, 752, 370, 48), viewport), false);
  assert.equal(inlineSignupGeometryCollides(section, null, rect(10, 752, 370, 48), viewport), false);
  assert.equal(inlineSignupGeometryCollides(rect(0, 480, 390, 500), null, null, viewport), true);
  assert.equal(inlineSignupGeometryCollides(rect(0, 481, 390, 500), null, null, viewport), false);
  assert.equal(inlineSignupGeometryCollides(rect(389, 0, 390, 800), null, null, viewport), false, "a horizontal sliver is not a substantial signup section");
  assert.equal(inlineSignupGeometryCollides(rect(0, -500, 390, 500), null, null, viewport), false);
  assert.equal(inlineSignupGeometryCollides(rect(0, 800, 390, 500), null, null, viewport), false);
});

test("zero geometry and visual viewport offsets do not count controls outside the visible screen", () => {
  const offset = { top: 150, left: 20, width: 320, height: 450 };
  assert.equal(inlineSignupGeometryCollides(rect(0, 0, 0, 0), rect(0, 0, 0, 0), rect(0, 0, 0, 0), viewport), false);
  assert.equal(inlineSignupGeometryCollides(rect(), rect(), rect(), { ...viewport, height: 0 }), false);
  assert.equal(inlineSignupGeometryCollides(rect(20, 540, 320, 60), rect(20, 490, 320, 48), rect(20, 540, 320, 48), offset), true);
  assert.equal(inlineSignupGeometryCollides(rect(20, 590, 320, 60), rect(20, 490, 320, 48), rect(20, 560, 320, 48), offset), false);
});

// These doubles exercise the shipped DOM adapter and lifecycle with controlled
// geometry, events, observers and clock. They are not browser/layout evidence.
class Surface {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
}
class Node {
  parentElement: Node | null = null;
  children: Node[] = [];
  hidden = false;
  ariaHidden: string | null = null;
  style = { display: "block", visibility: "visible", opacity: "1" };
  bounds = rect(0, 1000, 390, 500);
  kind: string;
  constructor(kind: string) { this.kind = kind; }
  append(child: Node) { child.parentElement = this; this.children.push(child); return child; }
  contains(node: Node | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
  getBoundingClientRect() { return this.bounds; }
  getAttribute(name: string) { return name === "aria-hidden" ? this.ariaHidden : null; }
  matches(selector: string): boolean {
    return selector === "[data-segment-signup] input" && this.kind === "email" && Boolean(this.ancestor("section"));
  }
  ancestor(kind: string): Node | null { return this.kind === kind ? this : this.parentElement?.ancestor(kind) ?? null; }
  closest(selector: string): Node | null {
    if (selector === '[hidden],[aria-hidden="true"],[inert]') return this.hidden || this.ariaHidden === "true" ? this : this.parentElement?.closest(selector) ?? null;
    if (selector.startsWith("form,input")) return this.kind === "email" || this.kind === "form" ? this : this.parentElement?.closest(selector) ?? null;
    throw new Error(`Unexpected closest ${selector}`);
  }
  querySelector(selector: string): Node | null {
    const kind = selector === 'input[type="email"]' ? "email" : selector === 'button[type="submit"]' ? "submit" : "unknown";
    for (const child of this.children) {
      if (child.kind === kind) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function harness() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const frames = new Map<number, () => void>();
  const mutations: Mutation[] = [];
  const resizes: Resize[] = [];
  class Mutation {
    disconnected = false;
    callback: (records: { type: string }[]) => void;
    constructor(callback: (records: { type: string }[]) => void) { this.callback = callback; mutations.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  class Resize {
    disconnected = false;
    observeCalls = 0;
    nodes = new Set<Node>();
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; resizes.push(this); }
    observe(node: Node) { this.observeCalls++; this.nodes.add(node); }
    unobserve(node: Node) { this.nodes.delete(node); }
    disconnect() { this.disconnected = true; this.nodes.clear(); }
  }
  const view = Object.assign(new Surface(), {
    innerWidth: 390, innerHeight: 800,
    visualViewport: Object.assign(new Surface(), { width: 390, height: 800, offsetTop: 0, offsetLeft: 0 }),
    getComputedStyle: (node: Node) => node.style,
    MutationObserver: Mutation, ResizeObserver: Resize,
    setTimeout: (callback: () => void, ms: number) => { const id = ++nextId; timers.set(id, { at: now + ms, callback }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    requestAnimationFrame: (callback: () => void) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  });
  const body = new Node("body");
  const section = body.append(new Node("section"));
  const form = section.append(new Node("form"));
  const email = form.append(new Node("email"));
  const submit = form.append(new Node("submit"));
  const panel = new Node("panel");
  const popupForm = panel.append(new Node("form"));
  const popupInput = popupForm.append(new Node("email"));
  const sections = [section];
  let ownPanel: Node | null = null;
  let modal: Node | null = null;
  let privacy: Node | null = null;
  const doc = Object.assign(new Surface(), {
    defaultView: view, body, hidden: false, fullscreenElement: null as Node | null, activeElement: null as Node | null,
    querySelector: (selector: string) => selector.includes("wd-privacy-title") ? privacy : modal || ownPanel,
    querySelectorAll: (selector: string) => selector === "[data-segment-signup]" ? sections : selector === "video" ? [] : [modal, ownPanel].filter(Boolean),
  });
  const document = doc as unknown as Document;
  const states: boolean[] = [];
  const known = { signedUp: false, paid: false };
  let claims = 0;
  let sessionAvailable = true;
  const start = () => startEntryCapture({
    document, getPanel: () => ownPanel as unknown as Element | null, getKnownStatus: () => known,
    claimSession: () => { claims++; return sessionAvailable; },
    onState: parked => { ownPanel = panel; panel.hidden = parked; states.push(parked); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  };
  const flush = () => { const batch = [...frames]; frames.clear(); for (const [, callback] of batch) callback(); };
  return { document, doc, view, body, section, email, submit, panel, popupInput, sections, states, known, timers, frames, mutations, resizes, start, advance, flush,
    get claims() { return claims; },
    setSessionAvailable: (value: boolean) => { sessionAvailable = value; },
    setModal: (value: boolean) => { modal = value ? new Node("modal") : null; },
    setPrivacy: (value: boolean) => { privacy = value ? new Node("privacy") : null; },
  };
}

test("DOM collision ignores hidden/transparent/offscreen sections and hero-only content", () => {
  const h = harness();
  assert.equal(hasInlineSignupCollision(h.document), false);
  h.body.append(new Node("hero")).bounds = rect(0, 0, 390, 800);
  assert.equal(hasInlineSignupCollision(h.document), false, "hero CTA is not an inline signup section");
  h.section.bounds = rect(0, 480, 390, 600);
  assert.equal(hasInlineSignupCollision(h.document), true);
  h.section.hidden = true;
  assert.equal(hasInlineSignupCollision(h.document), false);
  h.section.hidden = false;
  h.body.style.opacity = "0";
  assert.equal(hasInlineSignupCollision(h.document), false);
  h.body.style.opacity = "1";
  h.section.style.visibility = "hidden";
  assert.equal(hasInlineSignupCollision(h.document), false);
  h.section.style.visibility = "visible";
  h.section.bounds = rect(0, 1000, 390, 600);
  h.email.bounds = rect(10, 650, 370, 48);
  h.submit.bounds = rect(10, 710, 370, 48);
  assert.equal(hasInlineSignupCollision(h.document), true);
  h.submit.hidden = true;
  assert.equal(hasInlineSignupCollision(h.document), false);
});

test("600ms intent survives initial events; inline deferral consumes no cap and retries stay bounded", () => {
  const h = harness();
  h.section.bounds = rect(0, 400, 390, 600);
  const stop = h.start();
  h.view.emit("scroll"); h.flush();
  h.advance(599);
  assert.deepEqual(h.states, []);
  h.advance(1);
  assert.equal(h.claims, 0);
  h.advance(750 * 40 + 1000);
  assert.equal(h.timers.size, 0, "no unlimited polling after 40 retries");
  assert.equal(h.claims, 0, "waiting is not a shown/dismissed capture");
  h.section.bounds = rect(0, -800, 390, 600);
  h.view.emit("scroll"); h.flush();
  assert.deepEqual(h.states, [false], "later reading releases the defer even beyond the retry window");
  assert.equal(h.claims, 1);
  stop();
});

test("focused inline input blocks initial opening even offscreen, and unmount before 600ms cancels intent", () => {
  const h = harness(); h.doc.activeElement = h.email;
  const stop = h.start(); h.advance(600);
  assert.equal(h.claims, 0);
  h.doc.activeElement = null; h.doc.emit("focusout"); h.flush();
  assert.deepEqual(h.states, [false]);
  stop();
  const initial = harness(); const stopInitial = initial.start();
  initial.view.emit("scroll");
  stopInitial(); initial.advance(1000); initial.flush();
  assert.equal(initial.claims, 0);
  assert.equal(initial.timers.size + initial.frames.size, 0);
  assert.equal(initial.view.listenerCount + initial.doc.listenerCount + initial.view.visualViewport.listenerCount, 0);
});

test("open capture parks on inline geometry/focus, preserves own focus, and reuses its session", () => {
  const h = harness(); const stop = h.start(); h.advance(600);
  assert.deepEqual(h.states, [false]);
  h.doc.activeElement = h.popupInput;
  h.doc.emit("focusin"); h.flush();
  assert.deepEqual(h.states, [false], "own panel/input never suppress itself");
  h.section.bounds = rect(0, 400, 390, 600);
  h.view.emit("scroll"); h.flush();
  assert.deepEqual(h.states, [false, true]);
  h.section.bounds = rect(0, -800, 390, 600);
  h.doc.activeElement = h.email;
  h.doc.emit("focusin"); h.flush();
  assert.deepEqual(h.states, [false, true], "focused inline input blocks even after it scrolls offscreen");
  h.doc.activeElement = null;
  h.doc.emit("focusout"); h.flush();
  assert.deepEqual(h.states, [false, true, false]);
  assert.equal(h.claims, 1);
  stop();
});

test("privacy/modal/fullscreen and hidden-document guards continue after opening", () => {
  const h = harness(); const stop = h.start(); h.advance(600);
  h.setPrivacy(true); h.mutations[0].callback([{ type: "attributes" }]); h.flush();
  assert.equal(h.states.at(-1), true);
  h.setPrivacy(false); h.setModal(true); h.mutations[0].callback([{ type: "childList" }]); h.flush();
  assert.equal(h.states.at(-1), true);
  h.setModal(false); h.mutations[0].callback([{ type: "childList" }]); h.flush();
  assert.equal(h.states.at(-1), false);
  h.doc.fullscreenElement = new Node("video"); h.doc.emit("fullscreenchange"); h.flush();
  assert.equal(h.states.at(-1), true);
  h.doc.fullscreenElement = null; h.doc.emit("fullscreenchange"); h.flush();
  h.view.emit("resize");
  h.doc.hidden = true; h.doc.emit("visibilitychange");
  assert.equal(h.states.at(-1), true, "hidden document parks synchronously instead of waiting for a throttled RAF");
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
  h.doc.hidden = false; h.doc.emit("visibilitychange"); h.flush();
  assert.equal(h.states.at(-1), false);
  stop();
});

test("hidden arrival waits for visibility and visual viewport events recheck collisions", () => {
  const h = harness(); h.doc.hidden = true;
  const stop = h.start(); h.advance(600);
  assert.equal(h.claims, 0); assert.equal(h.timers.size, 0);
  h.doc.hidden = false; h.doc.emit("visibilitychange"); h.flush();
  assert.deepEqual(h.states, [false]);
  h.section.bounds = rect(0, 450, 390, 300);
  h.view.visualViewport.height = 600;
  h.view.visualViewport.offsetTop = 200;
  h.view.visualViewport.emit("resize"); h.flush();
  assert.equal(h.states.at(-1), true);
  h.view.visualViewport.offsetTop = 0;
  h.view.visualViewport.emit("scroll"); h.flush();
  assert.equal(h.states.at(-1), false);
  stop();
});

test("known signup/paid or a failed session claim prevent opening and release resources", () => {
  for (const mode of ["signedUp", "paid", "session"] as const) {
    const h = harness();
    if (mode === "session") h.setSessionAvailable(false); else h.known[mode] = true;
    h.start(); h.advance(600);
    assert.deepEqual(h.states, []);
    assert.equal(h.timers.size, 0);
    assert.ok(h.mutations[0].disconnected && h.resizes[0].disconnected);
    assert.equal(h.view.listenerCount + h.doc.listenerCount + h.view.visualViewport.listenerCount, 0);
  }
});

test("one observer lifetime coalesces events, tracks replaced sections, and cleanup cancels pending work", () => {
  const h = harness(); h.section.bounds = rect(0, 400, 390, 600);
  const stop = h.start(); h.advance(600);
  h.view.emit("scroll"); h.view.emit("resize"); h.doc.emit("focusout");
  assert.equal(h.frames.size, 1);
  h.flush();
  const observedBefore = h.resizes[0].observeCalls;
  h.mutations[0].callback([{ type: "attributes" }]);
  h.mutations[0].callback([{ type: "childList" }]);
  assert.equal(h.resizes[0].observeCalls, observedBefore, "no observer reattachment for unchanged sections");
  const replacement = h.body.append(new Node("section"));
  h.sections.splice(0, 1, replacement);
  h.mutations[0].callback([{ type: "childList" }]);
  assert.equal(h.resizes[0].nodes.has(h.section), false);
  assert.equal(h.resizes[0].nodes.has(replacement), true);
  stop(); stop();
  assert.equal(h.timers.size, 0); assert.equal(h.frames.size, 0);
  assert.equal(h.view.listenerCount + h.doc.listenerCount + h.view.visualViewport.listenerCount, 0);
  assert.ok(h.mutations[0].disconnected && h.resizes[0].disconnected);
  h.mutations[0].callback([{ type: "childList" }]); h.resizes[0].callback();
  h.advance(60000); h.flush();
  assert.equal(h.resizes[0].nodes.size, 0, "stale mutation callbacks cannot reattach observations after cleanup");
  assert.deepEqual(h.states, []); assert.equal(h.claims, 0);
});

test("all approved popup locales keep clear signup, product, free and confirmation copy", () => {
  assert.equal(Object.keys(ENTRY_COPY).length, 10);
  for (const copy of Object.values(ENTRY_COPY)) {
    for (const value of Object.values(copy)) assert.ok(value.trim());
    assert.doesNotMatch(copy.title + copy.body, /KICKSTARTER LAUNCH|December|12月|놓치지 마세요|Your next dive/);
  }
  assert.equal(ENTRY_COPY.en.title, "Get the WatchDive launch alert.");
  assert.equal(ENTRY_COPY.ko.body, "하우징이 수심과 수온을 측정하고, 스마트워치가 측정값을 보여줍니다.");
  assert.equal(ENTRY_COPY["zh-TW"].cta, "上線時通知我");
  assert.equal(ENTRY_COPY.nl.cta, "Seintje bij de lancering");
});
