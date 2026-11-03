/**
 * Current WatchDive publisher placements only.
 * Older DIVEROID smartphone-housing coverage stays out of this row.
 * Scuba Times is a licensed translation of The Scuba News, not a second test.
 */
export type PressCoverageType =
  | "original_roundup"
  | "original_editorial"
  | "editorial_rewrite"
  | "original_explainer"
  | "press_republication"
  | "licensed_translation";

export type PressLogoMeta = {
  id: string;
  name: string;
  href: string;
  file: string;
  width: number;
  height: number;
  ground: "light" | "dark";
  wide: boolean;
  coverageType: PressCoverageType;
  syndicatedFrom: string | null;
};

export const PRESS_LOGO_META = [
  {
    id: "gearjunkie",
    name: "GearJunkie",
    href: "https://gearjunkie.com/emerging-gear/emerging-gear-10-30-2026",
    file: "gearjunkie.svg",
    width: 185,
    height: 30,
    ground: "dark",
    wide: true,
    coverageType: "original_roundup",
    syndicatedFrom: null,
  },
  {
    id: "the-scuba-news",
    name: "The Scuba News",
    href: "https://www.thescubanews.com/2026/11/01/diveroid-watchdive-smartwatch-dive-computer-2026/",
    file: "the-scuba-news.png",
    width: 300,
    height: 90,
    ground: "light",
    wide: false,
    coverageType: "original_editorial",
    syndicatedFrom: null,
  },
  {
    id: "x-ray-mag",
    name: "X-Ray Mag",
    href: "https://xray-mag.com/content/watchdive-puts-dive-data-smartwatches",
    file: "xray-mag.png",
    width: 416,
    height: 75,
    ground: "light",
    wide: true,
    coverageType: "original_editorial",
    syndicatedFrom: null,
  },
  {
    id: "tuttoandroid",
    name: "TuttoAndroid",
    href: "https://www.tuttoandroid.net/news/2026/10/26/watchdive-diveroid-computer-subacqueo-smartwatch-kickstarter-1179439/",
    file: "tuttoandroid.png",
    width: 548,
    height: 95,
    ground: "light",
    wide: true,
    coverageType: "editorial_rewrite",
    syndicatedFrom: null,
  },
  {
    id: "tech-advisor-brasil",
    name: "Tech Advisor Brasil",
    href: "https://techadvisor.com.br/watchdive-caixa-estanque-transforma-apple-watch-e-galaxy-watch-em-computador-de-mergulho",
    file: "tech-advisor-brasil.png",
    width: 600,
    height: 60,
    ground: "light",
    wide: true,
    coverageType: "original_explainer",
    syndicatedFrom: null,
  },
  {
    id: "teknotalk",
    name: "Teknotalk",
    href: "https://www.teknotalk.com/watchdive-akilli-saat-dalis-bilgisayari-212212/",
    file: "teknotalk.png",
    width: 236,
    height: 88,
    ground: "light",
    wide: false,
    coverageType: "editorial_rewrite",
    syndicatedFrom: null,
  },
  {
    id: "estamos-en-linea",
    name: "Estamos en Línea",
    href: "https://www.estamosenlinea.co/2026/11/01/convierta-el-reloj-inteligente-que-ya-usa-en-una-computadora-de-buceo/",
    file: "estamos-en-linea.jpg",
    width: 290,
    height: 106,
    ground: "light",
    wide: false,
    coverageType: "press_republication",
    syndicatedFrom: null,
  },
  {
    id: "scubatimes",
    name: "스쿠버타임즈 (Scuba Times)",
    href: "https://www.scubatimes.co.kr/articles/diveroid-watchdive-aims-to-turn-everyday-smartwatches-into-mvxpzv11-2ow4dd",
    file: "scubatimes.png",
    width: 800,
    height: 120,
    ground: "light",
    wide: true,
    coverageType: "licensed_translation",
    syndicatedFrom: "The Scuba News",
  },
] as const satisfies readonly PressLogoMeta[];
