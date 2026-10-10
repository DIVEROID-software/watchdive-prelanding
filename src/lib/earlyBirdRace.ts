// The line that puts the two hard numbers on the page side by side: the
// early-bird price goes to the first 100 backers, and the list already holds
// tens of thousands. Each half is a claim the page already makes elsewhere (the
// hero price and the progress bar); this only places them next to each other,
// directly above the email field.
//
// Why there: page-behaviour rows from 2026-10-08 to 10-10 (183 consented
// sessions, 81% phones) put the median phone scroll at 7% and a third of
// visits never scroll, while the "first 100 backers" section further down was
// reached by 27%. A reason to act has to sit inside the first screen, next to
// the field, without pushing the field down.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "./i18n/locale.ts";
import { formatCount } from "./waitlistProgress.ts";

type RaceCopy = {
  /** `{price}` is the hero's localized early-bird price. */
  lead: string;
  /** `{total}` is the public waitlist figure, the same one the progress bar shows. */
  waiting: string;
};

export const earlyBirdRaceCopy: Record<Locale, RaceCopy> = {
  en: {
    lead: "Only the first 100 backers get {price}.",
    waiting: "{total} divers already waiting",
  },
  ko: {
    lead: "{price} 얼리버드는 선착순 후원자 100명뿐.",
    waiting: "이미 {total}명이 기다리는 중",
  },
  "zh-CN": {
    lead: "{price}早鸟价仅限前 100 位支持者。",
    waiting: "已有 {total} 位潜水员在等候",
  },
  "zh-TW": {
    lead: "{price}早鳥價僅限前 100 位支持者。",
    waiting: "已有 {total} 位潛水員在等候",
  },
  ja: {
    lead: "{price}の早期価格は先着100名の支援者だけ。",
    waiting: "すでに{total}人のダイバーが待っています",
  },
  es: {
    lead: "Solo los primeros 100 patrocinadores lo tendrán por {price}.",
    waiting: "{total} buceadores ya esperan",
  },
  fr: {
    lead: "Seuls les 100 premiers contributeurs l’auront à {price}.",
    waiting: "{total} plongeurs attendent déjà",
  },
  de: {
    lead: "Nur die ersten 100 Unterstützer bekommen es für {price}.",
    waiting: "{total} Taucher warten bereits",
  },
  "pt-BR": {
    lead: "Só os primeiros 100 apoiadores pagam {price}.",
    waiting: "{total} mergulhadores já esperam",
  },
};

/**
 * The two halves for a locale. `waiting` is null when the count is unknown:
 * a figure built from the baseline alone is a claim the page cannot back, the
 * same rule the progress bar follows.
 */
export function earlyBirdRace(
  locale: Locale,
  price: string,
  total: number | undefined,
): { lead: string; waiting: string | null } {
  const copy = earlyBirdRaceCopy[locale] ?? earlyBirdRaceCopy.en;
  return {
    lead: copy.lead.replace("{price}", price),
    waiting: total === undefined ? null : copy.waiting.replace("{total}", formatCount(total)),
  };
}
