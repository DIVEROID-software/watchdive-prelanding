import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES, type Locale } from "../src/lib/i18n/locale.ts";
import {
  APPLE_LOGO,
  GOOGLE_BUTTON_COLORS,
  GOOGLE_LOGO_PATHS,
  SOCIAL_BUTTON_METRICS,
  SOCIAL_SIGNUP_CSS,
  SOCIAL_SIGNUP_INTEGRATION,
  classifyEmbeddedBrowser,
  requestSocialProvider,
  socialSignupCopy,
  socialSignupRenderModel,
  type SocialProvider,
  type SocialSignupButtonsProps,
} from "../src/lib/socialSignupCopy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const componentPath = join(here, "../src/components/SocialSignupButtons.tsx");
const componentSource = readFileSync(componentPath, "utf8");

const OFFICIAL_CONTINUE: Record<Locale, { google: string; apple: string }> = {
  en: { google: "Continue with Google", apple: "Continue with Apple" },
  ko: { google: "Google 계정으로 계속하기", apple: "Apple로 계속하기" },
  "zh-CN": { google: "通过 Google 继续操作", apple: "通过\u2006Apple\u2006继续" },
  "zh-TW": { google: "透過 Google 帳戶繼續操作", apple: "透過\u2006Apple\u2006繼續" },
  ja: { google: "Google で続ける", apple: "Appleで続ける" },
  es: { google: "Continuar con Google", apple: "Continuar con Apple" },
  fr: { google: "Continuer avec Google", apple: "Continuer avec Apple" },
  de: { google: "Weiter mit Google", apple: "Mit Apple fortfahren" },
  "pt-BR": { google: "Continuar com o Google", apple: "Continuar com a Apple" },
};

const CLAIM_DENYLIST = [
  "reserve",
  "reservation",
  "guarantee",
  "purchase",
  "buyer",
  "payment",
  "kickstarter",
  "early-bird",
  "예약",
  "보장",
  "구매",
  "予約",
  "保証",
  "购买",
  "付款",
  "購買",
  "付款",
  "reserva",
  "garant",
  "achat",
  "paiement",
  "Kauf",
  "Zahlung",
  "compra",
  "pagamento",
];

const HONEST_FALLBACK: Record<Locale, { email: string; selfOpen: string; noAutoOpen: string }> = {
  en: { email: "email", selfOpen: "yourself", noAutoOpen: "does not open that browser" },
  ko: { email: "이메일", selfOpen: "직접", noAutoOpen: "대신 열어 주지는 않습니다" },
  "zh-CN": { email: "电子邮件", selfOpen: "自行", noAutoOpen: "不会替您打开" },
  "zh-TW": { email: "電子郵件", selfOpen: "自行", noAutoOpen: "不會替您開啟" },
  ja: { email: "メール", selfOpen: "ご自身で", noAutoOpen: "代わりに開くことはありません" },
  es: { email: "correo", selfOpen: "tú mismo", noAutoOpen: "no abre ese navegador" },
  fr: { email: "e-mail", selfOpen: "vous-même", noAutoOpen: "n’ouvre pas ce navigateur" },
  de: { email: "E-Mail", selfOpen: "selbst", noAutoOpen: "nicht für dich" },
  "pt-BR": { email: "e-mail", selfOpen: "você mesmo", noAutoOpen: "não abre esse navegador" },
};

const CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F79 Instagram 336.0.0.0.0";
const INSTAGRAM_ANDROID = `${CHROME.replace("Mobile Safari", "Mobile Safari")} Instagram 336.0.0.0.0`;
const FACEBOOK =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0.0;FBDV/iPhone]";
const WEBVIEW =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 ; wv)";
const TIKTOK =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 TikTok";

function markup(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/g, "");
}

function props(overrides: Partial<SocialSignupButtonsProps> = {}): SocialSignupButtonsProps {
  return {
    locale: "en",
    enabledProviders: { google: true, apple: true },
    loadingProvider: null,
    onProvider: () => {},
    ...overrides,
  };
}

