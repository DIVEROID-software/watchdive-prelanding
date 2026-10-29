import type { FrozenLandingMessages } from "@/lib/i18n/frozen-landing-en";

type Compat = FrozenLandingMessages["compat"];

/** Public `router.navigate` slice. `href` keeps the raw pathname and query. */
export type MiddleSignupNavigate = (options: {
  href: string;
  resetScroll: false;
  hashScrollIntoView: false;
}) => Promise<void>;

type SignupJumpEvent = {
  preventDefault(): void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
};

function wantsNativeNavigation(event: SignupJumpEvent) {
  return Boolean(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button ?? 0) !== 0);
}

function revealMiddleSignup() {
  const heading = document.getElementById("signup-title-middle");
  const panel = document.getElementById("signup-middle");
  if (!(heading instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
  const form = panel.querySelector("form[data-wd-signup]");
  // The offer above the form can exceed a short mobile viewport. The panel
  // heading is the hash target, so centering the form comes after the router
  // commit and the heading is focused without scrolling it back up.
  if (form instanceof HTMLElement) form.scrollIntoView({ block: "center" });
  else panel.scrollIntoView({ block: "start" });
  heading.focus({ preventScroll: true });
}

/** Show the signup controls without opening the mobile keyboard.
 * Plain clicks go through the router so hash restoration cannot pull the
 * panel heading back to the top. Modified clicks keep the native link.
 */
export async function focusMiddleSignup(event: SignupJumpEvent, navigate: MiddleSignupNavigate) {
  if (wantsNativeNavigation(event)) return;
  const heading = document.getElementById("signup-title-middle");
  const panel = document.getElementById("signup-middle");
  if (!(heading instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
  event.preventDefault();
  const href = `${window.location.pathname}${window.location.search}#signup-middle`;
  try {
    await navigate({ href, resetScroll: false, hashScrollIntoView: false });
  } catch {
    // preventDefault already replaced the native hash jump.
  }
  revealMiddleSignup();
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
