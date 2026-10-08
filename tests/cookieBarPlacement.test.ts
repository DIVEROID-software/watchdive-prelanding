// The privacy-choices banner. 2026-10-08 (owner decision): a full-width bottom
// sheet shown on arrival in opt-in countries. The earlier rule (wait for half a
// screen of scroll, step aside while a form is on screen) meant almost nobody
// there was ever asked, because this page's first screen is the form. These
// lock the new rule and the markup it depends on; what each fixed element
// covers per viewport is a Playwright measurement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cookieBarShouldYield, type Box } from "../src/lib/cookieBarPlacement.ts";

const box = (top: number, bottom: number, left = 0, right = 320): Box => ({
  top,
  bottom,
  left,
  right,
});

const idle = { editing: false, keyboardOpen: false };

test("on arrival the banner shows, whatever the first screen holds", () => {
  for (const viewportHeight of [568, 844, 932, 900, 720]) {
    assert.equal(cookieBarShouldYield({ asks: [], viewportHeight, ...idle }), false);
  }
});

test("it steps aside while the inline measurement question is on screen", () => {
  assert.equal(cookieBarShouldYield({ asks: [box(300, 520)], viewportHeight: 568, ...idle }), true);
  for (const ask of [box(-400, -1), box(569, 900), box(100, 100, 0, 0)]) {
    assert.equal(
      cookieBarShouldYield({ asks: [ask], viewportHeight: 568, ...idle }),
      false,
      JSON.stringify(ask),
    );
  }
});

test("typing in a form, or an open keyboard, always moves the banner aside", () => {
  assert.equal(
    cookieBarShouldYield({ asks: [], viewportHeight: 568, editing: true, keyboardOpen: false }),
    true,
  );
  assert.equal(
    cookieBarShouldYield({ asks: [], viewportHeight: 568, editing: false, keyboardOpen: true }),
    true,
  );
});

test("refusing is as easy as accepting, tap targets hold, and the yield stays wired", () => {
  const file = readFileSync(
    new URL("../src/components/cookie-choice-bar.tsx", import.meta.url),
    "utf8",
  );
  const source = file.slice(file.indexOf("export function CookieChoiceBar"));
  const privacyLink = source.match(/<a\s+href=\{privacyPath\(locale\)\}\s+className="([^"]+)"/);
  assert.ok(privacyLink, "privacy link not found");
  assert.match(privacyLink[1], /\bmin-h-11\b/);
  const buttons = [...source.matchAll(/<button\s+type="button"\s+className="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(buttons.length, 2, "exactly Reject all and Accept all");
  // Same box for both: identical height, padding and type size.
  const sizing = (classes: string) =>
    classes
      .split(/\s+/)
      .filter((c) => /^(min-h-|px-|py-|text-sm|sm:text-|font-|rounded-)/.test(c))
      .sort()
      .join(" ");
  assert.equal(sizing(buttons[0]), sizing(buttons[1]));
  for (const classes of buttons) assert.match(classes, /\bmin-h-12\b/);
  // Both sit in an equal two-column grid.
  assert.match(source, /grid-cols-2/);
  assert.match(source, /cookieBarShouldYield\(/);
  assert.match(source, /yielding \? "invisible pointer-events-none"/);
  assert.match(source, /--wd-cookie-space/);
});
