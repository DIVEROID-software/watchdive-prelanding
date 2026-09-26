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
  const digest = sha256(jsxStructure(source));
  assert.equal(digest, "e899ebdf949949e4094ad18c1348176470a064eb986ccc9b675991903e3d1a7a");

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
    "<FAQ />",
    "<Footer />",
  ];
  let cursor = -1;
  for (const component of expectedOrder) {
    const next = source.indexOf(component, cursor + 1);
    assert.ok(next > cursor, `${component} must stay in the production order`);
    cursor = next;
  }

  assert.equal((source.match(/<EmailForm\b/g) ?? []).length, 2);
  assert.match(source, /<EmailForm id="hero" \/>/);
  assert.match(source, /<EmailForm id="offer" includePhone \/>/);
  assert.match(source, /id="offer-form"/);
  assert.match(read("src/components/review-ticker.tsx"), /id="beta-reviews"/);
  assert.match(source, /href="#offer-form"/);
});

test("production stylesheet stays at the approved locale-typography baseline", () => {
  // 2026-09-26: Pangram and Spoqa stay, with the 40/56 display scale, 32px
  // titles, 15px body, caption tracking 0, and document scrolling. The notify
  // bar reserves padding-bottom. While the cookie choice is open, that
  // padding matches the measured cookie bar and the notify link is hidden.
  // Brand hex tokens stay; the nested scrollport does not return.
  // 2026-09-26: the cookie choice is a compact bottom bar, so the rule that
  // pushed the phone photo below a tall cookie dialog is gone.
  assert.equal(
    sha256(read("src/styles.css")),
    "d420c8470300c1c0e05341fc0ec711b68a7ad3f6a273b4e3911070bb67bdaece",
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
