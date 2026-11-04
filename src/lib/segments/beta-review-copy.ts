import type { Locale } from "../i18n/locale";

/** Segment heading only. The frozen landing catalog keeps its own review title. */
export type SegmentBetaCopy = {
  title: string;
  context: string;
  more: string;
};

export const SEGMENT_BETA_COPY = {
  en: {
    title: "From our beta testers",
    context: "Notes from people who tried WatchDive during beta testing.",
    more: "More beta experiences",
  },
  ko: {
    title: "베타테스터의 이야기",
    context: "출시 전에 WatchDive를 써 본 사람들의 기록입니다.",
    more: "베타 경험 더 보기",
  },
  "zh-CN": {
    title: "来自我们的测试用户",
    context: "这些是在测试阶段用过 WatchDive 的人写下的感受。",
    more: "更多测试体验",
  },
  "zh-TW": {
    title: "來自我們的測試者",
    context: "這些是在測試階段用過 WatchDive 的人寫下的感受。",
    more: "更多測試體驗",
  },
  ja: {
    title: "ベータテスターの声",
    context: "発売前に WatchDive を試した人たちの記録です。",
    more: "ほかのベータ体験",
  },
  es: {
    title: "De quienes probaron la beta",
    context: "Notas de quienes probaron WatchDive durante la beta.",
    more: "Más experiencias de la beta",
  },
  fr: {
    title: "De nos bêta-testeurs",
    context: "Notes de personnes qui ont essayé WatchDive pendant la bêta.",
    more: "D'autres expériences de la bêta",
  },
  de: {
    title: "Von unseren Beta-Testern",
    context: "Notizen von Leuten, die WatchDive im Beta-Test ausprobiert haben.",
    more: "Weitere Beta-Erfahrungen",
  },
  "pt-BR": {
    title: "De quem testou o beta",
    context: "Notas de quem experimentou o WatchDive no teste beta.",
    more: "Mais experiências do beta",
  },
  nl: {
    title: "Van onze bètatesters",
    context: "Notities van mensen die WatchDive tijdens de bètatest hebben geprobeerd.",
    more: "Meer bèta-ervaringen",
  },
} as const satisfies Record<Locale, SegmentBetaCopy>;

export function segmentBetaCopy(locale: Locale): SegmentBetaCopy {
  return SEGMENT_BETA_COPY[locale];
}
