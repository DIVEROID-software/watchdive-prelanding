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
    body: "We're a small dive team. If you allow it, cookies and similar tools from Meta, Google and Microsoft Clarity, plus our own click and scroll measurement, show us which ad brought you here and how the page is used, so we spend less reaching the next diver. Your signup works either way.",
    allow: "Allow measurement",
    decline: "No thanks",
    privacy: "Privacy",
    thanks: "Thank you. That genuinely helps.",
  },
  ko: {
    title: "선택 사항 하나만 부탁드려요",
    body: "저희는 작은 다이빙 팀이에요. 허용해 주시면 Meta, Google, Microsoft Clarity의 쿠키·유사 기술과 자체 클릭·스크롤 측정으로 어떤 광고로 오셨는지, 페이지가 어떻게 쓰이는지 알 수 있어 다음 다이버를 만나는 비용을 줄일 수 있어요. 허용하지 않아도 가입은 그대로 유지돼요.",
    allow: "측정 허용",
    decline: "괜찮아요",
    privacy: "개인정보",
    thanks: "고마워요. 정말 큰 도움이 돼요.",
  },
  "zh-CN": {
    title: "一个可选的小请求",
    body: "我们是一个小小的潜水团队。如果您允许，Meta、Google 和 Microsoft Clarity 的 Cookie 及类似工具，以及我们自己的点击和滚动统计，会告诉我们您是通过哪条广告来的、页面如何被使用，让我们用更少预算找到下一位潜水员。不允许也不影响您的报名。",
    allow: "允许统计",
    decline: "不用了",
    privacy: "隐私",
    thanks: "谢谢，这对我们很有帮助。",
  },
  "zh-TW": {
    title: "一個可選的小請求",
    body: "我們是一個小小的潛水團隊。如果您允許，Meta、Google 和 Microsoft Clarity 的 Cookie 及類似工具，以及我們自己的點擊和捲動統計，會告訴我們您是透過哪則廣告來的、頁面如何被使用，讓我們用更少預算找到下一位潛水員。不允許也不影響您的報名。",
    allow: "允許統計",
    decline: "不用了",
    privacy: "隱私",
    thanks: "謝謝，這對我們很有幫助。",
  },
  ja: {
    title: "任意のお願いをひとつ",
    body: "私たちは小さなダイビングチームです。許可いただくと、Meta・Google・Microsoft Clarity のクッキーや類似技術と自社のクリック・スクロール計測で、どの広告から来られたか、ページがどう使われたかが分かり、次のダイバーに届ける費用を抑えられます。許可しなくても登録はそのままです。",
    allow: "計測を許可",
    decline: "許可しない",
    privacy: "プライバシー",
    thanks: "ありがとうございます。本当に助かります。",
  },
  es: {
    title: "Un favor opcional",
    body: "Somos un equipo de buceo pequeño. Si lo permites, las cookies y herramientas similares de Meta, Google y Microsoft Clarity, además de nuestra propia medición de clics y desplazamiento, nos dicen qué anuncio te trajo y cómo se usa la página, y así gastamos menos para llegar al próximo buceador. Tu registro funciona igual en ambos casos.",
    allow: "Permitir medición",
    decline: "No, gracias",
    privacy: "Privacidad",
    thanks: "Gracias. Nos ayuda de verdad.",
  },
  fr: {
    title: "Un petit service, facultatif",
    body: "Nous sommes une petite équipe de plongée. Si vous l'autorisez, les cookies et outils similaires de Meta, Google et Microsoft Clarity, ainsi que notre propre mesure des clics et du défilement, nous indiquent quelle annonce vous a amené ici et comment la page est utilisée, pour dépenser moins pour atteindre le prochain plongeur. Votre inscription fonctionne dans les deux cas.",
    allow: "Autoriser la mesure",
    decline: "Non merci",
    privacy: "Confidentialité",
    thanks: "Merci, cela nous aide vraiment.",
  },
  de: {
    title: "Eine freiwillige Bitte",
    body: "Wir sind ein kleines Tauchteam. Wenn du es erlaubst, zeigen uns Cookies und ähnliche Tools von Meta, Google und Microsoft Clarity sowie unsere eigene Klick- und Scroll-Messung, welche Anzeige dich hergebracht hat und wie die Seite genutzt wird – so geben wir weniger aus, um die nächsten Taucher zu erreichen. Deine Anmeldung gilt so oder so.",
    allow: "Messung erlauben",
    decline: "Nein, danke",
    privacy: "Datenschutz",
    thanks: "Danke, das hilft uns wirklich.",
  },
  "pt-BR": {
    title: "Um favor opcional",
    body: "Somos uma pequena equipe de mergulho. Se você permitir, cookies e ferramentas semelhantes da Meta, do Google e do Microsoft Clarity, além da nossa própria medição de cliques e rolagem, nos dizem qual anúncio trouxe você e como a página é usada, e gastamos menos para alcançar o próximo mergulhador. Seu cadastro vale de qualquer jeito.",
    allow: "Permitir medição",
    decline: "Não, obrigado",
    privacy: "Privacidade",
    thanks: "Obrigado. Isso ajuda de verdade.",
  },
};

/**
 * Fired after any answer, from the card or the banner, with
 * `{ choice: "granted" | "denied", origin: "card" | "banner" }` as detail, so
 * the other control closes and a pending signup can record the answer.
 */
export const MEASUREMENT_CHOICE_EVENT = "watchdive:measurement-choice";

export type MeasurementChoiceDetail = {
  choice: "granted" | "denied";
  origin: "card" | "banner";
};

export function announceMeasurementChoice(detail: MeasurementChoiceDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<MeasurementChoiceDetail>(MEASUREMENT_CHOICE_EVENT, { detail }),
  );
}

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
  onDecline,
  tone = "dark",
}: {
  /** Runs after the choice is stored; starts the tags and sends what was withheld. */
  onAllow: () => void | Promise<void>;
  /** Runs after a refusal is stored; records it on the signup. */
  onDecline?: () => void | Promise<void>;
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
    announceMeasurementChoice({ choice, origin: "card" });
    if (choice === "granted") void Promise.resolve(onAllow()).catch(() => {});
    else if (onDecline) void Promise.resolve(onDecline()).catch(() => {});
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
