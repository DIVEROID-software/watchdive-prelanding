import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { privacyPath, type Locale } from "@/lib/i18n/locale";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import { initClarity } from "@/lib/clarity";
import { initGoogleTag } from "@/lib/googleTag";
import { startPageBehavior } from "@/lib/pageBehavior";
import {
  getMetaMeasurementConsent,
  initMetaPixel,
  setMetaMeasurementConsent,
} from "@/lib/metaPixel";
import { browserConsentRegion, resolveGeoCountry } from "@/lib/consentRegion";
import { cookieBarShouldYield } from "@/lib/cookieBarPlacement";
import {
  announceMeasurementChoice,
  clearWithdrawalRecorded,
  expectServerWithdrawal,
  markWithdrawalRecorded,
  MEASUREMENT_CHOICE_EVENT,
  MEASUREMENT_SETTLED_EVENT,
  noteMeasurementSettled,
  takeServerWithdrawalExpected,
  withdrawalNeedsRetry,
  type MeasurementChoiceDetail,
  type MeasurementSettledDetail,
} from "@/components/measurement-ask";
import { storedSignupHandles } from "@/lib/signupHandles";
import { withdrawEverySignup } from "@/lib/signupHandleWithdrawal";

type ChoiceCopy = {
  /** Banner heading. */
  title: string;
  /** What the cookies are for, and that the page works either way. */
  body: string;
  /**
   * The same facts for a phone screen: the same vendors, the same "similar
   * tools" category, BOTH purposes (which ads bring divers, how the page is
   * used) and "optional" — only the wording is tighter,
   * so the bar does not cover the headline on a 320px screen.
   */
  bodyShort: string;
  allow: string;
  decline: string;
  privacy: string;
  /** Footer link that reopens the choice (opt-out outside EU/EEA/UK/CH). */
  settings: string;
  /** Shown on the reject button while a refusal still needs to be written. */
  retry: string;
  retryBody: string;
};

