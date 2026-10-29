import type { ReservationLocale } from "./query.ts";
export const RESERVATION_PRESENTATION = {
  ko: {
    eyebrow: "지금 예약하고, 최저가를 내 것으로",
    feeLabel: "1회 예약금 · USD",
    reassurance: "추가 결제는 자동으로 청구되지 않습니다.",
    testMode: "테스트 결제 · 실제 청구 없음",
    consent: "약관에 동의하고 $3로 최저가를 확보합니다.",
    headline: "매일 차던 스마트워치,\n이제 바닷속에서도.",
    benefit: "선착순을 놓쳐도, 최저가는 놓치지 마세요.",
    description:
      "선착순 100명 안에 들 수 있을지 걱정되나요? 예약금 $3를 미리 결제하면, 선착순에 관계없이 출시 최저가 $149를 100% 보장해 드립니다.",
    cta: "$3로 내 최저가 확보하기",
    imageAlt:
      "WatchDive와 함께, 호환 스마트워치를 다이브 컴퓨터로. 수심·수온·무감압 시간 안내를 손목에서 확인하세요.",
  },
  en: {
    eyebrow: "Your lowest launch price, secured",
    feeLabel: "One-time reservation · USD",
    reassurance: "No automatic future charges.",
    testMode: "Test mode — no real charge",
    consent: "I agree to the terms and reserve my price for $3.",
    headline: "Your everyday smartwatch.\nNow, your dive companion.",
    benefit: "Miss the first 100. Keep the lowest price.",
    description:
      "Worried about missing the first 100? Pay the $3 reservation fee now to guarantee the lowest $149 launch price, 100%—regardless of your place in line.",
    cta: "Secure my price for $3",
    imageAlt:
      "Turn a compatible smartwatch into a dive computer with WatchDive. Depth, temperature and no-decompression time guidance, right on your wrist.",
  },
  ja: {
    eyebrow: "今予約して、発売最安値を確保",
    feeLabel: "1回限りの予約金 · USD",
    reassurance: "追加料金が自動請求されることはありません。",
    testMode: "テスト決済・実際の請求はありません",
    consent: "規約に同意し、$3で最安値を確保します。",
    headline: "いつものスマートウォッチを、\n水中でも。",
    benefit: "先着100名を逃しても、 最安値は逃さない。",
    description:
      "先着100名に入れるか不安ですか？予約金$3を先にお支払いいただくと、先着順に関係なく発売最安値$149を100%保証します。",
    cta: "$3で最安値を確保",
    imageAlt:
      "WatchDiveで、対応スマートウォッチをダイブコンピューターに。水深・水温・無減圧時間のガイダンスを手首で確認。",
  },
  "zh-CN": {
    eyebrow: "现在预约，锁定发布最低价",
    feeLabel: "一次性预约费 · USD",
    reassurance: "不会自动收取后续费用。",
    testMode: "测试付款 · 不会实际扣款",
    consent: "我同意条款，以$3锁定最低价。",
    headline: "每天戴的智能手表，\n现在也能陪你潜水。",
    benefit: "错过前100名， 不错过最低价。",
    description:
      "担心抢不到前100名？提前支付$3预约费，无论排名如何，都能100%保证$149的发布最低价。",
    cta: "$3锁定我的最低价",
    imageAlt: "搭配WatchDive，将兼容的智能手表变成潜水电脑。抬腕查看深度、水温和免减压时间提示。",
  },
  "zh-TW": {
    eyebrow: "現在預約，鎖定發表最低價",
    feeLabel: "一次性預約費 · USD",
    reassurance: "不會自動收取後續費用。",
    testMode: "測試付款 · 不會實際扣款",
    consent: "我同意條款，以$3鎖定最低價。",
    headline: "每天戴的智慧手錶，\n現在也能陪你潛水。",
    benefit: "錯過前100名， 不錯過最低價。",
    description:
      "擔心搶不到前100名？提前支付$3預約費，無論排名如何，都能100%保證$149的發表最低價。",
    cta: "$3鎖定我的最低價",
    imageAlt: "搭配WatchDive，將相容的智慧手錶變成潛水電腦。抬腕查看深度、水溫和免減壓時間提示。",
  },
  es: {
    eyebrow: "Asegura tu precio mínimo de lanzamiento",
    feeLabel: "Reserva única · USD",
    reassurance: "Sin cargos futuros automáticos.",
    testMode: "Modo de prueba — sin cargo real",
    consent: "Acepto las condiciones y reservo mi precio por $3.",
    headline: "Tu smartwatch de cada día.\nAhora, también bajo el agua.",
    benefit: "¿Fuera de los primeros 100? No pierdas el mejor precio.",
    description:
      "¿Te preocupa no estar entre los primeros 100? Paga $3 de reserva ahora y te garantizamos al 100% el precio mínimo de lanzamiento de $149, sin importar tu puesto.",
    cta: "Asegurar mi precio por $3",
    imageAlt:
      "Con WatchDive, convierte un smartwatch compatible en un ordenador de buceo. Consulta profundidad, temperatura y tiempo sin descompresión desde tu muñeca.",
  },
  fr: {
    eyebrow: "Votre prix de lancement le plus bas, garanti",
    feeLabel: "Réservation unique · USD",
    reassurance: "Aucun prélèvement futur automatique.",
    testMode: "Mode test — aucun débit réel",
    consent: "J’accepte les conditions et réserve mon prix pour 3 $.",
    headline: "Votre montre du quotidien.\nÀ vos côtés sous l’eau.",
    benefit: "Pas parmi les 100 premiers ? Gardez le prix le plus bas.",
    description:
      "Vous craignez de ne pas être parmi les 100 premiers ? Versez 3 $ de réservation maintenant : le prix de lancement le plus bas, 149 $, est garanti à 100 %, quel que soit votre rang.",
    cta: "Garantir mon prix pour 3 $",
    imageAlt:
      "Avec WatchDive, transformez une montre compatible en ordinateur de plongée. Profondeur, température et temps sans décompression à votre poignet.",
  },
  de: {
    eyebrow: "Jetzt den niedrigsten Startpreis sichern",
    feeLabel: "Einmalige Reservierung · USD",
    reassurance: "Keine automatischen Folgezahlungen.",
    testMode: "Testmodus — keine echte Abbuchung",
    consent: "Ich akzeptiere die Bedingungen und sichere meinen Preis für 3 $.",
    headline: "Ihre Smartwatch für jeden Tag.\nJetzt auch unter Wasser.",
    benefit: "Nicht unter den ersten 100? Den Bestpreis trotzdem sichern.",
    description:
      "Sorge, die ersten 100 zu verpassen? Zahlen Sie jetzt 3 $ Reservierungsgebühr. Damit garantieren wir Ihnen den niedrigsten Einführungspreis von 149 $ zu 100 % – unabhängig von Ihrem Platz.",
    cta: "Meinen Preis für 3 $ sichern",
    imageAlt:
      "WatchDive macht eine kompatible Smartwatch zum Tauchcomputer. Tiefe, Temperatur und Nullzeit direkt am Handgelenk im Blick.",
  },
  "pt-BR": {
    eyebrow: "Garanta o menor preço de lançamento",
    feeLabel: "Reserva única · USD",
    reassurance: "Sem cobranças futuras automáticas.",
    testMode: "Modo de teste — sem cobrança real",
    consent: "Aceito os termos e reservo meu preço por US$3.",
    headline: "Seu smartwatch de todos os dias.\nAgora, também debaixo d’água.",
    benefit: "Perdeu os primeiros 100? Não perca o menor preço.",
    description:
      "Receio de não estar entre os primeiros 100? Pague US$3 de reserva agora e garanta 100% o menor preço de lançamento de US$149, independentemente da sua posição.",
    cta: "Garantir meu preço por US$3",
    imageAlt:
      "Com WatchDive, transforme um smartwatch compatível em computador de mergulho. Profundidade, temperatura e tempo sem descompressão no seu pulso.",
  },
  nl: {
    eyebrow: "Jouw laagste lanceringsprijs, vastgezet",
    feeLabel: "Eenmalige reservering · USD",
    reassurance: "Geen automatische latere afschrijvingen.",
    testMode: "Testmodus — geen echte afschrijving",
    consent: "Ik ga akkoord met de voorwaarden en zet mijn prijs vast voor $3.",
    headline: "Je alledaagse smartwatch.\nNu ook je duikmaat.",
    benefit: "Mis de eerste 100. Houd de laagste prijs.",
    description:
      "Bang dat je de eerste 100 mist? Betaal nu de reserveringskosten van $3 en houd de laagste lanceringsprijs van $149, 100%, waar je ook in de rij staat.",
    cta: "Zet mijn prijs vast voor $3",
    imageAlt:
      "Maak van een compatibele smartwatch een duikcomputer met WatchDive. Diepte, temperatuur en tijd zonder decompressie, op je pols.",
  },
} as const satisfies Record<
  ReservationLocale,
  {
    eyebrow: string;
    feeLabel: string;
    reassurance: string;
    testMode: string;
    consent: string;
    headline: string;
    benefit: string;
    description: string;
    cta: string;
    imageAlt: string;
  }
>;
