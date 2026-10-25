import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { applySearchIndexingPolicy, publicCrawlResponse, robotsTxt, sitemapXml } from "../src/lib/i18n/crawl.ts";
import { EN_FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-en.ts";
import { FROZEN_LANDING_MESSAGES } from "../src/lib/i18n/frozen-landing-messages.ts";
import { SUPPORTED_LOCALES, homePath, privacyPath, termsPath, localizePath, type Locale } from "../src/lib/i18n/locale.ts";
import { WATCHDIVE_PUBLIC_ORIGIN } from "../src/lib/i18n/publicOrigin.ts";
import {
  jsonLdScript,
  landingStructuredData,
  legalStructuredData,
} from "../src/lib/i18n/structuredData.ts";

const ORIGIN = "https://watchdive.diveroid.com";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found);
    }
  }
  return found;
}

test("robots.txt allows public pages, blocks only API fetches, and publishes the sitemap", () => {
  const body = robotsTxt();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Allow: \/$/m);
  assert.match(body, /^Disallow: \/api\/$/m);
  assert.equal(body.match(/^Disallow:/gm)?.length, 1);
  assert.match(body, new RegExp(`^Sitemap: ${ORIGIN}/sitemap.xml$`, "m"));
  assert.doesNotMatch(body, /llms\.txt/i);
  assert.doesNotMatch(body, /Disallow: \/(?:privacy|ko|verify|reservation)/);
});

test("the sitemap lists the 45 canonical public URLs and repeats the HTML hreflang cluster", () => {
  const xml = sitemapXml();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(locs.length, SUPPORTED_LOCALES.length * 5);
  assert.equal(new Set(locs).size, locs.length);

  const expected = [homePath, privacyPath, termsPath, (locale: Locale) => localizePath('/freediving', locale), (locale: Locale) => localizePath('/scuba', locale)].flatMap((pathFor) =>
    SUPPORTED_LOCALES.map((locale) => new URL(pathFor(locale), ORIGIN).toString()),
  );
  assert.deepEqual(locs, expected);

  for (const block of xml.split("<url>").slice(1)) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    const alternates = [...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)];
    assert.equal(alternates.length, SUPPORTED_LOCALES.length + 1);
    assert.equal(alternates.filter((item) => item[1] === "x-default").length, 1);
    assert.ok(alternates.some((item) => item[2] === loc));
    assert.doesNotMatch(block, /<lastmod>/);
  }

  for (const blocked of ["/verify", "/reservation", "/api/", "/unsubscribe", "/admin", "/r/"]) {
    assert.equal(xml.includes(blocked), false, blocked);
  }
});

test("crawl responses are GET and HEAD documents and do not swallow other routes", () => {
  const robots = publicCrawlResponse("/robots.txt", "GET");
  const sitemap = publicCrawlResponse("/sitemap.xml", "GET");
  assert.equal(robots?.status, 200);
  assert.equal(robots?.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(robots?.headers.get("x-robots-tag"), "noindex");
  assert.equal(sitemap?.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(publicCrawlResponse("/sitemap.xml", "HEAD")?.status, 200);
  assert.equal(publicCrawlResponse("/robots.txt", "POST"), undefined);
  assert.equal(publicCrawlResponse("/ko", "GET"), undefined);
  assert.equal(publicCrawlResponse("/robots.txt/", "GET"), undefined);
});

test("landing structured data copies the visible depth answers and states no price or rating", () => {
  const catalogs: Record<Locale, typeof EN_FROZEN_LANDING_MESSAGES> = {
    en: EN_FROZEN_LANDING_MESSAGES,
    ...FROZEN_LANDING_MESSAGES,
  };
  for (const locale of SUPPORTED_LOCALES) {
    const messages = catalogs[locale];
    const data = landingStructuredData(
      locale,
      messages,
      new URL(homePath(locale), ORIGIN).toString(),
      `${ORIGIN}/hero.webp`,
    );
    const keys = collectKeys(data);
    for (const banned of ["offers", "aggregateRating", "review", "price", "priceCurrency", "availability"]) {
      assert.equal(keys.has(banned), false, `${locale} ${banned}`);
    }
    const thing = data["@graph"].find((node) => node["@type"] === "Thing");
    assert.equal(thing?.description, messages.faq.a1);
    assert.equal(thing?.disambiguatingDescription, messages.faq.a2);
    assert.match(String(thing?.description), /40\s?m/);
    assert.match(String(thing?.description), /60\s?m/);
    assert.doesNotMatch(String(thing?.description), /40\s?m\s*(?:\/|=|or)\s*60/i);
    assert.doesNotMatch(JSON.stringify(thing), /\$3|USD 3/);
    assert.equal(
      data["@graph"].some((node) => node["@type"] === "Product"),
      false,
    );
  }
});

test("legal structured data stays a web page and does not turn the reservation fee into a product offer", () => {
  const data = legalStructuredData(
    "en",
    "terms",
    EN_FROZEN_LANDING_MESSAGES,
    `${ORIGIN}/terms`,
  );
  const keys = collectKeys(data);
  assert.equal(keys.has("offers"), false);
  assert.equal(keys.has("price"), false);
  const page = data["@graph"].find((node) => node["@type"] === "WebPage");
  assert.equal(page?.description, EN_FROZEN_LANDING_MESSAGES.terms.metaDescription);
  assert.match(String(page?.description), /USD \$3/);
  assert.match(String(page?.description), /price reservation/);
  assert.doesNotMatch(String(page?.description), /product costs \$3|full product/i);
  assert.equal(jsonLdScript({ unsafe: "</script><script>" }).includes("</script>"), false);
});

test("English legal routes join the localized canonical cluster and crawl files stay on the server", () => {
  assert.match(read("src/routes/privacy.tsx"), /legalHead\("en", "privacy"\)/);
  assert.match(read("src/routes/terms.tsx"), /legalHead\("en", "terms"\)/);
  assert.match(read("src/server.ts"), /publicCrawlResponse\(pathname, request\.method\)/);
  assert.match(read("src/routes/r.$code.tsx"), /X-Robots-Tag": "noindex, nofollow"/);
  assert.match(read("src/routes/$locale.r.$code.tsx"), /X-Robots-Tag": "noindex, nofollow"/);
  assert.match(
    read("src/lib/i18n/seo.ts"),
    new RegExp(`export const WATCHDIVE_PUBLIC_ORIGIN = "${WATCHDIVE_PUBLIC_ORIGIN}"`),
  );
  assert.equal(WATCHDIVE_PUBLIC_ORIGIN, ORIGIN);
});

test("preview and private responses stay out of indexes without blocking production public pages", async () => {
  for (const [path, environment] of [["/ko", "preview"], ["/api/geo", "production"], ["/reservation", "production"]]) {
    const response = applySearchIndexingPolicy(new Response("body", { headers: { "set-cookie": "keep=1" } }), path, environment);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
    assert.equal(response.headers.get("set-cookie"), "keep=1");
    assert.equal(await response.text(), "body");
  }
  const publicResponse = new Response("public");
  assert.equal(applySearchIndexingPolicy(publicResponse, "/ko", "production"), publicResponse);
  assert.match(applySearchIndexingPolicy(new Response("missing", { status: 404 }), "/missing", "production").headers.get("x-robots-tag") ?? "", /noindex/);
});
