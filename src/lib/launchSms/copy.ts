// Kickstarter launch SMS copy. Draft only: nothing here sends, and no SMS
// provider is installed. A phone number is not proof of ownership, purchase
// intent, or consent. Language follows the saved signup locale, then English.
//
// The Korean "(광고)" prefix on this marketing text is separate from the
// buddy-joined status mail, whose subject omits that prefix.
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isLocale, type Locale } from "../i18n/locale.ts";

export const LAUNCH_SMS_COPY_VERSION = "wd-launch-sms-draft-20261027";
export const LAUNCH_SMS_PROVIDER_INSTALLED = false as const;
export const LAUNCH_SMS_SEGMENT_POLICY = "shared" as const;

/** Left in the draft. Not a live Kickstarter URL and not a shortener. */
export const LAUNCH_SMS_LAUNCH_URL_TOKEN = "{launchUrl}";
/** Secret reservation link. Must stay a different token from the public launch link. */
export const LAUNCH_SMS_RESERVATION_URL_TOKEN = "{reservationUrl}";
export const LAUNCH_SMS_OPT_OUT_TOKEN = "{optOut}";
export const LAUNCH_SMS_SENDER_CONTACT_TOKEN = "{senderContact}";

/** Same marker the Korean marketing email uses. Not applied to the status notice. */
export const LAUNCH_SMS_KO_MARKETING_PREFIX = "(광고) ";

export type LaunchSmsVariant = "launch" | "paid-reserver";

const OPT_OUT_LABEL: Record<Locale, string> = {
  en: "Opt out:",
  ko: "무료수신거부",
  "zh-CN": "退订：",
  "zh-TW": "拒收：",
  ja: "配信停止：",
  es: "Baja:",
  fr: "Désinscription :",
  de: "Abmelden:",
  "pt-BR": "Cancelar:",
};

const KO_FREE_OPT_OUT = "무료수신거부";

const BODY: Record<Locale, Record<LaunchSmsVariant, string>> = {
  "en": {
    "launch": "WatchDive is live on Kickstarter! $149 for the first 100 backers, then $200. Take a look: {launchUrl}",
    "paid-reserver": "WatchDive is live on Kickstarter! Your guaranteed $149 launch price is ready. Your private purchase link: {reservationUrl}"
  },
  "ko": {
    "launch": "WatchDive Kickstarter가 열렸어요! 선착순 100명 $149, 이후 $200. 지금 만나보세요: {launchUrl}",
    "paid-reserver": "WatchDive Kickstarter가 열렸어요! 예약하신 최저가 $149로 만나보세요. 나만의 구매 링크: {reservationUrl}"
  },
  "zh-CN": {
    "launch": "WatchDive 已登陆 Kickstarter！前100名支持者享 $149，之后为 $200。立即查看：{launchUrl}",
    "paid-reserver": "WatchDive 已登陆 Kickstarter！您锁定的 $149 首发最低价已为您保留。专属购买链接：{reservationUrl}"
  },
  "zh-TW": {
    "launch": "WatchDive 已在 Kickstarter 上線！前100名贊助者享 $149，之後為 $200。立即查看：{launchUrl}",
    "paid-reserver": "WatchDive 已在 Kickstarter 上線！您鎖定的 $149 上市最低價已為您保留。專屬購買連結：{reservationUrl}"
  },
  "ja": {
    "launch": "WatchDive が Kickstarter に登場！先着100名は149米ドル、その後は200米ドル。今すぐチェック：{launchUrl}",
    "paid-reserver": "WatchDive が Kickstarter に登場！ご予約で確保した発売時の最安価格149米ドルでご購入いただけます。専用リンク：{reservationUrl}"
  },
  "es": {
    "launch": "¡WatchDive ya está en Kickstarter! 149 USD para los primeros 100 mecenas; después, 200 USD. Descúbrelo: {launchUrl}",
    "paid-reserver": "¡WatchDive ya está en Kickstarter! Tu precio mínimo de lanzamiento de 149 USD está garantizado. Tu enlace privado de compra: {reservationUrl}"
  },
  "fr": {
    "launch": "WatchDive est lancé sur Kickstarter ! 149 USD pour les 100 premiers contributeurs, puis 200 USD. Découvrez-le : {launchUrl}",
    "paid-reserver": "WatchDive est lancé sur Kickstarter ! Votre prix de lancement le plus bas, 149 USD, est garanti. Votre lien privé pour commander : {reservationUrl}"
  },
  "de": {
    "launch": "WatchDive ist jetzt auf Kickstarter! 149 USD für die ersten 100 Unterstützer, danach 200 USD. Jetzt ansehen: {launchUrl}",
    "paid-reserver": "WatchDive ist jetzt auf Kickstarter! Dein garantierter Tiefstpreis zum Start: 149 USD. Hier ist dein persönlicher Kauflink: {reservationUrl}"
  },
  "pt-BR": {
    "launch": "WatchDive chegou ao Kickstarter! US$ 149 para os primeiros 100 apoiadores, depois US$ 200. Confira: {launchUrl}",
    "paid-reserver": "WatchDive chegou ao Kickstarter! Seu menor preço de lançamento, US$ 149, está garantido. Seu link exclusivo de compra: {reservationUrl}"
  }
};

