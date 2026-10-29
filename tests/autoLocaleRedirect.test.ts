import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { autoLocaleRedirect as rawAutoLocaleRedirect } from "../src/lib/i18n/auto-locale.ts";
import type { Locale } from "../src/lib/i18n/locale.ts";

const ORIGIN = "https://watchdive.diveroid.com";
const HUMAN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";

const autoLocaleRedirect = (request: Request) => rawAutoLocaleRedirect(request, true);

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** `null` deliberately exercises clients that send no user-agent. */
  userAgent?: string | null;
};

function request(path = "/", options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  if (options.userAgent !== null && !headers.has("user-agent")) {
    headers.set("user-agent", options.userAgent ?? HUMAN_UA);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
  });
}

function expectRedirect(
  actual: ReturnType<typeof autoLocaleRedirect>,
  locale: Locale,
  location: string,
): void {
  assert.ok(actual, `expected redirect to ${location}`);
  assert.equal(actual.locale, locale);
  assert.equal(actual.location, location);
  assert.equal(
    actual.setCookie,
    undefined,
    "automatic detection must not masquerade as a user choice",
  );
  assert.match(actual.location, /^\/(?!\/)/, "redirect must stay on an app-relative path");
}

test("the access country picks the locale, and a missing or unmapped country stays English", () => {
  const mapped: ReadonlyArray<[string, Locale, string]> = [
    ["KR", "ko", "/ko/scuba"],
    ["JP", "ja", "/ja/scuba"],
    ["CN", "zh-CN", "/zh-cn/scuba"],
    ["TW", "zh-TW", "/zh-tw/scuba"],
    ["HK", "zh-TW", "/zh-tw/scuba"],
    ["DE", "de", "/de/scuba"],
    ["AT", "de", "/de/scuba"],
    ["FR", "fr", "/fr/scuba"],
    ["ES", "es", "/es/scuba"],
    ["MX", "es", "/es/scuba"],
    ["BR", "pt-BR", "/pt-br/scuba"],
  ];
  for (const [country, locale, path] of mapped) {
    expectRedirect(
      autoLocaleRedirect(
        request(`${path === "/ko/scuba" ? "/?utm_source=ig" : "/"}`, {
          headers: {
            "x-vercel-ip-country": country,
            "accept-language": "en-US,en;q=0.9",
          },
        }),
      ),
      locale,
      path === "/ko/scuba" ? "/ko/scuba?utm_source=ig" : path,
    );
  }
  for (const country of ["US", "GB", "SG", "CA", "CH"]) {
    assert.equal(
      autoLocaleRedirect(
        request("/", {
          headers: { "x-vercel-ip-country": country, "accept-language": "ko-KR,ko;q=0.9" },
        }),
      ),
      undefined,
      `${country} stays on the English root even when the browser asks for another language`,
    );
  }
  assert.equal(
    autoLocaleRedirect(request("/", { headers: { "accept-language": "ko-KR,ko;q=0.9" } })),
    undefined,
    "no country falls back to English and does not read Accept-Language",
  );
  assert.equal(
    autoLocaleRedirect(
      request("/", { headers: { "cf-ipcountry": "KR", "accept-language": "ko-KR" } }),
    ),
    undefined,
    "cf-ipcountry is not a location guess",
  );
});

test("an explicit country argument wins over the header, and null means no country", () => {
  expectRedirect(
    rawAutoLocaleRedirect(
      request("/", { headers: { "x-vercel-ip-country": "US", "accept-language": "en-US" } }),
      true,
      "KR",
    ),
    "ko",
    "/ko/scuba",
  );
  assert.equal(
    rawAutoLocaleRedirect(
      request("/", { headers: { "x-vercel-ip-country": "KR", "accept-language": "ko-KR" } }),
      true,
      null,
    ),
    undefined,
  );
});

test("an explicit valid locale cookie overrides browser language", () => {
  expectRedirect(
    autoLocaleRedirect(
      request("/?utm_source=meta", {
        headers: {
          cookie: "session=opaque; watchdive.locale=fr; theme=dark",
          "x-vercel-ip-country": "KR",
          "accept-language": "ja-JP,ja;q=0.9",
        },
      }),
    ),
    "fr",
    "/fr/scuba?utm_source=meta",
  );

  assert.equal(
    autoLocaleRedirect(
      request("/", {
        headers: {
          cookie: "watchdive.locale=en",
          "x-vercel-ip-country": "KR",
          "accept-language": "ko-KR",
        },
      }),
    ),
    undefined,
    "an explicit English choice must keep the canonical root",
  );

  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: {
          cookie: "watchdive.locale=pt-BR",
          "x-vercel-ip-country": "DE",
        },
      }),
    ),
    "pt-BR",
    "/pt-br/scuba",
  );
});

