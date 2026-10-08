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
import { useEffect, useState } from "react";

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
  /** Local refusal saved, the signup row does not have it yet. */
  withdrawRetry: string;
  withdrawRetryButton: string;
  /** Local permission saved, the signup row does not have it yet. */
  grantRetry: string;
  grantRetryButton: string;
};

const COPY: Record<Locale, AskCopy> = {
  en: {
    title: "One optional favour",
    body: "We're a small dive team. If you allow it, cookies and similar tools from Meta, Google and Microsoft Clarity, plus our own click and scroll measurement, show us which ad brought you here and how the page is used, so we spend less reaching the next diver. Your signup works either way.",
    allow: "Allow measurement",
    decline: "No thanks",
    privacy: "Privacy",
    thanks: "Thank you. That genuinely helps.",
    withdrawRetry: "Measurement stays off in this browser. The signup does not have that refusal yet.",
    withdrawRetryButton: "Record the refusal again",
    grantRetry: "Measurement is on in this browser. The signup does not have that permission yet.",
    grantRetryButton: "Try again",
  },
  ko: {
    title: "선택 사항 하나만 부탁드려요",
    body: "저희는 작은 다이빙 팀이에요. 허용해 주시면 Meta, Google, Microsoft Clarity의 쿠키·유사 기술과 자체 클릭·스크롤 측정으로 어떤 광고로 오셨는지, 페이지가 어떻게 쓰이는지 알 수 있어 다음 다이버를 만나는 비용을 줄일 수 있어요. 허용하지 않아도 가입은 그대로 유지돼요.",
    allow: "측정 허용",
    decline: "괜찮아요",
    privacy: "개인정보",
    thanks: "고마워요. 정말 큰 도움이 돼요.",
    withdrawRetry: "이 브라우저에서는 측정을 껐어요. 가입 기록에는 아직 거부가 남지 않았어요.",
    withdrawRetryButton: "거부를 다시 기록",
    grantRetry: "이 브라우저에서는 측정을 켰어요. 가입 기록에는 아직 허용이 남지 않았어요.",
    grantRetryButton: "다시 시도",
  },
  "zh-CN": {
    title: "一个可选的小请求",
    body: "我们是一个小小的潜水团队。如果您允许，Meta、Google 和 Microsoft Clarity 的 Cookie 及类似工具，以及我们自己的点击和滚动统计，会告诉我们您是通过哪条广告来的、页面如何被使用，让我们用更少预算找到下一位潜水员。不允许也不影响您的报名。",
    allow: "允许统计",
    decline: "不用了",
    privacy: "隐私",
    thanks: "谢谢，这对我们很有帮助。",
    withdrawRetry: "此浏览器已关闭统计。报名记录里还没有这次拒绝。",
    withdrawRetryButton: "重新记录拒绝",
    grantRetry: "此浏览器已开启统计。报名记录里还没有这次允许。",
    grantRetryButton: "再试一次",
  },
  "zh-TW": {
    title: "一個可選的小請求",
    body: "我們是一個小小的潛水團隊。如果您允許，Meta、Google 和 Microsoft Clarity 的 Cookie 及類似工具，以及我們自己的點擊和捲動統計，會告訴我們您是透過哪則廣告來的、頁面如何被使用，讓我們用更少預算找到下一位潛水員。不允許也不影響您的報名。",
    allow: "允許統計",
    decline: "不用了",
    privacy: "隱私",
    thanks: "謝謝，這對我們很有幫助。",
    withdrawRetry: "此瀏覽器已關閉統計。報名記錄裡還沒有這次拒絕。",
    withdrawRetryButton: "重新記錄拒絕",
    grantRetry: "此瀏覽器已開啟統計。報名記錄裡還沒有這次允許。",
    grantRetryButton: "再試一次",
  },
  ja: {
    title: "任意のお願いをひとつ",
    body: "私たちは小さなダイビングチームです。許可いただくと、Meta・Google・Microsoft Clarity のクッキーや類似技術と自社のクリック・スクロール計測で、どの広告から来られたか、ページがどう使われたかが分かり、次のダイバーに届ける費用を抑えられます。許可しなくても登録はそのままです。",
    allow: "計測を許可",
    decline: "許可しない",
    privacy: "プライバシー",
    thanks: "ありがとうございます。本当に助かります。",
    withdrawRetry: "このブラウザでは計測を切っています。登録の記録には、まだ拒否が残っていません。",
    withdrawRetryButton: "拒否を記録し直す",
    grantRetry: "このブラウザでは計測をオンにしています。登録の記録には、まだ許可が残っていません。",
    grantRetryButton: "もう一度試す",
  },
  es: {
    title: "Un favor opcional",
    body: "Somos un equipo de buceo pequeño. Si lo permites, las cookies y herramientas similares de Meta, Google y Microsoft Clarity, además de nuestra propia medición de clics y desplazamiento, nos dicen qué anuncio te trajo y cómo se usa la página, y así gastamos menos para llegar al próximo buceador. Tu registro funciona igual en ambos casos.",
    allow: "Permitir medición",
    decline: "No, gracias",
    privacy: "Privacidad",
    thanks: "Gracias. Nos ayuda de verdad.",
    withdrawRetry: "En este navegador la medición está desactivada. El registro aún no tiene el rechazo.",
    withdrawRetryButton: "Registrar el rechazo otra vez",
    grantRetry: "En este navegador la medición está activada. El registro aún no tiene el permiso.",
    grantRetryButton: "Intentar de nuevo",
  },
  fr: {
    title: "Un petit service, facultatif",
    body: "Nous sommes une petite équipe de plongée. Si vous l'autorisez, les cookies et outils similaires de Meta, Google et Microsoft Clarity, ainsi que notre propre mesure des clics et du défilement, nous indiquent quelle annonce vous a amené ici et comment la page est utilisée, pour dépenser moins pour atteindre le prochain plongeur. Votre inscription fonctionne dans les deux cas.",
    allow: "Autoriser la mesure",
    decline: "Non merci",
    privacy: "Confidentialité",
    thanks: "Merci, cela nous aide vraiment.",
    withdrawRetry: "La mesure est coupée dans ce navigateur. Le refus n'est pas encore sur l'inscription.",
    withdrawRetryButton: "Enregistrer le refus à nouveau",
    grantRetry: "La mesure est activée dans ce navigateur. L'autorisation n'est pas encore sur l'inscription.",
    grantRetryButton: "Réessayer",
  },
  de: {
    title: "Eine freiwillige Bitte",
    body: "Wir sind ein kleines Tauchteam. Wenn du es erlaubst, zeigen uns Cookies und ähnliche Tools von Meta, Google und Microsoft Clarity sowie unsere eigene Klick- und Scroll-Messung, welche Anzeige dich hergebracht hat und wie die Seite genutzt wird – so geben wir weniger aus, um die nächsten Taucher zu erreichen. Deine Anmeldung gilt so oder so.",
    allow: "Messung erlauben",
    decline: "Nein, danke",
    privacy: "Datenschutz",
    thanks: "Danke, das hilft uns wirklich.",
    withdrawRetry: "In diesem Browser ist die Messung aus. Die Absage steht noch nicht bei der Anmeldung.",
    withdrawRetryButton: "Absage erneut speichern",
    grantRetry: "In diesem Browser ist die Messung an. Die Erlaubnis steht noch nicht bei der Anmeldung.",
    grantRetryButton: "Erneut versuchen",
  },
  "pt-BR": {
    title: "Um favor opcional",
    body: "Somos uma pequena equipe de mergulho. Se você permitir, cookies e ferramentas semelhantes da Meta, do Google e do Microsoft Clarity, além da nossa própria medição de cliques e rolagem, nos dizem qual anúncio trouxe você e como a página é usada, e gastamos menos para alcançar o próximo mergulhador. Seu cadastro vale de qualquer jeito.",
    allow: "Permitir medição",
    decline: "Não, obrigado",
    privacy: "Privacidade",
    thanks: "Obrigado. Isso ajuda de verdade.",
    withdrawRetry: "Neste navegador a medição está desligada. A recusa ainda não está no cadastro.",
    withdrawRetryButton: "Registrar a recusa de novo",
    grantRetry: "Neste navegador a medição está ligada. A permissão ainda não está no cadastro.",
    grantRetryButton: "Tentar de novo",
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

/** Set only after the signup row itself shows the refusal. Local deny is not enough. */
export const WITHDRAWAL_RECORDED_KEY = "watchdive.measurement-withdrawal-recorded.v1";

export const MEASUREMENT_SETTLED_EVENT = "watchdive:measurement-settled";

export type MeasurementSettledDetail = {
  choice: "granted" | "denied";
  recorded: boolean;
};

export function withdrawalRecorded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WITHDRAWAL_RECORDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWithdrawalRecorded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WITHDRAWAL_RECORDED_KEY, "1");
  } catch {
    // The in-page retry still shows. The next signup can try the row again.
  }
}

