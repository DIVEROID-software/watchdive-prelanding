import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LOCALE,
  LANGUAGE_OPTIONS,
  LOCALE_PATH_SEGMENTS,
  SUPPORTED_LOCALES,
  formatDate,
  formatNumber,
  homePath,
  isLocale,
  localeFromPathname,
  localePathPrefix,
  localizePath,
  matchLocale,
  parseLocalePath,
  privacyPath,
  referralPath,
  resolveLocale,
  resolvePreferredLocale,
  stripLocalePrefix,
  switchLocalePath,
  termsPath,
  verifyPath,
} from "../src/lib/i18n/locale.ts";
import { allowsThirdPartyScripts } from "../src/lib/thirdPartyScripts.ts";

test("the locale registry is complete, unique and uses native picker labels", () => {
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual(SUPPORTED_LOCALES, [
    "en",
    "ko",
    "zh-CN",
    "zh-TW",
    "ja",
    "es",
    "fr",
    "de",
    "pt-BR",
  ]);
  assert.equal(new Set(SUPPORTED_LOCALES).size, SUPPORTED_LOCALES.length);
  assert.equal(new Set(Object.values(LOCALE_PATH_SEGMENTS)).size, SUPPORTED_LOCALES.length);
  assert.deepEqual(
    LANGUAGE_OPTIONS.map(({ locale, label }) => [locale, label]),
    [
      ["en", "English"],
      ["ko", "한국어"],
      ["zh-CN", "简体中文"],
      ["zh-TW", "繁體中文"],
      ["ja", "日本語"],
      ["es", "Español"],
      ["fr", "Français"],
      ["de", "Deutsch"],
      ["pt-BR", "Português (Brasil)"],
    ],
  );
});

test("language tags resolve without confusing Simplified and Traditional Chinese", () => {
  assert.equal(matchLocale("zh-Hans-SG"), "zh-CN");
  assert.equal(matchLocale("zh_Hant_HK"), "zh-TW");
  assert.equal(matchLocale("zh-MO"), "zh-TW");
  assert.equal(matchLocale("en-US"), "en");
  assert.equal(matchLocale("ko-KR"), "ko");
  assert.equal(matchLocale("pt_BR"), "pt-BR");
  assert.equal(matchLocale("pt-PT"), undefined);
  assert.equal(matchLocale("ar"), undefined);
  assert.equal(matchLocale(null), undefined);
  assert.equal(resolveLocale("not-supported"), "en");
  assert.equal(resolveLocale("not-supported", "ja"), "ja");
  assert.equal(resolvePreferredLocale(["ar-EG", "zh-Hant", "en-US"]), "zh-TW");
  assert.equal(resolvePreferredLocale([], "fr"), "fr");
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("zh-cn"), false);
});

test("a locale prefix parses to a BCP 47 locale and a locale-independent route", () => {
  assert.deepEqual(parseLocalePath("/zh-cn/verify"), {
    locale: "zh-CN",
    pathname: "/verify",
    hasLocalePrefix: true,
  });
  assert.deepEqual(parseLocalePath("/PT-BR/privacy/"), {
    locale: "pt-BR",
    pathname: "/privacy/",
    hasLocalePrefix: true,
  });
  assert.deepEqual(parseLocalePath("/en/terms"), {
    locale: "en",
    pathname: "/terms",
    hasLocalePrefix: true,
  });
  assert.deepEqual(parseLocalePath("/product/ko"), {
    locale: "en",
    pathname: "/product/ko",
    hasLocalePrefix: false,
  });
  assert.equal(localeFromPathname("/ja?from=picker"), "ja");
  assert.equal(localeFromPathname("/"), "en");
  assert.equal(stripLocalePrefix("/fr/verify/?attempt=1#token"), "/verify/");
});

test("locale prefixes are stable and English stays on the canonical unprefixed URL", () => {
  assert.equal(localePathPrefix("en"), "");
  assert.equal(localePathPrefix("ko"), "/ko");
  assert.equal(localePathPrefix("zh-CN"), "/zh-cn");
  assert.equal(localePathPrefix("pt-BR"), "/pt-br");
  assert.equal(homePath("en"), "/");
  assert.equal(homePath("de"), "/de");
});

test("switching locale replaces the prefix while preserving campaign state", () => {
  const source = "/ko/verify?utm_source=meta&ref=abc#lead.token";
  assert.equal(
    switchLocalePath(source, "zh-CN"),
    "/zh-cn/verify?utm_source=meta&ref=abc#lead.token",
  );
  assert.equal(localizePath(source, "en"), "/verify?utm_source=meta&ref=abc#lead.token");
  assert.equal(
    localizePath("/ko?utm_campaign=launch#claim", "de"),
    "/de?utm_campaign=launch#claim",
  );
  assert.equal(
    localizePath(source, "fr", { preserveSearch: false, preserveHash: false }),
    "/fr/verify",
  );
});

test("localized route builders encode dynamic segments and verification fragments", () => {
  assert.equal(verifyPath("en"), "/verify");
  assert.equal(verifyPath("ja", "lead.part+signature"), "/ja/verify#lead.part%2Bsignature");
  assert.equal(privacyPath("zh-TW"), "/zh-tw/privacy");
  assert.equal(termsPath("pt-BR"), "/pt-br/terms");
  assert.equal(referralPath("es", "ab/cd"), "/es/r/ab%2Fcd");
});

test("URL helpers reject absolute and protocol-relative destinations", () => {
  for (const path of ["https://evil.example/verify", "//evil.example/verify", "verify"]) {
    assert.throws(() => localizePath(path, "ko"), TypeError);
  }
});

test("Intl helpers format values with the selected locale", () => {
  assert.equal(formatNumber(1234.5, "en"), "1,234.5");
  assert.equal(formatNumber(1234.5, "de"), "1.234,5");
  assert.equal(
    formatDate(Date.UTC(2026, 6, 31), "en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    }),
    "07/31/2026",
  );
  assert.equal(
    formatDate(Date.UTC(2026, 6, 31), "de", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC",
    }),
    "31.07.2026",
  );
});

test("every localized verification URL remains isolated from third-party scripts", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const path = verifyPath(locale);
    assert.equal(allowsThirdPartyScripts(path), false, `${path} allowed third-party scripts`);
    assert.equal(
      allowsThirdPartyScripts(`${path}/`),
      false,
      `${path}/ allowed third-party scripts`,
    );
    assert.equal(
      allowsThirdPartyScripts(`${path}?language-picker=1#secret-token`),
      false,
      `${path} with URL state allowed third-party scripts`,
    );
  }

  assert.equal(allowsThirdPartyScripts("/ko"), true);
  assert.equal(allowsThirdPartyScripts("/zh-cn/privacy"), true);
  assert.equal(allowsThirdPartyScripts("https://evil.example/verify"), false);
});
