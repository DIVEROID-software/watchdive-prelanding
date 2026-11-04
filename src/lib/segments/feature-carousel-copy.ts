import type { Locale } from "../i18n/locale";
import type { DiveSegment } from "./copy";
import type { FeatureIcon, FeatureScope, FeatureSlideId } from "./feature-carousel";

/**
 * Owner feature slider, 2026-11-04.
 * The 13 English lines are the supplied product-page copy. They are not an
 * engineering measurement. Scuba-only procedures stay in the list on the
 * freediving page and are named as scuba mode there. Screen figures in the
 * photographs are not specifications.
 */
export type FeatureLine = {
  icon: FeatureIcon;
  text: string;
  scope: FeatureScope;
};

export type FeatureSlideCopy = {
  id: FeatureSlideId;
  title: string;
  lines: readonly FeatureLine[];
};

export type FeatureCarouselCopy = {
  heading: Record<DiveSegment, string>;
  previous: string;
  next: string;
  play: string;
  pause: string;
  scopeLabel: string;
  trackLabel: string;
  carouselLabel: string;
  slideLabel: string;
  position: string;
  alt: Record<FeatureSlideId, string>;
  slides: Record<DiveSegment, readonly FeatureSlideCopy[]>;
};

function line(icon: FeatureIcon, text: string, scope: FeatureScope): FeatureLine {
  return { icon, text, scope };
}

function slides(
  dataTitle: string,
  depth: string,
  temperature: string,
  deco: string,
  ndl: string,
  safetyTitle: string,
  safetyStop: string,
  ascent: string,
  deepStop: string,
  techTitle: string,
  compass: string,
  nitrox: string,
  headingMarker: string,
  modesTitle: string,
  scubaMode: string,
  freediveMode: string,
  battery: string,
): Record<DiveSegment, readonly FeatureSlideCopy[]> {
  const shared: readonly FeatureSlideCopy[] = [
    {
      id: "data",
      title: dataTitle,
      lines: [
        line("depth", depth, "shared"),
        line("temperature", temperature, "shared"),
        line("deco", deco, "scuba"),
        line("ndl", ndl, "scuba"),
      ],
    },
    {
      id: "safety",
      title: safetyTitle,
      lines: [
        line("safety-stop", safetyStop, "scuba"),
        line("ascent", ascent, "scuba"),
        line("deep-stop", deepStop, "scuba"),
      ],
    },
    {
      id: "tech",
      title: techTitle,
      lines: [
        line("compass", compass, "shared"),
        line("nitrox", nitrox, "scuba"),
        line("heading", headingMarker, "shared"),
      ],
    },
    {
      id: "modes",
      title: modesTitle,
      lines: [
        line("scuba", scubaMode, "shared"),
        line("freedive", freediveMode, "shared"),
        line("battery", battery, "shared"),
      ],
    },
  ];
  return { scuba: shared, freediving: shared };
}

