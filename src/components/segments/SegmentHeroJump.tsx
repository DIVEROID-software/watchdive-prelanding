import type { FrozenLandingMessages } from "@/lib/i18n/frozen-landing-en";

type Compat = FrozenLandingMessages["compat"];

/** Move to the middle signup heading. Focusing the heading keeps the email field from opening the keyboard. */
export function focusMiddleSignup(event: { preventDefault(): void }) {
  const heading = document.getElementById("signup-title-middle");
  const panel = document.getElementById("signup-middle");
  if (!(heading instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
  event.preventDefault();
  heading.focus({ preventScroll: true });
  panel.scrollIntoView({ block: "start" });
  const next = `${window.location.pathname}${window.location.search}#signup-middle`;
  if (window.location.hash !== "#signup-middle") history.pushState(null, "", next);
  requestAnimationFrame(() => {
    if (document.activeElement !== heading) heading.focus({ preventScroll: true });
  });
}

function openCompatibilityAnswer() {
  const detail = document.getElementById("segment-compatibility");
  if (detail instanceof HTMLDetailsElement) detail.open = true;
}

export function SegmentHeroJump({
  appleLine,
  compat,
  faqLabel,
}: {
  appleLine: string;
  compat: Compat;
  faqLabel: string;
}) {
  return (
    <details className="wd-segment-hero-compat">
        <summary>
          <span>{faqLabel}</span>
          <span aria-hidden="true">+</span>
        </summary>
        <div className="wd-segment-compat-panel">
          <p className="wd-segment-compat-now">{compat.housingBadge} · {compat.housingTitle}</p>
          <ul>
            <li>{appleLine}</li>
            <li>{compat.housingModel2}</li>
            <li>{compat.housingModel3}</li>
            <li>{compat.housingModel4}</li>
          </ul>
          <p className="wd-segment-compat-later"><strong>{compat.appOnlyTitle}</strong></p>
          <p>{compat.appOnlyBody}</p>
          <p>{compat.appOnlyModel1}; {compat.appOnlyModel2}; {compat.appOnlyModel3}</p>
          <p>{compat.footnote}</p>
          <a href="#segment-compatibility" onClick={openCompatibilityAnswer}>
            {faqLabel}
            <span aria-hidden="true"> ↓</span>
          </a>
        </div>
      </details>
  );
}
