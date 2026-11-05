---
name: WatchDive photo-led landing preview
description: Spacious real diving photography, followed by a quiet email signup.
colors:
  ground: "#ffffff"
  ink: "#102d39"
  muted: "#49616c"
  action: "#087d80"
  soft: "#f2f7f7"
  line: "#d7e3e5"
rounded:
  control: "8px"
  photo: "20px"
  hero: "24px"
spacing:
  small: "16px"
  medium: "24px"
  large: "48px"
components:
  primary-action:
    backgroundColor: "{colors.action}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
---

## Overview

The new landing is scoped to `.wd-segment-airy` at `/launch/scuba` and `/launch/freediving`, including localized equivalents. Existing `/scuba` and `/freediving` retain the production control design and behavior. Real WatchDive in the water is the central visual; product understanding precedes the first email form. The owner supplied the Prelaunch photography and spacious layout reference. This is not a new brand identity or an email-theme change.

Taste's selected hero-object direction uses seed 1778557155. Its generated orange palette, and the subsequent pastel redraw, are deliberately superseded by the owner's bright agency reference: white ground, deep ocean ink, teal actions, existing blue diving photography. Existing typography is retained for localization and loading stability. Impeccable uses that pinned direction rather than an unrelated visual-world workshop.

## Colors

White carries most of the page. The photograph supplies strong blue and yellow. Teal identifies actions. Deep navy supports white carousel text and the final signup. Secondary text remains above AA contrast; no fluorescent yellow frames or decorative purple blocks.

## Typography

Keep the repository's installed brand/localized fonts. Display size scales from 38px to 64px, section headings 30px to 46px, readable body 16–20px. Avoid forced line breaks in translated paragraphs and fixed text heights. Price and compatibility qualifiers remain legible.

## Layout

Maximum content width is 1240px, with 1440px hero/navigation framing. Horizontal gutters scale from 20px to 64px. Use 72–124px between major sections, tighter spacing within related content. The hero statement leads into a large product visual. Three how-to photos replace repeated video/list explanations; the existing feature carousel retains four cards. The first form follows those explanations, before two open quotes (all eight accessible through the disclosure) and the press section. This shortens the initial photo-led preview's nearly five-screen mobile path without putting a large form in the hero.

The form is one column at up to 580px. Email comes first, confirmation guidance next, OAuth alternatives below. The first form explains the $149 launch-alert benefit with its full first-100/backer and no-reservation terms in adjacent plain text. The price is not a giant display or purchase button. The hero's primary action is the free launch alert, with product exploration as its secondary link. Direct signup links preserve campaign query strings and focus the form. A bottom sticky CTA appears only after visitors pass the first form and while neither form nor keyboard is visible.

## Elevation & Depth

No offset shadows or heavy frames. Soft tonal surfaces separate signup and cost details. Thin borders identify form fields and disclosure boundaries. Existing neutral/dark photographic scrims protect carousel text contrast; they are not decorative gradient backgrounds.

## Shapes

Photos use 16–24px corners; controls use 8px. These overrides remain inside the airy page because the legacy global theme deliberately forces square corners elsewhere. Preserve official logo files without distortion or recoloring.

## Components

The existing carousel remains the principal motion: six-second dwell, pause controls, keyboard interaction, viewport/visibility/focus guards and reduced-motion support. Ordinary controls use brief color/transform feedback; do not add entrance animations merely to reach a motion quota. All primary content is visible without waiting for an animation.

Hero footage plays silently inline when visible on both mobile and desktop. Screen width alone does not disable it. Retain the poster until a playable frame, respect reduced motion and data-saving connections, pause offscreen or in a hidden tab, and preserve a visitor's explicit pause. The play control remains available when automatic playback is unavailable.

Retain the shared EmailForm implementation and its pending, verification, optional-phone and error states. The preview's explicit `capture="none"` disables both entry and exit automatic capture; do not substitute the old entry flag because its false branch enables exit capture. Default behavior outside this variant is unchanged.

## Do's and Don'ts

- Preserve approved facts, source links, locale coverage and measurement identifiers.
- Review at 320, 390, 768 and 1440px and with reduced motion.
- Distinguish mock preview form checks from actual email, CRM or conversion-provider delivery.
- Keep both destinations available for the owner-requested Malaysia landing comparison; do not replace the control during the comparison.
