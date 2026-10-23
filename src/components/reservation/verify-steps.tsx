import { useId, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale";
import "./verify-steps.css";

export const VERIFY_STEP_TITLES: Record<Locale, readonly [string, string, string]> = {
  en: ["Get a text alert", "Lock the lowest price for $3", "Invite your dive buddies"],
  ko: ["문자 알림 신청", "$3 결제로 최저가 확보", "다이빙 버디 초대"],
  "zh-CN": ["申请短信提醒", "支付 $3 锁定最低价", "邀请潜水伙伴"],
  "zh-TW": ["申請簡訊提醒", "支付 $3 鎖定最低價", "邀請潛水夥伴"],
  ja: ["SMS通知を申し込む", "$3で最安値を確保", "ダイビング仲間を招待"],
  es: ["Recibe un aviso por SMS", "Asegura el precio más bajo por $3", "Invita a tus compañeros de buceo"],
  fr: ["Recevez une alerte par SMS", "Garantissez le prix le plus bas pour 3 $", "Invitez vos partenaires de plongée"],
  de: ["SMS-Benachrichtigung erhalten", "Tiefstpreis für $3 sichern", "Lade deine Tauchfreunde ein"],
  "pt-BR": ["Receba um aviso por SMS", "Garanta o menor preço por $3", "Convide seus amigos de mergulho"],
};

/** Presentation only: the existing cards retain their consent and payment logic. */
export function VerifyStep({ locale, number, children }: {
  locale: Locale; number: 1 | 2 | 3; children: ReactNode;
}) {
  const id = useId();
  return <section className="wd-verify-step" data-verify-step={number} aria-labelledby={id}>
    <header className="wd-verify-step-heading">
      <span className="wd-verify-step-number" aria-hidden="true">#{number}</span>
      <h2 id={id}><span className="sr-only">{number}. </span>{VERIFY_STEP_TITLES[locale][number - 1]}</h2>
    </header>
    <div className="wd-verify-step-content">{children}</div>
  </section>;
}
