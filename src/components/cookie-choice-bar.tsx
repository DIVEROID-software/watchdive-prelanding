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

type ChoiceCopy = {
  title: string;
  body: string;
  allow: string;
  decline: string;
  privacy: string;
};

const COPY: Record<Locale, ChoiceCopy> = {
  en: {
    title: "Cookies for measurement",
    body: "Allow us to record device type, country, time, and which parts of this page you open, click, and how long you stay. Signing up works either way.",
    allow: "Allow",
    decline: "Not now",
    privacy: "Privacy",
  },
  ko: {
    title: "측정용 쿠키",
    body: "기기 종류, 국가, 시간, 페이지에서 연 부분과 클릭, 머문 시간을 기록해도 될까요. 소식 신청은 동의하지 않아도 됩니다.",
    allow: "허용",
    decline: "나중에",
    privacy: "개인정보",
  },
  "zh-CN": {
    title: "用于统计的 Cookie",
    body: "允许后，我们会记录设备类型、国家、时间，以及你打开、点击和停留的页面部分。不点允许，也能留下邮箱。",
    allow: "允许",
    decline: "暂时不要",
    privacy: "隐私",
  },
  "zh-TW": {
    title: "用來統計的 Cookie",
    body: "允許之後，我們會記錄裝置類型、國家、時間，以及你打開、點擊和停留的頁面部分。不按允許，一樣可以留下信箱。",
    allow: "允許",
    decline: "暫時不要",
    privacy: "隱私",
  },
  ja: {
    title: "計測のためのクッキー",
    body: "端末の種類、国、時刻、ページのどこを開き、クリックし、どれだけ留まったかを記録してよいか伺います。メール登録は、許可しなくてもできます。",
    allow: "許可する",
    decline: "今はしない",
    privacy: "プライバシー",
  },
  es: {
    title: "Cookies de medición",
    body: "Si lo permites, registramos el tipo de dispositivo, el país, la hora y qué partes abres, pulsas y cuánto te quedas. Apuntarte funciona igual sin eso.",
    allow: "Permitir",
    decline: "Ahora no",
    privacy: "Privacidad",
  },
  fr: {
    title: "Cookies de mesure",
    body: "Si vous acceptez, nous notons le type d’appareil, le pays, l’heure, et quelles parties vous ouvrez, cliquez et combien de temps vous restez. L’inscription marche aussi sans ça.",
    allow: "Autoriser",
    decline: "Pas maintenant",
    privacy: "Confidentialité",
  },
  de: {
    title: "Cookies für die Messung",
    body: "Wenn du zustimmst, speichern wir Gerätetyp, Land, Uhrzeit und welche Teile du öffnest, anklickst und wie lange du bleibst. Eintragen geht auch ohne Zustimmung.",
    allow: "Erlauben",
    decline: "Jetzt nicht",
    privacy: "Datenschutz",
  },
  "pt-BR": {
    title: "Cookies de medição",
    body: "Se você permitir, registramos o tipo de aparelho, o país, a hora e quais partes você abre, clica e por quanto tempo fica. Deixar o e-mail funciona mesmo sem isso.",
    allow: "Permitir",
    decline: "Agora não",
    privacy: "Privacidade",
  },
};

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
    if (globalPrivacyControlOn()) return;
    if (getMetaMeasurementConsent() === "granted") {
      initGoogleTag();
      initClarity();
      startPageBehavior();
    }
    if (getMetaMeasurementConsent() === null) setOpen(true);
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
    }
    setOpen(false);
  }

  return (
    <div ref={barRef} className="fixed inset-x-0 bottom-0 z-[10000] px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        role="dialog"
        aria-labelledby="cookie-choice-title"
        className="mx-auto max-w-3xl rounded-2xl bg-[#201748] px-4 py-3 text-white sm:px-5 sm:py-4"
      >
        <p id="cookie-choice-title" className="text-sm font-medium tracking-tight sm:text-base">
          {copy.title}
        </p>
        <p className="mt-1 text-xs leading-snug text-[#EDE6FF] sm:mt-2 sm:text-sm sm:leading-relaxed">
          {copy.body}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-[#3D2683] px-4 text-sm font-medium text-white"
            onClick={() => choose("granted")}
          >
            {copy.allow}
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[#EDE6FF] px-4 text-sm font-medium text-[#EDE6FF]"
            onClick={() => choose("denied")}
          >
            {copy.decline}
          </button>
          <a
            href={privacyPath(locale)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-sm text-[#36A9E1] underline"
          >
            {copy.privacy}
          </a>
        </div>
      </div>
    </div>
  );
}
