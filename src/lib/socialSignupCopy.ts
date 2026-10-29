import { SUPPORTED_LOCALES, type Locale } from "./i18n/locale.ts";

/**
 * Google and Apple continue-button copy for the ten WatchDive locales.
 *
 * Button labels are the strings each vendor rendered on 2026-10-19:
 * - Google `continue_with` (case 4) from https://accounts.google.com/gsi/client?hl=<locale>
 * - Apple `continue.text` from
 *   https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/<locale>/appleid.auth.js
 *
 * Google branding permits a localized "Continue with Google" label and requires
 * the standard-color G on a white, neutral, or dark button:
 * https://developers.google.com/identity/branding-guidelines (updated 2026-07-07).
 * Apple's web button titles include "Continue with Apple", and the white style
 * is the one specified for a dark surface:
 * https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
 *
 * This module does not start a network request, read a credential, or rewrite
 * a user agent.
 */

export const SOCIAL_PROVIDERS = ["google", "apple"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export type EnabledProviders = Record<SocialProvider, boolean>;

export type SocialSignupButtonsProps = {
  /** Existing WatchDive locale. English is `en`; the other nine use their BCP 47 tags. */
  locale: Locale;
  /** Fail closed: a provider button renders only when its flag is exactly true. */
  enabledProviders: EnabledProviders;
  /** The provider whose caller-owned action is in flight. Omit or pass null when idle. */
  loadingProvider?: SocialProvider | null;
  /**
   * Required. Called only for a visible, enabled, idle provider button.
   * The caller starts any redirect. This package never does.
   */
  onProvider: (provider: SocialProvider) => void;
  /** Disables every visible button without hiding the embedded-browser note. */
  disabled?: boolean;
};

export type EmbeddedBrowserKind = "instagram" | "in-app";

export type EmbeddedBrowserAssessment = {
  blocksGoogle: boolean;
  kind: EmbeddedBrowserKind | null;
  /** Which detection rule matched. Never the user-agent string. */
  ruleId: string | null;
};

export const UNKNOWN_EMBEDDED_BROWSER: EmbeddedBrowserAssessment = {
  blocksGoogle: false,
  kind: null,
  ruleId: null,
};

export type SocialSignupEmbeddedCopy = {
  instagramTitle: string;
  inAppTitle: string;
  body: string;
};

export type SocialSignupCopy = {
  google: string;
  apple: string;
  loading: string;
  groupBoth: string;
  groupGoogle: string;
  groupApple: string;
  embedded: SocialSignupEmbeddedCopy;
};

const sixPerEm = "\u2006";

export const socialSignupCopy: Record<Locale, SocialSignupCopy> = {
  en: {
    google: "Continue with Google",
    apple: "Continue with Apple",
    loading: "Continuing…",
    groupBoth: "Continue with Google or Apple",
    groupGoogle: "Continue with Google",
    groupApple: "Continue with Apple",
    embedded: {
      instagramTitle: "Continue with Google is unavailable in Instagram’s browser.",
      inAppTitle: "Continue with Google is unavailable in this in-app browser.",
      body: "Google sign-in does not run in this browser. Open this page yourself in Safari or Chrome, then use Continue with Google. This page does not open that browser for you. You can continue with email on this page.",
    },
  },
  ko: {
    google: "Google 계정으로 계속하기",
    apple: "Apple로 계속하기",
    loading: "계속하는 중…",
    groupBoth: "Google 또는 Apple 계정으로 계속하기",
    groupGoogle: "Google 계정으로 계속하기",
    groupApple: "Apple로 계속하기",
    embedded: {
      instagramTitle: "Instagram 앱 안에서는 Google 계정으로 계속하기를 사용할 수 없습니다.",
      inAppTitle: "이 앱 내 브라우저에서는 Google 계정으로 계속하기를 사용할 수 없습니다.",
      body: "Google 로그인은 이 브라우저에서 실행되지 않습니다. 이 페이지를 Safari 또는 Chrome에서 직접 연 다음 Google 계정으로 계속하기를 사용하세요. 이 페이지가 그 브라우저를 대신 열어 주지는 않습니다. 이 페이지의 이메일로도 계속할 수 있습니다.",
    },
  },
  "zh-CN": {
    google: "通过 Google 继续操作",
    apple: `通过${sixPerEm}Apple${sixPerEm}继续`,
    loading: "正在继续…",
    groupBoth: "通过 Google 或 Apple 继续",
    groupGoogle: "通过 Google 继续操作",
    groupApple: `通过${sixPerEm}Apple${sixPerEm}继续`,
    embedded: {
      instagramTitle: "在 Instagram 应用内浏览器中无法使用“通过 Google 继续操作”。",
      inAppTitle: "在此应用内浏览器中无法使用“通过 Google 继续操作”。",
      body: "Google 登录无法在此浏览器中运行。请自行用 Safari 或 Chrome 打开此页面，然后再使用“通过 Google 继续操作”。此页面不会替您打开该浏览器。您也可以在此页面使用电子邮件继续。",
    },
  },
  "zh-TW": {
    google: "透過 Google 帳戶繼續操作",
    apple: `透過${sixPerEm}Apple${sixPerEm}繼續`,
    loading: "正在繼續…",
    groupBoth: "透過 Google 或 Apple 繼續",
    groupGoogle: "透過 Google 帳戶繼續操作",
    groupApple: `透過${sixPerEm}Apple${sixPerEm}繼續`,
    embedded: {
      instagramTitle: "在 Instagram 應用程式內建瀏覽器中無法使用「透過 Google 帳戶繼續操作」。",
      inAppTitle: "在此應用程式內建瀏覽器中無法使用「透過 Google 帳戶繼續操作」。",
      body: "Google 登入無法在此瀏覽器中執行。請自行用 Safari 或 Chrome 開啟此頁面，再使用「透過 Google 帳戶繼續操作」。此頁面不會替您開啟該瀏覽器。您也可以在此頁面使用電子郵件繼續。",
    },
  },
  ja: {
    google: "Google で続ける",
    apple: "Appleで続ける",
    loading: "続けています…",
    groupBoth: "GoogleまたはAppleで続ける",
    groupGoogle: "Google で続ける",
    groupApple: "Appleで続ける",
    embedded: {
      instagramTitle: "Instagramアプリ内のブラウザでは「Google で続ける」を利用できません。",
      inAppTitle: "このアプリ内ブラウザでは「Google で続ける」を利用できません。",
      body: "Googleログインはこのブラウザでは動作しません。このページをSafariまたはChromeでご自身で開いてから、「Google で続ける」を使ってください。このページがそのブラウザを代わりに開くことはありません。このページのメールでも続けられます。",
    },
  },
  es: {
    google: "Continuar con Google",
    apple: "Continuar con Apple",
    loading: "Continuando…",
    groupBoth: "Continuar con Google o Apple",
    groupGoogle: "Continuar con Google",
    groupApple: "Continuar con Apple",
    embedded: {
      instagramTitle: "Continuar con Google no está disponible en el navegador de Instagram.",
      inAppTitle: "Continuar con Google no está disponible en este navegador integrado.",
      body: "El inicio de sesión de Google no funciona en este navegador. Abre esta página tú mismo en Safari o Chrome y luego usa Continuar con Google. Esta página no abre ese navegador por ti. También puedes continuar con el correo en esta página.",
    },
  },
  fr: {
    google: "Continuer avec Google",
    apple: "Continuer avec Apple",
    loading: "En cours…",
    groupBoth: "Continuer avec Google ou Apple",
    groupGoogle: "Continuer avec Google",
    groupApple: "Continuer avec Apple",
    embedded: {
      instagramTitle: "Continuer avec Google n’est pas disponible dans le navigateur d’Instagram.",
      inAppTitle: "Continuer avec Google n’est pas disponible dans ce navigateur intégré.",
      body: "La connexion Google ne fonctionne pas dans ce navigateur. Ouvrez vous-même cette page dans Safari ou Chrome, puis utilisez Continuer avec Google. Cette page n’ouvre pas ce navigateur à votre place. Vous pouvez aussi continuer avec l’e-mail sur cette page.",
    },
  },
  de: {
    google: "Weiter mit Google",
    apple: "Mit Apple fortfahren",
    loading: "Wird fortgesetzt…",
    groupBoth: "Weiter mit Google oder Apple",
    groupGoogle: "Weiter mit Google",
    groupApple: "Mit Apple fortfahren",
    embedded: {
      instagramTitle: "Weiter mit Google ist im Browser von Instagram nicht verfügbar.",
      inAppTitle: "Weiter mit Google ist in diesem In-App-Browser nicht verfügbar.",
      body: "Die Google-Anmeldung funktioniert in diesem Browser nicht. Öffne diese Seite selbst in Safari oder Chrome und nutze dann Weiter mit Google. Diese Seite öffnet diesen Browser nicht für dich. Du kannst hier auch mit E-Mail weitermachen.",
    },
  },
  "pt-BR": {
    google: "Continuar com o Google",
    apple: "Continuar com a Apple",
    loading: "Continuando…",
    groupBoth: "Continuar com o Google ou com a Apple",
    groupGoogle: "Continuar com o Google",
    groupApple: "Continuar com a Apple",
    embedded: {
      instagramTitle: "Continuar com o Google não está disponível no navegador do Instagram.",
      inAppTitle: "Continuar com o Google não está disponível neste navegador do aplicativo.",
      body: "O login do Google não funciona neste navegador. Abra esta página você mesmo no Safari ou no Chrome e depois use Continuar com o Google. Esta página não abre esse navegador para você. Você também pode continuar com o e-mail nesta página.",
    },
  },
  nl: {
    google: "Doorgaan met Google",
    apple: "Ga door met Apple",
    loading: "Bezig…",
    groupBoth: "Doorgaan met Google of ga door met Apple",
    groupGoogle: "Doorgaan met Google",
    groupApple: "Ga door met Apple",
    embedded: {
      instagramTitle: "Doorgaan met Google is niet beschikbaar in de browser van Instagram.",
      inAppTitle: "Doorgaan met Google is niet beschikbaar in deze in-appbrowser.",
      body: "Inloggen met Google werkt niet in deze browser. Open deze pagina zelf in Safari of Chrome en gebruik daarna Doorgaan met Google. Deze pagina opent die browser niet voor je. Je kunt op deze pagina doorgaan met e-mail.",
    },
  },
};

export const SOCIAL_SIGNUP_LOCALES: readonly Locale[] = SUPPORTED_LOCALES;

export function socialSignupCopyFor(locale: Locale): SocialSignupCopy {
  const copy = socialSignupCopy[locale];
  if (!copy) throw new TypeError(`Unsupported WatchDive locale: ${String(locale)}`);
  return copy;
}

export function isSocialProvider(value: unknown): value is SocialProvider {
  return value === "google" || value === "apple";
}

/**
 * Read-only classification of the user agent the browser already sent.
 * It never rewrites, pads, or invents a user agent.
 *
 * Instagram is matched on its own token so the note can name that browser.
 * Other rules cover in-app browsers where Google Sign-In reports that it
 * does not support a webview. A normal Chrome, Safari, Firefox, or Samsung
 * Internet agent does not match. iOS webviews that add no token are not
 * detected; the server must still reject a disallowed Google user agent.
 */
const EMBEDDED_BROWSER_RULES: readonly {
  id: string;
  kind: EmbeddedBrowserKind;
  pattern: RegExp;
}[] = [
  { id: "instagram", kind: "instagram", pattern: /Instagram/i },
  { id: "facebook", kind: "in-app", pattern: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/ },
  { id: "messenger", kind: "in-app", pattern: /\bMessenger\b/ },
  { id: "threads", kind: "in-app", pattern: /\bBarcelona\b/ },
  { id: "tiktok", kind: "in-app", pattern: /TikTok|musical_ly|BytedanceWebview/i },
  { id: "line", kind: "in-app", pattern: /\bLine\// },
  { id: "wechat", kind: "in-app", pattern: /MicroMessenger/ },
  { id: "kakaotalk", kind: "in-app", pattern: /KAKAOTALK/ },
  { id: "snapchat", kind: "in-app", pattern: /\bSnapchat\b/ },
  { id: "twitter", kind: "in-app", pattern: /\bTwitter\b/ },
  { id: "android-webview", kind: "in-app", pattern: /;\s*wv\b|\bwv\)/ },
];

export function classifyEmbeddedBrowser(userAgent: unknown): EmbeddedBrowserAssessment {
  if (typeof userAgent !== "string" || userAgent.trim() === "") return UNKNOWN_EMBEDDED_BROWSER;
  for (const rule of EMBEDDED_BROWSER_RULES) {
    if (rule.pattern.test(userAgent)) {
      return { blocksGoogle: true, kind: rule.kind, ruleId: rule.id };
    }
  }
  return UNKNOWN_EMBEDDED_BROWSER;
}

export type SocialSignupRenderItem = {
  provider: SocialProvider;
  label: string;
  busy: boolean;
  disabled: boolean;
};

export type SocialSignupFallback = {
  kind: EmbeddedBrowserKind;
  title: string;
  body: string;
};

export type SocialSignupRenderModel = {
  items: SocialSignupRenderItem[];
  groupLabel: string | null;
  fallback: SocialSignupFallback | null;
};

function providerEnabled(value: boolean | undefined): boolean {
  return value === true;
}

export function socialSignupRenderModel(
  props: Pick<
    SocialSignupButtonsProps,
    "locale" | "enabledProviders" | "loadingProvider" | "disabled"
  >,
  embedded: EmbeddedBrowserAssessment,
): SocialSignupRenderModel {
  const copy = socialSignupCopyFor(props.locale);
  const googleEnabled = providerEnabled(props.enabledProviders?.google);
  const appleEnabled = providerEnabled(props.enabledProviders?.apple);
  const googleBlocked = googleEnabled && embedded.blocksGoogle;
  const showGoogle = googleEnabled && !embedded.blocksGoogle;
  const loading = props.loadingProvider;
  const anyLoading = loading === "google" || loading === "apple";
  const controlsDisabled = props.disabled === true || anyLoading;
  const item = (provider: SocialProvider): SocialSignupRenderItem => ({
    provider,
    label: loading === provider ? copy.loading : copy[provider],
    busy: loading === provider,
    disabled: controlsDisabled,
  });
  const items = [...(showGoogle ? [item("google")] : []), ...(appleEnabled ? [item("apple")] : [])];
  const groupLabel =
    showGoogle && appleEnabled
      ? copy.groupBoth
      : showGoogle
        ? copy.groupGoogle
        : appleEnabled
          ? copy.groupApple
          : null;
  const fallback = googleBlocked
    ? {
        kind: embedded.kind === "instagram" ? ("instagram" as const) : ("in-app" as const),
        title:
          embedded.kind === "instagram" ? copy.embedded.instagramTitle : copy.embedded.inAppTitle,
        body: copy.embedded.body,
      }
    : null;
  return { items, groupLabel, fallback };
}

export type SocialSignupActivation = {
  disabled?: boolean;
  loadingProvider?: SocialProvider | null;
  enabled: boolean;
  blocked: boolean;
};

/**
 * The only path that may call `onProvider`. Hidden, disabled, loading, and
 * embedded-blocked Google clicks all return false and do not call it.
 */
export function requestSocialProvider(
  provider: SocialProvider,
  state: SocialSignupActivation,
  onProvider: (provider: SocialProvider) => void,
): boolean {
  if (!isSocialProvider(provider)) return false;
  if (typeof onProvider !== "function") return false;
  if (state.disabled === true) return false;
  if (state.loadingProvider != null) return false;
  if (state.enabled !== true) return false;
  if (state.blocked) return false;
  onProvider(provider);
  return true;
}

/** Standard-color G paths copied from the GSI button SVG on 2026-10-19. Do not recolor. */
export const GOOGLE_LOGO_PATHS = [
  {
    fill: "#EA4335",
    d: "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z",
  },
  {
    fill: "#4285F4",
    d: "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z",
  },
  {
    fill: "#FBBC05",
    d: "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z",
  },
  {
    fill: "#34A853",
    d: "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z",
  },
] as const;

export const GOOGLE_LOGO_VIEWBOX = "0 0 48 48";

/**
 * Apple's small Sign in with Apple logo path from appleid.auth.js.
 * The viewBox is tightened to the glyph so it matches the G's visual size.
 * The path data is unchanged. White-button logos use currentColor (#000).
 */
export const APPLE_LOGO = {
  viewBox: "5.9 13.15 12.3 15.25",
  path: "M12.2337427,16.9879688 C12.8896607,16.9879688 13.7118677,16.5445313 14.2014966,15.9532812 C14.6449341,15.4174609 14.968274,14.6691602 14.968274,13.9208594 C14.968274,13.8192383 14.9590357,13.7176172 14.9405591,13.6344727 C14.2107349,13.6621875 13.3330982,14.1241016 12.8065162,14.7430664 C12.3907935,15.2142188 12.012024,15.9532812 12.012024,16.7108203 C12.012024,16.8216797 12.0305005,16.9325391 12.0397388,16.9694922 C12.0859302,16.9787305 12.1598365,16.9879688 12.2337427,16.9879688 Z M9.92417241,28.1662891 C10.8202857,28.1662891 11.2175318,27.5658008 12.3353638,27.5658008 C13.4716724,27.5658008 13.721106,28.1478125 14.7188404,28.1478125 C15.6980982,28.1478125 16.3540162,27.2424609 16.972981,26.3555859 C17.6658521,25.339375 17.9522388,24.3416406 17.9707154,24.2954492 C17.9060474,24.2769727 16.0306763,23.5101953 16.0306763,21.3576758 C16.0306763,19.491543 17.5088013,18.6508594 17.5919459,18.5861914 C16.612688,17.1819727 15.1253248,17.1450195 14.7188404,17.1450195 C13.6194849,17.1450195 12.7233716,17.8101758 12.1598365,17.8101758 C11.5501099,17.8101758 10.7463794,17.1819727 9.79483648,17.1819727 C7.98413335,17.1819727 6.14571538,18.6785742 6.14571538,21.5054883 C6.14571538,23.2607617 6.8293482,25.1176563 7.67003179,26.3186328 C8.39061773,27.3348438 9.01882085,28.1662891 9.92417241,28.1662891 Z",
} as const;

/**
 * Light Google button and white Apple button. Both sit on the dark hero
 * (#17465f → #07131c) and the dark offer form. Same outer size keeps them
 * at equal prominence. 48px is above Apple's 30pt minimum and the 44px touch
 * target. 12px corners match the email field's rounded-xl corners. Google's
 * guide allows rectangular or pill shapes and scaling that preserves the G.
 */
export const SOCIAL_BUTTON_METRICS = {
  minHeightPx: 48,
  minWidthPx: 140,
  cornerRadiusPx: 12,
  labelSizePx: 14,
  labelLinePx: 20,
  gapPx: 8,
} as const;

export const GOOGLE_BUTTON_COLORS = {
  fill: "#FFFFFF",
  stroke: "#747775",
  label: "#1F1F1F",
  hoverFill: "#F8F9FA",
} as const;

export const APPLE_BUTTON_COLORS = {
  fill: "#FFFFFF",
  label: "#000000",
  /** Same 1px box as Google so the outer heights match. Not the outline style. */
  stroke: "#FFFFFF",
  hoverFill: "#F5F5F5",
} as const;

export const SOCIAL_BUTTON_FONTS = {
  google:
    '"Google Sans", "Google Sans Medium", Roboto, "Pangram Sans", "Spoqa Han Sans Neo", "Hiragino Sans", "PingFang SC", "PingFang TC", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", system-ui, sans-serif',
  apple:
    'system-ui, -apple-system, "SF Pro Text", "Pangram Sans", "Spoqa Han Sans Neo", "Hiragino Sans", "PingFang SC", "PingFang TC", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", sans-serif',
} as const;

export const SOCIAL_SIGNUP_CSS = `
.wd-social-signup { display: grid; width: 100%; gap: ${SOCIAL_BUTTON_METRICS.gapPx}px; }
.wd-social-signup > style { display: none; }
.wd-social-signup .wd-social-group { display: grid; gap: ${SOCIAL_BUTTON_METRICS.gapPx}px; margin: 0; }
.wd-social-button {
  box-sizing: border-box;
  display: inline-flex;
  width: 100%;
  min-width: ${SOCIAL_BUTTON_METRICS.minWidthPx}px;
  min-height: ${SOCIAL_BUTTON_METRICS.minHeightPx}px;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin: 0;
  padding: 0 12px;
  border-radius: ${SOCIAL_BUTTON_METRICS.cornerRadiusPx}px;
  border-width: 1px;
  border-style: solid;
  font-size: ${SOCIAL_BUTTON_METRICS.labelSizePx}px;
  font-weight: 500;
  line-height: ${SOCIAL_BUTTON_METRICS.labelLinePx}px;
  text-align: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.wd-social-button[data-wd-provider="google"] {
  background: ${GOOGLE_BUTTON_COLORS.fill};
  color: ${GOOGLE_BUTTON_COLORS.label};
  border-color: ${GOOGLE_BUTTON_COLORS.stroke};
  font-family: ${SOCIAL_BUTTON_FONTS.google};
}
.wd-social-button[data-wd-provider="apple"] {
  background: ${APPLE_BUTTON_COLORS.fill};
  color: ${APPLE_BUTTON_COLORS.label};
  border-color: ${APPLE_BUTTON_COLORS.stroke};
  font-family: ${SOCIAL_BUTTON_FONTS.apple};
  letter-spacing: -0.022em;
}
.wd-social-button[data-wd-provider="google"]:hover:not(:disabled) { background: ${GOOGLE_BUTTON_COLORS.hoverFill}; }
.wd-social-button[data-wd-provider="apple"]:hover:not(:disabled) { background: ${APPLE_BUTTON_COLORS.hoverFill}; }
.wd-social-button:focus { outline: none; }
.wd-social-button:focus-visible {
  outline: 3px solid #65ceee;
  outline-offset: 3px;
}
.wd-social-button:active:not(:disabled) { transform: scale(0.99); }
.wd-social-button:disabled { cursor: not-allowed; opacity: 0.6; }
.wd-social-google-tile {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: ${GOOGLE_BUTTON_COLORS.fill};
}
.wd-social-logo { display: block; flex: 0 0 auto; }
.wd-social-label { min-width: 0; text-wrap: balance; }
.wd-social-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: wd-social-spin 0.8s linear infinite;
}
.wd-social-fallback {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid #65ceee66;
  background: #07131c;
  color: #f6fafc;
  text-align: left;
  font-size: 13px;
  line-height: 1.45;
  font-family: ${SOCIAL_BUTTON_FONTS.apple};
}
.wd-social-fallback strong { display: block; margin-bottom: 4px; font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  .wd-social-button:active:not(:disabled) { transform: none; }
  .wd-social-spinner { animation: none; }
}
@keyframes wd-social-spin { to { transform: rotate(360deg); } }
`.trim();

export const SOCIAL_SIGNUP_BRAND_SOURCES = {
  observedAt: "2026-10-19",
  googleClient: "https://accounts.google.com/gsi/client?hl=<locale>",
  googleBranding: "https://developers.google.com/identity/branding-guidelines",
  appleClient:
    "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/<locale>/appleid.auth.js",
  appleHig: "https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple",
  appleWebButtons:
    "https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web",
} as const;

/**
 * Instructions for the implementation snapshot. Mount the component beside the
 * existing email form. Do not replace that form or the form-first 50:50 test.
 */
export const SOCIAL_SIGNUP_INTEGRATION = {
  importFrom: "@/components/SocialSignupButtons",
  component: "SocialSignupButtons",
  copyModule: "@/lib/socialSignupCopy",
  placements: ["hero", "offer"] as const,
  props: [
    "locale: Locale",
    "enabledProviders: { google: boolean; apple: boolean }",
    "loadingProvider?: 'google' | 'apple' | null",
    "onProvider: (provider: 'google' | 'apple') => void",
    "disabled?: boolean",
  ] as const,
  rules: [
    "onProvider is required. The component does not call a network endpoint.",
    "Render type=button controls so they do not submit the email form.",
    "Do not change the form-first 50:50 experiment, its copy classes, or the email field.",
    "Place one group in the hero form and one in the offer form, above or below the email field.",
    "Omit Google and the fallback warning inside an unsupported in-app browser. Keep Apple and email available and enforce the same Google block on the server.",
    "Do not spoof the user agent and do not claim this page opens an external browser.",
    "Pass loadingProvider for the provider whose redirect the caller has started, then clear it.",
    "Leave disabled true until the caller wires a real onProvider handler.",
    "Email signup stays available. These buttons add no required step and no purchase or reservation claim.",
    "Prefer SocialSignupButtons. It reads navigator.userAgent after mount, so the first paint can still show Google inside Instagram until that read. To avoid the flash, render SocialSignupButtonGroup with classifyEmbeddedBrowser applied to the real request User-Agent header, unchanged. Do not rewrite that header to look like Chrome.",
  ] as const,
} as const;
