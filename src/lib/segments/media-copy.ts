import type { Locale } from "../i18n/locale";
import type { DiveSegment } from "./copy";

/**
 * Captions for the 2026-11-03 media expansion.
 * Prices, offers, compatibility and the existing benefit sentences stay in their own catalogs.
 * Screen figures in the photographs are examples in the footage, not specifications.
 */
export type MediaCopy = {
  benefitAlt: Record<DiveSegment, [string, string, string]>;
  galleryTitle: Record<DiveSegment, string>;
  galleryAlt: Record<DiveSegment, string[]>;
  logStillAlt: string;
  demoKicker: string;
  demoTitle: string;
  seal: { title: string; body: string; alt: string };
  controls: { title: string; body: string; alt: string };
  logClip: { title: string; body: string; alt: string };
  pressKicker: string;
  pressTitle: string;
  pressNote: string;
  pressScubaDate: string;
  pressXrayDate: string;
};

const PRESS_SCUBA = "https://www.thescubanews.com/2026/11/01/diveroid-watchdive-smartwatch-dive-computer-2026/";
const PRESS_XRAY = "https://xray-mag.com/content/watchdive-puts-dive-data-smartwatches";

export const PRESS_LINKS = [
  { publisher: "The Scuba News", href: PRESS_SCUBA, published: "2026-11-01" },
  { publisher: "X-Ray Mag", href: PRESS_XRAY, published: "2026-10-19" },
] as const;

