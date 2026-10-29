import type { Locale } from "../i18n/locale.ts";
export type DripCopy = { subject: string; preheader: string; headline: string; sentence1: string; sentence2: string };
type Followups = Record<"d1" | "d3" | "d7", DripCopy>;
/** DRAFT. One benefit, two sentences. The shared $3 button and fee line come from D0.
 * No countdown, remaining count, or closing date. Send still needs an exact approval hash. */
export const DRIP_COPY: Record<Locale, Followups> = {
  "ko": {
    "d1": {
      "subject": "매일 차는 시계로, 다음 다이빙까지",
      "preheader": "추가 구독 없이 만나는 WatchDive.",
      "headline": "내 시계를 다이브 컴퓨터로.",
      "sentence1": "호환되는 스마트워치를 WatchDive에 장착하면 다이브 컴퓨터가 됩니다.",
      "sentence2": "추가 구독 없이, 익숙한 시계로 다음 다이빙을 준비하세요."
    },
    "d3": {
      "subject": "$149 다음은 $200. 내 가격은 미리 보장하세요",
      "preheader": "지금 $3로 예약하면 선착순과 관계없이 $149.",
      "headline": "다음은 $200. 내 출시가는 $149.",
      "sentence1": "선착순 100명 혜택이 끝나면 WatchDive 가격은 $200으로 바뀝니다.",
      "sentence2": "지금 $3로 예약하면, 순서와 관계없이 $149를 보장받을 수 있어요."
    },
    "d7": {
      "subject": "다음 다이빙, WatchDive와 함께해요",
      "preheader": "$3로 출시 최저가 $149를 보장받으세요.",
      "headline": "다음 다이빙을 준비하며, 가격은 $149로.",
      "sentence1": "WatchDive가 마음에 남았다면, 지금 $3로 출시 최저가를 보장받으세요.",
      "sentence2": "선착순 순서와 관계없이 $149로 만나보실 수 있어요."
    }
  },
  "en": {
    "d1": {
      "subject": "Your everyday watch. Your next dive.",
      "preheader": "Dive-computer features, without another subscription.",
      "headline": "Your watch. A dive computer.",
      "sentence1": "Fit your compatible smartwatch into WatchDive and turn it into a dive computer.",
      "sentence2": "No extra subscription—just the watch you know, ready for your next dive."
    },
    "d3": {
      "subject": "First $149. Then $200. Keep your price.",
      "preheader": "A $3 reservation keeps your launch price at $149.",
      "headline": "Next price: $200. Your price: $149.",
      "sentence1": "After the first 100 Kickstarter backers, WatchDive moves to $200.",
      "sentence2": "Reserve for $3 and keep $149, wherever you are in line."
    },
    "d7": {
      "subject": "Ready for your next dive?",
      "preheader": "Reserve for $3 and keep the lowest launch price.",
      "headline": "Your next dive. Your $149 price.",
      "sentence1": "Still thinking about WatchDive? Reserve for $3 and keep the lowest launch price.",
      "sentence2": "You get $149, wherever you are in line."
    }
  },
  "ja": {
    "d1": {
      "subject": "いつもの時計で、次のダイビングへ",
      "preheader": "追加サブスクなしで使えるダイブコンピューター。",
      "headline": "いつもの時計をダイブコンピューターに。",
      "sentence1": "対応するスマートウォッチをWatchDiveに装着すると、ダイブコンピューターとして使えます。",
      "sentence2": "追加のサブスクリプションなしで、使い慣れた時計と次のダイビングへ。"
    },
    "d3": {
      "subject": "$149の次は$200。今のうちに価格を確保",
      "preheader": "$3で予約すれば、先着順に関係なく$149。",
      "headline": "次は$200。あなたの発売価格は$149。",
      "sentence1": "先着100名の特典が終了すると、WatchDiveは$200になります。",
      "sentence2": "今$3で予約しておけば、先着順に関係なく$149を保証します。"
    },
    "d7": {
      "subject": "次のダイビングを、WatchDiveと",
      "preheader": "$3で発売最安値$149を確保。",
      "headline": "次のダイビングに、$149のWatchDiveを。",
      "sentence1": "WatchDiveが気になっていたら、今$3で発売最安値を確保しませんか。",
      "sentence2": "先着順に関係なく、$149でお迎えいただけます。"
    }
  },
  "zh-CN": {
    "d1": {
      "subject": "戴着熟悉的手表，去下一次潜水",
      "preheader": "潜水电脑功能，无需额外订阅。",
      "headline": "让你的手表成为潜水电脑。",
      "sentence1": "把兼容的智能手表装入WatchDive，就能变成潜水电脑。",
      "sentence2": "无需额外订阅，带上熟悉的手表，准备下一次潜水。"
    },
    "d3": {
      "subject": "$149之后是$200，现在锁定你的价格",
      "preheader": "付$3预约，无需抢前100名，也享$149。",
      "headline": "下一档$200，你的发布价$149。",
      "sentence1": "前100名优惠结束后，WatchDive的价格将变为$200。",
      "sentence2": "现在付$3预约，无论排在第几名，都能锁定$149。"
    },
    "d7": {
      "subject": "下一次潜水，带上WatchDive",
      "preheader": "付$3锁定$149发布最低价。",
      "headline": "准备下一次潜水，也锁定$149。",
      "sentence1": "还在想着WatchDive？现在付$3，就能锁定发布最低价。",
      "sentence2": "无论排在第几名，你都能以$149购买。"
    }
  },
  "zh-TW": {
    "d1": {
      "subject": "戴著熟悉的手錶，去下一次潛水",
      "preheader": "潛水電腦功能，無需額外訂閱。",
      "headline": "讓你的手錶成為潛水電腦。",
      "sentence1": "將相容的智慧手錶裝入WatchDive，就能變成潛水電腦。",
      "sentence2": "無需額外訂閱，帶上熟悉的手錶，準備下一次潛水。"
    },
    "d3": {
      "subject": "$149之後是$200，現在鎖定你的價格",
      "preheader": "付$3預約，不必搶前100名，也享$149。",
      "headline": "下一階段$200，你的上市價$149。",
      "sentence1": "前100名優惠結束後，WatchDive的價格將變為$200。",
      "sentence2": "現在付$3預約，無論排在第幾名，都能鎖定$149。"
    },
    "d7": {
      "subject": "下一次潛水，帶上WatchDive",
      "preheader": "付$3鎖定$149上市最低價。",
      "headline": "準備下一次潛水，也鎖定$149。",
      "sentence1": "還在想著WatchDive？現在付$3，就能鎖定上市最低價。",
      "sentence2": "無論排在第幾名，你都能以$149購買。"
    }
  },
  "es": {
    "d1": {
      "subject": "Tu reloj de siempre. Tu próxima inmersión.",
      "preheader": "Funciones de ordenador de buceo sin otra suscripción.",
      "headline": "Tu reloj, ahora un ordenador de buceo.",
      "sentence1": "Coloca tu smartwatch compatible en WatchDive y conviértelo en un ordenador de buceo.",
      "sentence2": "Sin suscripciones adicionales: prepara tu próxima inmersión con el reloj que ya conoces."
    },
    "d3": {
      "subject": "Primero $149. Después $200. Asegura tu precio.",
      "preheader": "Una reserva de $3 mantiene tu precio en $149.",
      "headline": "El siguiente precio: $200. El tuyo: $149.",
      "sentence1": "Después de los primeros 100 patrocinadores, WatchDive costará $200.",
      "sentence2": "Reserva ahora por $3 y conserva los $149, sin importar tu turno."
    },
    "d7": {
      "subject": "¿Preparando tu próxima inmersión?",
      "preheader": "Reserva por $3 y asegura el precio mínimo de lanzamiento.",
      "headline": "Tu próxima inmersión. Tu precio de $149.",
      "sentence1": "¿Sigues pensando en WatchDive? Reserva por $3 y asegura el precio mínimo de lanzamiento.",
      "sentence2": "Pagarás $149, sin importar tu turno."
    }
  },
  "fr": {
    "d1": {
      "subject": "Votre montre au quotidien. Votre prochaine plongée.",
      "preheader": "Un ordinateur de plongée, sans abonnement supplémentaire.",
      "headline": "Votre montre devient un ordinateur de plongée.",
      "sentence1": "Installez votre montre connectée compatible dans WatchDive pour en faire un ordinateur de plongée.",
      "sentence2": "Sans abonnement supplémentaire, préparez votre prochaine plongée avec la montre que vous connaissez."
    },
    "d3": {
      "subject": "D’abord 149 $, puis 200 $. Gardez votre prix.",
      "preheader": "Une réservation de 3 $ vous garantit le prix de 149 $.",
      "headline": "Le prochain prix : 200 $. Le vôtre : 149 $.",
      "sentence1": "Après les 100 premiers contributeurs, WatchDive passe à 200 $.",
      "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place."
    },
    "d7": {
      "subject": "Prêt pour votre prochaine plongée ?",
      "preheader": "Réservez pour 3 $ et gardez le prix de lancement le plus bas.",
      "headline": "Votre prochaine plongée. Votre prix de 149 $.",
      "sentence1": "Vous pensez encore à WatchDive ? Réservez pour 3 $ et garantissez le prix de lancement le plus bas.",
      "sentence2": "Ce sera 149 $ pour vous, quelle que soit votre place."
    }
  },
  "de": {
    "d1": {
      "subject": "Deine Alltagsuhr. Dein nächster Tauchgang.",
      "preheader": "Tauchcomputer-Funktionen ohne zusätzliches Abo.",
      "headline": "Deine Uhr wird zum Tauchcomputer.",
      "sentence1": "Setze deine kompatible Smartwatch in WatchDive ein und mache sie zum Tauchcomputer.",
      "sentence2": "Ohne zusätzliches Abo: Bereite deinen nächsten Tauchgang mit der Uhr vor, die du schon kennst."
    },
    "d3": {
      "subject": "Erst $149, dann $200. Sichere dir deinen Preis.",
      "preheader": "Mit einer Reservierung für $3 bleibt dein Startpreis bei $149.",
      "headline": "Der nächste Preis: $200. Deiner: $149.",
      "sentence1": "Nach den ersten 100 Unterstützern steigt der Preis für WatchDive auf $200.",
      "sentence2": "Reserviere jetzt für $3 und behalte den Preis von $149 – unabhängig von der Reihenfolge."
    },
    "d7": {
      "subject": "Bereit für deinen nächsten Tauchgang?",
      "preheader": "Reserviere für $3 und sichere dir den niedrigsten Startpreis.",
      "headline": "Dein nächster Tauchgang. Dein Preis von $149.",
      "sentence1": "Denkst du noch an WatchDive? Reserviere für $3 und sichere dir den niedrigsten Startpreis.",
      "sentence2": "Dein Preis beträgt $149 – unabhängig von der Reihenfolge."
    }
  },
  "pt-BR": {
    "d1": {
      "subject": "Seu relógio de sempre. Seu próximo mergulho.",
      "preheader": "Funções de computador de mergulho sem outra assinatura.",
      "headline": "Seu relógio vira um computador de mergulho.",
      "sentence1": "Coloque seu smartwatch compatível no WatchDive e transforme-o em um computador de mergulho.",
      "sentence2": "Sem assinatura extra: prepare seu próximo mergulho com o relógio que você já conhece."
    },
    "d3": {
      "subject": "Primeiro $149, depois $200. Garanta seu preço.",
      "preheader": "Uma reserva de $3 mantém seu preço de lançamento em $149.",
      "headline": "Próximo preço: $200. O seu: $149.",
      "sentence1": "Depois dos primeiros 100 apoiadores, o WatchDive passa a custar $200.",
      "sentence2": "Reserve agora por $3 e mantenha os $149, independentemente da sua posição."
    },
    "d7": {
      "subject": "Tudo pronto para o próximo mergulho?",
      "preheader": "Reserve por $3 e garanta o menor preço de lançamento.",
      "headline": "Seu próximo mergulho. Seu preço de $149.",
      "sentence1": "Ainda pensando no WatchDive? Reserve por $3 e garanta o menor preço de lançamento.",
      "sentence2": "Você paga $149, independentemente da sua posição."
    }
  },
  "nl": {
    "d1": {
      "subject": "Je alledaagse horloge. Je volgende duik.",
      "preheader": "Functies van een duikcomputer, zonder extra abonnement.",
      "headline": "Je horloge. Een duikcomputer.",
      "sentence1": "Klik je compatibele smartwatch in WatchDive en maak er een duikcomputer van.",
      "sentence2": "Geen extra abonnement: alleen het horloge dat je kent, klaar voor je volgende duik."
    },
    "d3": {
      "subject": "Eerst $149. Daarna $200. Houd je prijs.",
      "preheader": "Een reservering van $3 houdt je lanceringsprijs op $149.",
      "headline": "Volgende prijs: $200. Jouw prijs: $149.",
      "sentence1": "Na de eerste 100 op Kickstarter gaat WatchDive naar $200.",
      "sentence2": "Reserveer voor $3 en houd $149, waar je ook in de rij staat."
    },
    "d7": {
      "subject": "Klaar voor je volgende duik?",
      "preheader": "Reserveer voor $3 en houd de laagste lanceringsprijs.",
      "headline": "Je volgende duik. Jouw prijs van $149.",
      "sentence1": "Denk je nog aan WatchDive? Reserveer voor $3 en houd de laagste lanceringsprijs.",
      "sentence2": "Je krijgt $149, waar je ook in de rij staat."
    }
  }
};
