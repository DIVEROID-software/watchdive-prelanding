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
function jsxStructure(sourceText: string): string {
  const source = ts.createSourceFile(
    "index.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parts: string[] = [];

  const opening = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
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
    if (ts.isJsxClosingElement(node)) parts.push(`</${node.tagName.getText(source)}>`);
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

test("production stylesheet remains byte-identical", () => {
  assert.equal(
    sha256(read("src/styles.css")),
    "d8da710239c5532679c5ca3ab17cbde77998847aeba9b62350e36abc57b7d27f",
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
