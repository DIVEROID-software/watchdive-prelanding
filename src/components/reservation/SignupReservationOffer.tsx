import { useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { getOnsiteReservation } from "@/lib/api/onsiteReservation.functions";
import type { OnsiteCredential } from "@/lib/reservation/onsite";
import { ONSITE_OFFER_COPY } from "./onsite-copy";
import { ReservationDetailsDialog } from "./ReservationDetailsDialog";
import { ReservationOfferView } from "./ReservationOfferView";

export function SignupReservationOffer({ locale, verified = false, credential, inboxId, autoFocus = false }: {
  locale: Locale; verified?: boolean; credential?: OnsiteCredential; inboxId?: string; autoFocus?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const lock = useRef(false);
  const copy = ONSITE_OFFER_COPY[locale];
  return <>
    <ReservationOfferView locale={locale} verified={verified} busy={busy} error={error} autoFocus={autoFocus}
      onContinue={async () => {
        if (!verified) {
          setDetailsOpen(true);
          return;
        }
        if (lock.current) return;
        if (!credential) {
          setError(copy.expired);
          return;
        }
        lock.current = true; setBusy(true); setError("");
        try {
          const result = await getOnsiteReservation({ data: { credential, locale } });
          if (result.status === "ready") {
            // The server returns only a same-origin relative path. The credential
            // is carried in the fragment and consumed by the existing payment UI.
            window.location.assign(result.href);
            return;
          }
          setError(result.status === "unavailable" ? copy.error : copy.expired);
        } catch { setError(copy.error); }
        lock.current = false; setBusy(false);
      }} />
    {detailsOpen && !verified ? (
      <ReservationDetailsDialog locale={locale} inboxId={inboxId} onClose={() => setDetailsOpen(false)} />
    ) : null}
  </>;
}
