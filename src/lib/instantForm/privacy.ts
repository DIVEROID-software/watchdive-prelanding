import type { Locale } from "../i18n/locale.ts";

export type NativePrivacyLocale = "en" | "ko" | "ja" | "zh-TW";

/**
 * Operational sentences for the locales this deploy can show. Other locales
 * keep the existing page. The paragraph is on unless
 * WATCHDIVE_NATIVE_FORM_PRIVACY is exactly "0".
 * This text does not claim APPI or PDPA compliance.
 */
export const NATIVE_FORM_PRIVACY: Record<NativePrivacyLocale, string> = {
  en: "If you submit a WatchDive form inside Facebook or Instagram, we receive the email address submitted there. Meta may fill that address from your profile. Submitting asks us to send one confirmation email. Launch-notification registration is complete only when you open the link in that email. A phone number is optional. We send no text message unless you check a separate text-message choice, which starts unchecked. Meta may keep the submitted lead available for us to download for up to 90 days. This is not a purchase and it does not start the separate USD $3 reservation checkout.",
  ko: "Facebook 또는 Instagram 안의 WatchDive 양식을 보내면, 그때 제출된 이메일 주소를 받습니다. Meta가 프로필에 있는 주소를 미리 채울 수 있습니다. 제출은 확인 메일 한 통을 요청하는 것입니다. 공개 알림 등록은 그 메일의 링크를 열었을 때 완료됩니다. 전화번호는 선택입니다. 따로 있는 문자 수신 항목을 체크하지 않으면 문자를 보내지 않으며, 그 항목은 처음에 체크되어 있지 않습니다. Meta는 제출된 리드를 최대 90일 동안 내려받을 수 있게 보관할 수 있습니다. 이것은 구매가 아니고, 별도의 USD $3 예약 결제를 시작하지 않습니다.",
  ja: "FacebookまたはInstagram内のWatchDiveフォームを送信すると、そのとき送信されたメールアドレスを受け取ります。Metaがプロフィールのアドレスを自動入力することがあります。送信は確認メール1通の依頼です。公開通知の登録は、そのメールのリンクを開いたときに完了します。電話番号は任意です。別のSMS項目をチェックしない限りSMSは送られず、その項目は最初はチェックされていません。Metaは送信されたリードを最長90日、ダウンロードできる状態で保持することがあります。これは購入ではなく、別の3米ドル予約決済を始めるものでもありません。",
  "zh-TW":
    "若你在 Facebook 或 Instagram 內送出 WatchDive 表單，我們會收到當時提交的電子郵件地址。Meta 可能以個人檔案中的地址預先填入。送出是請求一封確認信。上線通知登記要等你打開該信中的連結才完成。電話號碼為選填。除非你勾選另一個簡訊選項，否則我們不發送簡訊，而該選項一開始是未勾選的。Meta 可能將這筆名單保留最多 90 天供我們下載。這不是購買，也不會開始另外的 3 美元預留結帳。",
};

export function nativeFormPrivacyEnabled(
  env: { WATCHDIVE_NATIVE_FORM_PRIVACY?: string } = {},
): boolean {
  return (env.WATCHDIVE_NATIVE_FORM_PRIVACY ?? "").trim() !== "0";
}

export function nativeFormPrivacyParagraph(locale: Locale): string | undefined {
  if (locale === "en" || locale === "ko" || locale === "ja" || locale === "zh-TW") {
    return NATIVE_FORM_PRIVACY[locale];
  }
  return undefined;
}

/**
 * Native copy is on unless the flag is exactly "0". Buddy off and native off
 * returns undefined. Buddy on and native off returns exactly { buddyInvite: true }.
 */
export function mergePrivacyLoader(
  buddyEnabled: boolean,
  env: { WATCHDIVE_NATIVE_FORM_PRIVACY?: string } = {},
): { buddyInvite?: true; nativeFormPrivacy?: true } | undefined {
  const native = nativeFormPrivacyEnabled(env);
  if (!buddyEnabled && !native) return undefined;
  return {
    ...(buddyEnabled ? { buddyInvite: true as const } : {}),
    ...(native ? { nativeFormPrivacy: true as const } : {}),
  };
}