const COPY: Record<Locale, ChoiceCopy> = {
  en: {
    title: "Your privacy choices",
    body: "We'd like to use cookies and similar tools from Meta, Google and Microsoft Clarity, plus our own click and scroll measurement, to see which ads bring divers here and how this page is used. Optional: your signup works either way.",
    bodyShort:
      "Cookies and similar tools from Meta, Google and Microsoft Clarity, plus our own click and scroll measurement, show which ads bring divers here and how this page is used. Optional: your signup works either way.",
    allow: "Accept all",
    decline: "Reject all",
    privacy: "Privacy Policy",
    settings: "Cookie settings",
    retry: "Try again",
    retryBody:
      "Measurement is off in this browser. We couldn’t confirm your choice was saved. Please try again.",
  },
  ko: {
    title: "개인정보 선택",
    body: "Meta, Google, Microsoft Clarity의 쿠키·유사 기술과 자체 클릭·스크롤 측정으로 어떤 광고가 다이버를 데려오는지, 페이지가 어떻게 쓰이는지 보고 싶어요. 선택 사항이며, 가입은 그대로 유지돼요.",
    bodyShort:
      "Meta·Google·Microsoft Clarity의 쿠키·유사 기술과 자체 클릭·스크롤 측정으로 어떤 광고가 다이버를 데려오는지, 페이지가 어떻게 쓰이는지 봐요. 선택 사항이며, 가입은 그대로 유지돼요.",
    allow: "모두 허용",
    decline: "모두 거부",
    privacy: "개인정보처리방침",
    settings: "쿠키 설정",
    retry: "다시 시도",
    retryBody:
      "이 브라우저의 측정은 꺼져 있어요. 선택 사항 저장을 확인하지 못했어요. 다시 시도해 주세요.",
  },
  "zh-CN": {
    title: "您的隐私选择",
    body: "我们希望使用 Meta、Google 和 Microsoft Clarity 的 Cookie 及类似工具，以及我们自己的点击和滚动统计，了解哪些广告带来了潜水员、页面如何被使用。可选：不影响您的报名。",
    bodyShort:
      "使用 Meta、Google、Microsoft Clarity 的 Cookie 及类似工具，以及我们自己的点击和滚动统计，了解哪些广告带来了潜水员、页面如何被使用。可选：不影响您的报名。",
    allow: "全部接受",
    decline: "全部拒绝",
    privacy: "隐私政策",
    settings: "Cookie 设置",
    retry: "再试一次",
    retryBody: "此浏览器已关闭统计。报名记录里还没有这次拒绝。",
  },
  "zh-TW": {
    title: "您的隱私選擇",
    body: "我們希望使用 Meta、Google 和 Microsoft Clarity 的 Cookie 及類似工具，以及我們自己的點擊和捲動統計，了解哪些廣告帶來了潛水員、頁面如何被使用。可選：不影響您的報名。",
    bodyShort:
      "使用 Meta、Google、Microsoft Clarity 的 Cookie 及類似工具，以及我們自己的點擊和捲動統計，了解哪些廣告帶來了潛水員、頁面如何被使用。可選：不影響您的報名。",
    allow: "全部接受",
    decline: "全部拒絕",
    privacy: "隱私權政策",
    settings: "Cookie 設定",
    retry: "再試一次",
    retryBody: "此瀏覽器已關閉統計。報名記錄裡還沒有這次拒絕。",
  },
  ja: {
    title: "プライバシーの選択",
    body: "Meta・Google・Microsoft Clarity のクッキーや類似技術と、自社のクリック・スクロール計測で、どの広告からダイバーが来たか、ページがどう使われたかを知りたいと考えています。任意です。登録はそのまま有効です。",
    bodyShort:
      "Meta・Google・Microsoft Clarity のクッキーや類似技術と自社のクリック・スクロール計測で、どの広告からダイバーが来たか、ページがどう使われたかを把握します。任意です。登録はそのまま有効です。",
    allow: "すべて許可",
    decline: "すべて拒否",
    privacy: "プライバシーポリシー",
    settings: "クッキー設定",
    retry: "もう一度試す",
    retryBody: "このブラウザでは計測を切っています。登録の記録には、まだ拒否が残っていません。",
  },
  es: {
    title: "Tus opciones de privacidad",
    body: "Queremos usar cookies y herramientas similares de Meta, Google y Microsoft Clarity, además de nuestra propia medición de clics y desplazamiento, para saber qué anuncios traen buceadores y cómo se usa esta página. Es opcional: tu registro funciona igual.",
    bodyShort:
      "Cookies y herramientas similares de Meta, Google y Microsoft Clarity, más nuestra medición de clics y desplazamiento, para saber qué anuncios traen buceadores y cómo se usa esta página. Opcional: tu registro funciona igual.",
    allow: "Aceptar todo",
    decline: "Rechazar todo",
    privacy: "Política de privacidad",
    settings: "Cookies",
    retry: "Intentar de nuevo",
    retryBody:
      "En este navegador la medición está desactivada. El registro aún no tiene el rechazo.",
  },
  fr: {
    title: "Vos choix de confidentialité",
    body: "Nous aimerions utiliser des cookies et outils similaires de Meta, Google et Microsoft Clarity, ainsi que notre propre mesure des clics et du défilement, pour savoir quelles annonces amènent des plongeurs et comment la page est utilisée. Facultatif : votre inscription reste valable.",
    bodyShort:
      "Cookies et outils similaires de Meta, Google et Microsoft Clarity, et notre mesure des clics et du défilement, pour savoir quelles annonces amènent des plongeurs et comment la page est utilisée. Facultatif : votre inscription reste valable.",
    allow: "Tout accepter",
    decline: "Tout refuser",
    privacy: "Politique de confidentialité",
    settings: "Cookies",
    retry: "Réessayer",
    retryBody:
      "La mesure est coupée dans ce navigateur. Le refus n'est pas encore sur l'inscription.",
  },
  de: {
    title: "Deine Datenschutz-Einstellungen",
    body: "Wir möchten Cookies und ähnliche Tools von Meta, Google und Microsoft Clarity sowie unsere eigene Klick- und Scroll-Messung nutzen, um zu sehen, welche Anzeigen Taucher herbringen und wie die Seite genutzt wird. Freiwillig: deine Anmeldung gilt so oder so.",
    bodyShort:
      "Cookies und ähnliche Tools von Meta, Google und Microsoft Clarity plus unsere Klick- und Scroll-Messung zeigen, welche Anzeigen Taucher herbringen und wie die Seite genutzt wird. Freiwillig: deine Anmeldung gilt so oder so.",
    allow: "Alle akzeptieren",
    decline: "Alle ablehnen",
    privacy: "Datenschutzerklärung",
    settings: "Cookie-Einstellungen",
    retry: "Erneut versuchen",
    retryBody:
      "In diesem Browser ist die Messung aus. Die Absage steht noch nicht bei der Anmeldung.",
  },
  "pt-BR": {
    title: "Suas escolhas de privacidade",
    body: "Queremos usar cookies e ferramentas semelhantes da Meta, do Google e do Microsoft Clarity, além da nossa própria medição de cliques e rolagem, para saber quais anúncios trazem mergulhadores e como a página é usada. Opcional: seu cadastro vale de qualquer jeito.",
    bodyShort:
      "Cookies e ferramentas semelhantes da Meta, do Google e do Microsoft Clarity, mais nossa medição de cliques e rolagem, para saber quais anúncios trazem mergulhadores e como a página é usada. Opcional: seu cadastro vale de qualquer jeito.",
    allow: "Aceitar tudo",
    decline: "Rejeitar tudo",
    privacy: "Política de privacidade",
    settings: "Cookies",
    retry: "Tentar de novo",
    retryBody: "Neste navegador a medição está desligada. A recusa ainda não está no cadastro.",
  },
};

