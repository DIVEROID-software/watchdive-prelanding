/** Server-rendered presentation checks only. No browser, network, signup, mail or payment.
 * The real segment page, price paths, localized catalogs and frozen-message hook render;
 * router state and unrelated interactive surfaces are isolated with inert test doubles.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { conversionCopy } from "../src/lib/conversionCopy.ts";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { applyPriceClaim } from "../src/lib/i18n/price-claim.ts";
import { referralPriceClaim } from "../src/lib/i18n/referral-price-claim-copy.ts";
import { segmentCopy, type DiveSegment } from "../src/lib/segments/copy.ts";
import { subscriptionCopy } from "../src/lib/segments/subscription-copy.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const out = mkdtempSync(join(cache, "signup-landing-clarity-"));
after(() => rmSync(out, { recursive: true, force: true }));

let page: {
  SegmentLanding: (props: { segment: DiveSegment }) => ReactElement;
  pricePathHeadings: (locale: Locale) => { title: string; public: string };
  setRoute: (state: unknown) => void;
};

before(async () => {
  const mocks: Record<string, string> = {
    "@tanstack/react-router": `
      let state;
      export function setRoute(next) { state = next; }
      export function useRouterState({ select }) { return select(state); }
      export function useRouter() { return {}; }
    `,
    "routes/index": `
      import { createElement } from 'react';
      export const HOLD_EARLY_SUBMIT_JS = '';
      export const AcquisitionTools = () => null;
      export function EmailForm({ id, presentation }) {
        return createElement('form', { 'data-test-email-form': id, 'data-social-after-email': presentation.socialAfterEmail },
          createElement('input', { type: 'email', id: id + '-email' }),
          createElement('button', { type: 'submit' }, presentation.cta),
          createElement('p', { 'data-test-confirmation': '' }, presentation.note));
      }
    `,
    "language-switcher": "export const LanguageSwitcher = () => null;",
    "cookie-choice-bar": "export const CookieSettingsLink = () => null;",
    "social-auth-entry": "export const SocialSignupResultProvider = ({ children }) => children; export const SocialAuthResult = () => null;",
    "LeaderboardSection": `import { useRouterState } from '@tanstack/react-router'; export const useReferralProgramEnabled = () => useRouterState({ select: s => s.referralOn });`,
    "SegmentHowCompat": "export const SegmentHowCompat = () => null;",
    "liteMedia": "export const useLiteMedia = () => false;",
  };
  const outfile = join(out, "page.mjs");
  await build({
    stdin: {
      contents: `export { AirySegmentLanding as SegmentLanding } from './src/components/segments/AirySegmentLanding'; export { pricePathHeadings } from './src/components/segments/PricePaths'; export { setRoute } from '@tanstack/react-router';`,
      resolveDir: root,
    },
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    alias: { "@": join(root, "src") },
    loader: { ".css": "empty" },
    logLevel: "silent",
    plugins: [{
      name: "isolated-presentation-surfaces",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) => {
          const key = Object.keys(mocks).find(candidate => path === candidate || path.endsWith(`/${candidate}`));
          if (key) return { path: key, namespace: "clarity-mock" };
          if (/\.(webp|jpg|jpeg|png|svg|mp4)$/.test(path)) return { path, namespace: "clarity-asset" };
        });
        builder.onLoad({ filter: /.*/, namespace: "clarity-mock" }, ({ path }) => ({ contents: mocks[path], resolveDir: root }));
        builder.onLoad({ filter: /.*/, namespace: "clarity-asset" }, ({ path }) => ({ contents: `export default ${JSON.stringify(path)};` }));
      },
    }],
  });
  page = await import(pathToFileURL(outfile).href);
});