test("official continue labels exist for every supported locale and nowhere else", () => {
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), Object.keys(OFFICIAL_CONTINUE).sort());
  assert.deepEqual(Object.keys(socialSignupCopy).sort(), Object.keys(OFFICIAL_CONTINUE).sort());
  for (const locale of SUPPORTED_LOCALES) {
    const copy = socialSignupCopy[locale];
    assert.equal(copy.google, OFFICIAL_CONTINUE[locale].google, locale);
    assert.equal(copy.apple, OFFICIAL_CONTINUE[locale].apple, locale);
    assert.notEqual(copy.google, copy.apple);
    assert.match(copy.google, /Google/);
    assert.match(copy.apple, /Apple/);
    assert.ok(copy.loading.length > 0);
    assert.ok(copy.groupBoth.length > 0);
    for (const text of [
      copy.google,
      copy.apple,
      copy.loading,
      copy.groupBoth,
      copy.groupGoogle,
      copy.groupApple,
      copy.embedded.instagramTitle,
      copy.embedded.inAppTitle,
      copy.embedded.body,
    ]) {
      const lower = text.toLowerCase();
      for (const banned of CLAIM_DENYLIST) {
        assert.equal(
          lower.includes(banned.toLowerCase()),
          false,
          `${locale} contains ${banned}: ${text}`,
        );
      }
    }
    const honest = HONEST_FALLBACK[locale];
    assert.ok(copy.embedded.body.includes(honest.email), locale);
    assert.ok(copy.embedded.body.includes(honest.selfOpen), locale);
    assert.ok(copy.embedded.body.includes(honest.noAutoOpen), locale);
    assert.match(copy.embedded.body, /Safari/);
    assert.match(copy.embedded.body, /Chrome/);
    assert.match(copy.embedded.instagramTitle, /Instagram/);
  }
});

test("Chinese and Japanese vendor spacing stays exact", () => {
  assert.equal(socialSignupCopy.ja.google.includes("Google で"), true);
  assert.equal(socialSignupCopy.ja.apple.includes("Appleで"), true);
  assert.equal(socialSignupCopy.ja.apple.includes("Apple で"), false);
  assert.ok(socialSignupCopy["zh-CN"].apple.includes("\u2006Apple\u2006"));
  assert.ok(socialSignupCopy["zh-TW"].apple.includes("\u2006Apple\u2006"));
  assert.equal(socialSignupCopy["zh-CN"].google.includes("\u2006"), false);
});

test("embedded-browser classification reads the agent and does not invent one", () => {
  const samples: Array<[unknown, boolean, string | null]> = [
    [INSTAGRAM, true, "instagram"],
    [INSTAGRAM_ANDROID, true, "instagram"],
    [FACEBOOK, true, "facebook"],
    ["Mozilla/5.0 FB_IAB/FB4A", true, "facebook"],
    [TIKTOK, true, "tiktok"],
    ["musical_ly_201901", true, "tiktok"],
    ["Mozilla/5.0 Line/14.0.0", true, "line"],
    ["Mozilla/5.0 MicroMessenger/8.0", true, "wechat"],
    ["Mozilla/5.0 KAKAOTALK 10.0", true, "kakaotalk"],
    ["Mozilla/5.0 Snapchat/12.0", true, "snapchat"],
    ["Mozilla/5.0 Twitter for iPhone", true, "twitter"],
    [WEBVIEW, true, "android-webview"],
    [CHROME, false, null],
    [SAFARI, false, null],
    [FIREFOX, false, null],
    [SAMSUNG, false, null],
    ["", false, null],
    [null, false, null],
    [undefined, false, null],
    [17, false, null],
  ];
  for (const [agent, blocked, ruleId] of samples) {
    const before = typeof agent === "string" ? agent : agent;
    const result = classifyEmbeddedBrowser(agent);
    assert.equal(result.blocksGoogle, blocked, String(agent));
    assert.equal(result.ruleId, ruleId, String(agent));
    assert.equal(result.kind, blocked ? (ruleId === "instagram" ? "instagram" : "in-app") : null);
    if (typeof before === "string") assert.equal(agent, before);
    assert.equal(JSON.stringify(result).includes("Mozilla"), false);
  }
});

