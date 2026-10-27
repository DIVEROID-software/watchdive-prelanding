import { useEffect, useState } from 'react';
import { CompatibilityChecker } from '@/components/retargeting/CompatibilityChecker';
import { EmailForm } from '@/routes/index';
import { getAcquisitionReadiness } from '@/lib/api/waitlist.functions';
import type { Locale } from '@/lib/i18n/locale';

/** The existing compatibility card, opened from the how-section button.
 * Readiness still hides it when the capture path is off. No second endpoint. */
export function SegmentHowCompat({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAcquisitionReadiness()
      .then((result) => {
        if (!cancelled) setEnabled(Boolean(result.compatibility));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const select = document.getElementById('segment-how-check-model');
    if (select instanceof HTMLElement) select.focus();
  }, [open]);

  if (!enabled) return null;

  return (
    <div className="wd-segment-how-compat">
      <button
        type="button"
        className="wd-segment-text-link"
        aria-expanded={open}
        aria-controls="segment-how-compat-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      <div id="segment-how-compat-panel" hidden={!open}>
        {open ? (
          <CompatibilityChecker
            id="segment-how-check"
            locale={locale}
            alwaysShowEmail
            renderSignup={(request, presentation, beforeSubmit) => (
              <EmailForm
                id="hero"
                domId="segment-how-compatibility"
                compact
                compatibility={request}
                presentation={presentation}
                beforeSubmit={beforeSubmit}
              />
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