function escaped(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function section(html: string, id: string) {
  const content = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
  assert.ok(content, `missing section ${id}`);
  return content;
}

function occurrences(html: string, text: string) {
  return html.split(escaped(text)).length - 1;
}

for (const locale of SUPPORTED_LOCALES) {
  for (const segment of ["freediving", "scuba"] as const) {
    for (const referralOn of [false, true]) {
      test(`${locale} ${segment} referral ${referralOn ? "on" : "off"}: free action, price facts and benefit order`, () => {
        const messages = FROZEN_LANDING_MESSAGES[locale];
        const claim = referralOn ? referralPriceClaim(locale) : undefined;
        page.setRoute({ location: { pathname: `/${locale}/${segment}` }, matches: [{ context: { messages }, loaderData: { priceClaim: claim } }], referralOn });
        const html = renderToStaticMarkup(createElement(page.SegmentLanding, { segment }));
        const c = segmentCopy(locale, segment);
        const hero = section(html, "segment-hero");
        const middle = section(html, "signup-middle");
        const bottom = section(html, "signup-bottom");
        const prices = section(html, "segment-price-paths");
        const includes = hero.indexOf(escaped(c.includeNote));
        const signup = hero.indexOf('class="wd-segment-hero-jump"');
        const discover = hero.indexOf('class="wd-segment-secondary-link"');
        assert.ok(includes >= 0 && includes < signup && signup < discover, "product scope precedes primary signup and secondary discovery");
        assert.ok(hero.includes(escaped(c.intro)));
        assert.ok(hero.includes(`<a class="wd-segment-hero-jump" href="#signup-middle">${escaped(c.signupCta)}</a>`));
        assert.ok(hero.includes(`<a class="wd-segment-secondary-link" href="#segment-how">${escaped(c.discover)}</a>`));
        assert.equal(occurrences(hero, c.noPayment), 1);
        assert.doesNotMatch(hero, /data-test-email-form|wd-segment-hero-offer|\$149|\$200|\$299/);
        for (const [markup, source] of [[middle, "hero"], [bottom, "offer"]]) {
          assert.ok(markup.includes(escaped(c.finalTitle)));
          const body = source === "hero" ? conversionCopy[locale].benefit : c.finalBody;
          assert.equal(occurrences(markup, body), 1);
          assert.equal(occurrences(markup, conversionCopy[locale].confirmation), 1);
          assert.equal(occurrences(markup, c.noPayment), 1, "one free note per form");
          assert.ok(markup.indexOf(escaped(c.noPayment)) < markup.indexOf(`data-test-email-form="${source}"`), "free note above the email field");
          assert.match(markup, /data-social-after-email="true"/, "both segment forms request email before alternatives");
          assert.doesNotMatch(markup, /<s>|50%|\$299|\$200|wd-segment-discount|wd-segment-launch-price/);
          if (source === "offer") assert.doesNotMatch(markup, /(?:\$\s*149|149\s*\$)|wd-segment-signup-terms/);
        }
        const priceAndTerms = `<p>${escaped(conversionCopy[locale].benefit)}</p><p class="wd-segment-signup-terms">${escaped(conversionCopy[locale].terms)}</p>`;
        assert.ok(middle.includes(priceAndTerms), "price and first-100/non-reservation terms remain adjacent ordinary paragraphs");
        assert.equal(occurrences(middle, conversionCopy[locale].terms), 1);
        const firstHeading = middle.slice(0, middle.indexOf('class="wd-segment-form"'));
        assert.doesNotMatch(firstHeading, /<details|<summary|\bhidden(?:=|\s|>)|aria-hidden="true"|display:\s*none|visibility:\s*hidden|sr-only/);
        assert.ok(middle.indexOf(priceAndTerms) < middle.indexOf('data-test-email-form="hero"'));
        const how = section(html, "segment-how");
        assert.equal((how.match(/<figure\b/g) ?? []).length, 3, "three product photos remain");
        assert.equal((how.match(/<figcaption\b/g) ?? []).length, 3, "each product step retains its caption");
        const reviews = section(html, "beta-reviews");
        const beforeDisclosure = reviews.split('<details')[0];
        assert.deepEqual([...beforeDisclosure.matchAll(/data-review-id="(\d+)"/g)].map(match => Number(match[1])), [7, 35]);
        assert.deepEqual([...reviews.matchAll(/data-review-id="(\d+)"/g)].map(match => Number(match[1])), [7, 35, 45, 63, 72, 88, 100, 120], "all approved reviews remain accessible");
        assert.match(reviews, /<details class="wd-segment-review-more">/);
        assert.ok(prices.includes(escaped(applyPriceClaim(messages, claim).offer.lead)), "real frozen hook supplies referral-aware lead");
        assert.equal(occurrences(prices, conversionCopy[locale].terms), 1);
        assert.match(prices, /299/);
        assert.match(prices, /200/);
        assert.match(prices, /149/);
        assert.match(prices, /data-price-path="reservation"/);
        assert.equal(prices.includes('data-price-path="buddy"'), referralOn);
        assert.equal((html.match(/data-test-email-form=/g) ?? []).length, 2, "hero/offer remain the two inline sources");
        const benefits = section(html, "segment-benefits");
        const titles = [...benefits.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map(match => match[1]);
        const expected = segment === "freediving"
          ? [c.benefits[2].title, c.benefits[0].title, c.benefits[1].title]
          : [subscriptionCopy(locale).benefitTitle, c.benefits[0].title, c.benefits[1].title];
        assert.deepEqual(titles, expected.map(escaped));
      });
    }
  }
}

test("sticky labels reuse localized price-path free-alert headings", () => {
  const labels = ["Free launch alert", "무료 출시 알림", "免费上线通知", "免費上線通知", "無料の公開通知", "Aviso de lanzamiento gratis", "Alerte de lancement gratuite", "Kostenlose Startbenachrichtigung", "Aviso de lançamento grátis", "Gratis lanceringsalert"];
  for (const locale of SUPPORTED_LOCALES) assert.ok(labels.includes(page.pricePathHeadings(locale).public), locale);
  const source = readFileSync(join(root, "src/components/segments/AirySegmentLanding.tsx"), "utf8");
  assert.match(source, /className="wd-segment-sticky"[\s\S]*?<span>\{priceHeadings.public\}<\/span>/);
  assert.equal(source.includes("$149 · Kickstarter"), false);
});

test("sticky is opaque and yields to privacy or an unparked entry sheet; typography stays readable", () => {
  const css = readFileSync(join(root, "src/components/segments/segments.css"), "utf8");
  const stickyRules = [...css.matchAll(/\.wd-segment-sticky\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(stickyRules.some(rule => rule.includes("background-color:#f6fafc")));
  assert.ok(stickyRules.every(rule => !/backdrop-filter|rgba|rgb\(/.test(rule)));
  assert.match(css, /html\[data-wd-cookie="open"\] \.wd-segment-sticky,/);
  assert.match(css, /body:has\(\[aria-labelledby="wd-privacy-title"\]:not\(\[aria-hidden="true"\]\)\) \.wd-segment-sticky,/);
  assert.match(css, /body:has\(\.wd-entry-panel:not\(\[hidden\]\):not\(\[aria-hidden="true"\]\)\) \.wd-segment-sticky\{display:none\}/);
  assert.match(css, /\.wd-segment-price-terms\{[^}]*font-size:14px;line-height:1.6/);
  assert.match(css, /\.wd-segment-free-note\{[^}]*font-size:16px/);
  assert.match(css, /\.wd-segment-form \.wd-email-label\{[^}]*display:block/);
});

test("pending inbox takes the form column while standalone pricing stays discoverable", () => {
  const css = readFileSync(join(root, "src/components/segments/segments.css"), "utf8");
  assert.match(css, /\.wd-segment-signup:has\(\.wd-inbox-card\)\{grid-template-columns:1fr\}/);
  assert.match(css, /\.wd-segment-signup:has\(\.wd-inbox-card\) \.wd-segment-signup-heading,\.wd-segment-signup:has\(\.wd-inbox-card\) \.wd-segment-free-note\{display:none\}/);
  assert.match(css, /\.wd-segment-signup:has\(\.wd-inbox-card\) \.wd-segment-form\{width:100%;max-width:620px;margin:auto\}/);
  const desktop = css.indexOf('.wd-segment-signup:has(.wd-inbox-card)>.wd-segment-form{grid-column:1;grid-row:1}');
  const narrow = css.indexOf('.wd-segment-signup:has(.wd-inbox-card)>.wd-segment-form{grid-column:auto;grid-row:auto}');
  assert.ok(desktop > css.indexOf('.wd-segment-signup>.wd-segment-form{grid-column:2;grid-row:1}'));
  assert.ok(narrow > desktop && css.slice(desktop, narrow).includes('@media(max-width:959px)'));
  assert.doesNotMatch(css, /[^{}]*:has\(\.wd-inbox-card\)[^{}]*\.wd-segment-price-slot/);
  assert.match(css, /\.wd-segment-signup-line,\.wd-segment-signup-line:has\(\.wd-onsite-offer\)\{display:flex;flex-direction:column/);
});
