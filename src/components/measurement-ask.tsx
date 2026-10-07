// The contextual measurement question, asked at the two moments a visitor in
// the EU/EEA/UK/CH is most likely to say yes: right after the submit (the inbox
// card) and right after the confirmation. The passive cookie bar rarely gets
// seen there — it waits for a scroll and steps aside while a form is on screen,
// and on this page the form is the first screen — so before this, almost no
// one in those countries was ever asked, and their signups were invisible to
// the ad delivery that brought them.
//
// It stays a real choice: both answers are the same size and weight, nothing
// is pre-selected, the signup works either way, and the footer link still
// reopens the choice. Asked once per browser — any answer is remembered.
import { useState } from "react";

import { browserConsentRegion, browserGpc } from "@/lib/consentRegion";
import { privacyPath, type Locale } from "@/lib/i18n/locale";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import {
  getMetaMeasurementConsent,
  isMetaPixelConfigured,
  setMetaMeasurementConsent,
} from "@/lib/metaPixel";

type AskCopy = {
  title: string;
  body: string;
  allow: string;
  decline: string;
  privacy: string;
  thanks: string;
};

const COPY: Record<Locale, AskCopy> = {
  en: {
    title: "One optional favour",
    body: "We're a small dive team. If you allow measurement cookies, Meta and Google can tell us which ad brought you here, so we spend less reaching the next diver. Your signup works either way.",
    allow: "Allow measurement",
    decline: "No thanks",
    privacy: "Privacy",
    thanks: "Thank you. That genuinely helps.",
  },
  ko: {
    title: "선택 사항 하나만 부탁드려요",
    body: "저희는 작은 다이빙 팀이에요. 측정 쿠키를 허용해 주시면 Meta와 Google이 어떤 광고로 오셨는지 알려줘서, 다음 다이버를 만나는 비용을 줄일 수 있어요. 허용하지 않아도 가입은 그대로 유지돼요.",
    allow: "측정 허용",
    decline: "괜찮아요",
    privacy: "개인정보",
    thanks: "고마워요. 정말 큰 도움이 돼요.",
  },
  "zh-CN": {
    title: "一个可选的小请求",
    body: "我们是一个小小的潜水团队。如果您允许统计 Cookie，Meta 和 Google 就能告诉我们您是通过哪条广告来的，让我们用更少的预算找到下一位潜水员。不允许也不影响您的报名。",
    allow: "允许统计",
    decline: "不用了",
    privacy: "隐私",
    thanks: "谢谢，这对我们很有帮助。",
  },
  "zh-TW": {
    title: "一個可選的小請求",
    body: "我們是一個小小的潛水團隊。如果您允許統計 Cookie，Meta 和 Google 就能告訴我們您是透過哪則廣告來的，讓我們用更少的預算找到下一位潛水員。不允許也不影響您的報名。",
    allow: "允許統計",
    decline: "不用了",
    privacy: "隱私",
    thanks: "謝謝，這對我們很有幫助。",
  },
  ja: {
    title: "任意のお願いをひとつ",
    body: "私たちは小さなダイビングチームです。計測クッキーを許可いただくと、どの広告から来られたかを Meta と Google が教えてくれるので、次のダイバーに届ける費用を抑えられます。許可しなくても登録はそのままです。",
    allow: "計測を許可",
    decline: "許可しない",
    privacy: "プライバシー",
    thanks: "ありがとうございます。本当に助かります。",
  },
  es: {
    title: "Un favor opcional",
    body: "Somos un equipo de buceo pequeño. Si permites las cookies de medición, Meta y Google nos dicen qué anuncio te trajo aquí y gastamos menos para llegar al próximo buceador. Tu registro funciona igual en ambos casos.",
    allow: "Permitir medición",
    decline: "No, gracias",
    privacy: "Privacidad",
    thanks: "Gracias. Nos ayuda de verdad.",
  },
  fr: {
    title: "Un petit service, facultatif",
    body: "Nous sommes une petite équipe de plongée. Si vous autorisez les cookies de mesure, Meta et Google nous indiquent quelle annonce vous a amené ici, et nous dépensons moins pour atteindre le prochain plongeur. Votre inscription fonctionne dans les deux cas.",
    allow: "Autoriser la mesure",
    decline: "Non merci",
    privacy: "Confidentialité",
    thanks: "Merci, cela nous aide vraiment.",
  },
  de: {
    title: "Eine freiwillige Bitte",
    body: "Wir sind ein kleines Tauchteam. Wenn du Mess-Cookies erlaubst, sagen uns Meta und Google, welche Anzeige dich hergebracht hat – so geben wir weniger aus, um die nächsten Taucher zu erreichen. Deine Anmeldung gilt so oder so.",
    allow: "Messung erlauben",
    decline: "Nein, danke",
    privacy: "Datenschutz",
    thanks: "Danke, das hilft uns wirklich.",
  },
  "pt-BR": {
    title: "Um favor opcional",
    body: "Somos uma pequena equipe de mergulho. Se você permitir os cookies de medição, a Meta e o Google nos dizem qual anúncio trouxe você até aqui, e gastamos menos para alcançar o próximo mergulhador. Seu cadastro vale de qualquer jeito.",
    allow: "Permitir medição",
    decline: "Não, obrigado",
    privacy: "Privacidade",
    thanks: "Obrigado. Isso ajuda de verdade.",
  },
};