const OPEN_EVENT = "watchdive:open-cookie-choice";

/** Reopens the choice bar (footer "Cookie settings"). */
function openCookieChoice(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Footer link that reopens the choice, so anyone can opt out later. */
export function CookieSettingsLink({ className }: { className?: string }) {
  const locale = useCurrentLocale();
  return (
    <button type="button" className={className} onClick={openCookieChoice}>
      {COPY[locale].settings}
    </button>
  );
}

function globalPrivacyControlOn(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

export function CookieChoiceBar() {
  const locale = useCurrentLocale();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const [withdrawPending, setWithdrawPending] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  // A refusal stored here whose server write was never confirmed (the page
  // was reloaded, or "Wrong address?" dropped the inbox card's handle): try
  // again with the handles this browser kept, so a confirmation opened in a
  // mail app cannot convert past it.
  useEffect(() => {
    if (!withdrawalNeedsRetry()) return;
    const handles = storedSignupHandles();
    if (handles.length === 0) return;
    void withdrawEverySignup(handles);
  }, []);

  useEffect(() => {
    let alive = true;
    const reopen = () => setOpen(true);
    const onSettled = (event: Event) => {
      const detail = (event as CustomEvent<MeasurementSettledDetail>).detail;
      if (!detail || detail.choice !== "denied") return;
      if (detail.recorded) {
        setWithdrawPending(false);
        setOpen(false);
      } else {
        setWithdrawPending(true);
        setOpen(true);
      }
    };
    // Answered on the inbox card or the confirmation page: nothing left to ask.
    const answered = (event: Event) => {
      if ((event as CustomEvent<MeasurementChoiceDetail>).detail?.origin !== "banner")
        setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, reopen);
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, answered);
    window.addEventListener(MEASUREMENT_SETTLED_EVENT, onSettled);
    // The server hands down the country (`wd_geo`); outside EU/EEA/UK/CH the
    // tags start by default and no bar is shown. Inside it, or with an unknown
    // country, the bar asks once. GPC is an opt-out already: never ask.
    void resolveGeoCountry().then(() => {
      // Starting the tags when measurement is already allowed is the root
      // layout's job (it knows which routes may load third-party scripts).
      if (!alive || globalPrivacyControlOn()) return;
      if (getMetaMeasurementConsent() === null && browserConsentRegion() === "opt-in") {
        setOpen(true);
      }
    });
    return () => {
      alive = false;
      window.removeEventListener(OPEN_EVENT, reopen);
      window.removeEventListener(MEASUREMENT_CHOICE_EVENT, answered);
      window.removeEventListener(MEASUREMENT_SETTLED_EVENT, onSettled);
    };
  }, []);

  // While this bar is open it owns the bottom edge. The space it takes up,
  // from its top edge to the bottom of the viewport, is published so page
  // padding matches the bar, and the notify link stays hidden. It steps aside
  // only while someone types or the inline measurement question is on screen (see
  // `cookieBarShouldYield`): it stays laid out but is not painted or tappable.
  const [yielding, setYielding] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = barRef.current;
    if (!open || !node) {
      delete root.dataset.wdCookie;
      root.style.removeProperty("--wd-cookie-space");
      setYielding(false);
      return;
    }
    const viewport = window.visualViewport;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const bar = node.getBoundingClientRect();
      root.dataset.wdCookie = "open";
      root.style.setProperty(
        "--wd-cookie-space",
        `${Math.max(0, Math.ceil(window.innerHeight - bar.top))}px`,
      );
      const focused = document.activeElement;
      setYielding(
        cookieBarShouldYield({
          // The inline measurement question asks the same thing; the banner
          // must not sit on that card's own two buttons.
          asks: [...document.querySelectorAll("[data-measurement-ask]")].map((ask) =>
            ask.getBoundingClientRect(),
          ),
          viewportHeight: window.innerHeight,
          editing: focused instanceof HTMLElement && !!focused.closest("form"),
          keyboardOpen: !!viewport && viewport.height < window.innerHeight * 0.75,
        }),
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    apply();
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    viewport?.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      viewport?.removeEventListener("resize", schedule);
      delete root.dataset.wdCookie;
      root.style.removeProperty("--wd-cookie-space");
    };
  }, [open]);

  if (!open) return null;
  const gpcOn = globalPrivacyControlOn();

  function choose(choice: "granted" | "denied") {
    if (choice === "granted") {
      // Global Privacy Control wins over Accept. Do not store Allow, tell the
      // page it was granted, or start tags.
      if (globalPrivacyControlOn()) return;
      clearWithdrawalRecorded();
      setMetaMeasurementConsent("granted");
      announceMeasurementChoice({ choice, origin: "banner" });
      initMetaPixel();
      initGoogleTag();
      initClarity();
      startPageBehavior();
      setWithdrawPending(false);
      setOpen(false);
      return;
    }
    setMetaMeasurementConsent("denied");
    if (typeof window !== "undefined" && window.clarity) {
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
    }
    announceMeasurementChoice({ choice: "denied", origin: "banner" });
    // Listeners run before this returns. A pending signup on screen takes the
    // refusal itself (its call covers every kept signup too). Otherwise every
    // signup this browser kept a handle for gets it from here; with none, the
    // local refusal is the whole record and the bar can close.
    if (!takeServerWithdrawalExpected()) {
      const kept = storedSignupHandles();
      if (kept.length === 0) {
        setWithdrawPending(false);
        setOpen(false);
        return;
      }
      expectServerWithdrawal();
      takeServerWithdrawalExpected();
      void withdrawEverySignup(kept).then((recorded) => {
        noteMeasurementSettled({ choice: "denied", recorded });
      });
    }
    setWithdrawPending(true);
  }

  return (
    // A full-width bottom sheet on every viewport, shown on arrival in opt-in
    // countries. Reject all and Accept all are the same size and both plainly
    // visible: refusing has to be as easy as accepting. Accept carries the
    // page's primary button colour; that emphasis is the only difference.
    <div
      ref={barRef}
      aria-hidden={yielding || undefined}
      className={`fixed inset-x-0 bottom-0 z-[10000] border-t border-white/15 bg-[#201748] text-white shadow-[0_-12px_40px_rgba(7,19,28,0.55)] ${
        yielding ? "invisible pointer-events-none" : ""
      }`}
    >
      <div
        role="dialog"
        aria-hidden={yielding || undefined}
        aria-labelledby="wd-privacy-title"
        aria-describedby="wd-privacy-body"
        className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:gap-3 sm:px-6 sm:pt-4 lg:flex-row lg:items-center lg:gap-10 lg:pb-[max(1rem,env(safe-area-inset-bottom))] lg:pt-4"
      >
        <div className="min-w-0 lg:flex-1">
          {/* Below sm the heading row is visual only from sm up: the dialog
              keeps its name for screen readers, and the policy link moves to
              the end of the body, so the bar takes one row less on a phone. */}
          <div className="flex items-center justify-between gap-3 max-sm:sr-only">
            <h2
              id="wd-privacy-title"
              className="text-[0.9375rem] font-semibold leading-tight tracking-tight text-white sm:text-lg"
            >
              {copy.title}
            </h2>
            <a
              href={privacyPath(locale)}
              className="-my-2 hidden min-h-11 shrink-0 items-center text-sm text-[#36A9E1] underline sm:inline-flex"
            >
              {copy.privacy}
            </a>
          </div>
          <p
            id="wd-privacy-body"
            role={withdrawPending ? "alert" : undefined}
            className="text-[0.8125rem] leading-snug text-[#EDE6FF] sm:mt-1 sm:text-[0.9375rem] sm:leading-relaxed"
          >
            {withdrawPending ? (
              copy.retryBody
            ) : (
              <>
                <span className="sm:hidden">{copy.bodyShort}</span>
                <span className="hidden sm:inline">{copy.body}</span>
              </>
            )}{" "}
            <a
              href={privacyPath(locale)}
              className="whitespace-nowrap text-[#36A9E1] underline sm:hidden"
            >
              {copy.privacy}
            </a>
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:w-[26rem]">
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/60 px-3 text-sm font-semibold text-white sm:text-[0.9375rem]"
            disabled={yielding}
            tabIndex={yielding ? -1 : undefined}
            onClick={() => choose("denied")}
          >
            {withdrawPending ? copy.retry : copy.decline}
          </button>
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#65ceee] bg-[#65ceee] px-3 text-sm font-semibold text-[#181238] sm:text-[0.9375rem]"
            // Global Privacy Control already said no: Accept cannot apply, so
            // it is shown but not offered (Reject still works).
            disabled={yielding || gpcOn}
            tabIndex={yielding ? -1 : undefined}
            onClick={() => choose("granted")}
          >
            {copy.allow}
          </button>
        </div>
      </div>
    </div>
  );
}
