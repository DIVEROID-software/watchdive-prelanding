import { hasCaptureInterruption } from "./policy.ts";

export const ENTRY_DISMISSED_KEY = "wd:entry-capture-dismissed:v1";
export const ENTRY_DISMISS_MS = 7 * 86400_000;

/** Device-only display preference. This never proves signup or consent. */
export function entryDismissed(value: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const at = Number(value);
  return Number.isFinite(at) && at > 0 && at <= now && now - at < ENTRY_DISMISS_MS;
}

export function entryReturnFlow(search: string, hash: string): boolean {
  const params = new URLSearchParams(search);
  return ["auth", "token", "attempt", "session_id", "reservation", "unsubscribe"].some(key => params.has(key)) ||
    /signup|verify|reserve|offer-form/.test(hash);
}

type Rect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;
export type EntryViewport = { top: number; left: number; width: number; height: number };

/** Deliberately geometric: the entry panel must not hide its own collision
 * evidence by obscuring the inline controls in an elementFromPoint hit-test. */
export function inlineSignupGeometryCollides(
  section: Rect,
  input: Rect | null,
  submit: Rect | null,
  viewport: EntryViewport,
): boolean {
  if (!(viewport.width > 0 && viewport.height > 0)) return false;
  const right = viewport.left + viewport.width;
  const bottom = viewport.top + viewport.height;
  const full = (rect: Rect | null) => Boolean(rect && rect.width > 0 && rect.height > 0 &&
    rect.left >= viewport.left && rect.right <= right && rect.top >= viewport.top && rect.bottom <= bottom);
  if (full(input) && full(submit)) return true;
  const width = Math.max(0, Math.min(section.right, right) - Math.max(section.left, viewport.left));
  const height = Math.max(0, Math.min(section.bottom, bottom) - Math.max(section.top, viewport.top));
  return section.width > 0 && section.height > 0 && width * height >= viewport.width * viewport.height * 0.4;
}

function rendered(element: Element, document: Document): boolean {
  if (element.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = document.defaultView?.getComputedStyle(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) return false;
  }
  return true;
}

export function hasInlineSignupCollision(document: Document, ownPanel?: Element | null): boolean {
  const active = document.activeElement;
  if (active && !ownPanel?.contains(active) && active.matches('[data-segment-signup] input')) return true;
  const view = document.defaultView;
  if (!view) return false;
  const viewport = {
    top: view.visualViewport?.offsetTop ?? 0,
    left: view.visualViewport?.offsetLeft ?? 0,
    width: view.visualViewport?.width ?? view.innerWidth,
    height: view.visualViewport?.height ?? view.innerHeight,
  };
  return [...document.querySelectorAll('[data-segment-signup]')].some(section => {
    if (ownPanel?.contains(section) || !rendered(section, document)) return false;
    const input = section.querySelector('input[type="email"]');
    const submit = section.querySelector('button[type="submit"]');
    return inlineSignupGeometryCollides(
      section.getBoundingClientRect(),
      input && rendered(input, document) ? input.getBoundingClientRect() : null,
      submit && rendered(submit, document) ? submit.getBoundingClientRect() : null,
      viewport,
    );
  });
}

export function entryCaptureBlocked(document: Document, ownPanel?: Element | null): boolean {
  const privacy = document.querySelector('[aria-labelledby="wd-privacy-title"]');
  return Boolean((privacy && privacy.getAttribute("aria-hidden") !== "true") ||
    hasCaptureInterruption(document, ownPanel) || hasInlineSignupCollision(document, ownPanel));
}

/** One lifetime subscription, including while deferred or parked. Timed retries
 * stay bounded; later user/layout events can still release a collision without
 * consuming the session cap or writing a dismissal. */
export function startEntryCapture({ document, getPanel, getKnownStatus, claimSession, onState }: {
  document: Document;
  getPanel: () => Element | null;
  getKnownStatus: () => { signedUp: boolean; paid: boolean };
  claimSession: () => boolean;
  onState: (parked: boolean) => void;
}): () => void {
  const view = document.defaultView as (Window & typeof globalThis) | null;
  if (!view) return () => {};
  let stopped = false;
  let ready = false;
  let opened = false;
  let parked = false;
  let retries = 0;
  let timer: number | undefined;
  let frame: number | undefined;
  const observed = new Set<Element>();
  const clearTimer = () => {
    if (timer !== undefined) view.clearTimeout(timer);
    timer = undefined;
  };
  const check = () => {
    if (stopped || !ready) return;
    clearTimer();
    if (!opened) {
      const known = getKnownStatus();
      if (known.signedUp || known.paid) { stop(); return; }
    }
    const blocked = entryCaptureBlocked(document, getPanel());
    if (opened) {
      if (parked !== blocked) { parked = blocked; onState(parked); }
    } else if (!blocked) {
      if (!claimSession()) { stop(); return; }
      opened = true;
      onState(false);
    } else if (!document.hidden && retries < 40) {
      timer = view.setTimeout(() => { retries++; check(); }, 750);
    }
  };
  const schedule = () => {
    if (stopped) return;
    if (document.hidden) {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
      check();
    } else if (frame === undefined) {
      frame = view.requestAnimationFrame(() => { frame = undefined; check(); });
    }
  };
  const resize = new view.ResizeObserver(schedule);
  const syncSections = () => {
    const current = new Set<Element>([document.body, ...document.querySelectorAll('[data-segment-signup]')]);
    for (const node of observed) if (!current.has(node)) { resize.unobserve(node); observed.delete(node); }
    for (const node of current) if (!observed.has(node)) { resize.observe(node); observed.add(node); }
  };
  const mutation = new view.MutationObserver(records => {
    if (stopped) return;
    if (records.some(record => record.type === "childList")) syncSections();
    schedule();
  });
  const documentEvents = ["focusin", "focusout", "visibilitychange", "fullscreenchange", "play", "pause", "ended"];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    mutation.disconnect();
    resize.disconnect();
    observed.clear();
    view.removeEventListener("scroll", schedule, true);
    view.removeEventListener("resize", schedule);
    view.visualViewport?.removeEventListener("resize", schedule);
    view.visualViewport?.removeEventListener("scroll", schedule);
    for (const event of documentEvents) document.removeEventListener(event, schedule, true);
  };
  syncSections();
  mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "aria-modal", "class", "style", "inert"] });
  view.addEventListener("scroll", schedule, { passive: true, capture: true });
  view.addEventListener("resize", schedule);
  view.visualViewport?.addEventListener("resize", schedule);
  view.visualViewport?.addEventListener("scroll", schedule);
  for (const event of documentEvents) document.addEventListener(event, schedule, true);
  timer = view.setTimeout(() => { timer = undefined; ready = true; check(); }, 600);
  return stop;
}
