import type { Locale } from "../i18n/locale";

/** Clarifies the catalog's "all other Apple Watch models" against its three planned Ultra models. */
export const HERO_DISCLOSURE_COPY: Record<Locale, { appleLine: string }> = {
  en: { appleLine: "Apple Watch, except Ultra, Ultra 2 and Ultra 3" },
  ko: { appleLine: "Apple Watch (Ultra, Ultra 2, Ultra 3 제외)" },
  "zh-CN": { appleLine: "Apple Watch（Ultra、Ultra 2 和 Ultra 3 除外）" },
  "zh-TW": { appleLine: "Apple Watch（Ultra、Ultra 2 和 Ultra 3 除外）" },
  ja: { appleLine: "Apple Watch（Ultra、Ultra 2、Ultra 3を除く）" },
  es: { appleLine: "Apple Watch, excepto Ultra, Ultra 2 y Ultra 3" },
  fr: { appleLine: "Apple Watch, sauf Ultra, Ultra 2 et Ultra 3" },
  de: { appleLine: "Apple Watch, außer Ultra, Ultra 2 und Ultra 3" },
  "pt-BR": { appleLine: "Apple Watch, exceto Ultra, Ultra 2 e Ultra 3" },
  nl: { appleLine: "Apple Watch, behalve Ultra, Ultra 2 en Ultra 3" },
};

export function heroDisclosureCopy(locale: Locale) {
  return HERO_DISCLOSURE_COPY[locale];
}
