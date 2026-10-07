// The cookie choice bar on a first visit. Measured on production (2026-10-07)
// it covered the signup form's steps at 320x568 and the launch kicker at
// 1440x900 before the visitor had answered it. The browser-level check (what
// each fixed element covers at load, per viewport) is a Playwright measurement;
// these lock the rule and the markup it depends on.
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

const scrolled = { scrollY: 5_000 };

test("the first screen is never covered, whatever is on it", () => {
  // Production 2026-10-07: the form's steps at 320x568, the launch kicker at
  // 1440x900; locally the hero copy at 430x932 (ko) and the product caption at
  // 1280x720. None of those involve a form under the bar at 1440 or 1280.
  for (const [viewportHeight, forms] of [
    [568, [box(370, 545)]],
    [932, [box(380, 560, 0, 430)]],
    [900, [box(970, 1110, 144, 720)]],
    [720, [box(860, 1000, 100, 640)]],
  ] as const) {
    for (const scrollY of [0, viewportHeight / 2 - 1]) {
      assert.equal(
        cookieBarShouldYield({ forms, viewportHeight, scrollY, ...idle }),
        true,
        `${viewportHeight}px at scrollY ${scrollY}`,
      );
    }
  }
});

test("once scrolled, the bar waits while a signup form is on screen", () => {
  assert.equal(
    cookieBarShouldYield({ forms: [box(100, 300)], viewportHeight: 568, ...scrolled, ...idle }),
    true,
  );
  for (const form of [box(-400, -1), box(569, 900)]) {
    assert.equal(
      cookieBarShouldYield({ forms: [form], viewportHeight: 568, ...scrolled, ...idle }),
      false,
      JSON.stringify(form),
    );
  }
  // Half a screen down with no form in view, it shows.
  assert.equal(
    cookieBarShouldYield({ forms: [box(-900, -600)], viewportHeight: 900, scrollY: 450, ...idle }),
    false,
  );
});

test("typing in a form, or an open keyboard, always moves the bar aside", () => {
  const away = { forms: [box(-900, -600)], viewportHeight: 568, ...scrolled };
  assert.equal(cookieBarShouldYield({ ...away, editing: true, keyboardOpen: false }), true);
  assert.equal(cookieBarShouldYield({ ...away, editing: false, keyboardOpen: true }), true);
  // Collapsed (unrendered) forms are ignored.
  assert.equal(
    cookieBarShouldYield({
      forms: [box(100, 100, 0, 0)],
      viewportHeight: 568,
      ...scrolled,
      ...idle,
    }),
    false,
  );
});

test("the bar's own controls keep 44px tap targets and the yield stays wired", () => {
  const file = readFileSync(
    new URL("../src/components/cookie-choice-bar.tsx", import.meta.url),
    "utf8",
  );
  const source = file.slice(file.indexOf("export function CookieChoiceBar"));
  const privacyLink = source.match(/<a\s+href=\{privacyPath\(locale\)\}\s+className="([^"]+)"/);
  assert.ok(privacyLink, "privacy link not found");
  assert.match(privacyLink[1], /\bmin-h-11\b/);
  assert.match(privacyLink[1], /\bmin-w-11\b/);
  assert.equal(
    (source.match(/<button\s+type="button"\s+className="[^"]*\bmin-h-11 min-w-11\b/g) ?? []).length,
    2,
  );
  assert.match(source, /cookieBarShouldYield\(/);
  assert.match(source, /yielding \? "invisible pointer-events-none"/);
  // Page padding reserves the space the bar really takes up.
  assert.match(source, /--wd-cookie-space/);
});
