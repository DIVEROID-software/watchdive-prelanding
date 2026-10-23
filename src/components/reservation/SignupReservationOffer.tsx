import { useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { getOnsiteReservation } from "@/lib/api/onsiteReservation.functions";
import type { OnsiteCredential } from "@/lib/reservation/onsite";
import { ONSITE_OFFER_COPY } from "./onsite-copy";
import { ReservationOfferView } from "./ReservationOfferView";
import { isHostedStripeCheckoutUrl } from "./contract";
import { writeInvalidInviteFlag, writeStoredInvite, writeStoredLang } from "./query";

export function SignupReservationOffer({ locale, verified = false, credential, inboxId, autoFocus = false }: {
  locale: Locale; verified?: boolean; credential?: OnsiteCredential; inboxId?: string; autoFocus?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const lock = useRef(false);
  const copy = ONSITE_OFFER_COPY[locale];
  const focusVerification = () => {
    const inbox = inboxId && document.getElementById(inboxId);
    if (inbox) { inbox.focus({ preventScroll: true }); inbox.scrollIntoView({ block: "start", behavior: "smooth" }); }
  };
  return <ReservationOfferView locale={locale} verified={verified} busy={busy} error={error} alreadyPaid={alreadyPaid} paymentAvailable={Boolean(credential)} autoFocus={autoFocus}
    inboxId={inboxId} onVerify={!verified && inboxId ? focusVerification : undefined}
    onContinue={async () => {
      if (lock.current || alreadyPaid || !credential) return;
      lock.current = true; setBusy(true); setError("");
      try {
        const result = await getOnsiteReservation({ data: { credential, locale } });
        if (result.status === "ready") {
          // The server creates checkout and returns the Stripe-hosted URL.
          if (!isHostedStripeCheckoutUrl(result.href)) throw new Error("Invalid checkout URL");
          writeStoredInvite(window.sessionStorage, result.statusToken);
          writeStoredLang(window.sessionStorage, locale);
          writeInvalidInviteFlag(window.sessionStorage, false);
          window.location.assign(result.href);
          return;
        }
        if (result.status === "already_paid") {
          setAlreadyPaid(true); setBusy(false);
          return;
        }
        setError(result.status === "unavailable" ? copy.error : copy.expired);
      } catch { setError(copy.error); }
      lock.current = false; setBusy(false);
    }} />;
}
