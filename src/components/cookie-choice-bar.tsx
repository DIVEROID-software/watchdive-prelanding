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
import { MEASUREMENT_CHOICE_EVENT } from "@/components/measurement-ask";

type ChoiceCopy = {
  /** Banner heading. */
  title: string;
  /** What the cookies are for, and that the page works either way. */
  body: string;
  allow: string;
  decline: string;
  privacy: string;
  /** Footer link that reopens the choice (opt-out outside EU/EEA/UK/CH). */
  settings: string;
};

const COPY: Record<Locale, ChoiceCopy> = {
  en: {
    title: "Your privacy choices",
    body: "We'd like cookies to see which ads bring divers here, so a small team spends less reaching the next one. Optional: your signup works either way.",
    allow: "Accept all",
    decline: "Reject all",
    privacy: "Privacy Policy",
    settings: "Cookie settings",
  },
  ko: {
    title: "개인정보 선택",
    body: "어떤 광고가 다이버를 데려오는지 알기 위해 쿠키를 쓰고 싶어요. 작은 팀이 다음 다이버를 만나는 비용을 줄일 수 있어요. 선택 사항이며, 가입은 그대로 유지돼요.",
    allow: "모두 허용",
    decline: "모두 거부",
    privacy: "개인정보처리방침",
    settings: "쿠키 설정",
  },
  "zh-CN": {
    title: "您的隐私选择",
    body: "我们希望用 Cookie 了解哪些广告带来了潜水员，让小团队用更少预算找到下一位。可选：不影响您的报名。",
    allow: "全部接受",
    decline: "全部拒绝",
    privacy: "隐私政策",
    settings: "Cookie 设置",
  },
  "zh-TW": {
    title: "您的隱私選擇",
    body: "我們希望用 Cookie 了解哪些廣告帶來了潛水員，讓小團隊用更少預算找到下一位。可選：不影響您的報名。",
    allow: "全部接受",
    decline: "全部拒絕",
    privacy: "隱私權政策",
    settings: "Cookie 設定",
  },
  ja: {
    title: "プライバシーの選択",
    body: "どの広告がダイバーに届いたかを知るためにクッキーを使わせてください。小さなチームの費用を抑えられます。任意です。登録はそのまま有効です。",
    allow: "すべて許可",
    decline: "すべて拒否",
    privacy: "プライバシーポリシー",
    settings: "クッキー設定",
  },
  es: {
    title: "Tus opciones de privacidad",
    body: "Queremos usar cookies para saber qué anuncios traen buceadores, y así un equipo pequeño gasta menos. Es opcional: tu registro funciona igual.",
    allow: "Aceptar todo",
    decline: "Rechazar todo",
    privacy: "Política de privacidad",
    settings: "Cookies",
  },
  fr: {
    title: "Vos choix de confidentialité",
    body: "Des cookies nous diraient quelles annonces amènent des plongeurs, pour qu'une petite équipe dépense moins. Facultatif : votre inscription reste valable.",
    allow: "Tout accepter",
    decline: "Tout refuser",
    privacy: "Politique de confidentialité",
    settings: "Cookies",
  },
  de: {
    title: "Deine Datenschutz-Einstellungen",
    body: "Mit Cookies sehen wir, welche Anzeigen Taucher herbringen – so gibt ein kleines Team weniger aus. Freiwillig: deine Anmeldung gilt so oder so.",
    allow: "Alle akzeptieren",
    decline: "Alle ablehnen",
    privacy: "Datenschutzerklärung",
    settings: "Cookie-Einstellungen",
  },
  "pt-BR": {
    title: "Suas escolhas de privacidade",
    body: "Com cookies sabemos quais anúncios trazem mergulhadores, e uma equipe pequena gasta menos. Opcional: seu cadastro vale de qualquer jeito.",
    allow: "Aceitar tudo",
    decline: "Rejeitar tudo",
    privacy: "Política de privacidade",
    settings: "Cookies",
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
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const reopen = () => setOpen(true);
    // Answered on the inbox card or the confirmation page: nothing left to ask.
    const answered = () => setOpen(false);
    window.addEventListener(OPEN_EVENT, reopen);
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, answered);
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

  function choose(choice: "granted" | "denied") {
    setMetaMeasurementConsent(choice);
    if (choice === "granted") {
      initMetaPixel();
      initGoogleTag();
      initClarity();
      startPageBehavior();
    } else if (typeof window !== "undefined" && window.clarity) {
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
    }
    setOpen(false);
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
        aria-labelledby="wd-privacy-title"
        aria-describedby="wd-privacy-body"
        className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:gap-3 sm:px-6 sm:pt-5 lg:flex-row lg:items-end lg:gap-10 lg:pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:pt-6"
      >
        <div className="min-w-0 lg:flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="wd-privacy-title"
              className="text-base font-semibold leading-tight tracking-tight text-white sm:text-xl"
            >
              {copy.title}
            </h2>
            <a
              href={privacyPath(locale)}
              className="-my-2 inline-flex min-h-11 shrink-0 items-center text-xs text-[#36A9E1] underline sm:text-sm"
            >
              {copy.privacy}
            </a>
          </div>
          <p
            id="wd-privacy-body"
            className="mt-1 text-[0.8125rem] leading-snug text-[#EDE6FF] sm:text-[0.9375rem] sm:leading-relaxed"
          >
            {copy.body}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2.5 lg:w-[26rem]">
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/60 px-3 text-sm font-semibold text-white sm:text-[0.9375rem]"
            onClick={() => choose("denied")}
          >
            {copy.decline}
          </button>
          <button
            type="button"
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[#65ceee] bg-[#65ceee] px-3 text-sm font-semibold text-[#181238] sm:text-[0.9375rem]"
            onClick={() => choose("granted")}
          >
            {copy.allow}
          </button>
        </div>
      </div>
    </div>
  );
}