export type LaunchSmsDraft = {
  version: typeof LAUNCH_SMS_COPY_VERSION;
  locale: Locale;
  variant: LaunchSmsVariant;
  /** Saved signup locale was missing or not one of the nine site languages. */
  usedEnglishFallback: boolean;
  koreanMarketingPrefix: boolean;
  segmentPolicy: typeof LAUNCH_SMS_SEGMENT_POLICY;
  providerInstalled: typeof LAUNCH_SMS_PROVIDER_INSTALLED;
  /** Full draft, including prefix and opt-out. Tokens are still unsubstituted. */
  body: string;
  optOutLabel: string;
  characters: number;
};

/** Site language stored at signup. Unsupported or empty values become English. */
export function resolveLaunchSmsLocale(savedSignupLocale: string | null | undefined): Locale {
  const value = (savedSignupLocale ?? "").trim();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function launchSmsNeedsKoreanMarketingPrefix(input: {
  locale: Locale;
  signupCountry?: string | null;
}): boolean {
  return input.locale === "ko" || (input.signupCountry ?? "").trim().toUpperCase() === "KR";
}

export function renderLaunchSms(input: {
  savedSignupLocale?: string | null;
  signupCountry?: string | null;
  variant: LaunchSmsVariant;
  /** Accepted so a caller can pass the email segment. The text does not change. */
  segment?: string | null;
}): LaunchSmsDraft {
  const locale = resolveLaunchSmsLocale(input.savedSignupLocale);
  const koreanMarketingPrefix = launchSmsNeedsKoreanMarketingPrefix({
    locale,
    signupCountry: input.signupCountry,
  });
  const optOutLabel = koreanMarketingPrefix ? KO_FREE_OPT_OUT : OPT_OUT_LABEL[locale];
  const message = BODY[locale][input.variant];
  const body =
    `${koreanMarketingPrefix ? LAUNCH_SMS_KO_MARKETING_PREFIX : ""}` +
    `${message}\nDIVEROID · ${LAUNCH_SMS_SENDER_CONTACT_TOKEN}\n${optOutLabel} ${LAUNCH_SMS_OPT_OUT_TOKEN}`;
  return {
    version: LAUNCH_SMS_COPY_VERSION,
    locale,
    variant: input.variant,
    usedEnglishFallback: locale === "en" && !isLocale((input.savedSignupLocale ?? "").trim()),
    koreanMarketingPrefix,
    segmentPolicy: LAUNCH_SMS_SEGMENT_POLICY,
    providerInstalled: LAUNCH_SMS_PROVIDER_INSTALLED,
    body,
    optOutLabel,
    characters: [...body].length,
  };
}

export function launchSmsLocales(): readonly Locale[] {
  return SUPPORTED_LOCALES;
}

export function launchSmsOptOutLabel(locale: Locale): string {
  return OPT_OUT_LABEL[locale];
}