export const MEDIA_COPY = {
  en: {
    benefitAlt: {
      scuba: [
        "White WatchDive housing with a mask and fins",
        "Dive readings on WatchDive underwater",
        "WatchDive on a wrist underwater, with the heading on the screen",
      ],
      freediving: [
        "White WatchDive housing with a mask and fins",
        "Freediver on a yellow buoy, with dive time and depth on a white WatchDive",
        "Freediving profiles in the DIVEROID app",
      ],
    },
    galleryTitle: { scuba: "On the dive.", freediving: "At the pool edge." },
    galleryAlt: {
      scuba: ["Two divers at the surface, one wearing a white WatchDive"],
      freediving: ["WatchDive at the pool edge, with depth, time and temperature on the screen"],
    },
    logStillAlt: "A phone open to the logbook, with a white WatchDive on the wrist",
    demoKicker: "On the product",
    demoTitle: "The housing and the app, up close.",
    seal: {
      title: "A seal check before the dive.",
      body: "The watch can show a pressure check for the housing. A clear screen is not a guarantee. Look at the housing, then dive within your training and the conditions.",
      alt: "WatchDive housing during a seal check",
    },
    controls: {
      title: "Buttons on the housing.",
      body: "The housing has physical controls you can use in the water.",
      alt: "A hand using the control on the WatchDive housing",
    },
    logClip: {
      title: "The scuba profile, back in the app.",
      body: "After a scuba dive, the profile can be reviewed in the DIVEROID app.",
      alt: "A scuba dive profile open in the DIVEROID app beside a camera",
    },
    pressKicker: "In the press",
    pressTitle: "Coverage of the launch plan.",
    pressNote: "These reports describe WatchDive as it prepares to launch. They are not a product test or a certification.",
    pressScubaDate: "1 Nov 2026",
    pressXrayDate: "19 Oct 2026",
  },
  ko: {
    benefitAlt: {
      scuba: [
        "마스크와 핀 옆에 놓인 흰색 WatchDive 하우징",
        "수중에서 다이빙 정보가 켜진 WatchDive",
        "수중에서 손목에 찬 WatchDive. 화면에 방위가 보입니다",
      ],
      freediving: [
        "마스크와 핀 옆에 놓인 흰색 WatchDive 하우징",
        "노란 부표를 잡은 프리다이버. 흰색 WatchDive에 다이빙 시간과 수심이 보입니다",
        "DIVEROID 앱의 프리다이빙 프로필",
      ],
    },
    galleryTitle: { scuba: "물속과 수면에서.", freediving: "수영장 가장자리에서." },
    galleryAlt: {
      scuba: ["수면에서 흰색 WatchDive를 찬 다이버"],
      freediving: ["수영장 가장자리의 WatchDive. 화면에 수심, 시간, 수온이 보입니다"],
    },
    logStillAlt: "로그북이 열린 휴대폰과 손목의 흰색 WatchDive",
    demoKicker: "제품 화면",
    demoTitle: "하우징과 앱을 가까이서.",
    seal: {
      title: "다이빙 전에 실링을 확인합니다.",
      body: "워치에서 하우징의 압력 확인 결과를 볼 수 있습니다. 이상이 없다는 화면이 안전을 보장하지는 않습니다. 하우징을 직접 보고, 교육받은 범위와 그날의 조건 안에서 다이빙하세요.",
      alt: "실링 확인 중인 WatchDive 하우징",
    },
    controls: {
      title: "하우징의 버튼.",
      body: "물속에서는 하우징에 있는 버튼으로 조작합니다.",
      alt: "WatchDive 하우징의 버튼을 누르는 손",
    },
    logClip: {
      title: "스쿠버 기록이 앱으로 돌아옵니다.",
      body: "스쿠버다이빙 후 프로필을 DIVEROID 앱에서 다시 볼 수 있습니다.",
      alt: "카메라 옆에서 DIVEROID 앱에 열린 스쿠버 다이빙 프로필",
    },
    pressKicker: "보도",
    pressTitle: "출시 계획을 다룬 기사.",
    pressNote: "아래는 출시를 준비 중인 WatchDive를 소개한 보도입니다. 제품 시험이나 인증이 아닙니다.",
    pressScubaDate: "2026년 11월 1일",
    pressXrayDate: "2026년 10월 19일",
  },
  "zh-CN": {
    benefitAlt: {
      scuba: [
        "面镜和脚蹼旁的白色 WatchDive 外壳",
        "水下 WatchDive 上的潜水读数",
        "水下手腕上的 WatchDive，屏幕显示方位",
      ],
      freediving: [
        "面镜和脚蹼旁的白色 WatchDive 外壳",
        "自由潜水员扶着黄色浮标，白色 WatchDive 上显示潜水时间和深度",
        "DIVEROID 应用中的自由潜水曲线",
      ],
    },
    galleryTitle: { scuba: "下水的时候。", freediving: "在池边。" },
    galleryAlt: {
      scuba: ["水面上一名戴着白色 WatchDive 的潜水员"],
      freediving: ["池边的 WatchDive，屏幕上有深度、时间和水温"],
    },
    logStillAlt: "打开日志的手机，手腕上是白色 WatchDive",
    demoKicker: "产品画面",
    demoTitle: "近看外壳和应用。",
    seal: {
      title: "下水前做一次密封检查。",
      body: "手表可以显示外壳的压力检查结果。画面显示正常，并不等于安全保证。请亲自查看外壳，并在自己的训练范围和当天条件下潜水。",
      alt: "正在做密封检查的 WatchDive 外壳",
    },
    controls: {
      title: "外壳上的按钮。",
      body: "在水中可以用外壳上的实体按钮操作。",
      alt: "手按在 WatchDive 外壳的按钮上",
    },
    logClip: {
      title: "水肺潜水曲线回到应用里。",
      body: "一次水肺潜水之后，可以在 DIVEROID 应用中回看曲线。",
      alt: "相机旁，DIVEROID 应用中打开的水肺潜水曲线",
    },
    pressKicker: "报道",
    pressTitle: "关于发布计划的报道。",
    pressNote: "这些报道介绍的是准备发布的 WatchDive。它们不是产品测试，也不是认证。",
    pressScubaDate: "2026年11月1日",
    pressXrayDate: "2026年10月19日",
  },
  "zh-TW": {
    benefitAlt: {
      scuba: [
        "面鏡和蛙鞋旁的白色 WatchDive 外殼",
        "水下 WatchDive 上的潛水讀數",
        "水下手腕上的 WatchDive，畫面顯示方位",
      ],
      freediving: [
        "面鏡和蛙鞋旁的白色 WatchDive 外殼",
        "自由潛水員扶著黃色浮標，白色 WatchDive 上顯示潛水時間和深度",
        "DIVEROID app 裡的自由潛水曲線",
      ],
    },
    galleryTitle: { scuba: "下水的時候。", freediving: "在池邊。" },
    galleryAlt: {
      scuba: ["水面上一名戴著白色 WatchDive 的潛水員"],
      freediving: ["池邊的 WatchDive，畫面上有深度、時間和水溫"],
    },
    logStillAlt: "打開日誌的手機，手腕上是白色 WatchDive",
    demoKicker: "產品畫面",
    demoTitle: "近看外殼和 app。",
    seal: {
      title: "下水前做一次密封檢查。",
      body: "手錶可以顯示外殼的壓力檢查結果。畫面顯示正常，並不是安全保證。請親自查看外殼，並在自己的訓練範圍和當天條件下潛水。",
      alt: "正在做密封檢查的 WatchDive 外殼",
    },
    controls: {
      title: "外殼上的按鈕。",
      body: "在水中可以用外殼上的實體按鈕操作。",
      alt: "手按在 WatchDive 外殼的按鈕上",
    },
    logClip: {
      title: "水肺潛水曲線回到 app。",
      body: "一次水肺潛水之後，可以在 DIVEROID app 裡回看曲線。",
      alt: "相機旁，DIVEROID app 中打開的水肺潛水曲線",
    },
    pressKicker: "報導",
    pressTitle: "關於上市計畫的報導。",
    pressNote: "這些報導介紹的是準備上市的 WatchDive。它們不是產品測試，也不是認證。",
    pressScubaDate: "2026年11月1日",
    pressXrayDate: "2026年10月19日",
  },
  ja: {
    benefitAlt: {
      scuba: [
        "マスクとフィンのそばに置いた白いWatchDiveハウジング",
        "水中でダイブ情報が表示されたWatchDive",
        "水中の手首につけたWatchDive。画面に方位が見えます",
      ],
      freediving: [
        "マスクとフィンのそばに置いた白いWatchDiveハウジング",
        "黄色いブイにつかまると、白いWatchDiveにダイブタイムと水深が見えます",
        "DIVEROIDアプリのフリーダイビングプロフィール",
      ],
    },
    galleryTitle: { scuba: "潜っているとき。", freediving: "プールの縁で。" },
    galleryAlt: {
      scuba: ["水面で白いWatchDiveを着けたダイバー"],
      freediving: ["プールの縁のWatchDive。画面に水深、時間、水温が見えます"],
    },
    logStillAlt: "ログブックを開いたスマホと、手首の白いWatchDive",
    demoKicker: "製品の画面",
    demoTitle: "ハウジングとアプリを近くで。",
    seal: {
      title: "潜る前にシールを確認します。",
      body: "ウォッチに、ハウジングの圧力チェック結果を表示できます。問題なしと出ても、安全を保証するものではありません。ハウジングを自分で見て、受けたトレーニングと当日の条件の範囲で潜ってください。",
      alt: "シールチェック中のWatchDiveハウジング",
    },
    controls: {
      title: "ハウジングのボタン。",
      body: "水中では、ハウジングの物理ボタンで操作します。",
      alt: "WatchDiveハウジングのボタンに手を添える",
    },
    logClip: {
      title: "スクーバの記録がアプリに戻ります。",
      body: "スクーバダイビングのあと、プロフィールをDIVEROIDアプリで見返せます。",
      alt: "カメラの横で、DIVEROIDアプリに開いたスクーバのダイブプロフィール",
    },
    pressKicker: "掲載",
    pressTitle: "発売計画についての記事。",
    pressNote: "これらの記事は、発売を準備しているWatchDiveを伝えたものです。製品テストや認証ではありません。",
    pressScubaDate: "2026年11月1日",
    pressXrayDate: "2026年10月19日",
  },
  es: {
    benefitAlt: {
      scuba: [
        "Carcasa blanca de WatchDive junto a una máscara y unas aletas",
        "Lecturas de buceo en WatchDive bajo el agua",
        "WatchDive en una muñeca bajo el agua, con el rumbo en la pantalla",
      ],
      freediving: [
        "Carcasa blanca de WatchDive junto a una máscara y unas aletas",
        "Apneísta en una boya amarilla, con tiempo y profundidad en un WatchDive blanco",
        "Perfiles de apnea en la app DIVEROID",
      ],
    },
    galleryTitle: { scuba: "En el agua.", freediving: "Al borde de la piscina." },
    galleryAlt: {
      scuba: ["Dos buceadores en superficie; uno lleva un WatchDive blanco"],
      freediving: ["WatchDive al borde de la piscina, con profundidad, tiempo y temperatura en la pantalla"],
    },
    logStillAlt: "Un teléfono con el diario abierto y una WatchDive blanca en la muñeca",
    demoKicker: "En el producto",
    demoTitle: "La carcasa y la app, de cerca.",
    seal: {
      title: "Una comprobación de estanqueidad antes de bucear.",
      body: "El reloj puede mostrar una comprobación de presión de la carcasa. Una pantalla despejada no es una garantía. Revisa la carcasa y bucea dentro de tu formación y de las condiciones.",
      alt: "Carcasa WatchDive durante una comprobación de estanqueidad",
    },
    controls: {
      title: "Botones en la carcasa.",
      body: "La carcasa tiene controles físicos para usarlos en el agua.",
      alt: "Una mano en el control de la carcasa WatchDive",
    },
    logClip: {
      title: "El perfil de scuba, de vuelta en la app.",
      body: "Después de un buceo con scuba, el perfil se puede revisar en la app DIVEROID.",
      alt: "Un perfil de scuba abierto en la app DIVEROID, junto a una cámara",
    },
    pressKicker: "En la prensa",
    pressTitle: "Cobertura del plan de lanzamiento.",
    pressNote: "Estas notas cuentan WatchDive mientras se prepara el lanzamiento. No son una prueba del producto ni una certificación.",
    pressScubaDate: "1 nov 2026",
    pressXrayDate: "19 oct 2026",
  },
  fr: {
    benefitAlt: {
      scuba: [
        "Boîtier WatchDive blanc à côté d’un masque et de palmes",
        "Relevés de plongée sur WatchDive sous l’eau",
        "WatchDive au poignet sous l’eau, avec le cap à l’écran",
      ],
      freediving: [
        "Boîtier WatchDive blanc à côté d’un masque et de palmes",
        "Apnéiste sur une bouée jaune, temps et profondeur affichés sur un WatchDive blanc",
        "Profils d’apnée dans l’app DIVEROID",
      ],
    },
    galleryTitle: { scuba: "Dans l’eau.", freediving: "Au bord du bassin." },
    galleryAlt: {
      scuba: ["Deux plongeurs en surface, l’un porte un WatchDive blanc"],
      freediving: ["WatchDive au bord du bassin, avec profondeur, temps et température à l’écran"],
    },
    logStillAlt: "Un téléphone ouvert sur le carnet, avec un WatchDive blanc au poignet",
    demoKicker: "Sur le produit",
    demoTitle: "Le boîtier et l’app, de près.",
    seal: {
      title: "Un contrôle d’étanchéité avant la plongée.",
      body: "La montre peut afficher un contrôle de pression du boîtier. Un écran sans alerte n’est pas une garantie. Regardez le boîtier, puis plongez dans le cadre de votre formation et des conditions.",
      alt: "Boîtier WatchDive pendant un contrôle d’étanchéité",
    },
    controls: {
      title: "Des boutons sur le boîtier.",
      body: "Le boîtier a des commandes physiques utilisables dans l’eau.",
      alt: "Une main sur la commande du boîtier WatchDive",
    },
    logClip: {
      title: "Le profil scuba, de retour dans l’app.",
      body: "Après une plongée scuba, le profil peut se revoir dans l’app DIVEROID.",
      alt: "Un profil de plongée scuba ouvert dans l’app DIVEROID, à côté d’une caméra",
    },
    pressKicker: "Dans la presse",
    pressTitle: "Des articles sur le projet de lancement.",
    pressNote: "Ces articles présentent WatchDive pendant la préparation du lancement. Ce n’est ni un essai du produit ni une certification.",
    pressScubaDate: "1 nov. 2026",
    pressXrayDate: "19 oct. 2026",
  },
  de: {
    benefitAlt: {
      scuba: [
        "Weißes WatchDive-Gehäuse neben Maske und Flossen",
        "Tauchanzeige auf der WatchDive unter Wasser",
        "WatchDive am Handgelenk unter Wasser, mit dem Kurs auf dem Bildschirm",
      ],
      freediving: [
        "Weißes WatchDive-Gehäuse neben Maske und Flossen",
        "Apnoetaucher an einer gelben Boje, Tauchzeit und Tiefe auf einer weißen WatchDive",
        "Apnoe-Profile in der DIVEROID-App",
      ],
    },
    galleryTitle: { scuba: "Im Wasser.", freediving: "Am Beckenrand." },
    galleryAlt: {
      scuba: ["Zwei Taucher an der Oberfläche, einer trägt eine weiße WatchDive"],
      freediving: ["WatchDive am Beckenrand, mit Tiefe, Zeit und Temperatur auf dem Bildschirm"],
    },
    logStillAlt: "Ein Telefon mit offenem Logbuch und eine weiße WatchDive am Handgelenk",
    demoKicker: "Am Produkt",
    demoTitle: "Gehäuse und App aus der Nähe.",
    seal: {
      title: "Eine Dichtigkeitsprüfung vor dem Tauchgang.",
      body: "Die Uhr kann eine Druckprüfung für das Gehäuse anzeigen. Eine freie Anzeige ist keine Garantie. Schauen Sie das Gehäuse an und tauchen Sie innerhalb Ihrer Ausbildung und der Bedingungen.",
      alt: "WatchDive-Gehäuse bei einer Dichtigkeitsprüfung",
    },
    controls: {
      title: "Tasten am Gehäuse.",
      body: "Das Gehäuse hat physische Bedienelemente fürs Wasser.",
      alt: "Eine Hand an der Taste des WatchDive-Gehäuses",
    },
    logClip: {
      title: "Das Scuba-Profil, zurück in der App.",
      body: "Nach einem Gerätetauchgang lässt sich das Profil in der DIVEROID-App ansehen.",
      alt: "Ein Scuba-Tauchprofil in der DIVEROID-App neben einer Kamera",
    },
    pressKicker: "In der Presse",
    pressTitle: "Berichte über den Startplan.",
    pressNote: "Diese Beiträge beschreiben WatchDive während der Startvorbereitung. Sie sind kein Produkttest und keine Zertifizierung.",
    pressScubaDate: "1. Nov. 2026",
    pressXrayDate: "19. Okt. 2026",
  },
  "pt-BR": {
    benefitAlt: {
      scuba: [
        "Caixa branca da WatchDive ao lado de uma máscara e nadadeiras",
        "Leituras de mergulho na WatchDive embaixo d’água",
        "WatchDive no pulso embaixo d’água, com o rumo na tela",
      ],
      freediving: [
        "Caixa branca da WatchDive ao lado de uma máscara e nadadeiras",
        "Apneísta numa boia amarela, com tempo e profundidade numa WatchDive branca",
        "Perfis de apneia no app DIVEROID",
      ],
    },
    galleryTitle: { scuba: "Na água.", freediving: "Na borda da piscina." },
    galleryAlt: {
      scuba: ["Dois mergulhadores na superfície; um usa uma WatchDive branca"],
      freediving: ["WatchDive na borda da piscina, com profundidade, tempo e temperatura na tela"],
    },
    logStillAlt: "Um telefone aberto no diário e uma WatchDive branca no pulso",
    demoKicker: "No produto",
    demoTitle: "A caixa e o app, de perto.",
    seal: {
      title: "Uma checagem de vedação antes do mergulho.",
      body: "O relógio pode mostrar uma checagem de pressão da caixa. Uma tela limpa não é garantia. Olhe a caixa e mergulhe dentro do seu treinamento e das condições.",
      alt: "Caixa WatchDive durante uma checagem de vedação",
    },
    controls: {
      title: "Botões na caixa.",
      body: "A caixa tem controles físicos para usar na água.",
      alt: "Uma mão no controle da caixa WatchDive",
    },
    logClip: {
      title: "O perfil de scuba, de volta no app.",
      body: "Depois de um mergulho scuba, o perfil pode ser revisto no app DIVEROID.",
      alt: "Um perfil de scuba aberto no app DIVEROID, ao lado de uma câmera",
    },
    pressKicker: "Na imprensa",
    pressTitle: "Cobertura do plano de lançamento.",
    pressNote: "Estas reportagens descrevem a WatchDive enquanto o lançamento é preparado. Não são um teste do produto nem uma certificação.",
    pressScubaDate: "1 nov 2026",
    pressXrayDate: "19 out 2026",
  },
  nl: {
    benefitAlt: {
      scuba: [
        "Witte WatchDive-behuizing naast een masker en vinnen",
        "Duikgegevens op WatchDive onder water",
        "WatchDive om de pols onder water, met de koers op het scherm",
      ],
      freediving: [
        "Witte WatchDive-behuizing naast een masker en vinnen",
        "Freediver bij een gele boei, met duiktijd en diepte op een witte WatchDive",
        "Freediveprofielen in de DIVEROID-app",
      ],
    },
    galleryTitle: { scuba: "In het water.", freediving: "Aan de rand van het bad." },
    galleryAlt: {
      scuba: ["Twee duikers aan de oppervlakte, een draagt een witte WatchDive"],
      freediving: ["WatchDive aan de rand van het bad, met diepte, tijd en temperatuur op het scherm"],
    },
    logStillAlt: "Een telefoon met het logboek open en een witte WatchDive om de pols",
    demoKicker: "Op het product",
    demoTitle: "De behuizing en de app, van dichtbij.",
    seal: {
      title: "Een afdichtingscheck voor de duik.",
      body: "Het horloge kan een drukcheck van de behuizing tonen. Een scherm zonder waarschuwing is geen garantie. Bekijk de behuizing en duik binnen je opleiding en de omstandigheden.",
      alt: "WatchDive-behuizing tijdens een afdichtingscheck",
    },
    controls: {
      title: "Knoppen op de behuizing.",
      body: "De behuizing heeft fysieke knoppen voor gebruik in het water.",
      alt: "Een hand op de knop van de WatchDive-behuizing",
    },
    logClip: {
      title: "Het scubaprofiel, terug in de app.",
      body: "Na een scubaduik kun je het profiel terugzien in de DIVEROID-app.",
      alt: "Een scubaduikprofiel in de DIVEROID-app naast een camera",
    },
    pressKicker: "In de pers",
    pressTitle: "Berichtgeving over het lanceerplan.",
    pressNote: "Deze stukken beschrijven WatchDive terwijl de lancering wordt voorbereid. Het is geen producttest en geen certificering.",
    pressScubaDate: "1 nov 2026",
    pressXrayDate: "19 okt 2026",
  },
} satisfies Record<Locale, MediaCopy>;

export function mediaCopy(locale: Locale): MediaCopy {
  return MEDIA_COPY[locale];
}
