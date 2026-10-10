// One sentence directly above the hero email field: the early-bird price, and
// that only the first 100 Kickstarter backers at launch get it. Each part is a
// claim the catalog already makes (hero price, `offNote`, `conversionCopy.terms`);
// this states them together, with the limit inside the same sentence.
//
// Why there: page-behaviour rows from 2026-10-08 to 10-10 (183 consented
// sessions, 81% phones) put the median phone scroll at 7% and a third of
// visits never scroll, while the "first 100 backers" section further down was
// reached by 27%. The reason to act has to sit in the first screen, next to
// the field, and must not push the field down: in form-first it takes the
// place of the benefit line and stays within its line count.
//
// Deliberately not here: the waitlist total. It is mostly a founder-stated
// off-platform figure, and waitlist position does not allocate the 100
// pledges, so "N already waiting" beside "first 100" would imply a queue that
// does not exist. The progress bar shows the total with its own explanation.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "./i18n/locale.ts";

/** `{price}` is the hero's localized early-bird price (`hero.nowPrice`). */
export const earlyBirdRaceCopy: Record<Locale, string> = {
  en: "{price} for the first 100 Kickstarter backers at launch.",
  ko: "{price} 얼리버드는 Kickstarter 오픈 선착순 100명뿐.",
  "zh-CN": "{price} 早鸟价：Kickstarter 开启后仅限前 100 名。",
  "zh-TW": "{price} 早鳥價：Kickstarter 開賣後僅限前 100 名。",
  ja: "{price}の早期価格は、Kickstarter開始時の先着100名だけ。",
  es: "{price} solo para los 100 primeros en Kickstarter, al abrir.",
  fr: "{price} pour les 100 premiers sur Kickstarter, à l’ouverture.",
  de: "{price} nur für die ersten 100 auf Kickstarter, zum Start.",
  "pt-BR": "{price}: só os 100 primeiros no Kickstarter, ao abrir.",
};

/** The sentence for a locale, capitalized when a price like "unos 140 €" opens it. */
export function earlyBirdRace(locale: Locale, price: string): string {
  const sentence = (earlyBirdRaceCopy[locale] ?? earlyBirdRaceCopy.en).replace("{price}", price);
  return sentence.charAt(0).toLocaleUpperCase(locale) + sentence.slice(1);
}
