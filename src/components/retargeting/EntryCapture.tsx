import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { privacyPath, type Locale } from "../../lib/i18n/locale";
import { WatchDiveLogo } from "../segments/WatchDiveLogo";
import { CAPTURE_SESSION_KEY, hasCaptureInterruption } from "./policy";
import { ENTRY_DISMISSED_KEY, entryDismissed, entryReturnFlow } from "./entry-policy";
import { ENTRY_COPY } from "./entry-copy";
import type { KnownCaptureStatus } from "./ExitIntentCapture";
import "./entry-capture.css";

/** Non-modal entry panel: the product remains usable and focus is not stolen.
 * The caller supplies the existing signup form. No identity or consent is inferred.
 */
export function EntryCapture({ locale, getKnownStatus, children }: {
  locale: Locale;
  getKnownStatus: () => KnownCaptureStatus;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [parked, setParked] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const knownStatus = useRef(getKnownStatus);
  knownStatus.current = getKnownStatus;
  const id = useId();
  const copy = ENTRY_COPY[locale];
  useEffect(() => {
    if (entryReturnFlow(location.search, location.hash)) return;
    try {
      if (sessionStorage.getItem(CAPTURE_SESSION_KEY) || entryDismissed(localStorage.getItem(ENTRY_DISMISSED_KEY))) return;
    } catch {
      // If the browser cannot remember a dismissal, do not nag on every page.
      return;
    }
    let tries = 0;
    const tryOpen = () => {
      const known = knownStatus.current();
      if (known.signedUp || known.paid || ++tries > 40) return;
      const privacy = document.querySelector('[aria-labelledby="wd-privacy-title"]');
      const privacyPresent = privacy && privacy.getAttribute("aria-hidden") !== "true";
      if (privacyPresent || hasCaptureInterruption(document)) {
        timer = window.setTimeout(tryOpen, 750);
        return;
      }
      try { sessionStorage.setItem(CAPTURE_SESSION_KEY, "entry-shown"); } catch { return; }
      setOpen(true);
    };
    let timer = window.setTimeout(tryOpen, 600);
    return () => window.clearTimeout(timer);
  }, []);

  function dismiss() {
    const hadFocus = panel.current?.contains(document.activeElement);
    try { localStorage.setItem(ENTRY_DISMISSED_KEY, String(Date.now())); } catch { /* session cap still applies */ }
    setOpen(false);
    if (hadFocus) {
      // No autofocus on arrival. On dismissal return the reader to the product.
      document.querySelector<HTMLElement>(".wd-segment-hero-jump,main a,main button")?.focus({ preventScroll: true });
    }
  }
  useEffect(() => {
    if (!open) return;
    const checkOverlays = () => {
      const privacy = document.querySelector('[aria-labelledby="wd-privacy-title"]');
      setParked(Boolean(document.querySelector('dialog[open],[aria-modal="true"]') ||
        (privacy && privacy.getAttribute("aria-hidden") !== "true")));
    };
    const observer = new MutationObserver(checkOverlays);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-hidden", "aria-modal"] });
    checkOverlays();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('dialog[open],[aria-modal="true"]')) dismiss();
    };
    document.addEventListener("keydown", onEscape);
    return () => { observer.disconnect(); document.removeEventListener("keydown", onEscape); };
  }, [open]);

  if (!open) return null;
  return <aside ref={panel} hidden={parked} className="wd-entry-panel" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} data-wd-capture-block="" data-wd-placement="entry-popup">
    <div className="wd-entry-topline">
      <WatchDiveLogo tone="on-light" />
      <span className="wd-entry-kicker">KICKSTARTER LAUNCH</span>
      <button type="button" className="wd-entry-close" onClick={dismiss} aria-label={copy.close}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.7" /></svg></button>
    </div>
    <h2 id={`${id}-title`}>{copy.title.split("\n").map(line => <span key={line}>{line}</span>)}</h2>
    <p id={`${id}-body`} className="wd-entry-body">{copy.body}</p>
    <div className="wd-entry-form">{children}</div>
    <p className="wd-entry-free">{copy.free}</p>
    <div className="wd-entry-footer">
      <button type="button" onClick={dismiss}>{copy.later}<span aria-hidden="true"> ↗</span></button>
      <a href={privacyPath(locale)}>{copy.privacy}</a>
    </div>
  </aside>;
}
