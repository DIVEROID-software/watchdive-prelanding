import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locale";
import {
  CAPTURE_SESSION_KEY,
  hasCaptureInterruption,
  scrollProgress,
  shouldOpenCapture,
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
  const status = useRef(getKnownStatus);
  status.current = getKnownStatus;
  const [open, setOpen] = useState(false);
  const copy = RETARGETING_COPY[locale];
  useEffect(() => {
    // Storage unavailable: fail closed, avoiding repeated prompts on navigation.
    try {
      seen.current = Boolean(sessionStorage.getItem(CAPTURE_SESSION_KEY));
    } catch {
      seen.current = true;
    }
    const attempt = (trigger: Parameters<typeof shouldOpenCapture>[1]) => {
      const known = status.current();
      if (
        !shouldOpenCapture(
          {
            knownSignup: known.signedUp,
            paid: known.paid,
            seen: seen.current,
            dismissed: false,
            activeForm: hasCaptureInterruption(document),
            dialog: false,
            playingVideo: false,
            fullscreen: false,
            hidden: false,
          },
          trigger,
        )
      )
        return;
      try {
        sessionStorage.setItem(CAPTURE_SESSION_KEY, "shown");
      } catch {
        return;
      }
      seen.current = true;
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    const fine = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
    const exit = (event: MouseEvent) =>
      attempt({
        kind: "desktop-exit",
        finePointer: fine(),
        clientY: event.clientY,
        relatedTarget: Boolean(event.relatedTarget),
      });
    const scroll = () =>
      attempt({
        kind: "mobile-scroll",
        finePointer: fine(),
        progress: scrollProgress(
          window.scrollY,
          document.documentElement.scrollHeight,
          window.innerHeight,
        ),
      });
    document.addEventListener("mouseout", exit);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      document.removeEventListener("mouseout", exit);
      window.removeEventListener("scroll", scroll);
    };
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node || typeof node.showModal !== "function") return;
    // Recheck when the render commits, before stealing focus.
    const known = status.current();
    if (known.signedUp || known.paid || hasCaptureInterruption(document)) {
      setOpen(false);
      return;
    }
    node.showModal();
    return () => {
      node.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [open]);
  function dismiss() {
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
