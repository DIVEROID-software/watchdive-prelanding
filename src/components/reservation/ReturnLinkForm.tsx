import { useId, useState } from "react";

import type { ReservationLocale } from "./query.ts";
import { reservationCopy } from "./copy.ts";
import { submitReservationReturn } from "./returnClient.ts";

export function ReturnLinkForm({ locale }: { locale: ReservationLocale }) {
  const copy = reservationCopy(locale);
  const emailId = useId();
  const statusId = useId();
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"accepted" | "invalid_email" | "unavailable" | null>(null);

  async function onSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setResult(null);
    const next = await submitReservationReturn({ email, locale, honeypot });
    setResult(next);
    setSending(false);
  }

  const message =
    result === "accepted" ? copy.returnAccepted : result === "invalid_email" ? copy.returnInvalid : result === "unavailable" ? copy.returnUnavailable : "";

  return (
    <form className="wd-rsv-return" onSubmit={onSubmit} noValidate>
      <p>{copy.returnLead}</p>
      <label className="wd-rsv-return-label" htmlFor={emailId}>
        {copy.returnEmailLabel}
      </label>
      <input
        id={emailId}
        className="wd-rsv-return-email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
      />
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={honeypot}
        onChange={(event) => setHoneypot(event.currentTarget.value)}
        className="wd-rsv-return-trap"
      />
      <button type="submit" className="wd-rsv-submit" disabled={sending}>
        {sending ? copy.returnSending : copy.returnSubmit}
      </button>
      <p id={statusId} className="wd-rsv-return-status" role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
