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

type ChoiceCopy = {
  /** One short line: the bar is a single compact row, even at 390 px. */
  body: string;
  allow: string;
  decline: string;
  privacy: string;
  /** Footer link that reopens the choice (opt-out outside EU/EEA/UK/CH). */
  settings: string;
};

const COPY: Record<Locale, ChoiceCopy> = {
  en: {
    body: "We use cookies to measure this page.",
    allow: "Allow",
    decline: "Not now",
    privacy: "Privacy",
    settings: "Cookie settings",
  },
  ko: {
    body: "페이지 측정을 위해 쿠키를 사용해요.",
    allow: "허용",
    decline: "나중에",
    privacy: "개인정보",
    settings: "쿠키 설정",
  },
  "zh-CN": {
    body: "我们用 Cookie 统计本页访问。",
    allow: "允许",
    decline: "暂时不要",
    privacy: "隐私",
    settings: "Cookie 设置",
  },
  "zh-TW": {
    body: "我們用 Cookie 統計本頁造訪。",
    allow: "允許",
    decline: "暫時不要",
    privacy: "隱私",
    settings: "Cookie 設定",
  },
  ja: {
    body: "ページ計測にクッキーを使います。",
    allow: "許可する",
    decline: "今はしない",
    privacy: "プライバシー",
    settings: "クッキー設定",
  },
  es: {
    body: "Usamos cookies para medir esta página.",
    allow: "Permitir",
    decline: "Ahora no",
    privacy: "Privacidad",
    settings: "Cookies",
  },
  fr: {
    body: "Nous utilisons des cookies de mesure.",
    allow: "Autoriser",
    decline: "Pas maintenant",
    privacy: "Confidentialité",
    settings: "Cookies",
  },
  de: {
    body: "Wir nutzen Cookies zur Messung.",
    allow: "Erlauben",
    decline: "Jetzt nicht",
    privacy: "Datenschutz",
    settings: "Cookie-Einstellungen",
  },
  "pt-BR": {
    body: "Usamos cookies para medir esta página.",
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
    window.addEventListener(OPEN_EVENT, reopen);
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
    };
  }, []);

  // While this bar is open it owns the bottom edge. The height is published
  // so page padding matches the bar, and the notify link stays hidden.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const node = barRef.current;
    if (!open || !node) {
      delete root.dataset.wdCookie;
      root.style.removeProperty("--wd-cookie-space");
      return;
    }
    const apply = () => {
      root.dataset.wdCookie = "open";
      root.style.setProperty(
        "--wd-cookie-space",
        `${Math.ceil(node.getBoundingClientRect().height)}px`,
      );
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
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
    <div ref={barRef} className="fixed inset-x-0 bottom-0 z-[10000] px-2 pb-2 sm:px-4 sm:pb-3">
      <div
        role="dialog"
        aria-label={copy.body}
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[#201748]/95 px-3 py-1.5 text-white shadow-lg sm:flex-nowrap sm:px-4"
      >
        <p className="min-w-0 flex-1 basis-full text-xs leading-snug text-[#EDE6FF] min-[380px]:basis-auto sm:text-sm">
          {copy.body}{" "}
          <a href={privacyPath(locale)} className="text-[#36A9E1] underline">
            {copy.privacy}
          </a>
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-[#EDE6FF]/70 px-3 text-xs font-medium text-[#EDE6FF] sm:text-sm"
            onClick={() => choose("denied")}
          >
            {copy.decline}
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#3D2683] px-3 text-xs font-medium text-white sm:text-sm"
            onClick={() => choose("granted")}
          >
            {copy.allow}
          </button>
        </div>
      </div>
    </div>
  );
}
