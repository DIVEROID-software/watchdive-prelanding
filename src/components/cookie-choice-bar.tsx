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
  /** One short line of text; Privacy and the two choices share the row below. */
  body: string;
  allow: string;
  decline: string;
  privacy: string;
  /** Footer link that reopens the choice (opt-out outside EU/EEA/UK/CH). */
  settings: string;
};

const COPY: Record<Locale, ChoiceCopy> = {
  en: {
    body: "Allow cookies so we know which ads find divers? Optional.",
    allow: "Allow",
    decline: "Not now",
    privacy: "Privacy",
    settings: "Cookie settings",
  },
  ko: {
    body: "어떤 광고가 다이버를 데려오는지 알 수 있게 쿠키를 허용할까요? 선택이에요.",
    allow: "허용",
    decline: "나중에",
    privacy: "개인정보",
    settings: "쿠키 설정",
  },
  "zh-CN": {
    body: "允许 Cookie，让我们知道哪些广告找到了潜水员？可选。",
    allow: "允许",
    decline: "暂时不要",
    privacy: "隐私",
    settings: "Cookie 设置",
  },
  "zh-TW": {
    body: "允許 Cookie，讓我們知道哪些廣告找到了潛水員？可選。",
    allow: "允許",
    decline: "暫時不要",
    privacy: "隱私",
    settings: "Cookie 設定",
  },
  ja: {
    body: "どの広告がダイバーに届いたか分かるよう、クッキーを許可しますか？任意です。",
    allow: "許可する",
    decline: "今はしない",
    privacy: "プライバシー",
    settings: "クッキー設定",
  },
  es: {
    body: "¿Permites cookies para saber qué anuncios encuentran buceadores? Es opcional.",
    allow: "Permitir",
    decline: "Ahora no",
    privacy: "Privacidad",
    settings: "Cookies",
  },
  fr: {
    body: "Autoriser les cookies pour savoir quelles annonces trouvent des plongeurs ? Facultatif.",
    allow: "Autoriser",
    decline: "Pas maintenant",
    privacy: "Confidentialité",
    settings: "Cookies",
  },
  de: {
    body: "Cookies erlauben, damit wir wissen, welche Anzeigen Taucher finden? Freiwillig.",
    allow: "Erlauben",
    decline: "Jetzt nicht",
    privacy: "Datenschutz",
    settings: "Cookie-Einstellungen",
  },
  "pt-BR": {
    body: "Permitir cookies para sabermos quais anúncios encontram mergulhadores? É opcional.",
    allow: "Permitir",
    decline: "Agora não",
    privacy: "Privacidade",
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
  // padding matches the bar, and the notify link stays hidden. It never covers
  // the first screen and steps aside while a signup form is on screen (see
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
          // The inline measurement question counts as a form: the bar asks the
          // same thing, and must not sit on that card's own two buttons.
          forms: [...document.querySelectorAll("form, [data-measurement-ask]")].map((form) =>
            form.getBoundingClientRect(),
          ),
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
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
    // Phones: a full-width strip on the bottom edge. From `sm` up: a card in
    // the notify link's bottom-right slot, beside the hero copy on a desktop
    // first screen rather than across it.
    <div
      ref={barRef}
      aria-hidden={yielding || undefined}
      className={`fixed inset-x-0 bottom-0 z-[10000] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[23rem] sm:px-0 sm:pb-[env(safe-area-inset-bottom)] ${
        yielding ? "invisible pointer-events-none" : ""
      }`}
    >
      <div
        role="dialog"
        aria-label={copy.body}
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl bg-[#201748]/95 px-3 py-1.5 text-white shadow-lg sm:px-4 sm:py-3"
      >
        <p className="min-w-0 basis-full text-xs leading-snug text-[#EDE6FF] sm:text-sm">
          {copy.body}
        </p>
        {/* On the action row, so its 44px tap target is a real box beside the
            buttons instead of a hit area spilling over them from the text. */}
        <a
          href={privacyPath(locale)}
          className="-ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center px-0.5 text-xs text-[#36A9E1] underline sm:text-sm"
        >
          {copy.privacy}
        </a>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[#EDE6FF]/70 px-2.5 text-xs font-medium text-[#EDE6FF] sm:px-3 sm:text-sm"
            onClick={() => choose("denied")}
          >
            {copy.decline}
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[#3D2683] px-2.5 text-xs font-medium text-white sm:px-3 sm:text-sm"
            onClick={() => choose("granted")}
          >
            {copy.allow}
          </button>
        </div>
      </div>
    </div>
  );
}
