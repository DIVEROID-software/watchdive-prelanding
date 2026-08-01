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
 * replace elements, attributes, class names, media, forms, or component order.
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
  const digest = sha256(jsxStructure(source));
  assert.equal(digest, "fa7a87e9f35ed75b71fbaeb59156202dfbc86e91c313ca8881c7e0520f87beea");

  const expectedOrder = [
    "<StickyLaunchBanner />",
    "<Hero />",
    "<ValueSection />",
    "<FunctionsSection />",
    "<HowItWorks />",
    "<AppEcosystem />",
    "<ReviewTicker />",
    "<Compatibility />",
    "<ActionCameras />",
    "<SafetySection />",
    "<OfferSection />",
    "<Credentials />",
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
  assert.equal(
    sha256(read("src/styles.css")),
    "f9a558623d37232f6e83854d59564e8417eccd6c6d322858fca3983cfb64bc51",
  );
});

test("testimonial localization preserves the frozen host DOM and classes", () => {
  assert.equal(
    sha256(jsxStructure(read("src/components/review-ticker.tsx"), true)),
    "1963e9a5b58171b59a165d15f040b6cb5964d715c7aa20f757a74e2c77cb4804",
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
