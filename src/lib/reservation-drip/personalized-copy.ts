// Segmented D0–D7 drafts. One paid button still comes from the D0 reservation copy.
// Checkout fee, deduction, refund and statutory lines stay out of these fields.
// Signups keep coming in. No daily rate, count, sell-out, or deadline.
import type { Locale } from "../i18n/locale.ts";
import type { DripStage } from "./policy.ts";
import { isReservationEmailSegment, type ReservationEmailSegment } from "./media.ts";

export type PersonalizedStageCopy = {
  subject: string;
  preheader: string;
  headline: string;
  sentence1: string;
  sentence2: string;
  eyebrow: string;
  chip: string;
  imageAlt: string;
};

type Stages = Record<DripStage, PersonalizedStageCopy>;
type ByLocale = Record<Locale, Stages>;

export const PERSONALIZED_COPY: Record<ReservationEmailSegment, ByLocale> = {
  "general": {
    "en": {
      "d0": {
        "subject": "Reserve for $3. Lock in the $149 launch price.",
        "preheader": "The first 100 pay $149. After that, WatchDive is $200.",
        "headline": "Reserve for $3. Lock in the $149 launch price.",
        "sentence1": "Fit a compatible smartwatch into WatchDive and dive with the watch you already own.",
        "sentence2": "The first 100 pay $149. After that, the price is $200.",
        "eyebrow": "$149 launch price",
        "chip": "One $3 reservation",
        "imageAlt": "Hands fitting the clear WatchDive housing onto a watch."
      },
      "d1": {
        "subject": "Your watch can be the dive computer.",
        "preheader": "Depth and temperature on your wrist, then a logbook in the app.",
        "headline": "A dive computer, on the watch you already own.",
        "sentence1": "The housing reads depth and water temperature, and your smartwatch shows them.",
        "sentence2": "After the dive, review the logbook in the DIVEROID app. No extra subscription for the dive-computer features.",
        "eyebrow": "On your wrist",
        "chip": "Logbook included",
        "imageAlt": "WatchDive resting on pink fins beside a diving mask."
      },
      "d3": {
        "subject": "Signups keep coming in. The $149 early bird is for the first 100.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "After the first 100, the price is $200.",
        "sentence1": "Launch alert signups keep coming in. The $149 early-bird price is limited to the first 100.",
        "sentence2": "Reserve for $3 and keep $149, wherever you are in line.",
        "eyebrow": "First 100 at $149",
        "chip": "Signups keep coming in",
        "imageAlt": "WatchDive on a wrist underwater, with another diver behind."
      },
      "d7": {
        "subject": "Get ready for your next dive. Lock in $149.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "Get ready for your next dive. Lock in $149.",
        "sentence1": "Launch alert signups keep coming in. After the first 100, the price is $200.",
        "sentence2": "Reserve for $3 and keep $149, wherever you are in line.",
        "eyebrow": "Next dive",
        "chip": "$3 keeps $149",
        "imageAlt": "Two divers at the surface, one checking WatchDive."
      }
    },
    "ko": {
      "d0": {
        "subject": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "preheader": "선착순 100명은 $149, 그다음은 $200입니다.",
        "headline": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "sentence1": "호환되는 스마트워치를 WatchDive에 끼우면, 쓰던 시계로 다이빙할 수 있습니다.",
        "sentence2": "선착순 100명은 $149, 그다음은 $200입니다.",
        "eyebrow": "최저가 $149",
        "chip": "$3 예약",
        "imageAlt": "투명한 WatchDive 하우징을 시계에 끼우는 손."
      },
      "d1": {
        "subject": "쓰던 시계가 다이브 컴퓨터가 됩니다",
        "preheader": "수심과 수온은 손목에서, 기록은 앱 로그북에서.",
        "headline": "추가 구독 없이 쓰는 다이브 컴퓨터.",
        "sentence1": "하우징이 수심과 수온을 측정하고, 스마트워치가 그 값을 보여 줍니다.",
        "sentence2": "다이빙이 끝나면 DIVEROID 앱 로그북에서 기록을 돌아봅니다. 다이브 컴퓨터 기능에 추가 구독은 없습니다.",
        "eyebrow": "손목에서",
        "chip": "로그북까지, 구독 없이",
        "imageAlt": "핑크 핀 위에 놓인 WatchDive와 마스크."
      },
      "d3": {
        "subject": "신청은 늘고, $149 얼리버드는 선착순 100명",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "선착순 100명 이후 가격은 $200입니다",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요.",
        "sentence2": "$3로 예약하면 순서와 관계없이 최저가 $149를 보장받습니다.",
        "eyebrow": "선착순 100명",
        "chip": "신청은 늘고 있어요",
        "imageAlt": "수중 손목의 WatchDive, 뒤에 다른 다이버."
      },
      "d7": {
        "subject": "다음 다이빙은 WatchDive와. 가격은 $149로",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "다음 다이빙은 WatchDive와. 가격은 $149로",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요. 선착순 100명 이후 가격은 $200입니다.",
        "sentence2": "$3로 예약하면 순서와 관계없이 최저가 $149를 보장받습니다.",
        "eyebrow": "다음 다이빙",
        "chip": "$3면 $149",
        "imageAlt": "수면의 두 다이버, 한 사람이 손목의 WatchDive를 봅니다."
      }
    },
    "ja": {
      "d0": {
        "subject": "$3で予約。発売価格の$149を確保",
        "preheader": "先着100名は$149、その後は$200です。",
        "headline": "$3で予約。発売価格は$149のままです",
        "sentence1": "対応するスマートウォッチをWatchDiveに入れると、今つけている時計で潜れます。",
        "sentence2": "先着100名は$149、その後は$200です。",
        "eyebrow": "最低価格 $149",
        "chip": "$3で予約",
        "imageAlt": "透明なWatchDiveハウジングを時計にはめている手元。"
      },
      "d1": {
        "subject": "いつもの時計がダイブコンピューターになります",
        "preheader": "水深と水温は手首で。記録はアプリのログブックへ。",
        "headline": "追加サブスクなしのダイブコンピューター。",
        "sentence1": "ハウジングが水深と水温を測り、スマートウォッチがその値を表示します。",
        "sentence2": "ダイビングのあと、DIVEROIDアプリのログブックで記録を振り返ります。ダイブコンピューター機能に追加のサブスクリプションはありません。",
        "eyebrow": "手首のうえで",
        "chip": "ログブックまで、サブスクなし",
        "imageAlt": "ピンクのフィンの上に置かれたWatchDiveとマスク。"
      },
      "d3": {
        "subject": "申し込みは増えています。$149は先着100名",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "先着100名のあと、価格は$200です",
        "sentence1": "発売案内の申し込みは増え続けています。",
        "sentence2": "$3で予約すると、順番に関係なく最低価格の$149が確保されます。",
        "eyebrow": "先着100名",
        "chip": "申し込みは増えています",
        "imageAlt": "水中の手首のWatchDive。後ろにもう一人のダイバー。"
      },
      "d7": {
        "subject": "次のダイビングはWatchDiveで。価格は$149",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "次のダイビングはWatchDiveで。価格は$149",
        "sentence1": "発売案内の申し込みは増え続けています。先着100名のあと、価格は$200です",
        "sentence2": "$3で予約すると、順番に関係なく最低価格の$149を確保できます。",
        "eyebrow": "次のダイビング",
        "chip": "$3で$149",
        "imageAlt": "水面のダイバー二人。一人が手首のWatchDiveを見ています。"
      }
    },
    "zh-CN": {
      "d0": {
        "subject": "用$3预约，把最低发布价留在$149",
        "preheader": "前100名是$149，之后是$200。",
        "headline": "用$3预约，把最低发布价留在$149",
        "sentence1": "把已经在戴的兼容智能手表装进WatchDive，就能带着它去潜水。",
        "sentence2": "前100名是$149，之后是$200。",
        "eyebrow": "最低价 $149",
        "chip": "$3 预约",
        "imageAlt": "双手把透明的WatchDive外壳装到手表上。"
      },
      "d1": {
        "subject": "熟悉的手表，成为潜水电脑",
        "preheader": "水深和水温在手腕上，记录在应用日志里。",
        "headline": "不必额外订阅的潜水电脑。",
        "sentence1": "外壳测量水深和水温，智能手表显示这些读数。",
        "sentence2": "潜水结束后，在DIVEROID应用的日志里回看记录。潜水电脑功能无需额外订阅。",
        "eyebrow": "在手腕上",
        "chip": "日志也在，无需订阅",
        "imageAlt": "WatchDive放在粉色脚蹼旁，旁边有面镜。"
      },
      "d3": {
        "subject": "申请还在增加。$149只给前100名",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "前100名之后，价格是$200",
        "sentence1": "上线提醒的申请还在增加。",
        "sentence2": "用$3预约，不论顺序，都能保住最低价$149。",
        "eyebrow": "前100名",
        "chip": "申请还在增加",
        "imageAlt": "水下手腕上的WatchDive，后方还有一位潜水员。"
      },
      "d7": {
        "subject": "下一次潜水，和WatchDive一起。价格是$149",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "下一次潜水，和WatchDive一起。价格是$149",
        "sentence1": "上线提醒的申请还在增加。前100名之后，价格是$200",
        "sentence2": "用$3预约，不论顺序，都能保住最低价$149。",
        "eyebrow": "下一次潜水",
        "chip": "$3 保住 $149",
        "imageAlt": "水面的两位潜水员，其中一位在看手腕上的WatchDive。"
      }
    },
    "zh-TW": {
      "d0": {
        "subject": "用$3預約，把最低上市價留在$149",
        "preheader": "前100名是$149，之後是$200。",
        "headline": "用$3預約，把最低上市價留在$149",
        "sentence1": "把已經在戴的相容智慧手錶裝進WatchDive，就能帶著它去潛水。",
        "sentence2": "前100名是$149，之後是$200。",
        "eyebrow": "最低價 $149",
        "chip": "$3 預約",
        "imageAlt": "雙手把透明的WatchDive外殼裝到手錶上。"
      },
      "d1": {
        "subject": "熟悉的手錶，成為潛水電腦",
        "preheader": "水深和水溫在手腕上，記錄在應用日誌裡。",
        "headline": "不必額外訂閱的潛水電腦。",
        "sentence1": "外殼測量水深和水溫，智慧手錶顯示這些讀數。",
        "sentence2": "潛水結束後，在DIVEROID應用的日誌裡回看記錄。潛水電腦功能無需額外訂閱。",
        "eyebrow": "在手腕上",
        "chip": "日誌也在，無需訂閱",
        "imageAlt": "WatchDive放在粉色蛙鞋旁，旁邊有面鏡。"
      },
      "d3": {
        "subject": "申請還在增加。$149只給前100名",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "前100名之後，價格是$200",
        "sentence1": "上市提醒的申請還在增加。",
        "sentence2": "用$3預約，不論順序，都能保住最低價$149。",
        "eyebrow": "前100名",
        "chip": "申請還在增加",
        "imageAlt": "水下手腕上的WatchDive，後方還有一位潛水員。"
      },
      "d7": {
        "subject": "下一次潛水，和WatchDive一起。價格是$149",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "下一次潛水，和WatchDive一起。價格是$149",
        "sentence1": "上市提醒的申請還在增加。前100名之後，價格是$200",
        "sentence2": "用$3預約，不論順序，都能保住最低價$149。",
        "eyebrow": "下一次潛水",
        "chip": "$3 保住 $149",
        "imageAlt": "水面的兩位潛水員，其中一位在看手腕上的WatchDive。"
      }
    },
    "es": {
      "d0": {
        "subject": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "preheader": "Los primeros 100 pagan $149. Después, WatchDive cuesta $200.",
        "headline": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "sentence1": "Encaja el smartwatch compatible que ya usas en WatchDive y llévalo a bucear.",
        "sentence2": "Los primeros 100 pagan $149. Después, el precio es $200.",
        "eyebrow": "Precio de $149",
        "chip": "Reserva de $3",
        "imageAlt": "Manos colocando la carcasa transparente de WatchDive en un reloj."
      },
      "d1": {
        "subject": "Tu reloj puede ser el ordenador de buceo.",
        "preheader": "Profundidad y temperatura en la muñeca, y el diario en la app.",
        "headline": "Un ordenador de buceo, en el reloj que ya tienes.",
        "sentence1": "La carcasa mide la profundidad y la temperatura del agua, y tu smartwatch las muestra.",
        "sentence2": "Después de la inmersión, revisa el diario en la app DIVEROID. Sin suscripción adicional por las funciones de ordenador de buceo.",
        "eyebrow": "En tu muñeca",
        "chip": "Diario incluido",
        "imageAlt": "WatchDive sobre aletas rosas, junto a una máscara."
      },
      "d3": {
        "subject": "Las altas siguen. $149 es para los primeros 100.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Después de los primeros 100, el precio es $200.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando.",
        "sentence2": "Reserva por $3 y conserva $149, esté donde esté tu turno.",
        "eyebrow": "Primeros 100",
        "chip": "Las altas siguen",
        "imageAlt": "WatchDive en una muñeca bajo el agua, con otro buceador detrás."
      },
      "d7": {
        "subject": "Tu próxima inmersión es con WatchDive. El precio es $149.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Tu próxima inmersión es con WatchDive. El precio es $149.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando. Después de los primeros 100, el precio es $200.",
        "sentence2": "Reserva por $3 y conserva $149, esté donde esté tu turno.",
        "eyebrow": "Próxima inmersión",
        "chip": "$3 mantiene $149",
        "imageAlt": "Dos buceadores en la superficie, uno mira WatchDive."
      }
    },
    "fr": {
      "d0": {
        "subject": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "preheader": "Les 100 premiers paient 149 $. Ensuite, WatchDive passe à 200 $.",
        "headline": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "sentence1": "Glissez la montre connectée compatible que vous portez déjà dans WatchDive, et partez plonger avec elle.",
        "sentence2": "Les 100 premiers paient 149 $. Ensuite, le prix passe à 200 $.",
        "eyebrow": "Prix de 149 $",
        "chip": "Réservation de 3 $",
        "imageAlt": "Des mains posent le boîtier transparent WatchDive sur une montre."
      },
      "d1": {
        "subject": "Votre montre peut devenir l'ordinateur de plongée.",
        "preheader": "Profondeur et température au poignet, puis le carnet dans l'app.",
        "headline": "Un ordinateur de plongée, sur la montre que vous avez déjà.",
        "sentence1": "Le boîtier mesure la profondeur et la température de l'eau. Votre montre affiche ces valeurs.",
        "sentence2": "Après la plongée, relisez le carnet dans l'app DIVEROID. Sans abonnement supplémentaire pour les fonctions d'ordinateur de plongée.",
        "eyebrow": "À votre poignet",
        "chip": "Carnet inclus",
        "imageAlt": "WatchDive posé sur des palmes roses, à côté d'un masque."
      },
      "d3": {
        "subject": "Les inscriptions continuent. 149 $, c'est pour les 100 premiers.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Après les 100 premiers, le prix passe à 200 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place.",
        "eyebrow": "100 premiers",
        "chip": "Les inscriptions continuent",
        "imageAlt": "WatchDive au poignet sous l'eau, un autre plongeur derrière."
      },
      "d7": {
        "subject": "Votre prochaine plongée avec WatchDive. Le prix est 149 $.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Votre prochaine plongée avec WatchDive. Le prix est 149 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter. Après les 100 premiers, le prix passe à 200 $.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place.",
        "eyebrow": "Prochaine plongée",
        "chip": "3 $ gardent 149 $",
        "imageAlt": "Deux plongeurs en surface, l'un regarde WatchDive."
      }
    },
    "de": {
      "d0": {
        "subject": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "preheader": "Die ersten 100 zahlen $149. Danach kostet WatchDive $200.",
        "headline": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "sentence1": "Setzen Sie die kompatible Smartwatch, die Sie schon tragen, in WatchDive ein und nehmen Sie sie mit zum Tauchen.",
        "sentence2": "Die ersten 100 zahlen $149. Danach liegt der Preis bei $200.",
        "eyebrow": "Startpreis $149",
        "chip": "Reservierung für $3",
        "imageAlt": "Hände setzen das klare WatchDive-Gehäuse auf eine Uhr."
      },
      "d1": {
        "subject": "Ihre Uhr kann der Tauchcomputer sein.",
        "preheader": "Tiefe und Temperatur am Handgelenk, das Logbuch in der App.",
        "headline": "Ein Tauchcomputer, auf der Uhr, die Sie schon besitzen.",
        "sentence1": "Das Gehäuse misst Tiefe und Wassertemperatur. Ihre Smartwatch zeigt die Werte.",
        "sentence2": "Nach dem Tauchgang sehen Sie das Logbuch in der DIVEROID App. Kein zusätzliches Abo für die Tauchcomputer-Funktionen.",
        "eyebrow": "An Ihrem Handgelenk",
        "chip": "Logbuch inklusive",
        "imageAlt": "WatchDive auf rosa Flossen, neben einer Maske."
      },
      "d3": {
        "subject": "Anmeldungen kommen weiter. $149 gilt für die ersten 100.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Nach den ersten 100 liegt der Preis bei $200.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149, unabhängig von Ihrem Platz in der Reihe.",
        "eyebrow": "Erste 100",
        "chip": "Anmeldungen kommen weiter",
        "imageAlt": "WatchDive am Handgelenk unter Wasser, ein weiterer Taucher dahinter."
      },
      "d7": {
        "subject": "Ihr nächster Tauchgang mit WatchDive. Der Preis ist $149.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Ihr nächster Tauchgang mit WatchDive. Der Preis ist $149.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu. Nach den ersten 100 liegt der Preis bei $200.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149, unabhängig von Ihrem Platz in der Reihe.",
        "eyebrow": "Nächster Tauchgang",
        "chip": "$3 hält $149",
        "imageAlt": "Zwei Taucher an der Oberfläche, einer sieht auf WatchDive."
      }
    },
    "pt-BR": {
      "d0": {
        "subject": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "preheader": "Os primeiros 100 pagam $149. Depois, o WatchDive fica $200.",
        "headline": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "sentence1": "Encaixe o smartwatch compatível que você já usa no WatchDive e leve-o para mergulhar.",
        "sentence2": "Os primeiros 100 pagam $149. Depois, o preço vai para $200.",
        "eyebrow": "Preço de $149",
        "chip": "Reserva de $3",
        "imageAlt": "Mãos encaixando a caixa transparente do WatchDive em um relógio."
      },
      "d1": {
        "subject": "Seu relógio pode ser o computador de mergulho.",
        "preheader": "Profundidade e temperatura no pulso, e o diário no app.",
        "headline": "Um computador de mergulho, no relógio que você já tem.",
        "sentence1": "A caixa mede a profundidade e a temperatura da água. Seu smartwatch mostra esses dados.",
        "sentence2": "Depois do mergulho, reveja o diário no app DIVEROID. Sem assinatura extra para as funções de computador de mergulho.",
        "eyebrow": "No seu pulso",
        "chip": "Diário incluído",
        "imageAlt": "WatchDive sobre nadadeiras rosa, ao lado de uma máscara."
      },
      "d3": {
        "subject": "As inscrições continuam. $149 é para os primeiros 100.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Depois dos primeiros 100, o preço fica $200.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando.",
        "sentence2": "Reserve por $3 e mantenha $149, seja qual for o seu lugar na fila.",
        "eyebrow": "Primeiros 100",
        "chip": "As inscrições continuam",
        "imageAlt": "WatchDive no pulso debaixo d'água, com outro mergulhador atrás."
      },
      "d7": {
        "subject": "Seu próximo mergulho é com o WatchDive. O preço é $149.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Seu próximo mergulho é com o WatchDive. O preço é $149.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando. Depois dos primeiros 100, o preço fica $200.",
        "sentence2": "Reserve por $3 e mantenha $149, seja qual for o seu lugar na fila.",
        "eyebrow": "Próximo mergulho",
        "chip": "$3 mantém $149",
        "imageAlt": "Dois mergulhadores na superfície, um olha o WatchDive."
      }
    }
  },
  "scuba": {
    "en": {
      "d0": {
        "subject": "Reserve for $3. Lock in the $149 launch price.",
        "preheader": "The watch you wear becomes a dive computer. The first 100 pay $149.",
        "headline": "Reserve for $3. Lock in the $149 launch price.",
        "sentence1": "WatchDive turns the smartwatch you already wear into a dive computer for scuba.",
        "sentence2": "The first 100 pay $149. After that, the price is $200.",
        "eyebrow": "For scuba",
        "chip": "One $3 reservation",
        "imageAlt": "WatchDive on a wrist underwater, screen on."
      },
      "d1": {
        "subject": "Compass, depth and a logbook. No extra subscription.",
        "preheader": "Scuba readings on your watch, then the logbook in the app.",
        "headline": "Your dive computer, compass and logbook.",
        "sentence1": "On a scuba dive, the watch shows the compass, depth, dive time and water temperature.",
        "sentence2": "Back on the surface, the logbook syncs to the DIVEROID app. No extra subscription for these dive-computer features.",
        "eyebrow": "For scuba",
        "chip": "Compass and logbook",
        "imageAlt": "WatchDive on a wrist during a scuba dive, another diver behind."
      },
      "d3": {
        "subject": "Signups keep coming in. The $149 early bird is for the first 100.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "After the first 100, the price is $200.",
        "sentence1": "Launch alert signups keep coming in. The $149 early-bird price is limited to the first 100.",
        "sentence2": "For scuba, reserve for $3 and keep $149, wherever you are in line.",
        "eyebrow": "First 100 at $149",
        "chip": "Signups keep coming in",
        "imageAlt": "WatchDive on pink fins beside a diving mask."
      },
      "d7": {
        "subject": "Get ready for your next scuba dive. Lock in $149.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "Get ready for your next scuba dive. Lock in $149.",
        "sentence1": "Launch alert signups keep coming in. After the first 100, the price is $200.",
        "sentence2": "Reserve for $3 and keep $149 for the dive computer, wherever you are in line.",
        "eyebrow": "Next scuba dive",
        "chip": "$3 keeps $149",
        "imageAlt": "Two divers at the surface, one checking WatchDive."
      }
    },
    "ko": {
      "d0": {
        "subject": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "preheader": "쓰던 시계가 다이브 컴퓨터가 됩니다. 선착순 100명은 $149.",
        "headline": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "sentence1": "WatchDive는 이미 가진 스마트워치를 스쿠버다이빙용 다이브 컴퓨터로 바꿔 줍니다.",
        "sentence2": "선착순 100명은 $149, 그다음은 $200입니다.",
        "eyebrow": "스쿠버다이빙",
        "chip": "$3 예약",
        "imageAlt": "수중 손목의 WatchDive, 화면이 켜져 있습니다."
      },
      "d1": {
        "subject": "나침반과 로그북, 추가 구독은 없습니다",
        "preheader": "스쿠버다이빙 정보를 손목에서 보고, 기록은 앱에 남깁니다.",
        "headline": "다이브 컴퓨터, 나침반, 그리고 로그북.",
        "sentence1": "스쿠버다이빙 중에는 나침반, 수심, 다이빙 시간, 수온을 스마트워치에서 봅니다.",
        "sentence2": "수면으로 돌아오면 로그북이 DIVEROID 앱에 동기화됩니다. 이 다이브 컴퓨터 기능에 추가 구독은 없습니다.",
        "eyebrow": "스쿠버다이빙",
        "chip": "나침반과 로그북",
        "imageAlt": "스쿠버다이빙 중 손목의 WatchDive, 뒤에 다른 다이버."
      },
      "d3": {
        "subject": "신청은 늘고, $149 얼리버드는 선착순 100명",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "선착순 100명 이후 가격은 $200입니다",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요.",
        "sentence2": "$3로 예약하면 순서와 관계없이 최저가 $149를 보장받습니다.",
        "eyebrow": "선착순 100명",
        "chip": "신청은 늘고 있어요",
        "imageAlt": "핑크 핀 옆에 놓인 WatchDive와 마스크."
      },
      "d7": {
        "subject": "다음 스쿠버다이빙은 WatchDive와. 가격은 $149로",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "다음 스쿠버다이빙은 WatchDive와. 가격은 $149로",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요. 선착순 100명 이후 가격은 $200입니다.",
        "sentence2": "$3로 예약하면 다이브 컴퓨터의 최저가 $149를 순서와 관계없이 보장받습니다.",
        "eyebrow": "다음 스쿠버다이빙",
        "chip": "$3면 $149",
        "imageAlt": "수면의 두 다이버, 한 사람이 손목의 WatchDive를 확인합니다."
      }
    },
    "ja": {
      "d0": {
        "subject": "$3で予約。発売価格の$149を確保",
        "preheader": "いつもの時計がダイブコンピューターに。先着100名は$149。",
        "headline": "$3で予約。発売価格は$149のままです",
        "sentence1": "WatchDiveは、今持っているスマートウォッチをスキューバ用のダイブコンピューターにします。",
        "sentence2": "先着100名は$149、その後は$200です。",
        "eyebrow": "スキューバダイビング",
        "chip": "$3で予約",
        "imageAlt": "水中の手首のWatchDive。画面が点いています。"
      },
      "d1": {
        "subject": "コンパスとログブック。追加サブスクはありません",
        "preheader": "スキューバの情報は手首で、記録はアプリへ。",
        "headline": "ダイブコンピューターとコンパス、ログブック。",
        "sentence1": "スキューバダイビング中は、コンパス、水深、ダイビング時間、水温をスマートウォッチで見ます。",
        "sentence2": "水面に戻るとログブックがDIVEROIDアプリに同期されます。このダイブコンピューター機能に追加のサブスクリプションはありません。",
        "eyebrow": "スキューバダイビング",
        "chip": "コンパスとログブック",
        "imageAlt": "スキューバダイビング中の手首のWatchDive。後ろにダイバー。"
      },
      "d3": {
        "subject": "申し込みは増えています。$149は先着100名",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "先着100名のあと、価格は$200です",
        "sentence1": "発売案内の申し込みは増え続けています。",
        "sentence2": "$3で予約すると、順番に関係なく最低価格の$149が確保されます。",
        "eyebrow": "先着100名",
        "chip": "申し込みは増えています",
        "imageAlt": "ピンクのフィンの横に置かれたWatchDiveとマスク。"
      },
      "d7": {
        "subject": "次のスキューバダイビングはWatchDiveで。価格は$149",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "次のスキューバダイビングはWatchDiveで。価格は$149",
        "sentence1": "発売案内の申し込みは増え続けています。先着100名のあと、価格は$200です",
        "sentence2": "$3で予約すると、順番に関係なく最低価格の$149を確保できます。",
        "eyebrow": "次のスキューバダイビング",
        "chip": "$3で$149",
        "imageAlt": "水面のダイバー二人。一人が手首のWatchDiveを確認しています。"
      }
    },
    "zh-CN": {
      "d0": {
        "subject": "用$3预约，把最低发布价留在$149",
        "preheader": "熟悉的手表变成潜水电脑。前100名是$149。",
        "headline": "用$3预约，把最低发布价留在$149",
        "sentence1": "WatchDive把你已经拥有的智能手表变成水肺潜水用的潜水电脑。",
        "sentence2": "前100名是$149，之后是$200。",
        "eyebrow": "水肺潜水",
        "chip": "$3 预约",
        "imageAlt": "水下手腕上的WatchDive，屏幕亮着。"
      },
      "d1": {
        "subject": "指南针和日志，无需额外订阅",
        "preheader": "水肺潜水的信息在手腕上，记录留在应用里。",
        "headline": "潜水电脑、指南针和日志。",
        "sentence1": "水肺潜水时，在智能手表上看指南针、水深、潜水时间和水温。",
        "sentence2": "回到水面后，日志会同步到DIVEROID应用。这些潜水电脑功能无需额外订阅。",
        "eyebrow": "水肺潜水",
        "chip": "指南针和日志",
        "imageAlt": "水肺潜水时手腕上的WatchDive，后方还有一位潜水员。"
      },
      "d3": {
        "subject": "申请还在增加。$149只给前100名",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "前100名之后，价格是$200",
        "sentence1": "上线提醒的申请还在增加。",
        "sentence2": "用$3预约，不论顺序，都能保住最低价$149。",
        "eyebrow": "前100名",
        "chip": "申请还在增加",
        "imageAlt": "粉色脚蹼旁的WatchDive和面镜。"
      },
      "d7": {
        "subject": "下一次水肺潜水，和WatchDive一起。价格是$149",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "下一次水肺潜水，和WatchDive一起。价格是$149",
        "sentence1": "上线提醒的申请还在增加。前100名之后，价格是$200",
        "sentence2": "用$3预约，不论顺序，都能保住最低价$149。",
        "eyebrow": "下一次水肺潜水",
        "chip": "$3 保住 $149",
        "imageAlt": "水面的两位潜水员，其中一位在确认手腕上的WatchDive。"
      }
    },
    "zh-TW": {
      "d0": {
        "subject": "用$3預約，把最低上市價留在$149",
        "preheader": "熟悉的手錶變成潛水電腦。前100名是$149。",
        "headline": "用$3預約，把最低上市價留在$149",
        "sentence1": "WatchDive把你已經擁有的智慧手錶變成水肺潛水用的潛水電腦。",
        "sentence2": "前100名是$149，之後是$200。",
        "eyebrow": "水肺潛水",
        "chip": "$3 預約",
        "imageAlt": "水下手腕上的WatchDive，螢幕亮著。"
      },
      "d1": {
        "subject": "指南針和日誌，無需額外訂閱",
        "preheader": "水肺潛水的資訊在手腕上，記錄留在應用裡。",
        "headline": "潛水電腦、指南針和日誌。",
        "sentence1": "水肺潛水時，在智慧手錶上看指南針、水深、潛水時間和水溫。",
        "sentence2": "回到水面後，日誌會同步到DIVEROID應用。這些潛水電腦功能無需額外訂閱。",
        "eyebrow": "水肺潛水",
        "chip": "指南針和日誌",
        "imageAlt": "水肺潛水時手腕上的WatchDive，後方還有一位潛水員。"
      },
      "d3": {
        "subject": "申請還在增加。$149只給前100名",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "前100名之後，價格是$200",
        "sentence1": "上市提醒的申請還在增加。",
        "sentence2": "用$3預約，不論順序，都能保住最低價$149。",
        "eyebrow": "前100名",
        "chip": "申請還在增加",
        "imageAlt": "粉色蛙鞋旁的WatchDive和面鏡。"
      },
      "d7": {
        "subject": "下一次水肺潛水，和WatchDive一起。價格是$149",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "下一次水肺潛水，和WatchDive一起。價格是$149",
        "sentence1": "上市提醒的申請還在增加。前100名之後，價格是$200",
        "sentence2": "用$3預約，不論順序，都能保住最低價$149。",
        "eyebrow": "下一次水肺潛水",
        "chip": "$3 保住 $149",
        "imageAlt": "水面的兩位潛水員，其中一位在確認手腕上的WatchDive。"
      }
    },
    "es": {
      "d0": {
        "subject": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "preheader": "El reloj que llevas pasa a ser un ordenador de buceo. Los primeros 100 pagan $149.",
        "headline": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "sentence1": "WatchDive convierte el smartwatch que ya llevas en un ordenador de buceo para buceo autónomo.",
        "sentence2": "Los primeros 100 pagan $149. Después, el precio es $200.",
        "eyebrow": "Buceo autónomo",
        "chip": "Reserva de $3",
        "imageAlt": "WatchDive en una muñeca bajo el agua, con la pantalla encendida."
      },
      "d1": {
        "subject": "Brújula, profundidad y diario. Sin suscripción adicional.",
        "preheader": "Datos de buceo autónomo en el reloj y el diario en la app.",
        "headline": "Tu ordenador de buceo, la brújula y el diario.",
        "sentence1": "En un buceo autónomo, el reloj muestra la brújula, la profundidad, el tiempo de buceo y la temperatura del agua.",
        "sentence2": "De vuelta en superficie, el diario se sincroniza con la app DIVEROID. Sin suscripción adicional por estas funciones de ordenador de buceo.",
        "eyebrow": "Buceo autónomo",
        "chip": "Brújula y diario",
        "imageAlt": "WatchDive en la muñeca durante un buceo autónomo, otro buceador detrás."
      },
      "d3": {
        "subject": "Las altas siguen. $149 es para los primeros 100.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Después de los primeros 100, el precio es $200.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando.",
        "sentence2": "Reserva por $3 y conserva $149, esté donde esté tu turno.",
        "eyebrow": "Primeros 100",
        "chip": "Las altas siguen",
        "imageAlt": "WatchDive sobre aletas rosas, junto a una máscara."
      },
      "d7": {
        "subject": "Tu próximo buceo autónomo es con WatchDive. El precio es $149.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Tu próximo buceo autónomo es con WatchDive. El precio es $149.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando. Después de los primeros 100, el precio es $200.",
        "sentence2": "Reserva por $3 y conserva $149, esté donde esté tu turno.",
        "eyebrow": "Próximo buceo",
        "chip": "$3 mantiene $149",
        "imageAlt": "Dos buceadores en la superficie, uno comprueba WatchDive."
      }
    },
    "fr": {
      "d0": {
        "subject": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "preheader": "La montre que vous portez devient un ordinateur de plongée. Les 100 premiers paient 149 $.",
        "headline": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "sentence1": "WatchDive fait de la montre connectée que vous portez déjà un ordinateur de plongée pour la plongée bouteille.",
        "sentence2": "Les 100 premiers paient 149 $. Ensuite, le prix passe à 200 $.",
        "eyebrow": "Plongée bouteille",
        "chip": "Réservation de 3 $",
        "imageAlt": "WatchDive au poignet sous l'eau, écran allumé."
      },
      "d1": {
        "subject": "Compas, profondeur et carnet. Sans abonnement supplémentaire.",
        "preheader": "Les données de plongée bouteille au poignet, le carnet dans l'app.",
        "headline": "Votre ordinateur de plongée, le compas et le carnet.",
        "sentence1": "En plongée bouteille, la montre affiche le compas, la profondeur, le temps de plongée et la température de l'eau.",
        "sentence2": "De retour en surface, le carnet se synchronise avec l'app DIVEROID. Sans abonnement supplémentaire pour ces fonctions d'ordinateur de plongée.",
        "eyebrow": "Plongée bouteille",
        "chip": "Compas et carnet",
        "imageAlt": "WatchDive au poignet pendant une plongée bouteille, un plongeur derrière."
      },
      "d3": {
        "subject": "Les inscriptions continuent. 149 $, c'est pour les 100 premiers.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Après les 100 premiers, le prix passe à 200 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place.",
        "eyebrow": "100 premiers",
        "chip": "Les inscriptions continuent",
        "imageAlt": "WatchDive sur des palmes roses, à côté d'un masque."
      },
      "d7": {
        "subject": "Votre prochaine plongée en bouteille avec WatchDive. Le prix est 149 $.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Votre prochaine plongée en bouteille avec WatchDive. Le prix est 149 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter. Après les 100 premiers, le prix passe à 200 $.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place.",
        "eyebrow": "Prochaine plongée",
        "chip": "3 $ gardent 149 $",
        "imageAlt": "Deux plongeurs en surface, l'un vérifie WatchDive."
      }
    },
    "de": {
      "d0": {
        "subject": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "preheader": "Die Uhr, die Sie tragen, wird zum Tauchcomputer. Die ersten 100 zahlen $149.",
        "headline": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "sentence1": "WatchDive macht aus der Smartwatch, die Sie schon tragen, einen Tauchcomputer fürs Gerätetauchen.",
        "sentence2": "Die ersten 100 zahlen $149. Danach liegt der Preis bei $200.",
        "eyebrow": "Gerätetauchgang",
        "chip": "Reservierung für $3",
        "imageAlt": "WatchDive am Handgelenk unter Wasser, Display an."
      },
      "d1": {
        "subject": "Kompass, Tiefe und Logbuch. Kein zusätzliches Abo.",
        "preheader": "Gerätetauch-Daten an der Uhr, das Logbuch in der App.",
        "headline": "Ihr Tauchcomputer, der Kompass und das Logbuch.",
        "sentence1": "Beim Gerätetauchen zeigt die Uhr Kompass, Tiefe, Tauchzeit und Wassertemperatur.",
        "sentence2": "Zurück an der Oberfläche wird das Logbuch mit der DIVEROID App synchronisiert. Kein zusätzliches Abo für diese Tauchcomputer-Funktionen.",
        "eyebrow": "Gerätetauchen",
        "chip": "Kompass und Logbuch",
        "imageAlt": "WatchDive am Handgelenk beim Gerätetauchen, ein Taucher dahinter."
      },
      "d3": {
        "subject": "Anmeldungen kommen weiter. $149 gilt für die ersten 100.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Nach den ersten 100 liegt der Preis bei $200.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149, unabhängig von Ihrem Platz in der Reihe.",
        "eyebrow": "Erste 100",
        "chip": "Anmeldungen kommen weiter",
        "imageAlt": "WatchDive auf rosa Flossen, neben einer Maske."
      },
      "d7": {
        "subject": "Ihr nächster Gerätetauchgang mit WatchDive. Der Preis ist $149.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Ihr nächster Gerätetauchgang mit WatchDive. Der Preis ist $149.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu. Nach den ersten 100 liegt der Preis bei $200.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149, unabhängig von Ihrem Platz in der Reihe.",
        "eyebrow": "Gerätetauchgang",
        "chip": "$3 hält $149",
        "imageAlt": "Zwei Taucher an der Oberfläche, einer prüft WatchDive."
      }
    },
    "pt-BR": {
      "d0": {
        "subject": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "preheader": "O relógio que você usa vira um computador de mergulho. Os primeiros 100 pagam $149.",
        "headline": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "sentence1": "O WatchDive transforma o smartwatch que você já usa em um computador de mergulho para o mergulho autônomo.",
        "sentence2": "Os primeiros 100 pagam $149. Depois, o preço vai para $200.",
        "eyebrow": "Mergulho autônomo",
        "chip": "Reserva de $3",
        "imageAlt": "WatchDive no pulso debaixo d'água, tela ligada."
      },
      "d1": {
        "subject": "Bússola, profundidade e diário. Sem assinatura extra.",
        "preheader": "Dados do mergulho autônomo no relógio e o diário no app.",
        "headline": "Seu computador de mergulho, a bússola e o diário.",
        "sentence1": "No mergulho autônomo, o relógio mostra a bússola, a profundidade, o tempo de mergulho e a temperatura da água.",
        "sentence2": "De volta à superfície, o diário sincroniza com o app DIVEROID. Sem assinatura extra para essas funções de computador de mergulho.",
        "eyebrow": "Mergulho autônomo",
        "chip": "Bússola e diário",
        "imageAlt": "WatchDive no pulso durante um mergulho autônomo, outro mergulhador atrás."
      },
      "d3": {
        "subject": "As inscrições continuam. $149 é para os primeiros 100.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Depois dos primeiros 100, o preço fica $200.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando.",
        "sentence2": "Reserve por $3 e mantenha $149, seja qual for o seu lugar na fila.",
        "eyebrow": "Primeiros 100",
        "chip": "As inscrições continuam",
        "imageAlt": "WatchDive sobre nadadeiras rosa, ao lado de uma máscara."
      },
      "d7": {
        "subject": "Seu próximo mergulho autônomo é com o WatchDive. O preço é $149.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Seu próximo mergulho autônomo é com o WatchDive. O preço é $149.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando. Depois dos primeiros 100, o preço fica $200.",
        "sentence2": "Reserve por $3 e mantenha $149, seja qual for o seu lugar na fila.",
        "eyebrow": "Mergulho autônomo",
        "chip": "$3 mantém $149",
        "imageAlt": "Dois mergulhadores na superfície, um confere o WatchDive."
      }
    }
  },
  "freediving": {
    "en": {
      "d0": {
        "subject": "Reserve for $3. Lock in the $149 launch price.",
        "preheader": "Freediving readings on your watch. The first 100 pay $149.",
        "headline": "Reserve for $3. Lock in the $149 launch price.",
        "sentence1": "On a freedive, WatchDive shows depth and time on the smartwatch you already wear.",
        "sentence2": "The first 100 pay $149. After that, the price is $200.",
        "eyebrow": "For freediving",
        "chip": "Depth and time",
        "imageAlt": "WatchDive on a wrist underwater, hand on a guide line."
      },
      "d1": {
        "subject": "Depth, time, surface interval, then your logbook.",
        "preheader": "Read the freedive on your watch. Review it in the logbook.",
        "headline": "Depth, time and the surface interval.",
        "sentence1": "During the freedive, your watch shows depth and dive time.",
        "sentence2": "Between dives, check the surface interval, then review the profile in your DIVEROID logbook.",
        "eyebrow": "For freediving",
        "chip": "Surface interval, then the logbook",
        "imageAlt": "At the surface between dives, WatchDive on a wrist."
      },
      "d3": {
        "subject": "Signups keep coming in. The $149 early bird is for the first 100.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "After the first 100, the price is $200.",
        "sentence1": "Launch alert signups keep coming in. The $149 early-bird price is limited to the first 100.",
        "sentence2": "For your next freedive, reserve for $3 and keep $149, wherever you are in line.",
        "eyebrow": "First 100 at $149",
        "chip": "Signups keep coming in",
        "imageAlt": "A phone logbook beside the pool, WatchDive on the wrist."
      },
      "d7": {
        "subject": "Get ready for your next freedive. Lock in $149.",
        "preheader": "Launch alert signups keep coming in.",
        "headline": "Get ready for your next freedive. Lock in $149.",
        "sentence1": "Launch alert signups keep coming in. After the first 100, the price is $200.",
        "sentence2": "Reserve for $3 and keep $149. Take depth, time, and the surface interval into your logbook.",
        "eyebrow": "Next freedive",
        "chip": "$3 keeps $149",
        "imageAlt": "Hands fitting the clear WatchDive housing onto a watch."
      }
    },
    "ko": {
      "d0": {
        "subject": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "preheader": "쓰던 시계에 수심과 시간. 선착순 100명은 $149.",
        "headline": "$3로 예약하고, 최저가 $149를 보장받으세요",
        "sentence1": "프리다이빙에서는 이미 가진 스마트워치로 수심과 시간을 확인합니다.",
        "sentence2": "선착순 100명은 $149, 그다음은 $200입니다.",
        "eyebrow": "프리다이빙",
        "chip": "수심과 시간",
        "imageAlt": "수중에서 가이드 라인을 잡은 손목의 WatchDive."
      },
      "d1": {
        "subject": "수심, 시간, 수면 휴식, 그리고 로그북",
        "preheader": "프리다이빙 기록은 다이빙 사이와 다이빙 후에 남습니다.",
        "headline": "수심과 시간, 그리고 수면 휴식.",
        "sentence1": "프리다이빙 중에는 스마트워치에서 수심과 다이빙 시간을 봅니다.",
        "sentence2": "다이빙 사이에는 수면 휴식을 확인하고, 프로필은 DIVEROID 로그북에서 돌아봅니다.",
        "eyebrow": "프리다이빙",
        "chip": "수면 휴식과 로그북",
        "imageAlt": "다이빙 사이 수면에서 손목의 WatchDive."
      },
      "d3": {
        "subject": "신청은 늘고, $149 얼리버드는 선착순 100명",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "선착순 100명 이후 가격은 $200입니다",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요.",
        "sentence2": "$3로 예약하면 순서와 관계없이 최저가 $149를 보장받습니다.",
        "eyebrow": "선착순 100명",
        "chip": "신청은 늘고 있어요",
        "imageAlt": "풀가에서 폰의 로그북을 보고, 손목에는 WatchDive."
      },
      "d7": {
        "subject": "다음 프리다이빙은 WatchDive와. 가격은 $149로",
        "preheader": "사전 알림 신청이 계속 늘고 있어요.",
        "headline": "다음 프리다이빙은 WatchDive와. 가격은 $149로",
        "sentence1": "사전 알림 신청이 계속 늘고 있어요. 선착순 100명 이후 가격은 $200입니다.",
        "sentence2": "수심과 시간, 수면 휴식을 로그북에 남기고, $3로 최저가 $149를 보장받으세요.",
        "eyebrow": "다음 프리다이빙",
        "chip": "$3면 $149",
        "imageAlt": "투명한 WatchDive 하우징을 시계에 끼우는 손."
      }
    },
    "ja": {
      "d0": {
        "subject": "$3で予約。発売価格の$149を確保",
        "preheader": "いつもの時計に水深と時間。先着100名は$149。",
        "headline": "$3で予約。発売価格は$149のままです",
        "sentence1": "フリーダイビングでは、今つけているスマートウォッチで水深と時間を確認します。",
        "sentence2": "先着100名は$149、その後は$200です。",
        "eyebrow": "フリーダイビング",
        "chip": "水深と時間",
        "imageAlt": "水中でガイドラインを握る手首のWatchDive。"
      },
      "d1": {
        "subject": "水深、時間、水面休息、そしてログブック",
        "preheader": "フリーダイビングの記録は、潜りのあいだと潜ったあとに残ります。",
        "headline": "水深と時間、そして水面休息。",
        "sentence1": "フリーダイビング中は、スマートウォッチで水深とダイビング時間を見ます。",
        "sentence2": "潜りのあいだに水面休息を確認し、プロファイルはDIVEROIDのログブックで振り返ります。",
        "eyebrow": "フリーダイビング",
        "chip": "水面休息とログブック",
        "imageAlt": "潜りのあいだ、水面で手首のWatchDive。"
      },
      "d3": {
        "subject": "申し込みは増えています。$149は先着100名",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "先着100名のあと、価格は$200です",
        "sentence1": "発売案内の申し込みは増え続けています。",
        "sentence2": "$3で予約すると、順番に関係なく最低価格の$149が確保されます。",
        "eyebrow": "先着100名",
        "chip": "申し込みは増えています",
        "imageAlt": "プール脇でスマホのログブックを見る人。手首にWatchDive。"
      },
      "d7": {
        "subject": "次のフリーダイビングはWatchDiveで。価格は$149",
        "preheader": "発売案内の申し込みは増え続けています。",
        "headline": "次のフリーダイビングはWatchDiveで。価格は$149",
        "sentence1": "発売案内の申し込みは増え続けています。先着100名のあと、価格は$200です",
        "sentence2": "水深と時間、水面休息をログブックに残して、$3で最低価格の$149を確保してください。",
        "eyebrow": "次のフリーダイビング",
        "chip": "$3で$149",
        "imageAlt": "透明なWatchDiveハウジングを時計にはめている手元。"
      }
    },
    "zh-CN": {
      "d0": {
        "subject": "用$3预约，把最低发布价留在$149",
        "preheader": "熟悉的手表上看水深和时间。前100名是$149。",
        "headline": "用$3预约，把最低发布价留在$149",
        "sentence1": "自由潜水时，用你已经在戴的智能手表看水深和时间。",
        "sentence2": "前100名是$149，之后是$200。",
        "eyebrow": "自由潜水",
        "chip": "水深和时间",
        "imageAlt": "水下抓着引导绳的手腕，上面是WatchDive。"
      },
      "d1": {
        "subject": "水深、时间、水面休息，然后是日志",
        "preheader": "自由潜水的记录，留在两次下潜之间和上岸之后。",
        "headline": "水深、时间，还有水面休息。",
        "sentence1": "自由潜水时，在智能手表上看水深和潜水时间。",
        "sentence2": "两次下潜之间确认水面休息，再在DIVEROID日志里回看曲线。",
        "eyebrow": "自由潜水",
        "chip": "水面休息和日志",
        "imageAlt": "两次下潜之间，水面手腕上的WatchDive。"
      },
      "d3": {
        "subject": "申请还在增加。$149只给前100名",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "前100名之后，价格是$200",
        "sentence1": "上线提醒的申请还在增加。",
        "sentence2": "用$3预约，不论顺序，都能保住最低价$149。",
        "eyebrow": "前100名",
        "chip": "申请还在增加",
        "imageAlt": "池边用手机看日志，手腕上戴着WatchDive。"
      },
      "d7": {
        "subject": "下一次自由潜水，和WatchDive一起。价格是$149",
        "preheader": "上线提醒的申请还在增加。",
        "headline": "下一次自由潜水，和WatchDive一起。价格是$149",
        "sentence1": "上线提醒的申请还在增加。前100名之后，价格是$200",
        "sentence2": "把水深、时间、水面休息留在日志里，并用$3保住最低价$149。",
        "eyebrow": "下一次自由潜水",
        "chip": "$3 保住 $149",
        "imageAlt": "双手把透明的WatchDive外壳装到手表上。"
      }
    },
    "zh-TW": {
      "d0": {
        "subject": "用$3預約，把最低上市價留在$149",
        "preheader": "熟悉的手錶上看水深和時間。前100名是$149。",
        "headline": "用$3預約，把最低上市價留在$149",
        "sentence1": "自由潛水時，用你已經在戴的智慧手錶看水深和時間。",
        "sentence2": "前100名是$149，之後是$200。",
        "eyebrow": "自由潛水",
        "chip": "水深和時間",
        "imageAlt": "水下抓著引導繩的手腕，上面是WatchDive。"
      },
      "d1": {
        "subject": "水深、時間、水面休息，然後是日誌",
        "preheader": "自由潛水的記錄，留在兩次下潛之間和上岸之後。",
        "headline": "水深、時間，還有水面休息。",
        "sentence1": "自由潛水時，在智慧手錶上看水深和潛水時間。",
        "sentence2": "兩次下潛之間確認水面休息，再在DIVEROID日誌裡回看曲線。",
        "eyebrow": "自由潛水",
        "chip": "水面休息和日誌",
        "imageAlt": "兩次下潛之間，水面手腕上的WatchDive。"
      },
      "d3": {
        "subject": "申請還在增加。$149只給前100名",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "前100名之後，價格是$200",
        "sentence1": "上市提醒的申請還在增加。",
        "sentence2": "用$3預約，不論順序，都能保住最低價$149。",
        "eyebrow": "前100名",
        "chip": "申請還在增加",
        "imageAlt": "池邊用手機看日誌，手腕上戴著WatchDive。"
      },
      "d7": {
        "subject": "下一次自由潛水，和WatchDive一起。價格是$149",
        "preheader": "上市提醒的申請還在增加。",
        "headline": "下一次自由潛水，和WatchDive一起。價格是$149",
        "sentence1": "上市提醒的申請還在增加。前100名之後，價格是$200",
        "sentence2": "把水深、時間、水面休息留在日誌裡，並用$3保住最低價$149。",
        "eyebrow": "下一次自由潛水",
        "chip": "$3 保住 $149",
        "imageAlt": "雙手把透明的WatchDive外殼裝到手錶上。"
      }
    },
    "es": {
      "d0": {
        "subject": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "preheader": "Lecturas de apnea en tu reloj. Los primeros 100 pagan $149.",
        "headline": "Reserva por $3. Asegura el precio de lanzamiento de $149.",
        "sentence1": "En la apnea, WatchDive muestra la profundidad y el tiempo en el smartwatch que ya llevas.",
        "sentence2": "Los primeros 100 pagan $149. Después, el precio es $200.",
        "eyebrow": "Apnea",
        "chip": "Profundidad y tiempo",
        "imageAlt": "WatchDive en una muñeca bajo el agua, la mano en una línea guía."
      },
      "d1": {
        "subject": "Profundidad, tiempo, intervalo en superficie y tu diario.",
        "preheader": "Lee la apnea en el reloj. Revísala después en el diario.",
        "headline": "Profundidad, tiempo e intervalo en superficie.",
        "sentence1": "Durante la apnea, el reloj muestra la profundidad y el tiempo de inmersión.",
        "sentence2": "Entre inmersiones, mira el intervalo en superficie y revisa el perfil en tu diario DIVEROID.",
        "eyebrow": "Apnea",
        "chip": "Intervalo en superficie y diario",
        "imageAlt": "En la superficie, entre inmersiones, WatchDive en la muñeca."
      },
      "d3": {
        "subject": "Las altas siguen. $149 es para los primeros 100.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Después de los primeros 100, el precio es $200.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando.",
        "sentence2": "Reserva por $3 y conserva $149, esté donde esté tu turno.",
        "eyebrow": "Primeros 100",
        "chip": "Las altas siguen",
        "imageAlt": "Un diario en el teléfono junto a la piscina, WatchDive en la muñeca."
      },
      "d7": {
        "subject": "Tu próxima apnea es con WatchDive. El precio es $149.",
        "preheader": "Las altas del aviso de lanzamiento siguen aumentando.",
        "headline": "Tu próxima apnea es con WatchDive. El precio es $149.",
        "sentence1": "Las altas del aviso de lanzamiento siguen aumentando. Después de los primeros 100, el precio es $200.",
        "sentence2": "Reserva por $3 y conserva $149. Lleva la profundidad, el tiempo y el intervalo en superficie a tu diario.",
        "eyebrow": "Próxima apnea",
        "chip": "$3 mantiene $149",
        "imageAlt": "Manos colocando la carcasa transparente de WatchDive en un reloj."
      }
    },
    "fr": {
      "d0": {
        "subject": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "preheader": "Les mesures d'apnée sur votre montre. Les 100 premiers paient 149 $.",
        "headline": "Réservez pour 3 $. Le prix de lancement de 149 $ est à vous.",
        "sentence1": "En apnée, WatchDive affiche la profondeur et le temps sur la montre connectée que vous portez déjà.",
        "sentence2": "Les 100 premiers paient 149 $. Ensuite, le prix passe à 200 $.",
        "eyebrow": "Apnée",
        "chip": "Profondeur et temps",
        "imageAlt": "WatchDive au poignet sous l'eau, la main sur une ligne."
      },
      "d1": {
        "subject": "Profondeur, temps, intervalle de surface, puis le carnet.",
        "preheader": "Lisez l'apnée sur la montre. Retrouvez-la dans le carnet.",
        "headline": "Profondeur, temps et intervalle de surface.",
        "sentence1": "Pendant l'apnée, la montre affiche la profondeur et le temps de plongée.",
        "sentence2": "Entre deux plongées, vérifiez l'intervalle de surface, puis relisez le profil dans votre carnet DIVEROID.",
        "eyebrow": "Apnée",
        "chip": "Intervalle de surface, puis le carnet",
        "imageAlt": "En surface, entre deux plongées, WatchDive au poignet."
      },
      "d3": {
        "subject": "Les inscriptions continuent. 149 $, c'est pour les 100 premiers.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Après les 100 premiers, le prix passe à 200 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $, quelle que soit votre place.",
        "eyebrow": "100 premiers",
        "chip": "Les inscriptions continuent",
        "imageAlt": "Un carnet sur le téléphone au bord du bassin, WatchDive au poignet."
      },
      "d7": {
        "subject": "Votre prochaine apnée avec WatchDive. Le prix est 149 $.",
        "preheader": "Les inscriptions à l'alerte de lancement continuent d'augmenter.",
        "headline": "Votre prochaine apnée avec WatchDive. Le prix est 149 $.",
        "sentence1": "Les inscriptions à l'alerte de lancement continuent d'augmenter. Après les 100 premiers, le prix passe à 200 $.",
        "sentence2": "Réservez pour 3 $ et gardez 149 $. Emportez profondeur, temps et intervalle de surface dans votre carnet.",
        "eyebrow": "Prochaine apnée",
        "chip": "3 $ gardent 149 $",
        "imageAlt": "Des mains posent le boîtier transparent WatchDive sur une montre."
      }
    },
    "de": {
      "d0": {
        "subject": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "preheader": "Apnoe-Werte an Ihrer Uhr. Die ersten 100 zahlen $149.",
        "headline": "Reservieren Sie für $3. Sichern Sie den Startpreis von $149.",
        "sentence1": "Beim Apnoetauchen zeigt WatchDive Tiefe und Zeit auf der Smartwatch, die Sie schon tragen.",
        "sentence2": "Die ersten 100 zahlen $149. Danach liegt der Preis bei $200.",
        "eyebrow": "Apnoetauchgang",
        "chip": "Tiefe und Zeit",
        "imageAlt": "WatchDive am Handgelenk unter Wasser, die Hand an einer Führungsleine."
      },
      "d1": {
        "subject": "Tiefe, Zeit, Oberflächenpause und Ihr Logbuch.",
        "preheader": "Lesen Sie den Apnoetauchgang an der Uhr. Sehen Sie ihn im Logbuch nach.",
        "headline": "Tiefe, Zeit und die Oberflächenpause.",
        "sentence1": "Während des Apnoetauchgangs zeigt die Uhr Tiefe und Tauchzeit.",
        "sentence2": "Zwischen den Tauchgängen prüfen Sie die Oberflächenpause und sehen das Profil im DIVEROID-Logbuch.",
        "eyebrow": "Apnoetauchen",
        "chip": "Oberflächenpause, dann das Logbuch",
        "imageAlt": "An der Oberfläche zwischen zwei Tauchgängen, WatchDive am Handgelenk."
      },
      "d3": {
        "subject": "Anmeldungen kommen weiter. $149 gilt für die ersten 100.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Nach den ersten 100 liegt der Preis bei $200.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149, unabhängig von Ihrem Platz in der Reihe.",
        "eyebrow": "Erste 100",
        "chip": "Anmeldungen kommen weiter",
        "imageAlt": "Ein Logbuch auf dem Telefon am Beckenrand, WatchDive am Handgelenk."
      },
      "d7": {
        "subject": "Ihr nächster Apnoetauchgang mit WatchDive. Der Preis ist $149.",
        "preheader": "Die Anmeldungen zur Startmitteilung nehmen weiter zu.",
        "headline": "Ihr nächster Apnoetauchgang mit WatchDive. Der Preis ist $149.",
        "sentence1": "Die Anmeldungen zur Startmitteilung nehmen weiter zu. Nach den ersten 100 liegt der Preis bei $200.",
        "sentence2": "Reservieren Sie für $3 und behalten Sie $149. Nehmen Sie Tiefe, Zeit und die Oberflächenpause mit ins Logbuch.",
        "eyebrow": "Apnoetauchgang",
        "chip": "$3 hält $149",
        "imageAlt": "Hände setzen das klare WatchDive-Gehäuse auf eine Uhr."
      }
    },
    "pt-BR": {
      "d0": {
        "subject": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "preheader": "Leituras de mergulho livre no seu relógio. Os primeiros 100 pagam $149.",
        "headline": "Reserve por $3. Garanta o preço de lançamento de $149.",
        "sentence1": "No mergulho livre, o WatchDive mostra profundidade e tempo no smartwatch que você já usa.",
        "sentence2": "Os primeiros 100 pagam $149. Depois, o preço vai para $200.",
        "eyebrow": "Mergulho livre",
        "chip": "Profundidade e tempo",
        "imageAlt": "WatchDive no pulso debaixo d'água, a mão em uma linha guia."
      },
      "d1": {
        "subject": "Profundidade, tempo, intervalo de superfície e o diário.",
        "preheader": "Leia o mergulho livre no relógio. Revise depois no diário.",
        "headline": "Profundidade, tempo e o intervalo de superfície.",
        "sentence1": "Durante o mergulho livre, o relógio mostra a profundidade e o tempo de mergulho.",
        "sentence2": "Entre os mergulhos, confira o intervalo de superfície e revise o perfil no seu diário DIVEROID.",
        "eyebrow": "Mergulho livre",
        "chip": "Intervalo de superfície e diário",
        "imageAlt": "Na superfície, entre mergulhos, WatchDive no pulso."
      },
      "d3": {
        "subject": "As inscrições continuam. $149 é para os primeiros 100.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Depois dos primeiros 100, o preço fica $200.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando.",
        "sentence2": "Reserve por $3 e mantenha $149, seja qual for o seu lugar na fila.",
        "eyebrow": "Primeiros 100",
        "chip": "As inscrições continuam",
        "imageAlt": "Um diário no telefone à beira da piscina, WatchDive no pulso."
      },
      "d7": {
        "subject": "Seu próximo mergulho livre é com o WatchDive. O preço é $149.",
        "preheader": "As inscrições do aviso de lançamento continuam aumentando.",
        "headline": "Seu próximo mergulho livre é com o WatchDive. O preço é $149.",
        "sentence1": "As inscrições do aviso de lançamento continuam aumentando. Depois dos primeiros 100, o preço fica $200.",
        "sentence2": "Reserve por $3 e mantenha $149. Leve profundidade, tempo e o intervalo de superfície para o diário.",
        "eyebrow": "Mergulho livre",
        "chip": "$3 mantém $149",
        "imageAlt": "Mãos encaixando a caixa transparente do WatchDive em um relógio."
      }
    }
  }
};

export function personalizedStageCopy(
  segment: ReservationEmailSegment,
  locale: Locale,
  stage: DripStage,
): PersonalizedStageCopy {
  if (!isReservationEmailSegment(segment)) throw new Error("Reservation mail segment");
  const draft = PERSONALIZED_COPY[segment][locale][stage];
  for (const value of Object.values(draft)) {
    if (!value || /[\r\n]/.test(value)) throw new Error("Reservation mail copy");
  }
  return draft;
}