/** Fired after any answer so the passive cookie bar closes too. */
export const MEASUREMENT_CHOICE_EVENT = "watchdive:measurement-choice";

/**
 * Ask only where the law asks for opt-in, only while this browser has not
 * answered, never under Global Privacy Control, and only when the pixel is
 * actually configured (asking for nothing would be a dark pattern of its own).
 */
export function measurementAskEligible(): boolean {
  if (typeof window === "undefined") return false;
  return (
    isMetaPixelConfigured() &&
    getMetaMeasurementConsent() === null &&
    !browserGpc() &&
    browserConsentRegion() === "opt-in"
  );
}

export function MeasurementAsk({
  onAllow,
  tone = "dark",
}: {
  /** Runs after the choice is stored; starts the tags and sends what was withheld. */
  onAllow: () => void | Promise<void>;
  tone?: "dark" | "card";
}) {
  const locale = useCurrentLocale();
  const copy = COPY[locale];
  const [answered, setAnswered] = useState<"granted" | "denied" | null>(null);

  if (answered === "denied") return null;
  if (answered === "granted") {
    return (
      <p role="status" className="mt-4 text-sm leading-relaxed text-[#EDE6FF]">
        {copy.thanks}
      </p>
    );
  }

  const choose = (choice: "granted" | "denied") => {
    setMetaMeasurementConsent(choice);
    setAnswered(choice);
    window.dispatchEvent(new Event(MEASUREMENT_CHOICE_EVENT));
    if (choice === "granted") void Promise.resolve(onAllow()).catch(() => {});
  };

  return (
    <section
      aria-labelledby="wd-measurement-ask-title"
      data-measurement-ask
      className={`mt-5 rounded-2xl border border-white/15 p-4 text-left ${
        tone === "card" ? "bg-white/[0.06]" : "bg-[#201748]/70"
      }`}
    >
      <h3 id="wd-measurement-ask-title" className="text-base font-semibold text-white">
        {copy.title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-white/80">{copy.body}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => choose("denied")}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 px-3 text-sm font-medium text-white"
        >
          {copy.decline}
        </button>
        <button
          type="button"
          onClick={() => choose("granted")}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 bg-[#3D2683] px-3 text-sm font-medium text-white"
        >
          {copy.allow}
        </button>
      </div>
      <a
        href={privacyPath(locale)}
        className="mt-2 inline-flex min-h-11 items-center text-xs text-[#36A9E1] underline"
      >
        {copy.privacy}
      </a>
    </section>
  );
}
