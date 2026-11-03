import gearjunkie from "@/assets/press/watchdive-20261104/gearjunkie.svg";
import scubaNews from "@/assets/press/watchdive-20261104/the-scuba-news.png";
import xrayMag from "@/assets/press/watchdive-20261104/xray-mag.png";
import tuttoandroid from "@/assets/press/watchdive-20261104/tuttoandroid.png";
import techAdvisor from "@/assets/press/watchdive-20261104/tech-advisor-brasil.png";
import teknotalk from "@/assets/press/watchdive-20261104/teknotalk.png";
import estamosEnLinea from "@/assets/press/watchdive-20261104/estamos-en-linea.jpg";
import scubaTimes from "@/assets/press/watchdive-20261104/scubatimes.png";
import { PRESS_LOGO_META, type PressLogoMeta } from "@/lib/segments/press-logo-meta";

const PRESS_LOGO_SRC: Record<(typeof PRESS_LOGO_META)[number]["id"], string> = {
  gearjunkie,
  "the-scuba-news": scubaNews,
  "x-ray-mag": xrayMag,
  tuttoandroid,
  "tech-advisor-brasil": techAdvisor,
  teknotalk,
  "estamos-en-linea": estamosEnLinea,
  scubatimes: scubaTimes,
};

export type PressLogo = PressLogoMeta & { src: string };

/** Mastheads joined to the publisher facts. Assets stay unmodified. */
export const PRESS_LOGOS: readonly PressLogo[] = PRESS_LOGO_META.map((logo) => ({
  ...logo,
  src: PRESS_LOGO_SRC[logo.id],
}));
