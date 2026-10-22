import { useId, useState } from "react";
import { PhoneNumberFields } from "./phone-number-fields";
import { savePhoneOptIn } from "@/lib/api/waitlist.functions";
import { defaultPhoneCountry, normalizePhone } from "@/lib/phoneNumbers";
import { useCurrentLocale, usePhoneOptInCopy } from "@/lib/i18n/use-current-locale";
import type { PhoneCredential } from "@/lib/verification/phoneOptIn";

export function PhoneOptInCard({
  credential,
  complete = false,
  onSaved,
}: {
  credential: PhoneCredential;
  complete?: boolean;
  onSaved?: () => void;
}) {
  const locale = useCurrentLocale();
  // The terms line names the Buddy Invite exceptions while that program is on.
  const copy = usePhoneOptInCopy(locale);
  const id = useId();
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<string>(defaultPhoneCountry(locale));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"accepted" | "saved" | null>(null);
  const [error, setError] = useState("");
  if (complete || saved)
    return (
      <div className="wd-phone-success" role="status">
        ✓ {copy[saved || "saved"]}
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
          if (busy) return;
          setError("");
          if (!normalizePhone(phone, country)) {
            setError(copy.invalid);
            return;
          }
          if (!consent) {
            setError(copy.consentRequired);
            return;
          }
          setBusy(true);
          try {
            const result = await savePhoneOptIn({
              data: { credential, phone, country, consent, locale },
            });
            if (result.status === "accepted" || result.status === "saved") {
              setSaved(result.status);
              onSaved?.();
            } else setError(result.status === "invalid" ? copy.invalid : copy.error);
          } catch {
            setError(copy.error);
          } finally {
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
          invalid={error === copy.invalid}
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
        {error && (
          <p className="wd-phone-error" role="alert">
            {error}
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