export const FEATURE_CAROUSEL_COPY = {
  en: {
    heading: { scuba: "Everything Your Dive Needs, Right On Your Wrist.", freediving: "Everything Your Dive Needs, Right On Your Wrist." },
    previous: "Previous feature",
    next: "Next feature",
    play: "Play automatic slides",
    pause: "Pause automatic slides",
    scopeLabel: "Scuba mode",
    trackLabel: "Feature slides",
    carouselLabel: "carousel",
    slideLabel: "slide",
    position: "{current} of {total}",
    alt: {
      data: "WatchDive on a wrist underwater, with dive readings on the screen",
      safety: "A freediver’s hands on a yellow buoy, with a white WatchDive on the wrist",
      tech: "A black WatchDive on an extended wrist above the pool",
      modes: "WatchDive clipped to a dive vest, beside a yellow hose and a black corrugated hose",
    },
    slides: slides(
      "Data",
      "Live depth tracking",
      "Water temperature monitoring",
      "Decompression stop guidance",
      "NDL",
      "Safety",
      "Safety stop alerts",
      "Ascent rate alerts",
      "Deep stop alerts",
      "Dive Tech",
      "Digital compass",
      "Nitrox (EANx) support",
      "Compass heading marker",
      "Modes",
      "Scuba mode",
      "Freedive mode",
      "Low-battery warning",
    ),
  },
  ko: {
    heading: { scuba: "다이빙에 필요한 모든 것, 손목 위에.", freediving: "다이빙에 필요한 모든 것, 손목 위에." },
    previous: "이전 기능",
    next: "다음 기능",
    play: "자동 넘김 재생",
    pause: "자동 넘김 정지",
    scopeLabel: "스쿠버 모드",
    trackLabel: "기능 슬라이드",
    carouselLabel: "캐러셀",
    slideLabel: "슬라이드",
    position: "{total}개 중 {current}번째",
    alt: {
      data: "수중에서 손목에 찬 WatchDive. 화면에 다이빙 수치가 보입니다",
      safety: "노란 부표 위에 올린 프리다이버의 손. 흰색 WatchDive가 손목에 있습니다",
      tech: "수영장 위로 뻗은 손목의 검은 WatchDive",
      modes: "노란색 호스와 검은 주름 호스 옆, 다이브 베스트에 고정된 WatchDive",
    },
    slides: slides(
      "데이터",
      "실시간 수심",
      "수온 모니터링",
      "감압 정지 안내",
      "NDL",
      "안전",
      "안전정지 알림",
      "상승 속도 알림",
      "딥스톱 알림",
      "다이브 테크",
      "디지털 나침반",
      "나이트록스(EANx) 지원",
      "나침반 방위 마커",
      "모드",
      "스쿠버 모드",
      "프리다이빙 모드",
      "배터리 부족 경고",
    ),
  },
  "zh-CN": {
    heading: { scuba: "潜水需要的，都在腕上。", freediving: "潜水需要的，都在腕上。" },
    previous: "上一项功能",
    next: "下一项功能",
    play: "播放自动切换",
    pause: "暂停自动切换",
    scopeLabel: "水肺模式",
    trackLabel: "功能幻灯片",
    carouselLabel: "轮播",
    slideLabel: "幻灯片",
    position: "第 {current} 项，共 {total} 项",
    alt: {
      data: "水下腕上的 WatchDive，屏幕显示潜水读数",
      safety: "自由潜水者的双手放在黄色浮标上，白色 WatchDive 戴在腕上",
      tech: "泳池上方伸展的手腕，戴着黑色 WatchDive",
      modes: "WatchDive 固定在潜水背心上，旁边是黄色软管和黑色波纹管",
    },
    slides: slides(
      "数据",
      "实时深度",
      "水温监测",
      "减压停留指引",
      "NDL",
      "安全",
      "安全停留提醒",
      "上升速度提醒",
      "深停提醒",
      "潜水技术",
      "数字罗盘",
      "高氧（EANx）支持",
      "罗盘航向标记",
      "模式",
      "水肺模式",
      "自由潜水模式",
      "低电量警告",
    ),
  },
  "zh-TW": {
    heading: { scuba: "潛水需要的，都在腕上。", freediving: "潛水需要的，都在腕上。" },
    previous: "上一項功能",
    next: "下一項功能",
    play: "播放自動切換",
    pause: "暫停自動切換",
    scopeLabel: "水肺模式",
    trackLabel: "功能投影片",
    carouselLabel: "輪播",
    slideLabel: "投影片",
    position: "第 {current} 項，共 {total} 項",
    alt: {
      data: "水下腕上的 WatchDive，螢幕顯示潛水讀數",
      safety: "自由潛水者的雙手放在黃色浮標上，白色 WatchDive 戴在腕上",
      tech: "泳池上方伸出的手腕，戴著黑色 WatchDive",
      modes: "WatchDive 固定在潛水背心上，旁邊是黃色軟管和黑色波紋管",
    },
    slides: slides(
      "數據",
      "即時深度",
      "水溫監測",
      "減壓停留指引",
      "NDL",
      "安全",
      "安全停留提醒",
      "上升速度提醒",
      "深停提醒",
      "潛水技術",
      "數位羅盤",
      "高氧（EANx）支援",
      "羅盤航向標記",
      "模式",
      "水肺模式",
      "自由潛水模式",
      "低電量警告",
    ),
  },
  ja: {
    heading: { scuba: "潜水に必要なもの、すべて手首に。", freediving: "潜水に必要なもの、すべて手首に。" },
    previous: "前の機能",
    next: "次の機能",
    play: "自動送りを再生",
    pause: "自動送りを停止",
    scopeLabel: "スキューバモード",
    trackLabel: "機能スライド",
    carouselLabel: "カルーセル",
    slideLabel: "スライド",
    position: "{total}枚中{current}枚目",
    alt: {
      data: "水中の手首につけた WatchDive。画面に潜水の数値が表示されています",
      safety: "黄色いブイに両手を乗せたフリーダイバー。白い WatchDive が手首にあります",
      tech: "プールの上に伸ばした手首の、黒い WatchDive",
      modes: "黄色いホースと黒いジャバラホースのそばで、ダイブベストに留めた WatchDive",
    },
    slides: slides(
      "データ",
      "リアルタイムの深度",
      "水温のモニタリング",
      "減圧停止の案内",
      "NDL",
      "安全",
      "安全停止アラート",
      "浮上速度アラート",
      "ディープストップアラート",
      "ダイブテック",
      "デジタルコンパス",
      "ナイトロックス（EANx）対応",
      "コンパスの方位マーカー",
      "モード",
      "スキューバモード",
      "フリーダイブモード",
      "バッテリー残量の警告",
    ),
  },
  es: {
    heading: { scuba: "Todo lo que tu inmersión necesita, en la muñeca.", freediving: "Todo lo que tu inmersión necesita, en la muñeca." },
    previous: "Función anterior",
    next: "Función siguiente",
    play: "Reproducir el avance automático",
    pause: "Pausar el avance automático",
    scopeLabel: "Modo scuba",
    trackLabel: "Diapositivas de funciones",
    carouselLabel: "carrusel",
    slideLabel: "diapositiva",
    position: "{current} de {total}",
    alt: {
      data: "WatchDive en una muñeca bajo el agua, con lecturas de inmersión en la pantalla",
      safety: "Las manos de un apneísta sobre una boya amarilla, con un WatchDive blanco en la muñeca",
      tech: "Un WatchDive negro en una muñeca extendida sobre la piscina",
      modes: "WatchDive sujeto a un chaleco de buceo, junto a un latiguillo amarillo y un latiguillo corrugado negro",
    },
    slides: slides(
      "Datos",
      "Seguimiento de profundidad en vivo",
      "Control de la temperatura del agua",
      "Guía de parada de descompresión",
      "NDL",
      "Seguridad",
      "Avisos de parada de seguridad",
      "Avisos de velocidad de ascenso",
      "Avisos de parada profunda",
      "Tecnología",
      "Brújula digital",
      "Soporte de Nitrox (EANx)",
      "Marcador de rumbo de la brújula",
      "Modos",
      "Modo scuba",
      "Modo apnea",
      "Aviso de batería baja",
    ),
  },
  fr: {
    heading: { scuba: "Tout ce qu’il faut pour plonger, au poignet.", freediving: "Tout ce qu’il faut pour plonger, au poignet." },
    previous: "Fonction précédente",
    next: "Fonction suivante",
    play: "Lire le défilement automatique",
    pause: "Mettre le défilement en pause",
    scopeLabel: "Mode scuba",
    trackLabel: "Diapositives des fonctions",
    carouselLabel: "carrousel",
    slideLabel: "diapositive",
    position: "{current} sur {total}",
    alt: {
      data: "WatchDive au poignet sous l’eau, avec les mesures de plongée à l’écran",
      safety: "Les mains d’un apnéiste sur une bouée jaune, avec un WatchDive blanc au poignet",
      tech: "Un WatchDive noir sur un poignet tendu au-dessus du bassin",
      modes: "WatchDive fixé sur un gilet de plongée, à côté d’un flexible jaune et d’un flexible annelé noir",
    },
    slides: slides(
      "Données",
      "Suivi de profondeur en direct",
      "Suivi de la température de l’eau",
      "Indication de palier de décompression",
      "NDL",
      "Sécurité",
      "Alertes de palier de sécurité",
      "Alertes de vitesse de remontée",
      "Alertes de palier profond",
      "Technique",
      "Compas numérique",
      "Prise en charge du Nitrox (EANx)",
      "Repère de cap du compas",
      "Modes",
      "Mode scuba",
      "Mode apnée",
      "Alerte de batterie faible",
    ),
  },
  de: {
    heading: { scuba: "Alles für deinen Tauchgang, am Handgelenk.", freediving: "Alles für deinen Tauchgang, am Handgelenk." },
    previous: "Vorherige Funktion",
    next: "Nächste Funktion",
    play: "Automatischen Wechsel starten",
    pause: "Automatischen Wechsel pausieren",
    scopeLabel: "Scuba-Modus",
    trackLabel: "Funktionsfolien",
    carouselLabel: "Karussell",
    slideLabel: "Folie",
    position: "{current} von {total}",
    alt: {
      data: "WatchDive am Handgelenk unter Wasser, mit Tauchwerten auf dem Display",
      safety: "Die Hände eines Apnoetauchers auf einer gelben Boje, mit weißem WatchDive am Handgelenk",
      tech: "Ein schwarzes WatchDive an einem ausgestreckten Handgelenk über dem Becken",
      modes: "WatchDive an einer Tauchweste, neben einem gelben Schlauch und einem schwarzen Faltenschlauch",
    },
    slides: slides(
      "Daten",
      "Live-Tiefenmessung",
      "Wassertemperatur",
      "Hinweis zum Dekompressionsstopp",
      "NDL",
      "Sicherheit",
      "Warnung zum Sicherheitsstopp",
      "Warnung zur Aufstiegsgeschwindigkeit",
      "Warnung zum Tiefenstopp",
      "Tauchtechnik",
      "Digitaler Kompass",
      "Unterstützung für Nitrox (EANx)",
      "Kompass-Peilmarke",
      "Modi",
      "Scuba-Modus",
      "Apnoe-Modus",
      "Warnung bei niedrigem Akku",
    ),
  },
  "pt-BR": {
    heading: { scuba: "Tudo o que o seu mergulho precisa, no pulso.", freediving: "Tudo o que o seu mergulho precisa, no pulso." },
    previous: "Função anterior",
    next: "Próxima função",
    play: "Reproduzir a troca automática",
    pause: "Pausar a troca automática",
    scopeLabel: "Modo scuba",
    trackLabel: "Slides de funções",
    carouselLabel: "carrossel",
    slideLabel: "slide",
    position: "{current} de {total}",
    alt: {
      data: "WatchDive no pulso debaixo d’água, com leituras de mergulho na tela",
      safety: "As mãos de um mergulhador em apneia numa boia amarela, com um WatchDive branco no pulso",
      tech: "Um WatchDive preto num pulso estendido sobre a piscina",
      modes: "WatchDive preso a um colete de mergulho, ao lado de uma mangueira amarela e de uma mangueira corrugada preta",
    },
    slides: slides(
      "Dados",
      "Profundidade ao vivo",
      "Monitoramento da temperatura da água",
      "Orientação de parada de descompressão",
      "NDL",
      "Segurança",
      "Alertas de parada de segurança",
      "Alertas de velocidade de subida",
      "Alertas de parada profunda",
      "Tecnologia",
      "Bússola digital",
      "Suporte a Nitrox (EANx)",
      "Marcador de rumo da bússola",
      "Modos",
      "Modo scuba",
      "Modo apneia",
      "Aviso de bateria baixa",
    ),
  },
  nl: {
    heading: { scuba: "Alles wat je duik nodig heeft, om je pols.", freediving: "Alles wat je duik nodig heeft, om je pols." },
    previous: "Vorige functie",
    next: "Volgende functie",
    play: "Automatisch doorschuiven afspelen",
    pause: "Automatisch doorschuiven pauzeren",
    scopeLabel: "Scubamodus",
    trackLabel: "Functiedia’s",
    carouselLabel: "carrousel",
    slideLabel: "dia",
    position: "{current} van {total}",
    alt: {
      data: "WatchDive om een pols onder water, met duikwaarden op het scherm",
      safety: "De handen van een freediver op een gele boei, met een witte WatchDive om de pols",
      tech: "Een zwarte WatchDive om een uitgestoken pols boven het bad",
      modes: "WatchDive vastgemaakt aan een duikvest, naast een gele slang en een zwarte geribbelde slang",
    },
    slides: slides(
      "Data",
      "Live diepte",
      "Watertemperatuur",
      "Advies voor de decompressiestop",
      "NDL",
      "Veiligheid",
      "Waarschuwing voor de veiligheidsstop",
      "Waarschuwing voor de stijgsnelheid",
      "Waarschuwing voor de dieptestop",
      "Duiktechniek",
      "Digitaal kompas",
      "Ondersteuning voor Nitrox (EANx)",
      "Kompaskoersmarkering",
      "Modi",
      "Scubamodus",
      "Freedivemodus",
      "Waarschuwing bij lage batterij",
    ),
  },
} satisfies Record<Locale, FeatureCarouselCopy>;

export function featureCarouselCopy(locale: Locale): FeatureCarouselCopy {
  return FEATURE_CAROUSEL_COPY[locale];
}

export function formatFeaturePosition(template: string, current: number, total: number): string {
  return template.replaceAll("{current}", String(current)).replaceAll("{total}", String(total));
}

/** Freediving names scuba-only procedures as scuba mode. The product page shows the owner line. */
export function featureLineText(lineItem: FeatureLine, segment: DiveSegment, scopeLabel: string): string {
  if (segment === "freediving" && lineItem.scope === "scuba") return `${lineItem.text} · ${scopeLabel}`;
  return lineItem.text;
}
