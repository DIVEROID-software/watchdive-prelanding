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
  clipError: string;
  pressKicker: string;
  pressTitle: string;
};

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
    galleryTitle: { scuba: "At the pool edge.", freediving: "On the yellow buoy." },
    galleryAlt: {
      scuba: ["Two divers at the pool edge, with a black WatchDive beside a fin"],
      freediving: ["A freediver on a yellow buoy, with time and depth on a white WatchDive"],
    },
    logStillAlt: "A phone open to the logbook, with a white WatchDive on the wrist",
    demoKicker: "On the product",
    demoTitle: "The housing and the app, up close.",
    seal: {
      title: "A seal check before the dive.",
      body: "Before the dive, the housing runs a pressure check and shows the result on the watch.",
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
    clipError: "This clip did not load. Press play to try again.",
    pressKicker: "In the press",
    pressTitle: "As featured on",
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
    galleryTitle: { scuba: "수영장 가장자리에서.", freediving: "노란 부표 위에서." },
    galleryAlt: {
      scuba: ["수영장 가장자리의 두 다이버. 손목의 검은 WatchDive와 핀이 보입니다"],
      freediving: ["노란 부표에 기댄 프리다이버. 흰색 WatchDive에 시간과 수심이 보입니다"],
    },
    logStillAlt: "로그북이 열린 휴대폰과 손목의 흰색 WatchDive",
    demoKicker: "제품 화면",
    demoTitle: "하우징과 앱을 가까이서.",
    seal: {
      title: "다이빙 전에 실링을 확인합니다.",
      body: "입수 전에 하우징이 압력을 확인하고, 그 결과를 워치 화면에 보여 줍니다.",
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
    clipError: "영상을 불러오지 못했습니다. 다시 눌러 주세요.",
    pressKicker: "보도",
    pressTitle: "미디어에 소개된 WatchDive",
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
    galleryTitle: { scuba: "在泳池边。", freediving: "在黄色浮标上。" },
    galleryAlt: {
      scuba: ["泳池边的两名潜水员，手腕上是黑色 WatchDive，旁边有脚蹼"],
      freediving: ["自由潜水员靠在黄色浮标上，白色 WatchDive 显示时间和深度"],
    },
    logStillAlt: "打开日志的手机，手腕上是白色 WatchDive",
    demoKicker: "产品画面",
    demoTitle: "近看外壳和应用。",
    seal: {
      title: "下水前做一次密封检查。",
      body: "下水前，外壳会做一次压力检查，并把结果显示在手表上。",
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
    clipError: "这段视频没有载入。请再按一次播放。",
    pressKicker: "报道",
    pressTitle: "媒体报道中的 WatchDive",
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
    galleryTitle: { scuba: "在泳池邊。", freediving: "在黃色浮標上。" },
    galleryAlt: {
      scuba: ["泳池邊的兩名潛水員，手腕上是黑色 WatchDive，旁邊有蛙鞋"],
      freediving: ["自由潛水員靠在黃色浮標上，白色 WatchDive 顯示時間和深度"],
    },
    logStillAlt: "打開日誌的手機，手腕上是白色 WatchDive",
    demoKicker: "產品畫面",
    demoTitle: "近看外殼和 app。",
    seal: {
      title: "下水前做一次密封檢查。",
      body: "下水前，外殼會做一次壓力檢查，並把結果顯示在手錶上。",
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
    clipError: "這段影片沒有載入。請再按一次播放。",
    pressKicker: "報導",
    pressTitle: "媒體報導中的 WatchDive",
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
    galleryTitle: { scuba: "プールの縁で。", freediving: "黄色いブイの上で。" },
    galleryAlt: {
      scuba: ["プールの縁にいる二人のダイバー。手首の黒いWatchDiveとフィンが見えます"],
      freediving: ["黄色いブイに寄りかかるフリーダイバー。白いWatchDiveに時間と水深が見えます"],
    },
    logStillAlt: "ログブックを開いたスマホと、手首の白いWatchDive",
    demoKicker: "製品の画面",
    demoTitle: "ハウジングとアプリを近くで。",
    seal: {
      title: "潜る前にシールを確認します。",
      body: "入水前にハウジングが圧力を確認し、その結果をウォッチに表示します。",
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
    clipError: "動画を読み込めませんでした。もう一度再生を押してください。",
    pressKicker: "掲載",
    pressTitle: "メディアで紹介されたWatchDive",
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
    galleryTitle: { scuba: "Al borde de la piscina.", freediving: "En la boya amarilla." },
    galleryAlt: {
      scuba: ["Dos buceadores al borde de la piscina, con un WatchDive negro junto a una aleta"],
      freediving: ["Un apneísta en una boya amarilla, con tiempo y profundidad en un WatchDive blanco"],
    },
    logStillAlt: "Un teléfono con el diario abierto y una WatchDive blanca en la muñeca",
    demoKicker: "En el producto",
    demoTitle: "La carcasa y la app, de cerca.",
    seal: {
      title: "Una comprobación de estanqueidad antes de bucear.",
      body: "Antes de bucear, la carcasa hace una comprobación de presión y muestra el resultado en el reloj.",
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
    clipError: "Este vídeo no se ha cargado. Pulsa reproducir para intentarlo de nuevo.",
    pressKicker: "En la prensa",
    pressTitle: "WatchDive en los medios",
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
    galleryTitle: { scuba: "Au bord du bassin.", freediving: "Sur la bouée jaune." },
    galleryAlt: {
      scuba: ["Deux plongeurs au bord du bassin, avec un WatchDive noir à côté d’une palme"],
      freediving: ["Un apnéiste sur une bouée jaune, temps et profondeur sur un WatchDive blanc"],
    },
    logStillAlt: "Un téléphone ouvert sur le carnet, avec un WatchDive blanc au poignet",
    demoKicker: "Sur le produit",
    demoTitle: "Le boîtier et l’app, de près.",
    seal: {
      title: "Un contrôle d’étanchéité avant la plongée.",
      body: "Avant la plongée, le boîtier lance un contrôle de pression et affiche le résultat sur la montre.",
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
    clipError: "Cette vidéo ne s’est pas chargée. Appuyez sur lecture pour réessayer.",
    pressKicker: "Dans la presse",
    pressTitle: "WatchDive dans les médias",
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
    galleryTitle: { scuba: "Am Beckenrand.", freediving: "An der gelben Boje." },
    galleryAlt: {
      scuba: ["Zwei Taucher am Beckenrand, mit einer schwarzen WatchDive neben einer Flosse"],
      freediving: ["Ein Apnoetaucher an einer gelben Boje, Zeit und Tiefe auf einer weißen WatchDive"],
    },
    logStillAlt: "Ein Telefon mit offenem Logbuch und eine weiße WatchDive am Handgelenk",
    demoKicker: "Am Produkt",
    demoTitle: "Gehäuse und App aus der Nähe.",
    seal: {
      title: "Eine Dichtigkeitsprüfung vor dem Tauchgang.",
      body: "Vor dem Tauchgang prüft das Gehäuse den Druck und zeigt das Ergebnis auf der Uhr.",
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
    clipError: "Dieser Clip wurde nicht geladen. Tippen Sie auf Wiedergabe und versuchen Sie es erneut.",
    pressKicker: "In der Presse",
    pressTitle: "Bekannt aus",
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
    galleryTitle: { scuba: "Na borda da piscina.", freediving: "Na boia amarela." },
    galleryAlt: {
      scuba: ["Dois mergulhadores na borda da piscina, com uma WatchDive preta ao lado de uma nadadeira"],
      freediving: ["Um apneísta numa boia amarela, com tempo e profundidade numa WatchDive branca"],
    },
    logStillAlt: "Um telefone aberto no diário e uma WatchDive branca no pulso",
    demoKicker: "No produto",
    demoTitle: "A caixa e o app, de perto.",
    seal: {
      title: "Uma checagem de vedação antes do mergulho.",
      body: "Antes do mergulho, a caixa faz uma checagem de pressão e mostra o resultado no relógio.",
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
    clipError: "Este clipe não carregou. Toque em reproduzir para tentar de novo.",
    pressKicker: "Na imprensa",
    pressTitle: "Como visto na imprensa",
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
    galleryTitle: { scuba: "Aan de rand van het bad.", freediving: "Bij de gele boei." },
    galleryAlt: {
      scuba: ["Twee duikers aan de rand van het bad, met een zwarte WatchDive naast een vin"],
      freediving: ["Een freediver bij een gele boei, met tijd en diepte op een witte WatchDive"],
    },
    logStillAlt: "Een telefoon met het logboek open en een witte WatchDive om de pols",
    demoKicker: "Op het product",
    demoTitle: "De behuizing en de app, van dichtbij.",
    seal: {
      title: "Een afdichtingscheck voor de duik.",
      body: "Voor de duik doet de behuizing een drukcheck en toont het resultaat op het horloge.",
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
    clipError: "Deze clip is niet geladen. Tik op afspelen om het opnieuw te proberen.",
    pressKicker: "In de pers",
    pressTitle: "WatchDive in de media",
  },
} satisfies Record<Locale, MediaCopy>;

export function mediaCopy(locale: Locale): MediaCopy {
  return MEDIA_COPY[locale];
}
