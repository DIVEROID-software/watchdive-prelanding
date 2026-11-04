import type { Locale } from "../i18n/locale";
import type { DiveSegment } from "./copy";
import type { FeatureSlideId } from "./feature-carousel";

/**
 * Short carousel labels. Each line restates an approved segment or FAQ fact.
 * Scuba guidance stays on the scuba slides. Freediving does not borrow it.
 * Screen numbers in the photographs are not specifications.
 */
export type FeatureSlideCopy = {
  id: FeatureSlideId;
  title: string;
  lines: readonly string[];
};

export type FeatureCarouselCopy = {
  heading: Record<DiveSegment, string>;
  previous: string;
  next: string;
  trackLabel: string;
  carouselLabel: string;
  slideLabel: string;
  position: string;
  slides: Record<DiveSegment, readonly FeatureSlideCopy[]>;
};

export const FEATURE_CAROUSEL_COPY = {
  en: {
    heading: { scuba: "The dive, on your wrist.", freediving: "The freedive, on your wrist." },
    previous: "Previous feature",
    next: "Next feature",
    trackLabel: "Feature slides",
    carouselLabel: "carousel",
    slideLabel: "slide",
    position: "{current} of {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Readings", lines: ["Compass", "Depth", "Dive time", "Water temperature"] },
        { id: "guidance", title: "Guidance", lines: ["No-decompression time", "Deco guidance", "Ascent alerts", "Safety stop"] },
        { id: "logbook", title: "Logbook", lines: ["Sync at the surface", "Review the dive profile", "Your dives in one place", "Footage with the record"] },
      ],
      freediving: [
        { id: "readings", title: "Readings", lines: ["Depth", "Dive time", "Water temperature"] },
        { id: "logbook", title: "Logbook", lines: ["Sync after the dive", "Freediving profiles", "Review the record", "Footage with the log"] },
        { id: "housing", title: "Housing", lines: ["Add the housing to dive", "Your watch stays for land", "Depth and temperature, measured", "A seal check before the dive"] },
      ],
    },
  },
  ko: {
    heading: { scuba: "다이빙 정보, 손목에서.", freediving: "프리다이빙 정보, 손목에서." },
    previous: "이전 기능",
    next: "다음 기능",
    trackLabel: "기능 슬라이드",
    carouselLabel: "캐러셀",
    slideLabel: "슬라이드",
    position: "{total}개 중 {current}번째",
    slides: {
      scuba: [
        { id: "readings", title: "측정값", lines: ["나침반", "수심", "다이빙 시간", "수온"] },
        { id: "guidance", title: "가이드", lines: ["무감압 시간", "감압 안내", "상승 알림", "안전정지"] },
        { id: "logbook", title: "로그북", lines: ["수면에서 동기화", "다이브 프로필 다시 보기", "지난 다이빙을 한곳에서", "기록과 함께 보는 영상"] },
      ],
      freediving: [
        { id: "readings", title: "측정값", lines: ["수심", "다이빙 시간", "수온"] },
        { id: "logbook", title: "로그북", lines: ["다이빙 후 동기화", "프리다이빙 프로필", "기록 다시 보기", "기록과 함께 보는 영상"] },
        { id: "housing", title: "하우징", lines: ["다이빙할 때 하우징", "육지에서는 쓰던 워치", "수심과 수온을 측정", "입수 전 실링 확인"] },
      ],
    },
  },
  "zh-CN": {
    heading: { scuba: "这一次潜水，在腕上。", freediving: "这一次自由潜水，在腕上。" },
    previous: "上一项功能",
    next: "下一项功能",
    trackLabel: "功能滑片",
    carouselLabel: "轮播",
    slideLabel: "滑片",
    position: "第 {current} 项，共 {total} 项",
    slides: {
      scuba: [
        { id: "readings", title: "读数", lines: ["指南针", "水深", "潜水时间", "水温"] },
        { id: "guidance", title: "指引", lines: ["免减压时间", "减压指引", "上升提醒", "安全停留"] },
        { id: "logbook", title: "日志", lines: ["回到水面后同步", "回看潜水曲线", "在一处回顾每次潜水", "影像与潜水日志放在一起"] },
      ],
      freediving: [
        { id: "readings", title: "读数", lines: ["水深", "潜水时间", "水温"] },
        { id: "logbook", title: "日志", lines: ["潜水后同步", "自由潜水曲线", "回看潜水记录", "影像与潜水日志放在一起"] },
        { id: "housing", title: "外壳", lines: ["潜水时加上外壳", "岸上继续戴这只表", "外壳测量水深和水温", "下水前做密封检查"] },
      ],
    },
  },
  "zh-TW": {
    heading: { scuba: "這次潛水，在手腕上。", freediving: "這次自由潛水，在手腕上。" },
    previous: "上一項功能",
    next: "下一項功能",
    trackLabel: "功能滑片",
    carouselLabel: "輪播",
    slideLabel: "滑片",
    position: "第 {current} 項，共 {total} 項",
    slides: {
      scuba: [
        { id: "readings", title: "讀數", lines: ["指南針", "深度", "潛水時間", "水溫"] },
        { id: "guidance", title: "指引", lines: ["免減壓時間", "減壓指引", "上升提醒", "安全停留"] },
        { id: "logbook", title: "日誌", lines: ["回到水面後同步", "回顧潛水剖面", "在同一處回顧每次潛水", "影像與潛水日誌放在一起"] },
      ],
      freediving: [
        { id: "readings", title: "讀數", lines: ["深度", "潛水時間", "水溫"] },
        { id: "logbook", title: "日誌", lines: ["潛水後同步", "自由潛水曲線", "回顧潛水紀錄", "影像與潛水日誌放在一起"] },
        { id: "housing", title: "外殼", lines: ["潛水時加上防水殼", "上岸後繼續日常佩戴", "防水殼測量深度與水溫", "下水前做密封檢查"] },
      ],
    },
  },
  ja: {
    heading: { scuba: "潜水の情報を、手首で。", freediving: "フリーダイビングを、手首で。" },
    previous: "前の機能",
    next: "次の機能",
    trackLabel: "機能スライド",
    carouselLabel: "カルーセル",
    slideLabel: "スライド",
    position: "{total}枚中{current}枚目",
    slides: {
      scuba: [
        { id: "readings", title: "測定値", lines: ["コンパス", "深度", "潜水時間", "水温"] },
        { id: "guidance", title: "ガイダンス", lines: ["無減圧潜水時間", "減圧ガイダンス", "浮上アラート", "安全停止"] },
        { id: "logbook", title: "ログブック", lines: ["水面で同期", "プロファイルを振り返る", "記録をひとつに", "映像をログと一緒に"] },
      ],
      freediving: [
        { id: "readings", title: "測定値", lines: ["深度", "潜水時間", "水温"] },
        { id: "logbook", title: "ログブック", lines: ["潜ったあと同期", "フリーダイビングの記録", "プロファイルを振り返る", "映像をログと一緒に"] },
        { id: "housing", title: "ハウジング", lines: ["潜るときはハウジング", "陸上ではいつものウォッチ", "深度と水温を測定", "入水前に圧力を確認"] },
      ],
    },
  },
  es: {
    heading: { scuba: "Tu inmersión, en la muñeca.", freediving: "Tu apnea, en la muñeca." },
    previous: "Función anterior",
    next: "Función siguiente",
    trackLabel: "Diapositivas de funciones",
    carouselLabel: "carrusel",
    slideLabel: "diapositiva",
    position: "{current} de {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Lecturas", lines: ["Brújula", "Profundidad", "Tiempo de inmersión", "Temperatura del agua"] },
        { id: "guidance", title: "Guía", lines: ["Tiempo sin descompresión", "Indicaciones de descompresión", "Avisos de ascenso", "Parada de seguridad"] },
        { id: "logbook", title: "Diario", lines: ["Sincroniza en superficie", "Revisa el perfil", "Tus inmersiones, en un lugar", "Imágenes con el diario"] },
      ],
      freediving: [
        { id: "readings", title: "Lecturas", lines: ["Profundidad", "Tiempo de inmersión", "Temperatura del agua"] },
        { id: "logbook", title: "Diario", lines: ["Sincroniza después", "Perfiles de apnea", "Revisa el registro", "Imágenes con el diario"] },
        { id: "housing", title: "Carcasa", lines: ["La carcasa para bucear", "En tierra, tu smartwatch", "Mide profundidad y temperatura", "Comprobación de presión antes"] },
      ],
    },
  },
  fr: {
    heading: { scuba: "La plongée, au poignet.", freediving: "L’apnée, au poignet." },
    previous: "Fonction précédente",
    next: "Fonction suivante",
    trackLabel: "Diapositives des fonctions",
    carouselLabel: "carrousel",
    slideLabel: "diapositive",
    position: "{current} sur {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Mesures", lines: ["Compas", "Profondeur", "Durée de plongée", "Température de l’eau"] },
        { id: "guidance", title: "Guidage", lines: ["Temps sans palier", "Indications de décompression", "Alertes de remontée", "Palier de sécurité"] },
        { id: "logbook", title: "Carnet", lines: ["Synchronisation en surface", "Revoir le profil", "Vos plongées au même endroit", "Les images avec le carnet"] },
      ],
      freediving: [
        { id: "readings", title: "Mesures", lines: ["Profondeur", "Durée", "Température de l’eau"] },
        { id: "logbook", title: "Carnet", lines: ["Synchroniser après la plongée", "Profils d’apnée", "Consulter l’enregistrement", "Les images avec le carnet"] },
        { id: "housing", title: "Caisson", lines: ["Le caisson pour plonger", "À terre, votre montre", "Profondeur et température mesurées", "Contrôle de pression avant"] },
      ],
    },
  },
  de: {
    heading: { scuba: "Der Tauchgang, am Handgelenk.", freediving: "Der Apnoetauchgang, am Handgelenk." },
    previous: "Vorherige Funktion",
    next: "Nächste Funktion",
    trackLabel: "Funktionsfolien",
    carouselLabel: "Karussell",
    slideLabel: "Folie",
    position: "{current} von {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Werte", lines: ["Kompass", "Tiefe", "Tauchzeit", "Wassertemperatur"] },
        { id: "guidance", title: "Führung", lines: ["Nullzeit", "Dekompressionshinweise", "Aufstiegswarnung", "Sicherheitsstopp"] },
        { id: "logbook", title: "Logbuch", lines: ["An der Oberfläche synchronisieren", "Profil ansehen", "Tauchgänge an einem Ort", "Aufnahmen beim Logbuch"] },
      ],
      freediving: [
        { id: "readings", title: "Werte", lines: ["Tiefe", "Zeit", "Wassertemperatur"] },
        { id: "logbook", title: "Logbuch", lines: ["Nach dem Tauchgang synchronisieren", "Apnoe-Profile", "Eintrag ansehen", "Aufnahmen beim Logbuch"] },
        { id: "housing", title: "Gehäuse", lines: ["Gehäuse zum Tauchen", "An Land bleibt die Smartwatch", "Tiefe und Temperatur messen", "Druckprüfung vor dem Tauchgang"] },
      ],
    },
  },
  "pt-BR": {
    heading: { scuba: "O mergulho, no pulso.", freediving: "A apneia, no pulso." },
    previous: "Função anterior",
    next: "Próxima função",
    trackLabel: "Slides de funções",
    carouselLabel: "carrossel",
    slideLabel: "slide",
    position: "{current} de {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Leituras", lines: ["Bússola", "Profundidade", "Tempo de mergulho", "Temperatura da água"] },
        { id: "guidance", title: "Orientação", lines: ["Tempo sem descompressão", "Orientações de descompressão", "Alertas de subida", "Parada de segurança"] },
        { id: "logbook", title: "Diário", lines: ["Sincronize na superfície", "Reveja o perfil", "Mergulhos em um só lugar", "Imagens com o diário"] },
      ],
      freediving: [
        { id: "readings", title: "Leituras", lines: ["Profundidade", "Tempo de mergulho", "Temperatura da água"] },
        { id: "logbook", title: "Diário", lines: ["Sincronize depois do mergulho", "Perfis de mergulho livre", "Reveja o registro", "Imagens com o diário"] },
        { id: "housing", title: "Caixa", lines: ["A caixa para mergulhar", "Em terra, o smartwatch", "Mede profundidade e temperatura", "Checagem de pressão antes"] },
      ],
    },
  },
  nl: {
    heading: { scuba: "De duik, om je pols.", freediving: "De freedive, om je pols." },
    previous: "Vorige functie",
    next: "Volgende functie",
    trackLabel: "Functiedia’s",
    carouselLabel: "carrousel",
    slideLabel: "dia",
    position: "{current} van {total}",
    slides: {
      scuba: [
        { id: "readings", title: "Metingen", lines: ["Kompas", "Diepte", "Duiktijd", "Watertemperatuur"] },
        { id: "guidance", title: "Begeleiding", lines: ["No-decompressietijd", "Veiligheidsstop", "Stijgwaarschuwing"] },
        { id: "logbook", title: "Logboek", lines: ["Synchroniseer aan de oppervlakte", "Bekijk het duikprofiel", "Duiken op één plek", "Beelden bij het logboek"] },
      ],
      freediving: [
        { id: "readings", title: "Metingen", lines: ["Diepte", "Duiktijd", "Watertemperatuur"] },
        { id: "logbook", title: "Logboek", lines: ["Synchroniseer na de duik", "Freediveprofielen", "Bekijk je registratie", "Beelden bij het logboek"] },
        { id: "housing", title: "Behuizing", lines: ["Behuizing om te duiken", "Aan land blijft je horloge", "Diepte en temperatuur meten", "Drukcheck voor de duik"] },
      ],
    },
  },
} satisfies Record<Locale, FeatureCarouselCopy>;

export function featureCarouselCopy(locale: Locale): FeatureCarouselCopy {
  return FEATURE_CAROUSEL_COPY[locale];
}

export function formatFeaturePosition(template: string, current: number, total: number): string {
  return template.replaceAll("{current}", String(current)).replaceAll("{total}", String(total));
}
