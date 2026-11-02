import { signupActionsVisible } from "./signupVisibility.ts";

function documentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** The entry panel itself is on screen. This is not the email/submit hit-test. */
export function entryPopupPanelVisible(panel: Element | null, parked: boolean): boolean {
  if (!panel || parked || !documentVisible()) return false;
  if ("hidden" in panel && (panel as HTMLElement).hidden) return false;
  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const width = window.visualViewport?.width ?? window.innerWidth;
  if (!(height > 0) || !(width > 0)) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

/** Email field and submit button are unobscured. A visible panel is not enough. */
export function entryPopupFormVisible(panel: Element | null, parked: boolean): boolean {
  if (!entryPopupPanelVisible(panel, parked)) return false;
  const form = panel?.querySelector("form");
  if (!form) return false;
  return signupActionsVisible(form);
}
