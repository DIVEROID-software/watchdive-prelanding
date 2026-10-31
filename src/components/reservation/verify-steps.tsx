import { useId, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale";
import { reservationChoiceTitle } from "@/components/segments/PricePaths";
import "./verify-steps.css";

export type VerifyChoice = "buddy" | "reservation" | "phone";

/** Choice labels, not a required sequence. Phone stays explicitly optional. */
export const VERIFY_CHOICE_COPY: Record<Locale, Record<VerifyChoice, { mark: string; title: string }>> = {
  en: {
    buddy: { mark: "Optional", title: "Invite your dive buddies" },
    reservation: { mark: "Optional", title: reservationChoiceTitle("en") },
    phone: { mark: "Optional", title: "Get a text alert" },
  },
  ko: {
    buddy: { mark: "선택", title: "다이빙 버디 초대" },
    reservation: { mark: "선택", title: reservationChoiceTitle("ko") },
    phone: { mark: "선택", title: "문자 알림 신청" },
  },
  "zh-CN": {
    buddy: { mark: "可选", title: "邀请潜水伙伴" },
    reservation: { mark: "可选", title: reservationChoiceTitle("zh-CN") },
    phone: { mark: "可选", title: "申请短信提醒" },
  },
  "zh-TW": {
    buddy: { mark: "可選", title: "邀請潛水夥伴" },
    reservation: { mark: "可選", title: reservationChoiceTitle("zh-TW") },
    phone: { mark: "可選", title: "申請簡訊提醒" },
  },
  ja: {
    buddy: { mark: "任意", title: "ダイビング仲間を招待" },
    reservation: { mark: "任意", title: reservationChoiceTitle("ja") },
    phone: { mark: "任意", title: "SMS通知を申し込む" },
  },
  es: {
    buddy: { mark: "Opcional", title: "Invita a tus compañeros de buceo" },
    reservation: { mark: "Opcional", title: reservationChoiceTitle("es") },
    phone: { mark: "Opcional", title: "Recibe un aviso por SMS" },
  },
  fr: {
    buddy: { mark: "Facultatif", title: "Invitez vos partenaires de plongée" },
    reservation: { mark: "Facultatif", title: reservationChoiceTitle("fr") },
    phone: { mark: "Facultatif", title: "Recevez une alerte par SMS" },
  },
  de: {
    buddy: { mark: "Optional", title: "Lade deine Tauchfreunde ein" },
    reservation: { mark: "Optional", title: reservationChoiceTitle("de") },
    phone: { mark: "Optional", title: "SMS-Benachrichtigung erhalten" },
  },
  "pt-BR": {
    buddy: { mark: "Opcional", title: "Convide seus amigos de mergulho" },
    reservation: { mark: "Opcional", title: reservationChoiceTitle("pt-BR") },
    phone: { mark: "Opcional", title: "Receba um aviso por SMS" },
  },
  nl: {
    buddy: { mark: "Optioneel", title: "Nodig je duikbuddy's uit" },
    reservation: { mark: "Optioneel", title: reservationChoiceTitle("nl") },
    phone: { mark: "Optioneel", title: "Ontvang een sms-alert" },
  },
};

/** Presentation only: the existing cards retain their consent and payment logic. */
export function VerifyStep({ locale, choice, children }: {
  locale: Locale; choice: VerifyChoice; children: ReactNode;
}) {
  const id = useId();
  const copy = VERIFY_CHOICE_COPY[locale][choice];
  return <section className="wd-verify-step" data-verify-choice={choice} data-analytics-hook="verify_choice" aria-labelledby={id}>
    <header className="wd-verify-step-heading">
      <span className="wd-verify-step-mark">{copy.mark}</span>
      <h2 id={id}>{copy.title}</h2>
    </header>
    <div className="wd-verify-step-content">{children}</div>
  </section>;
}
