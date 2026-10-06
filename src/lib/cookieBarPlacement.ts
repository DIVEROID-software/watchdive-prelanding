// When the cookie choice bar steps aside.
//
// The bar is fixed to the bottom edge. Reserved page padding protects only the
// end of the document; on a first visit the bar sat on whatever the first
// screen ended with — measured on production (2026-10-07), the signup form's
// own steps at 320x568 and the launch kicker at 1440x900, and locally the
// hero copy under the form on taller phones and the product card's caption
// on a 1280x720 laptop. Which text that is depends on the viewport and the
// language, so the rule is about the visit, not the layout:
//
// - the first screen is never covered: the bar waits until the visitor has
//   scrolled half a screen;
// - like the notify link, it steps aside while a signup form is on screen or
//   someone is typing, so it never sits on the email field, the button or the
//   steps under it.
//
// Stepping aside keeps the bar laid out (so its height stays reserved) but
// neither painted nor tappable. Nothing measures until Allow either way.
//
// Kept free of path-alias imports and the DOM so `npm test` can load it.

export type Box = { top: number; bottom: number; left: number; right: number };

export function cookieBarShouldYield(input: {
  /** Every signup form on the page. */
  forms: readonly Box[];
  viewportHeight: number;
  scrollY: number;
  /** A form field has focus. */
  editing: boolean;
  /** The on-screen keyboard is open (visual viewport well below the layout one). */
  keyboardOpen: boolean;
}): boolean {
  if (input.editing || input.keyboardOpen) return true;
  if (input.scrollY < input.viewportHeight / 2) return true;
  return input.forms.some(
    (form) =>
      form.bottom > form.top &&
      form.right > form.left &&
      form.bottom > 0 &&
      form.top < input.viewportHeight,
  );
}
