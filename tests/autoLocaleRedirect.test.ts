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

test("a clear country signal maps to the corresponding supported locale", () => {
  const cases: ReadonlyArray<[country: string, locale: Locale, location: string]> = [
    ["KR", "ko", "/ko"],
    ["CN", "zh-CN", "/zh-cn"],
    ["TW", "zh-TW", "/zh-tw"],
    ["HK", "zh-TW", "/zh-tw"],
    ["MO", "zh-TW", "/zh-tw"],
    ["JP", "ja", "/ja"],
    ["BR", "pt-BR", "/pt-br"],
    ["DE", "de", "/de"],
    ["AT", "de", "/de"],
    ["FR", "fr", "/fr"],
    ["ES", "es", "/es"],
    ["MX", "es", "/es"],
    ["AR", "es", "/es"],
    ["CO", "es", "/es"],
  ];

  for (const [country, locale, location] of cases) {
    expectRedirect(
      autoLocaleRedirect(
        request("/", {
          headers: { "x-vercel-ip-country": country, "accept-language": "en-US,en;q=0.9" },
        }),
      ),
      locale,
      location,
    );
  }
});

test("country wins over Accept-Language, with a valid provider-header fallback", () => {
  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: {
          "x-vercel-ip-country": "KR",
          "cf-ipcountry": "JP",
          "accept-language": "fr-FR,fr;q=0.9",
        },
      }),
    ),
    "ko",
    "/ko",
  );

  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: {
          "x-vercel-ip-country": "ZZ",
          "cf-ipcountry": "JP",
          "accept-language": "fr-FR,fr;q=0.9",
        },
      }),
    ),
    "ja",
    "/ja",
  );
});

test("ambiguous or unmapped countries defer to Accept-Language", () => {
  const cases: ReadonlyArray<[country: string, language: string, locale: Locale, path: string]> = [
    ["CA", "fr-CA,fr;q=0.9,en;q=0.8", "fr", "/fr"],
    ["CH", "de-CH,de;q=0.9", "de", "/de"],
    ["SG", "zh-SG,zh;q=0.9,en;q=0.8", "zh-CN", "/zh-cn"],
    ["US", "ko-KR,ko;q=0.9,en;q=0.8", "ko", "/ko"],
  ];

  for (const [country, language, locale, path] of cases) {
    expectRedirect(
      autoLocaleRedirect(
        request("/", {
          headers: { "x-vercel-ip-country": country, "accept-language": language },
        }),
      ),
      locale,
      path,
    );
  }
});

test("Accept-Language honors q weights, skips q=0, and preserves stable order", () => {
  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: { "accept-language": "en-US;q=0.8, ja-JP;q=0.9, fr-FR;q=0.7" },
      }),
    ),
    "ja",
    "/ja",
  );

  expectRedirect(
    autoLocaleRedirect(
      request("/", {
        headers: { "accept-language": "ko;q=0, de;q=0.5, fr;q=0.5" },
      }),
    ),
    "de",
    "/de",
  );

  assert.equal(
    autoLocaleRedirect(request("/", { headers: { "accept-language": "ko;q=0, en-US;q=0.8" } })),
    undefined,
    "a language explicitly excluded with q=0 must not cause a redirect",
  );
});

test("an explicit valid locale cookie overrides country and browser language", () => {
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
    "/fr?utm_source=meta",
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
    "/pt-br",
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
    "/ko",
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
  expectRedirect(
    autoLocaleRedirect(request("/", { method: "HEAD", headers: { "x-vercel-ip-country": "KR" } })),
    "ko",
    "/ko",
  );

  assert.equal(
    autoLocaleRedirect(request("/", { method: "POST", headers: { "x-vercel-ip-country": "KR" } })),
    undefined,
  );

  for (const path of [
    "/privacy",
    "/terms",
    "/r/abc12345",
    "/favicon.svg",
    "/robots.txt",
    "/_serverFn/submit",
    "//",
  ]) {
    assert.equal(
      autoLocaleRedirect(request(path, { headers: { "x-vercel-ip-country": "KR" } })),
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
      autoLocaleRedirect(request("/", { userAgent, headers: { "x-vercel-ip-country": "KR" } })),
      undefined,
      userAgent,
    );
  }

  assert.equal(
    autoLocaleRedirect(request("/", { userAgent: null, headers: { "x-vercel-ip-country": "KR" } })),
    undefined,
  );
});

test("root redirects preserve the query exactly and never redirect English to itself", () => {
  const source = "/?utm_source=meta&utm_campaign=launch&ref=ab%2Bcd";
  expectRedirect(
    autoLocaleRedirect(request(source, { headers: { "x-vercel-ip-country": "JP" } })),
    "ja",
    "/ja?utm_source=meta&utm_campaign=launch&ref=ab%2Bcd",
  );

  for (const headers of [
    { "x-vercel-ip-country": "GB", "accept-language": "en-GB,en;q=0.9" },
    { "x-vercel-ip-country": "US", "accept-language": "en-US,en;q=0.9" },
    { "accept-language": "en-US,en;q=0.9" },
    {},
  ]) {
    assert.equal(autoLocaleRedirect(request("/", { headers })), undefined);
  }
});

test("the server integration uses a temporary, private, variant-aware redirect", () => {
  const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

  assert.match(source, /autoLocaleRedirect\([\s\S]*request,[\s\S]*isI18nReviewEnabled/);
  assert.match(source, /status:\s*307/);
  assert.match(source, /["']cache-control["']\s*:\s*["']private, no-store["']/i);

  for (const field of [
    "Cookie",
    "Accept-Language",
    "User-Agent",
    "X-Vercel-IP-Country",
    "CF-IPCountry",
  ]) {
    assert.match(source, new RegExp(field, "i"), `redirect response must vary on ${field}`);
  }
});
