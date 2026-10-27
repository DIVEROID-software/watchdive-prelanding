import { useEffect, useId, useRef } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { RESERVATION_DETAILS_COPY } from "./details-copy";
import { ONSITE_OFFER_COPY } from "./onsite-copy";
import "./reservation-details.css";

const INBOX_ID = /^[A-Za-z0-9_-]{1,80}$/;

function focusInbox(inboxId?: string) {
  if (!inboxId || !INBOX_ID.test(inboxId) || typeof document === "undefined") return;
  const inbox = document.getElementById(inboxId);
  if (!inbox) return;
  inbox.focus({ preventScroll: true });
  inbox.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** Pending $3 terms. Stays on the signup page and never starts checkout. */
export function ReservationDetailsDialog({
  locale,
  inboxId,
  onClose,
}: {
  locale: Locale;
  inboxId?: string;
  onClose: () => void;
}) {
  const copy = RESERVATION_DETAILS_COPY[locale];
  const offer = ONSITE_OFFER_COPY[locale];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const returnToInbox = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    alive.current = true;
    const node = dialogRef.current;
    if (!node) return;
    if (document.activeElement instanceof HTMLElement && !node.contains(document.activeElement)) trigger.current = document.activeElement;
    if (!node.open) node.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
      if (node.open) node.close();
    };
  }, []);

  function dismiss(toInbox = false) {
    returnToInbox.current = toInbox;
    const node = dialogRef.current;
    if (node?.open) node.close();
  }

  function settle() {
    // StrictMode closes and reopens the dialog while checking effects. Ignore
    // the queued close event when this same dialog is already open again.
    if (!alive.current || dialogRef.current?.open) return;
    onClose();
    window.setTimeout(() => {
      if (returnToInbox.current) focusInbox(inboxId);
      else if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    }, 0);
  }

  return (
    <dialog
      ref={dialogRef}
      className="wd-reservation-dialog"
      lang={locale}
      aria-labelledby={titleId}
      data-reservation-entry="pending"
      data-email-verified="false"
      data-paid="false"
      data-price-guaranteed="false"
      onClose={settle}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="wd-reservation-dialog-bar">
        <p className="wd-reservation-dialog-eyebrow">{offer.eyebrow}</p>
        <button type="button" className="wd-reservation-dialog-close" onClick={() => dismiss()}>
          {copy.closeLabel}
        </button>
      </div>
      <h2 id={titleId} ref={titleRef} tabIndex={-1}>
        {offer.guarantee}
      </h2>
      <p className="wd-reservation-dialog-status" role="status">
        {copy.statusChip}
      </p>
      <p>{offer.body}</p>
      <p className="wd-reservation-dialog-fee">
        <span>$</span>3
      </p>
      <p className="wd-reservation-dialog-fee-label">{offer.feeLabel}</p>
      <p className="wd-reservation-dialog-next">{offer.nextPrice}</p>
      <ol className="wd-reservation-dialog-steps">
        <li aria-current="step">{copy.stepVerify}</li>
        <li>{copy.stepPay}</li>
      </ol>
      <button type="button" className="wd-reservation-dialog-inbox" onClick={() => dismiss(true)}>
        {copy.inboxCta}
      </button>
      <div className="wd-reservation-dialog-terms">
        <p>{offer.separate}</p>
        <p>{offer.refund}</p>
        <p>{offer.noCharge}</p>
        <p>{copy.phoneOptional}</p>
      </div>
    </dialog>
  );
}
