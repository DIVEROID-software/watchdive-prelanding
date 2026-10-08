// When the privacy-choices banner steps aside.
//
// 2026-10-08 (owner decision): in EU/EEA/UK/CH the banner is a full-width
// bottom sheet shown on arrival, like most consent banners. The earlier rule —
// wait for half a screen of scroll, and step aside whenever a signup form is on
// screen — meant that on this page, whose first screen is the form, almost no
// one in those countries was ever asked, and their visits and signups were
// invisible to the ads that paid for them.
//
// It still steps aside in the two moments it would get in the way:
//
// - someone is typing in a field or the on-screen keyboard is open;
// - the inline measurement question (inbox card / confirmation page) is on
//   screen — it asks the same thing, and the banner must not sit on its two
//   buttons.
//
// Stepping aside keeps the banner laid out (so its height stays reserved as
// page padding) but neither painted nor tappable. Nothing measures until
// Accept either way.
//
// Kept free of path-alias imports and the DOM so `npm test` can load it.

export type Box = { top: number; bottom: number; left: number; right: number };

export function cookieBarShouldYield(input: {
  /** Every inline measurement question currently rendered. */
  asks: readonly Box[];
  viewportHeight: number;
  /** A form field has focus. */
  editing: boolean;
  /** The on-screen keyboard is open (visual viewport well below the layout one). */
  keyboardOpen: boolean;
}): boolean {
  if (input.editing || input.keyboardOpen) return true;
  return input.asks.some(
    (ask) =>
      ask.bottom > ask.top &&
      ask.right > ask.left &&
      ask.bottom > 0 &&
      ask.top < input.viewportHeight,
  );
}