test("invalid cookie and provider values are ignored instead of becoming redirect targets", () => {
  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: {
          cookie: "watchdive.locale=%2F%2Fevil.example",
          "x-vercel-ip-country": "kr",
          "accept-language": "fr-FR",
        },
      }),
    ),
    "ko",
    "/ko/scuba",
  );

  assert.doesNotThrow(() =>
    autoLocaleRedirect(
      request("/", {
        headers: {
          cookie: `watchdive.locale=${"x".repeat(4096)}`,
          "x-vercel-ip-country": "KOR",
          "cf-ipcountry": "1",
          "accept-language": ";;;;, ../../ko;q=2, ja-JP;q=wat, *;q=1",
        },
      }),
    ),
  );
  assert.equal(
    autoLocaleRedirect(
      request("/", {
        headers: {
          cookie: "watchdive.locale=%0D%0ALocation%3A%20https%3A%2F%2Fevil.example",
          "x-vercel-ip-country": "KOR",
          "accept-language": ";;;;, ../../ko;q=2, ja-JP;q=wat, *;q=1",
        },
      }),
    ),
    undefined,
  );
});

test("only a human GET or HEAD request for the exact root is eligible", () => {
  assert.equal(
    autoLocaleRedirect(request("/", { method: "HEAD", headers: { "accept-language": "ko-KR" } })),
    undefined,
    "HEAD without a country stays English",
  );
  expectRedirect(
    autoLocaleRedirect(
      request("/", { method: "HEAD", headers: { "x-vercel-ip-country": "KR", "accept-language": "en-US" } }),
    ),
    "ko",
    "/ko/scuba",
  );

  assert.equal(
    autoLocaleRedirect(request("/", { method: "POST", headers: { "accept-language": "ko-KR" } })),
    undefined,
  );

  for (const path of [
    "/privacy",
    "/terms",
    "/r/abc12345",
    "/favicon.png",
    "/robots.txt",
    "/_serverFn/submit",
    "//",
  ]) {
    assert.equal(
      autoLocaleRedirect(request(path, { headers: { "accept-language": "ko-KR" } })),
      undefined,
      `${path} must not auto-redirect`,
    );
  }
});

test("locale-prefixed and verification paths are never auto-redirected", () => {
  for (const path of [
    "/ko",
    "/ko/",
    "/zh-cn",
    "/pt-br?utm_source=meta",
    "/verify",
    "/verify?source=email",
    "/ko/verify",
    "/zh-tw/verify",
  ]) {
    assert.equal(
      autoLocaleRedirect(
        request(path, {
          headers: {
            cookie: "watchdive.locale=fr",
            "x-vercel-ip-country": "KR",
            "accept-language": "ja-JP",
          },
        }),
      ),
      undefined,
      `${path} must remain stable`,
    );
  }
});

test("known crawlers, link unfurlers, and requests without a browser UA stay canonical", () => {
  const bots = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  ];

  for (const userAgent of bots) {
    assert.equal(
      autoLocaleRedirect(
        request("/", { userAgent, headers: { "x-vercel-ip-country": "KR", "accept-language": "ko-KR" } }),
      ),
      undefined,
      userAgent,
    );
  }

  assert.equal(
    autoLocaleRedirect(request("/", { userAgent: null, headers: { "accept-language": "ko-KR" } })),
    undefined,
  );
});

test("root redirects preserve the query exactly and never redirect English to itself", () => {
  const source = "/?utm_source=meta&utm_campaign=launch&ref=ab%2Bcd";
  expectRedirect(
    autoLocaleRedirect(
      request(source, { headers: { "x-vercel-ip-country": "JP", "accept-language": "en-US,en;q=0.9" } }),
    ),
    "ja",
    "/ja/scuba?utm_source=meta&utm_campaign=launch&ref=ab%2Bcd",
  );

  for (const headers of [
    { "x-vercel-ip-country": "GB", "accept-language": "en-GB,en;q=0.9" },
    { "x-vercel-ip-country": "US", "accept-language": "ko-KR,ko;q=0.9" },
    { "accept-language": "ja-JP,ja;q=0.9" },
    {},
  ]) {
    assert.equal(autoLocaleRedirect(request("/", { headers })), undefined);
  }
});

test("review off does not infer a locale, and the raw query is not re-encoded", () => {
  assert.equal(
    rawAutoLocaleRedirect(
      request("/?utm_content=video%204", { headers: { "x-vercel-ip-country": "KR" } }),
      false,
    ),
    undefined,
  );
  expectRedirect(
    autoLocaleRedirect(
      request("/?utm_content=video%204&ad_id=120251732832820215", {
        headers: { "x-vercel-ip-country": "KR" },
      }),
    ),
    "ko",
    "/ko/scuba?utm_content=video%204&ad_id=120251732832820215",
  );
});

test("the server integration uses a temporary, private, variant-aware redirect", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

  assert.match(source, /autoLocaleRedirect\([\s\S]*request,[\s\S]*isI18nReviewEnabled/);
  assert.match(source, /status:\s*307/);
  assert.match(source, /["']cache-control["']\s*:\s*["']private, no-store["']/i);

  for (const field of ["Cookie", "Accept-Language", "User-Agent", "X-Vercel-IP-Country"]) {
    assert.match(source, new RegExp(field, "i"), `redirect response must vary on ${field}`);
  }
  assert.match(source, /requestCountry\(request\)/);
});
