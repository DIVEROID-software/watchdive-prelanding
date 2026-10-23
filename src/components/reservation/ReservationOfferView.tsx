import { useEffect, useId, useRef } from "react";
import type { Locale } from "../../lib/i18n/locale";
import { ONSITE_OFFER_COPY } from "./onsite-copy";
import "./onsite-offer.css";

/** Shared by the real signup flow and the network-free local preview. */
export function ReservationOfferView({ locale, verified = false, busy = false, error = "", autoFocus = false, onContinue }: {
  locale: Locale; verified?: boolean; busy?: boolean; error?: string; autoFocus?: boolean; onContinue: () => void;
}) {
  const copy = ONSITE_OFFER_COPY[locale];
  const titleId = useId();
  const hintId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [autoFocus]);
  return <section className="wd-onsite-offer" lang={locale} aria-labelledby={titleId} ref={panel} tabIndex={-1}>
    <div className="wd-onsite-photo">
      <img src="/brand/reservation/watchdive-underwater.jpg" width="1440" height="960" alt={copy.imageAlt} />
      <span className="wd-onsite-product">WatchDive</span>
    </div>
    <div className="wd-onsite-content">
      <p className="wd-onsite-eyebrow">{copy.eyebrow}</p>
      <h2 id={titleId}>{copy.title}</h2>
      <p className="wd-onsite-body">{copy.body}</p>
      <p className="wd-onsite-next">{copy.nextPrice}</p>
      <div className="wd-onsite-price">
        <div><span>{copy.feeLabel}</span><strong>$3</strong></div>
        <p><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" stroke="currentColor" strokeWidth="1.5"/><path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="1.5"/></svg>{copy.guarantee}</p>
      </div>
      <button type="button" className="wd-onsite-cta" onClick={onContinue} disabled={busy} aria-describedby={hintId}>
        {busy ? copy.busy : verified ? copy.cta : copy.verifyCta}<span aria-hidden="true">→</span>
      </button>
      <p id={hintId} className="wd-onsite-auth" role="status">{verified ? copy.verified : copy.pending}</p>
      {error && <p className="wd-onsite-error" role="alert">{error}</p>}
      <div className="wd-onsite-terms"><p>{copy.separate}</p><p>{copy.refund}</p><p>{copy.noCharge}</p></div>
    </div>
  </section>;
}
