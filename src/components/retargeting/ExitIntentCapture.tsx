import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locale";
import {
  evaluateCaptureOpen,
  latchAfterOpen,
  previewTouchFixtureActive,
  readCaptureSuppressed,
  readPointerSignals,
  resolveCaptureSignals,
  scheduleMobileDwellRetry,
  usesMobileScrollTrigger,
} from "./capture-eligibility";
import {
  CAPTURE_SESSION_KEY,
  hasCaptureInterruption,
  scrollProgress,
  type CaptureFacts,
} from "./policy";
import { RETARGETING_COPY } from "./copy";
import "./retargeting.css";
export type KnownCaptureStatus = { signedUp: boolean; paid: boolean };
/** getKnownStatus is device-scoped UI suppression, never authentication.
 * Root supplies existing pending/verified/social/paid state and the existing
 * single-email form as children (includePhone=false, unique placement id). */
export function ExitIntentCapture({
  locale,
  getKnownStatus,
  children,
}: {
  locale: Locale;
  getKnownStatus: () => KnownCaptureStatus;
  children: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const seen = useRef(false);
  const opening = useRef(false);
  const status = useRef(getKnownStatus);
  status.current = getKnownStatus;
  const [open, setOpen] = useState(false);
  const copy = RETARGETING_COPY[locale];
  useEffect(() => {
    const started = Date.now();
    seen.current = readCaptureSuppressed(() => sessionStorage.getItem(CAPTURE_SESSION_KEY));
    let stopped = false;
    let dwellTimer = 0;
    const signals = () =>
      resolveCaptureSignals(
        readPointerSignals((query) => window.matchMedia(query).matches),
        previewTouchFixtureActive(window.location.search),
      );
    const facts = (): CaptureFacts => {
      const known = status.current();
      return {
        knownSignup: known.signedUp,
        paid: known.paid,
        seen: seen.current,
        dismissed: false,
        activeForm: hasCaptureInterruption(document),
        dialog: false,
        playingVideo: false,
        fullscreen: false,
        hidden: false,
      };
    };
    const progress = () =>
      scrollProgress(window.scrollY, document.documentElement.scrollHeight, window.innerHeight);
    const clearDwell = () => {
      if (!dwellTimer) return;
      window.clearTimeout(dwellTimer);
      dwellTimer = 0;
    };
    const tryOpen = (kind: "mobile-scroll" | "desktop-exit", event?: MouseEvent) => {
      if (stopped || seen.current || opening.current) return;
      const known = status.current();
      if (known.signedUp || known.paid) {
        clearDwell();
        return;
      }
      const elapsedMs = Date.now() - started;
      const currentProgress = progress();
      const currentSignals = signals();
      if (
        !evaluateCaptureOpen({
          kind,
          signals: currentSignals,
          facts: facts(),
          elapsedMs,
          progress: currentProgress,
          clientY: event?.clientY,
          relatedTarget: Boolean(event?.relatedTarget),
          suppressed: seen.current,
        })
      ) {
        if (kind !== "mobile-scroll") return;
        const delay = scheduleMobileDwellRetry({
          mobile: usesMobileScrollTrigger(currentSignals),
          progress: currentProgress,
          elapsedMs,
          suppressed: seen.current,
          knownSignup: known.signedUp,
          paid: known.paid,
          seen: seen.current,
          alreadyScheduled: dwellTimer !== 0,
        });
        if (delay == null) return;
        dwellTimer = window.setTimeout(() => {
          dwellTimer = 0;
          tryOpen("mobile-scroll");
        }, delay);
        return;
      }
      clearDwell();
      opening.current = true;
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    const onScroll = () => {
      if (!usesMobileScrollTrigger(signals())) return;
      tryOpen("mobile-scroll");
    };
    const onExit = (event: MouseEvent) => tryOpen("desktop-exit", event);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mouseout", onExit);
    onScroll();
    return () => {
      stopped = true;
      clearDwell();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onExit);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    const known = status.current();
    const blocked =
      !node ||
      known.signedUp ||
      known.paid ||
      hasCaptureInterruption(document) ||
      typeof node.showModal !== "function";
    if (blocked || !node) {
      const latch = latchAfterOpen("blocked");
      seen.current = latch.seen;
      opening.current = false;
      setOpen(false);
      return;
    }
    try {
      if (!node.open) node.showModal();
    } catch {
      const latch = latchAfterOpen("blocked");
      seen.current = latch.seen;
      opening.current = false;
      setOpen(false);
      return;
    }
    const latch = latchAfterOpen("shown");
    seen.current = latch.seen;
    if (latch.persist) {
      try {
        sessionStorage.setItem(CAPTURE_SESSION_KEY, latch.persist);
      } catch {
        /* seen still stops a second prompt in this document */
      }
    }
    return () => {
      if (node.open) node.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [open]);
  function dismiss() {
    seen.current = true;
    opening.current = false;
    try {
      sessionStorage.setItem(CAPTURE_SESSION_KEY, "dismissed");
    } catch {
      /* seen ref still caps */
    }
    setOpen(false);
  }
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="wd-capture-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="wd-capture-card">
        <button
          type="button"
          className="wd-capture-close"
          aria-label={copy.close}
          onClick={dismiss}
          autoFocus
        >
          ×
        </button>
        <p className="wd-capture-eyebrow">WATCHDIVE</p>
        <h2 id={`${id}-title`}>{copy.exitTitle}</h2>
        <p id={`${id}-description`}>{copy.exitBody}</p>
        {children}
        <button type="button" className="wd-capture-decline" onClick={dismiss}>
          {copy.decline}
        </button>
      </div>
    </dialog>
  );
}
