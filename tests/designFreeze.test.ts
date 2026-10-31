import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const TEXT_ONLY_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-description",
  "placeholder",
  "title",
  "to",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Fingerprint the production JSX skeleton while deliberately ignoring copy.
 * Locale work may replace text nodes and text-valued attributes, but it may not
 * replace elements, attributes, class names, media, or forms. The component
 * order below is the founder-directed content flow approved on 2026-08-03.
 */
function jsxStructure(sourceText: string, hostElementsOnly = false): string {
  const source = ts.createSourceFile(
    "index.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parts: string[] = [];

  const opening = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    if (hostElementsOnly && !/^[a-z]/.test(node.tagName.getText(source))) return;
    const attributes = node.attributes.properties.map((attribute) => {
      if (ts.isJsxSpreadAttribute(attribute)) return "{...spread}";
      const name = attribute.name.getText(source);
      if (!attribute.initializer) return name;
      if (TEXT_ONLY_ATTRIBUTES.has(name)) return `${name}=<copy>`;
      // Copy shown by a toast/share action can live inside the handler. The
      // security and submission contracts have their own tests; this digest
      // is deliberately about rendered structure and styling.
      if (/^on[A-Z]/.test(name)) return `${name}=<handler>`;
      return `${name}=${attribute.initializer.getText(source)}`;
    });
    parts.push(`<${node.tagName.getText(source)} ${attributes.join(" ")}>`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) opening(node);
    if (
      ts.isJsxClosingElement(node) &&
      (!hostElementsOnly || /^[a-z]/.test(node.tagName.getText(source)))
    ) {
      parts.push(`</${node.tagName.getText(source)}>`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return parts.join("\n");
}

test("production landing DOM and Tailwind skeleton remain frozen", () => {
  const source = read("src/routes/index.tsx");
  // 2026-09-26: the four-wave design pass is ported onto this tree.
  // Section order, both email forms, #offer-form and #beta-reviews stay.
  // Classes change for one hero surface, the type scale, mid-violet buttons,
  // the two-row wordmark header, a single-frame product photo, and a notify
  // bar portaled to the document. Measurement calls in the form stay.
  // 2026-09-26 (US conversion): below lg the hero shows headline, price and
  // the email form before the product photo (flex order only; desktop order
  // unchanged), the countdown became a static December notice, and the
  // footer gained a Cookie settings link.
  // 2026-09-26: mobile optimization adds intrinsic form widths, wrapping
  // footer links and compact app tabs; section order and signup flow stay.
  // 2026-10-07 (page weight): same elements, classes and sources. Photos gain
  // srcset/sizes cuts and the first-screen photo fetchPriority; the three
  // clips become LazyVideo (poster and playback only near the screen). Full-page
  // screenshots at 390@3x and 1440@1x/2x differ only inside the resized photos.
  // 2026-10-07: the two compatibility cards and their text columns get
  // min-w-0, and the housing badge may hyphenate, so es/pt-BR (and fr's
  // grid track) no longer overflow a 320px viewport. Measured: no size change
  // at 390/430/1440 or in any other locale.
  // 2026-10-07: owner explicitly requested a mobile-first content upgrade
  // using their TCF media archive. Reviewed baseline: one responsive studio
  // gallery, product before signup on mobile, real underwater/pool/app photos,
  // clearer two-step email confirmation, address display and resend cooldown.
  // Both forms, section IDs/order, consent and tracking contracts remain.
  // 2026-10-08: owner-requested hero/USP/conversion pass. The hero shows the
  // housing on a wrist underwater (<picture>, AVIF/WebP, preloaded) and says
  // "your smartwatch becomes a dive computer"; the studio gallery moves into
  // the "This launch" card, uncropped and stacked on phones; a three-item
  // proof strip (compatibility with a link to the new #compatibility anchor,
  // the first-100 price, what it does) replaces the two hero facts; Yahoo,
  // iCloud and Outlook addresses get a spam-folder line in the inbox card; a
  // submit made before hydration is held and sent once React is ready; on
  // Save-Data or slow connections videos wait for a tap. Both forms, #offer-form,
  // section order, consent and tracking calls are unchanged.
  // 2026-10-08: the inbox card (after a submit) may show one optional
  // measurement question to visitors in opt-in countries who have not answered
  // the cookie bar — which on this page they almost never saw. Nothing else in
  // the DOM changes; the form, sections and order are untouched.
  // 2026-10-08 (QA round): the inbox card also wires the refusal path, so a
  // "No thanks" after the submit is recorded on the signup. Props only.
  // 2026-10-08: owner accepted the form-first 50:50 conversion experiment.
  // Both existing forms and all sections remain; the treatment moves signup
  // before media, clarifies the offer/confirmation and fixes sticky visibility.
  // 2026-10-10: owner-requested FOMO pass, placed from page-behaviour data
  // (81% phones, median phone scroll 7%, first-100 section reached by 27%).
  // In form-first the hero form leads with one first-100 sentence (price,
  // Kickstarter, at launch) in place of the benefit line, and the price chip's
  // "first 100 at launch" note is hidden. Control renders as before: an added
  // line there pushed the desktop submit button below a 900px fold.
  // 2026-10-12: owner requested optional SMS capture after signup/verification
  // and country search by name or calling code. Reviewed at 320/390/1440px
  // across 9 locales. The existing first form, media and 50:50 experiment stay.
  // 2026-10-12: owner requested aligned app screenshots. The three existing
  // figures share title/image/caption rows, including in the swipe carousel.
  // 2026-10-18: owner-requested underwater image quality improvement uses
  // original-master responsive exports in ValueSection; hero and layout stay.
  // 2026-10-18: owner requested an explicit already-verified response card.
  // It replaces the inbox prompt only after a repeat verified signup.
  // 2026-10-19: owner requested Google and Apple signup on both existing forms.
  // The email fields, phone fields, and 50:50 experiment stay. The buttons are
  // an added control above each form, and the result line sits above the hero form.
  // 2026-10-19: signup-state QA repair adds a non-DOM React provider and
  // replaces both forms with a completion panel only for a one-time social
  // callback acknowledgement. Fresh signup structure and allocation stay.
  // 2026-10-22: Buddy Invite adds a client-only leaderboard section between the
  // offer and the FAQ, a footer rules link, and the referral card in the
  // post-verification panel. The hero and both forms are untouched.
  // 2026-10-22: Buddy Invite visual QA, program-on branches only: the card's
  // share field gets a non-collapsing class and a label, reward tiers move
  // into a <details>, the rules link gets a 44px target, and the invited
  // banner gains one muted line. Switch-off DOM is pixel-identical to main
  // (full-page diff 0 at 390/1280px in ko/en/de/ja).
  // 2026-10-22: memorable share codes, program-on only. The verified card
  // gains a code row, and each signup form gains a closed disclosure under
  // the email field and submit button. Both stay out of the tree while the
  // program is off, so the switch-off DOM matches the previous pin.
  // 2026-10-22: owner-requested EVENT ladder is visible in the program-on
  // verified card; only its conditions collapse. The off branch is unchanged.
  // 2026-10-23: owner-requested post-signup reservation offer, inbox focus
  // target, and post-verification offer. Existing landing sections stay frozen.
  // 2026-10-23 owner override: remove hero description and the shared
  // reassurance/confirmation/terms block, retaining the separate email hint.
  // aria-describedby now points only at that retained hint.
  // 2026-10-25: audience pages reuse EmailForm with an opt-in presentation.
  // Resolve only that new option to its absent (legacy) value before comparing
  // the original pin. The legacy route never supplies this prop. Do not re-pin
  // its hash to hide accidental changes to the original page.
  // 2026-10-26: owner-requested signup-to-payment QA fixes. Reviewed diff is
  // confined to EmailForm: a shared consent-aware phone card keeps failed
  // saves retryable; a server-authorized social completion adds phone/offer.
  // No section order, initial form, hero/media or main CSS changes. Re-pin
  // those authorized post-submit branches; retain the structural checks below.
  // 2026-10-26 retargeting preparation: owner requested AcquisitionTools on
  // the existing route, compact single-email capture, compatibility context
  // and optional push. Reviewed with 18 localized segment screens plus the
  // signup/verification/phone/reservation flow (QA-UI.json). Existing section
  // order assertions below remain; this pins the reviewed local preparation.
  // 2026-10-29: owner-approved first-visit popup rollout. A build flag selects
  // one entry capture instead of exit capture (false restores exit). Both reuse
  // EmailForm; the entry instance does not report legacy middle/bottom funnel
  // milestones. Existing sections, initial forms and stylesheet stay pinned.
  // 2026-10-31: owner-requested referral price path on the post-verification
  // card only. The program-on next-tier sentence becomes the confirmed-email
  // goal, the share button gains data attributes, and the prize ladder sits
  // in a labelled disclosure. The goal receives countState so a check in
  // progress is not shown as an unknown or zero count. Program-off count,
  // titles, share copy, both forms, section order and the stylesheet pin stay.
  // 2026-10-31 later: the signup share hook is omitted while the program is
  // off, and a presentation inbox no longer receives the phone slot. Restoring
  // those two attribute texts reproduces 79fe9710…; presentation element order
  // stays stripped below. No other skeleton line moved.
  const legacySource = source
    .replace(/    if \(presentation\) return <>[^\n]+<\/>;\n/, "")
    .replace(/\{!presentation && (<SignupReservationOffer[^\n]+autoFocus \/>)\}/, "$1")
    .replace(/\{presentation && <SignupReservationOffer[^\n]+\/>\}/, "")
    .replace('autoFocus={Boolean(presentation)}', 'autoFocus={false}')
    .replace('message={presentation ? "" : pending}', 'message={pending}')
    .replace('className={presentation ? "wd-segment-confirm-note" : "wd-control-copy text-sm leading-relaxed text-white/90"}', 'className="wd-control-copy text-sm leading-relaxed text-white/90"');
  const digest = sha256(jsxStructure(legacySource));
  assert.equal(digest, "efa6639dbe4b219405e6cf77cce8869ff152ccdc92a01dba909cdf9149564fe5");

  const expectedOrder = [
    "<StickyLaunchBanner />",
    "<Hero />",
    "<ValueSection />",
    "<HowItWorks />",
    "<Compatibility />",
    "<FunctionsSection />",
    "<AppEcosystem />",
    "<ActionCameras />",
    "<SafetySection />",
    "<ReviewTicker />",
    "<Credentials />",
    "<OfferSection />",
    "<LeaderboardSection locale={locale} />",
    "<FAQ />",
    "<Footer />",
  ];
  let cursor = -1;
  for (const component of expectedOrder) {
    const next = source.indexOf(component, cursor + 1);
    assert.ok(next > cursor, `${component} must stay in the production order`);
    cursor = next;
  }

  // The two original form placements remain; two compact, on-demand capture
  // wrappers are compatibility and mutually exclusive entry/exit prompts.
  assert.equal((source.match(/<EmailForm\b/g) ?? []).length, 5);
  assert.match(source, /<EmailForm id="hero" domId="compatibility-checker" compact compatibility=\{request\}/);
  assert.match(source, /<EmailForm id="offer" domId="exit-capture" compact/);
  assert.match(source, /<EmailForm id="hero" \/>/);
  assert.match(source, /<EmailForm id="offer" includePhone \/>/);
  assert.match(source, /id="offer-form"/);
  assert.match(read("src/components/review-ticker.tsx"), /id="beta-reviews"/);
  assert.match(source, /href="#offer-form"/);
});

test("production stylesheet stays at the approved locale-typography baseline", () => {
  // Mobile pass: fluid headings, full product crop, compact chat launcher,
  // wrapping translated copy and 16px inputs; desktop scale stays unchanged.
  // 2026-09-26: Pangram and Spoqa stay, with the 40/56 display scale, 32px
  // titles, 15px body, caption tracking 0, and document scrolling. The notify
  // bar reserves padding-bottom. While the cookie choice is open, that
  // padding matches the measured cookie bar and the notify link is hidden.
  // Brand hex tokens stay; the nested scrollport does not return.
  // 2026-09-26: the cookie choice is a compact bottom bar, so the rule that
  // pushed the phone photo below a tall cookie dialog is gone.
  // 2026-10-07: Spoqa faces declare their Hangul unicode-range (plus a 1 KB
  // cut for 한국어 in the picker); Hangul renders pixel-identical.
  // 2026-10-07: owner-authorized mobile content/verification refresh, visually
  // inspected at 320, 390 and 1440px. Old reef styling retired; brand retained.
  // 2026-10-08: owner-requested hero pass. Ocean ground mixed from brand cyan
  // and the abyss token (text contrast >= 5.3:1 at the lightest stop), photo
  // frame with an inlined 24px preview, proof strip, uncropped launch-card
  // gallery, held-submit note, spam-folder line and tap-to-play. Measured with
  // fv-layoutqa at 320/390/430/1440, 9 locales, pre/post consent.
  // 2026-10-10: owner-requested FOMO pass adds one rule for the hero
  // first-100 line (the benefit line's size and leading). Nothing else changes.
  // 2026-10-12: owner-requested optional SMS card and searchable country picker;
  // 16px mobile inputs, visible focus and a stacked narrow-screen layout.
  // 2026-10-12: shared app-screen rows align images and captions across wrapped
  // headings; 22 locale/viewport cases and mobile navigation were reviewed.
  // 2026-10-21: owner-requested FOMO motion on the launch-alert CTAs (sweep,
  // halo, brighten; notify-bar arrow nudge). Off under reduced motion and while
  // hovered, focused or submitting; checked at 390px with no horizontal scroll.
  // 2026-10-23 owner override: first-100 marker pulses its background only,
  // with a static reduced-motion state. No surrounding styles are changed.
  assert.equal(
    sha256(read("src/styles.css")),
    "5bf32c958d5d9f16d1295c0702f6ad1ddc4156c219d9f24168ca204611469f42",
  );
});

test("testimonial localization preserves the frozen host DOM and classes", () => {
  // 2026-09-26: same host elements and marquee. Body, name, and disclosure
  // use the type scale and #F6FAFC on the deep-violet section.
  assert.equal(
    sha256(jsxStructure(read("src/components/review-ticker.tsx"), true)),
    "301336a35061d8b4ce5c46e2328c8c515c58939cf4b3285dfc9c822341568002",
  );
});

test("the rejected replacement-design components cannot return", () => {
  for (const path of [
    "src/components/localized-landing.tsx",
    "src/components/localized-waitlist-form.tsx",
    "src/components/measurement-consent.tsx",
  ]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path);
  }
});
