import type { Locale } from "./i18n/locale.ts";

export type SignupClarityCopy = {
  pendingReservation: string;
  sender: string;
  invalidEmail: string;
};

/** Shared signup guidance; reservation terms remain in ONSITE_OFFER_COPY. */
export const SIGNUP_CLARITY_COPY: Record<Locale, SignupClarityCopy> = {
  en: {
    pendingReservation: "The optional $3 reservation opens after you confirm your email.",
    sender: "The message is from WatchDive <help@diveroid.com>.",
    invalidEmail: "Enter a valid email address.",
  },
  ko: {
    pendingReservation: "선택 $3 예약은 이메일 인증 뒤에 열립니다.",
    sender: "메일은 WatchDive <help@diveroid.com>에서 옵니다.",
    invalidEmail: "올바른 이메일 주소를 입력해 주세요.",
  },
  "zh-CN": {
    pendingReservation: "可选的 $3 预约会在验证邮箱后开放。",
    sender: "发件人是 WatchDive <help@diveroid.com>。",
    invalidEmail: "请输入有效的电子邮箱地址。",
  },
  "zh-TW": {
    pendingReservation: "可選的 $3 預約會在驗證信箱後開放。",
    sender: "寄件者是 WatchDive <help@diveroid.com>。",
    invalidEmail: "請輸入有效的電子郵件地址。",
  },
  ja: {
    pendingReservation: "任意の$3予約は、メール認証のあとに開きます。",
    sender: "差出人は WatchDive <help@diveroid.com> です。",
    invalidEmail: "有効なメールアドレスを入力してください。",
  },
  es: {
    pendingReservation: "La reserva opcional de $3 se abre después de confirmar tu correo.",
    sender: "El mensaje llega de WatchDive <help@diveroid.com>.",
    invalidEmail: "Escribe un correo válido.",
  },
  fr: {
    pendingReservation: "La réservation facultative de 3 $ s’ouvre après la confirmation de votre e-mail.",
    sender: "Le message vient de WatchDive <help@diveroid.com>.",
    invalidEmail: "Saisissez une adresse e-mail valide.",
  },
  de: {
    pendingReservation: "Die optionale Reservierung für $3 öffnet sich nach der Bestätigung deiner E-Mail.",
    sender: "Die Nachricht kommt von WatchDive <help@diveroid.com>.",
    invalidEmail: "Gib eine gültige E-Mail-Adresse ein.",
  },
  "pt-BR": {
    pendingReservation: "A reserva opcional de $3 abre depois que você confirma o e-mail.",
    sender: "A mensagem vem de WatchDive <help@diveroid.com>.",
    invalidEmail: "Digite um e-mail válido.",
  },
  nl: {
    pendingReservation: "De optionele reservering van $3 opent nadat je je e-mail bevestigt.",
    sender: "Het bericht komt van WatchDive <help@diveroid.com>.",
    invalidEmail: "Vul een geldig e-mailadres in.",
  },
};
