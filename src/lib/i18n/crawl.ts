import { absoluteWatchDivePath, WATCHDIVE_PUBLIC_ORIGIN } from "./publicOrigin.ts";
import { SUPPORTED_LOCALES, homePath, privacyPath, termsPath, type Locale } from "./locale.ts";

/**
 * Public crawl files for the production origin.
 *
 * robots.txt only manages fetching. A noindex robots meta tag, not this file,
 * keeps a private HTML URL out of a search index, so those URLs stay fetchable.
 * Google Search does not give llms.txt special treatment, so this module does
 * not publish one and does not ask crawlers for citations.
 *
 * Omit lastmod until an actual modification date is tracked per public page.
 */

const PUBLIC_DOCUMENTS = [
  { pathFor: homePath },
  { pathFor: privacyPath },
  { pathFor: termsPath },
] as const;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function alternates(pathFor: (locale: Locale) => string): string {
  const links = [
    ...SUPPORTED_LOCALES.map(
      (locale) =>
        `    <xhtml:link rel="alternate" hreflang="${xmlEscape(locale)}" href="${xmlEscape(absoluteWatchDivePath(pathFor(locale)))}"/>`,
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(absoluteWatchDivePath(pathFor("en")))}"/>`,
  ];
  return links.join("\n");
}

export function robotsTxt(): string {
  return [
    "# Crawl access for https://watchdive.diveroid.com",
    "# This file tells crawlers which paths they may fetch.",
    "# It does not remove a URL from an index and it does not request AI citations.",
    "# Private HTML stays fetchable and carries its own noindex robots meta tag.",
    "",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${WATCHDIVE_PUBLIC_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(): string {
  const urls = PUBLIC_DOCUMENTS.flatMap(({ pathFor }) =>
    SUPPORTED_LOCALES.map((locale) => {
      const loc = absoluteWatchDivePath(pathFor(locale));
      return [
        "  <url>",
        `    <loc>${xmlEscape(loc)}</loc>`,
        alternates(pathFor),
        "  </url>",
      ].join("\n");
    }),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

const CRAWL_HEADERS = {
  "cache-control": "public, max-age=3600",
  "x-robots-tag": "noindex",
} as const;

/** Static crawl documents. Undefined for every other path. */
export function publicCrawlResponse(pathname: string, method: string): Response | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  if (pathname !== "/robots.txt" && pathname !== "/sitemap.xml") return undefined;
  const sitemap = pathname === "/sitemap.xml";
  return new Response(method === "HEAD" ? null : sitemap ? sitemapXml() : robotsTxt(), {
    status: 200,
    headers: {
      "content-type": sitemap ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
      ...CRAWL_HEADERS,
    },
  });
}

/** Use the trusted deployment environment, never an incoming Host header. */
export function applySearchIndexingPolicy(
  response: Response,
  pathname: string,
  deploymentEnvironment: string | undefined,
): Response {
  const privatePath = /^\/(?:api(?:\/|$)|admin(?:\/|$)|reservation(?:\/|$)|unsubscribe(?:\/|$)|verify(?:\/|$))/.test(pathname);
  if (deploymentEnvironment !== "preview" && !privatePath && response.status < 400) return response;
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