test("onProvider fires only for an enabled, idle, unblocked click", () => {
  const calls: SocialProvider[] = [];
  const onProvider = (provider: SocialProvider) => calls.push(provider);
  assert.equal(
    requestSocialProvider(
      "google",
      { enabled: true, blocked: false, disabled: false, loadingProvider: null },
      onProvider,
    ),
    true,
  );
  assert.deepEqual(calls, ["google"]);
  assert.equal(
    requestSocialProvider(
      "apple",
      { enabled: true, blocked: false, disabled: true, loadingProvider: null },
      onProvider,
    ),
    false,
  );
  assert.equal(
    requestSocialProvider(
      "google",
      { enabled: true, blocked: true, disabled: false, loadingProvider: null },
      onProvider,
    ),
    false,
  );
  assert.equal(
    requestSocialProvider(
      "apple",
      { enabled: true, blocked: false, disabled: false, loadingProvider: "google" },
      onProvider,
    ),
    false,
  );
  assert.equal(
    requestSocialProvider(
      "google",
      { enabled: false, blocked: false, disabled: false, loadingProvider: null },
      onProvider,
    ),
    false,
  );
  assert.equal(
    requestSocialProvider(
      "google",
      { enabled: true, blocked: false, disabled: false, loadingProvider: null },
      undefined as never,
    ),
    false,
  );
  assert.deepEqual(calls, ["google"]);
});

test("render model suppresses Google in Instagram and keeps Apple and the note", () => {
  const embedded = classifyEmbeddedBrowser(INSTAGRAM);
  const model = socialSignupRenderModel(props(), embedded);
  assert.deepEqual(
    model.items.map((item) => item.provider),
    ["apple"],
  );
  assert.equal(model.items[0]?.label, "Continue with Apple");
  assert.equal(model.fallback?.kind, "instagram");
  assert.match(model.fallback?.title ?? "", /Instagram/);
  assert.equal(model.groupLabel, "Continue with Apple");

  const hidden = socialSignupRenderModel(
    props({ enabledProviders: { google: false, apple: true } }),
    embedded,
  );
  assert.equal(hidden.fallback, null);
  assert.deepEqual(
    hidden.items.map((item) => item.provider),
    ["apple"],
  );

  const idle = socialSignupRenderModel(props(), classifyEmbeddedBrowser(SAFARI));
  assert.deepEqual(
    idle.items.map((item) => item.label),
    ["Continue with Google", "Continue with Apple"],
  );
  assert.equal(idle.fallback, null);

  const loading = socialSignupRenderModel(
    props({ loadingProvider: "google" }),
    classifyEmbeddedBrowser(CHROME),
  );
  assert.equal(loading.items[0]?.busy, true);
  assert.equal(loading.items[0]?.label, "Continuing…");
  assert.equal(loading.items[0]?.disabled, true);
  assert.equal(loading.items[1]?.busy, false);
  assert.equal(loading.items[1]?.disabled, true);

  const closed = socialSignupRenderModel(
    props({ enabledProviders: { google: false, apple: false } }),
    classifyEmbeddedBrowser(CHROME),
  );
  assert.deepEqual(closed.items, []);
  assert.equal(closed.fallback, null);
});