/** Local deny with no confirmed write on a signup. The refusal can still be retried. */
export function withdrawalNeedsRetry(): boolean {
  return getMetaMeasurementConsent() === "denied" && !withdrawalRecorded();
}

let serverWithdrawalExpected = false;

/** The banner listener calls this synchronously while it still has a signup handle. */
export function expectServerWithdrawal(): void {
  serverWithdrawalExpected = true;
}

/** The banner reads this in the same turn, after the choice event's listeners run. */
export function takeServerWithdrawalExpected(): boolean {
  const expected = serverWithdrawalExpected;
  serverWithdrawalExpected = false;
  return expected;
}

export function noteMeasurementSettled(detail: MeasurementSettledDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MeasurementSettledDetail>(MEASUREMENT_SETTLED_EVENT, { detail }));
}

function stopClarity(): void {
  if (typeof window === "undefined") return;
  const clarity = (window as Window & { clarity?: (...args: unknown[]) => void }).clarity;
  clarity?.("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
}

type AskMode = "ask" | "granted" | "denied" | "grant-retry" | "withdraw-retry";

function initialAskMode(): AskMode {
  if (withdrawalNeedsRetry()) return "withdraw-retry";
  if (getMetaMeasurementConsent() === "granted") return "grant-retry";
  return "ask";
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
  /**
   * Starts the tags and records the grant. Resolves `false` when the signup
   * row still does not show the permission. `true` (or a void resolve from an
   * older caller) means the card can thank them.
   */
  onAllow: () => boolean | void | Promise<boolean | void>;
  /** Records the refusal on the signup. `false` keeps the retry on screen. */
  onDecline?: () => boolean | void | Promise<boolean | void>;
  tone?: "dark" | "card";
}) {
  const locale = useCurrentLocale();
  const copy = COPY[locale];
  const [mode, setMode] = useState<AskMode>(initialAskMode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onSettled = (event: Event) => {
      const detail = (event as CustomEvent<MeasurementSettledDetail>).detail;
      if (!detail) return;
      if (detail.choice === "denied") setMode(detail.recorded ? "denied" : "withdraw-retry");
      else setMode(detail.recorded ? "granted" : "grant-retry");
    };
    window.addEventListener(MEASUREMENT_SETTLED_EVENT, onSettled);
    return () => window.removeEventListener(MEASUREMENT_SETTLED_EVENT, onSettled);
  }, []);

  if (mode === "denied") return null;
  if (mode === "granted") {
    return (
      <p role="status" className="mt-4 text-sm leading-relaxed text-[#EDE6FF]">
        {copy.thanks}
      </p>
    );
  }

  const choose = (choice: "granted" | "denied") => {
    if (busy) return;
    if (choice === "granted") {
      // Global Privacy Control wins over this click. Do not store Allow,
      // announce it, or start tags.
      if (browserGpc()) return;
      setMetaMeasurementConsent("granted");
      announceMeasurementChoice({ choice, origin: "card" });
      setBusy(true);
      void Promise.resolve(onAllow())
        .then((ok) => setMode(ok === false ? "grant-retry" : "granted"))
        .catch(() => setMode("grant-retry"))
        .finally(() => setBusy(false));
      return;
    }
    setMetaMeasurementConsent("denied");
    stopClarity();
    announceMeasurementChoice({ choice: "denied", origin: "card" });
    setBusy(true);
    void Promise.resolve(onDecline?.())
      .then((ok) => setMode(ok === false ? "withdraw-retry" : "denied"))
      .catch(() => setMode("withdraw-retry"))
      .finally(() => setBusy(false));
  };

  if (mode === "grant-retry" || mode === "withdraw-retry") {
    const withdrawing = mode === "withdraw-retry";
    return (
      <section
        role="alert"
        data-measurement-ask
        className={`mt-5 rounded-2xl border border-white/15 p-4 text-left ${
          tone === "card" ? "bg-white/[0.06]" : "bg-[#201748]/70"
        }`}
      >
        <p className="text-sm leading-relaxed text-white/80">
          {withdrawing ? copy.withdrawRetry : copy.grantRetry}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => choose(withdrawing ? "denied" : "granted")}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 px-3 text-sm font-medium text-white"
        >
          {withdrawing ? copy.withdrawRetryButton : copy.grantRetryButton}
        </button>
      </section>
    );
  }

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
          disabled={busy}
          onClick={() => choose("denied")}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 px-3 text-sm font-medium text-white"
        >
          {copy.decline}
        </button>
        <button
          type="button"
          disabled={busy}
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
