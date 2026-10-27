import { useId, useRef, useState } from "react";
import { PhoneNumberFields } from "./phone-number-fields";
import { savePhoneOptIn } from "@/lib/api/waitlist.functions";
import { defaultPhoneCountry, normalizePhone } from "@/lib/phoneNumbers";
import { useCurrentLocale, usePhoneOptInCopy } from "@/lib/i18n/use-current-locale";
import type { PhoneCredential } from "@/lib/verification/phoneOptIn";

export function PhoneOptInCard({
  credential,
  complete = false,
  onSaved,
  resultStatus = null,
  draft,
}: {
  credential: PhoneCredential;
  complete?: boolean;
  onSaved?: (status?: "accepted" | "saved") => void;
  /** Set only from a save result. Omitted callers keep the saved confirmation copy. */
  resultStatus?: "accepted" | "saved" | null;
  /** Present only when a consented save failed and the same number can be retried. */
  draft?: { phone: string; country: string; consent: boolean; unsuccessful?: boolean };
}) {
  const locale = useCurrentLocale();
  // The terms line names the Buddy Invite exceptions while that program is on.
  const copy = usePhoneOptInCopy(locale);
  const id = useId();
  const [phone, setPhone] = useState(draft?.phone ?? "");
  const [country, setCountry] = useState<string>(draft?.country || defaultPhoneCountry(locale));
  const [consent, setConsent] = useState(draft?.consent === true);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [saved, setSaved] = useState<"accepted" | "saved" | null>(null);
  const [error, setError] = useState(draft?.unsuccessful ? "retry" : "");
  const shown = saved || (complete ? resultStatus || "saved" : null);
  const visibleError = error === "retry" ? copy.error : error;
  if (shown)
    return (
      <div className="wd-phone-success" role="status">
        ✓ {copy[shown]}
      </div>
    );
  return (
    <section className="wd-phone-card" aria-labelledby={`${id}-title`}>
      <p className="wd-phone-eyebrow">{copy.eyebrow}</p>
      <h3 id={`${id}-title`}>{copy.title}</h3>
      <p className="wd-phone-body">{copy.body}</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || saving.current) return;
          setError("");
          if (!normalizePhone(phone, country)) {
            setError(copy.invalid);
            return;
          }
          if (!consent) {
            setError(copy.consentRequired);
            return;
          }
          saving.current = true;
          setBusy(true);
          try {
            const result = await savePhoneOptIn({
              data: { credential, phone, country, consent, locale },
            });
            if (result.status === "accepted" || result.status === "saved") {
              setSaved(result.status);
              onSaved?.(result.status);
            } else setError(result.status === "invalid" ? copy.invalid : copy.error);
          } catch {
            setError(copy.error);
          } finally {
            saving.current = false;
            setBusy(false);
          }
        }}
      >
        <PhoneNumberFields
          locale={locale}
          phone={phone}
          onPhone={setPhone}
          country={country}
          onCountry={setCountry}
          disabled={busy}
          invalid={visibleError === copy.invalid}
        />
        <label className="wd-phone-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{copy.consent}</span>
        </label>
        {visibleError && (
          <p className="wd-phone-error" role="alert">
            {visibleError}
          </p>
        )}
        <button className="wd-phone-save" type="submit" disabled={busy}>
          {busy ? copy.busy : copy.button}
          <span aria-hidden> →</span>
        </button>
      </form>
      <p className="wd-phone-terms">{copy.terms}</p>
    </section>
  );
}