test("brand metrics and integration rules stay explicit", () => {
  assert.equal(SOCIAL_BUTTON_METRICS.minHeightPx, 48);
  assert.ok(SOCIAL_BUTTON_METRICS.minHeightPx >= 44);
  assert.ok(SOCIAL_BUTTON_METRICS.minWidthPx >= 140);
  assert.equal(GOOGLE_BUTTON_COLORS.fill, "#FFFFFF");
  assert.equal(GOOGLE_BUTTON_COLORS.stroke, "#747775");
  assert.equal(GOOGLE_BUTTON_COLORS.label, "#1F1F1F");
  assert.deepEqual(
    GOOGLE_LOGO_PATHS.map((path) => path.fill),
    ["#EA4335", "#4285F4", "#FBBC05", "#34A853"],
  );
  assert.match(APPLE_LOGO.path, /^M12\.2337427/);
  assert.match(SOCIAL_SIGNUP_CSS, /focus-visible/);
  assert.match(SOCIAL_SIGNUP_CSS, /prefers-reduced-motion/);
  assert.match(SOCIAL_SIGNUP_CSS, /min-height: 48px/);
  const rules = SOCIAL_SIGNUP_INTEGRATION.rules.join("\n");
  for (const phrase of [
    "onProvider is required",
    "does not call a network endpoint",
    "50:50",
    "Do not spoof the user agent",
    "do not claim this page opens an external browser",
    "Email signup stays available",
    "disabled true until",
  ]) {
    assert.ok(rules.includes(phrase), phrase);
  }
  assert.deepEqual(
    SOCIAL_SIGNUP_INTEGRATION.props.includes("onProvider: (provider: 'google' | 'apple') => void"),
    true,
  );
});

test("component source reads the real user agent and does not fetch or spoof one", () => {
  assert.match(componentSource, /type="button"/);
  assert.match(componentSource, /navigator\.userAgent/);
  assert.equal(componentSource.includes("fetch("), false);
  assert.equal(componentSource.includes("XMLHttpRequest"), false);
  assert.equal(componentSource.includes("navigator.userAgent ="), false);
  assert.match(componentSource, /requestSocialProvider/);
  assert.match(componentSource, /SocialSignupButtonsProps/);
});

type RenderedModule = {
  SocialSignupButtons: (props: SocialSignupButtonsProps) => ReactElement | null;
  SocialSignupButtonGroup: (
    props: SocialSignupButtonsProps & { embedded: ReturnType<typeof classifyEmbeddedBrowser> },
  ) => ReactElement | null;
};

async function loadRenderedModule(): Promise<RenderedModule> {
  const compiled = ts.transpileModule(componentSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: componentPath,
  }).outputText;
  const rewritten = compiled.replaceAll(
    "../lib/socialSignupCopy.ts",
    "../src/lib/socialSignupCopy.ts",
  );
  const output = join(here, ".tmp-social-signup-buttons.mjs");
  writeFileSync(output, rewritten);
  return import(pathToFileURL(output).href) as Promise<RenderedModule>;
}

