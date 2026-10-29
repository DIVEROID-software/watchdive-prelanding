// Owner-approved hero copy, 2026-10-23: the first 100 Kickstarter backers
// get the early-bird price, followed by USD 200. The hero keeps its existing
// localized early-bird estimate; the next tier explicitly names USD so we do
// not invent exchange rates. Buddy Invite ON and OFF share these templates.
// No waitlist count, deadline, or remaining-place estimate is implied.
import type { Locale } from "./i18n/locale.ts";
import { EARLY_BIRD_SEATS } from "./referral/program.ts";

/** `{price}` comes from hero.nowPrice; `{seats}` comes from program.ts. */
export const earlyBirdRaceCopy: Record<Locale, string> = {
  en: "{price} early bird: first {seats} Kickstarter backers. After that the price goes up to $200.",
  ko: "{price} 얼리버드: Kickstarter 선착순 {seats}명. 이후 가격은 $200로 올라요.",
  "zh-CN": "{price}早鸟价：限 Kickstarter 前 {seats} 名支持者。之后价格将涨至 200 美元。",
  "zh-TW": "{price}早鳥價：限 Kickstarter 前 {seats} 名支持者。之後價格將漲至 200 美元。",
  ja: "{price}の早期価格：Kickstarterの先着{seats}名の支援者が対象。その後は200米ドルに上がります。",
  es: "{price} de lanzamiento: los {seats} primeros patrocinadores en Kickstarter. Después, el precio sube a 200 USD.",
  fr: "{price} en offre de lancement : les {seats} premiers contributeurs sur Kickstarter. Ensuite, le prix passe à 200 USD.",
  de: "{price} zum Early-Bird-Preis: die ersten {seats} Unterstützer auf Kickstarter. Danach steigt der Preis auf 200 USD.",
  "pt-BR": "{price} na oferta de lançamento: os {seats} primeiros apoiadores no Kickstarter. Depois, o preço sobe para US$ 200.",
  nl: "{price} early bird: de eerste {seats} Kickstarter-backers. Daarna stijgt de prijs naar 200 USD.",
};

/** Only this phrase gets a marker; its text never fades with the background. */
export const earlyBirdRaceHighlight: Record<Locale, string> = {
  en: `first ${EARLY_BIRD_SEATS}`,
  ko: `선착순 ${EARLY_BIRD_SEATS}명`,
  "zh-CN": `前 ${EARLY_BIRD_SEATS} 名`,
  "zh-TW": `前 ${EARLY_BIRD_SEATS} 名`,
  ja: `先着${EARLY_BIRD_SEATS}名`,
  es: `los ${EARLY_BIRD_SEATS} primeros`,
  fr: `les ${EARLY_BIRD_SEATS} premiers`,
  de: `die ersten ${EARLY_BIRD_SEATS}`,
  "pt-BR": `os ${EARLY_BIRD_SEATS} primeiros`,
  nl: `de eerste ${EARLY_BIRD_SEATS}`,
};

export function earlyBirdRace(locale: Locale, price: string, template?: string): string {
  const sentence = (template ?? earlyBirdRaceCopy[locale] ?? earlyBirdRaceCopy.en)
    .replace("{price}", price)
    .replaceAll("{seats}", String(EARLY_BIRD_SEATS));
  return sentence.charAt(0).toLocaleUpperCase(locale) + sentence.slice(1);
}
