import { useId, useState, type ReactNode } from "react";
import type { Locale } from "../../lib/i18n/locale";
import { COMPATIBILITY_MODELS } from "../../lib/compatibility/catalog";
import type { CompatibilityRequest } from "../../lib/compatibility/context";
import { RETARGETING_COPY } from "./copy";
import "./retargeting.css";
/** renderSignup must render the existing single-email form with this request
 * attached to its existing submit. The CTA explicitly requests the result email.
 * `alwaysShowEmail` keeps the address field visible before a model is chosen.
 * The optional guard then blocks submit until a catalog model is selected. */
export function CompatibilityChecker({
  locale,
  renderSignup,
  id: idProp,
  alwaysShowEmail = false,
}: {
  locale: Locale;
  id?: string;
  alwaysShowEmail?: boolean;
  renderSignup: (
    request: CompatibilityRequest,
    presentation: { cta: string; note: string },
    beforeSubmit?: () => boolean,
  ) => ReactNode;
}) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const [modelId, setModelId] = useState("");
  const [modelError, setModelError] = useState(false);
  const copy = RETARGETING_COPY[locale];
  const presentation = { cta: copy.request, note: copy.checkerBody };
  const beforeSubmit = () => {
    if (modelId) {
      setModelError(false);
      return true;
    }
    setModelError(true);
    document.getElementById(`${id}-model`)?.focus();
    return false;
  };
  const signup = renderSignup(
    { modelId, locale, requested: true },
    presentation,
    beforeSubmit,
  );
  return (
    <section className="wd-capture-card wd-compatibility-checker" aria-labelledby={`${id}-title`}>
      <p className="wd-capture-eyebrow">WATCHDIVE</p>
      <h2 id={`${id}-title`}>{copy.checkerTitle}</h2>
      <p>{copy.checkerBody}</p>
      <label htmlFor={`${id}-model`}>{copy.model}</label>
      <select
        id={`${id}-model`}
        value={modelId}
        aria-invalid={modelError || undefined}
        aria-describedby={modelError ? `${id}-model-error` : undefined}
        onChange={(event) => {
          setModelId(event.target.value);
          if (event.target.value) setModelError(false);
        }}
      >
        <option value="">{copy.choose}</option>
        {COMPATIBILITY_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.id === "not-listed"
              ? copy.other
              : model.id === "apple-watch-non-ultra"
                ? copy.otherApple
                : model.name}
          </option>
        ))}
      </select>
      {modelError ? <p id={`${id}-model-error`} role="alert">{copy.choose}</p> : null}
      <p className="wd-capture-note">{copy.sizes}</p>
      {alwaysShowEmail ? signup : modelId ? <div key={modelId}>{signup}</div> : null}
    </section>
  );
}