test("static React markup covers locales, states, and the Instagram fallback", async () => {
  const ui = await loadRenderedModule();
  try {
    for (const locale of SUPPORTED_LOCALES) {
      const html = renderToStaticMarkup(
        createElement(ui.SocialSignupButtonGroup, {
          ...props({ locale }),
          embedded: classifyEmbeddedBrowser(SAFARI),
        }),
      );
      const body = markup(html);
      assert.match(body, new RegExp(`data-locale="${locale}"`));
      assert.equal(body.includes(OFFICIAL_CONTINUE[locale].google), true, locale);
      assert.equal(body.includes(OFFICIAL_CONTINUE[locale].apple), true, locale);
      assert.equal(body.includes('type="button"'), true);
      assert.equal(body.includes("href="), false);
      assert.equal(/<img\b/i.test(body), false);
      const withoutSvgNamespace = body.replaceAll("http://www.w3.org/2000/svg", "");
      assert.equal(withoutSvgNamespace.includes("http://"), false, locale);
      assert.equal(withoutSvgNamespace.includes("https://"), false, locale);
    }

    const both = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props(),
        embedded: classifyEmbeddedBrowser(CHROME),
      }),
    );
    const bothBody = markup(both);
    for (const fill of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"])
      assert.equal(bothBody.includes(fill), true);
    assert.equal(bothBody.includes(APPLE_LOGO.path.slice(0, 24)), true);
    assert.equal(
      bothBody.includes('<button type="button" class="wd-social-button" data-wd-provider="google"'),
      true,
    );
    assert.equal(
      bothBody.includes('<button type="button" class="wd-social-button" data-wd-provider="apple"'),
      true,
    );
    assert.equal(bothBody.includes("data-wd-social-fallback="), false);
    assert.match(bothBody, /aria-label="Continue with Google or Apple"/);
    assert.match(both, /min-height: 48px/);
    assert.match(both, /focus-visible/);

    const blocked = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props(),
        embedded: classifyEmbeddedBrowser(INSTAGRAM),
      }),
    );
    const blockedBody = markup(blocked);
    assert.equal(blockedBody.includes('data-wd-provider="google"'), false);
    assert.equal(blockedBody.includes('data-wd-provider="apple"'), true);
    assert.equal(blockedBody.includes('data-wd-social-fallback="instagram"'), true);
    assert.match(blockedBody, /does not open that browser/);
    assert.equal(blockedBody.includes("Continue with Google"), true);

    const inApp = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props({ locale: "de" }),
        embedded: classifyEmbeddedBrowser(WEBVIEW),
      }),
    );
    const inAppBody = markup(inApp);
    assert.equal(inAppBody.includes('data-wd-social-fallback="in-app"'), true);
    assert.equal(inAppBody.includes("Weiter mit Google"), true);
    assert.equal(inAppBody.includes('data-wd-provider="google"'), false);
    assert.equal(inAppBody.includes("Mit Apple fortfahren"), true);

    const loading = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props({ loadingProvider: "apple", disabled: false }),
        embedded: classifyEmbeddedBrowser(SAFARI),
      }),
    );
    const loadingBody = markup(loading);
    assert.equal(loadingBody.includes('data-wd-social-loading="true"'), true);
    assert.equal(loadingBody.includes('aria-busy="true"'), true);
    assert.equal(loadingBody.includes("Continuing…"), true);
    assert.equal((loadingBody.match(/disabled=""/g) ?? []).length, 2);

    const disabled = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props({ disabled: true }),
        embedded: classifyEmbeddedBrowser(SAFARI),
      }),
    );
    const disabledBody = markup(disabled);
    assert.equal((disabledBody.match(/disabled=""/g) ?? []).length, 2);
    assert.equal(disabledBody.includes("Continuing…"), false);

    const googleOnly = renderToStaticMarkup(
      createElement(ui.SocialSignupButtonGroup, {
        ...props({ enabledProviders: { google: true, apple: false } }),
        embedded: classifyEmbeddedBrowser(FIREFOX),
      }),
    );
    const googleOnlyBody = markup(googleOnly);
    assert.equal(googleOnlyBody.includes('data-wd-provider="apple"'), false);
    assert.match(googleOnlyBody, /aria-label="Continue with Google"/);

    const mounted = markup(renderToStaticMarkup(createElement(ui.SocialSignupButtons, props())));
    assert.equal(mounted.includes('data-wd-provider="google"'), true);
    assert.equal(mounted.includes('data-wd-provider="apple"'), true);

    const nothing = renderToStaticMarkup(
      createElement(
        ui.SocialSignupButtons,
        props({ enabledProviders: { google: false, apple: false } }),
      ),
    );
    assert.equal(nothing, "");
  } finally {
    rmSync(join(here, ".tmp-social-signup-buttons.mjs"), { force: true });
  }
});

test("rendered module path resolves React from this package", () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require.resolve("react"), "string");
  assert.equal(typeof require.resolve("react-dom/server"), "string");
});
