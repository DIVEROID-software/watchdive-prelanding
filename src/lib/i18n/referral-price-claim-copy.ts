// Switched-on early-bird claim, per locale (see price-claim.ts for why).
//
// Source: claims review BLOCKER 1, option (a), approved by the owner on
// 2026-10-22. The en and ko lines follow the review's replacement text; the
// other seven say the same thing in each catalog's own voice and terms:
//   - each locale keeps the price wording its page already uses (USD for en
//     and ko, the catalog's local estimate elsewhere) and its estimate notice;
//   - "Dive Team" is the tier name from src/lib/referral/copy.ts (fr: Palanquée);
//   - "price reservation" is the name the terms and privacy pages use for the
//     paid USD 3 reservation.
//
// Two kinds of surface:
//   - sentences (search snippets, the offer lead, the form terms, the hero
//     line, the SMS card terms) state the limit with both exceptions;
//   - short labels (button, chip note, kicker, section and strip titles) drop
//     the number and keep "early bird" beside the price. Each sits on a page
//     whose offer lead and form terms carry the full sentence.
// No line claims a live count, a deadline or that the price is "only" for 100.
// The share text names no price at all, as the review proposes: a friend
// receives it with none of the page's conditions around it.
//
// `{seats}` is filled from program.ts so the number cannot drift from the
// rules; `{price}` stays for the caller, which uses the hero's own price.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { EARLY_BIRD_SEATS } from "../referral/program.ts";
import type { Locale } from "./locale.ts";
import type { PriceClaim } from "./price-claim.ts";

export const REFERRAL_PRICE_CLAIM_COPY: Record<Locale, PriceClaim> = {
  en: {
    landing: {
      meta: {
        description:
          "A DIVEROID sensor housing turns a supported Apple Watch or Galaxy Watch into a dive computer. Depth, time, water temperature, no-deco. $149 early bird: the first {seats} Kickstarter backers, plus waitlist members with a price reservation or Dive Team status.",
        ogDescription:
          "A DIVEROID sensor housing turns a supported Apple Watch or Galaxy Watch into a dive computer. Depth, time, water temperature, no-deco. $149 early bird: the first {seats} Kickstarter backers, plus waitlist members with a price reservation or Dive Team status.",
        twitterDescription:
          "A DIVEROID sensor housing for the Apple Watch or Galaxy Watch you already wear. $149 early bird: the first {seats} Kickstarter backers, plus waitlist members with a price reservation or Dive Team status.",
      },
      cta: { label: "Notify me · $149 early bird" },
      referral: {
        shareText:
          "WatchDive turns the Apple Watch or Galaxy Watch I already wear into a dive computer. It launches on Kickstarter in December. Join the waitlist with my link.",
      },
      usp: { priceTitle: "{price} early bird" },
      hero: { offNote: "Kickstarter early-bird price" },
      value: { h2: "$149 early bird on Kickstarter." },
      offer: {
        kicker: "Early bird · 50% off",
        lead: "Hear first when WatchDive opens on Kickstarter. $149 early bird: the first {seats} Kickstarter backers, plus waitlist members with a price reservation or Dive Team status. Public price $299.",
      },
    },
    conversionTerms:
      "For the first {seats} Kickstarter backers, plus waitlist members with a price reservation or Dive Team status. Signing up does not reserve the offer.",
    earlyBirdRace:
      "{price} for the first {seats} Kickstarter backers, plus price-reservation holders and Dive Team members.",
    phoneTerms:
      "The early-bird offer goes to the first {seats} backers on Kickstarter, plus waitlist members with a price reservation or Dive Team status. Adding a number does not reserve a spot or guarantee the offer.",
  },
  ko: {
    landing: {
      meta: {
        description:
          "수심과 수온은 하우징 안의 DIVEROID 센서가 읽고, 지원되는 Apple Watch·Galaxy Watch가 보여 줍니다. 얼리버드 $149: Kickstarter 선착순 후원자 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원.",
        ogDescription:
          "수심과 수온은 하우징 안의 DIVEROID 센서가 읽고, 지원되는 Apple Watch·Galaxy Watch가 보여 줍니다. 얼리버드 $149: Kickstarter 선착순 후원자 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원.",
        twitterDescription:
          "쓰던 Apple Watch·Galaxy Watch에 끼우는 DIVEROID 센서 하우징. 얼리버드 $149: Kickstarter 선착순 후원자 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원.",
      },
      cta: { label: "출시 알림 받기 · 얼리버드 $149" },
      referral: {
        shareText:
          "WatchDive는 지금 차고 있는 Apple Watch나 Galaxy Watch를 다이브 컴퓨터로 만들어 줘요. 12월 Kickstarter 공개 예정이에요. 내 링크로 알림 신청해 보세요.",
      },
      usp: { priceTitle: "얼리버드 {price}" },
      hero: { offNote: "Kickstarter 얼리버드 가격" },
      value: { h2: "Kickstarter 얼리버드 $149." },
      offer: {
        kicker: "얼리버드 · 50% 할인",
        lead: "WatchDive가 열리는 날 가장 먼저 알려 드립니다. 얼리버드 $149: Kickstarter 선착순 후원자 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원. 정가 $299. 가격은 미국 달러(USD) 기준이며, 실제 결제 금액은 Kickstarter 캠페인 페이지를 기준으로 합니다.",
      },
    },
    conversionTerms:
      "Kickstarter 선착순 후원자 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원 대상. 알림 신청으로 혜택이 예약되지는 않습니다.",
    earlyBirdRace:
      "{price} 얼리버드: Kickstarter 선착순 {seats}명, 그리고 가격 예약·다이브 팀 회원.",
    phoneTerms:
      "얼리버드 혜택은 Kickstarter에서 먼저 후원한 {seats}명, 그리고 가격 예약 또는 다이브 팀 등급을 가진 대기 명단 회원에게 적용돼요. 번호 등록으로 순서가 예약되거나 혜택이 보장되지는 않아요.",
  },
  "zh-CN": {
    landing: {
      meta: {
        description:
          "水深和水温由外壳内置的 DIVEROID 传感器测量，数值显示在受支持的 Apple Watch 或 Galaxy Watch 上。Kickstarter 早鸟价约 1,000 元，适用于前 {seats} 名支持者，以及有价格预约或潜水小队等级的名单成员。",
        ogDescription:
          "水深和水温由外壳内置的 DIVEROID 传感器测量，数值显示在受支持的 Apple Watch 或 Galaxy Watch 上。Kickstarter 早鸟价约 1,000 元，适用于前 {seats} 名支持者，以及有价格预约或潜水小队等级的名单成员。",
        twitterDescription:
          "给你已有的 Apple Watch 或 Galaxy Watch 配一个 DIVEROID 传感器外壳。Kickstarter 早鸟价约 1,000 元，适用于前 {seats} 名支持者，以及有价格预约或潜水小队等级的名单成员。",
      },
      cta: { label: "通知我 · 早鸟价约 1,000 元" },
      referral: {
        shareText:
          "WatchDive 能把我手上这块 Apple Watch / Galaxy Watch 变成潜水电脑，12 月在 Kickstarter 上线。用我的链接一起加入名单吧。",
      },
      usp: { priceTitle: "早鸟价{price}" },
      hero: { offNote: "Kickstarter 早鸟价" },
      value: { h2: "Kickstarter 早鸟价约 1,000 元。" },
      offer: {
        kicker: "早鸟 · 5 折",
        lead: "WatchDive 开启时，第一时间通知你。公开价格约 2,000 元；早鸟价约 1,000 元，适用于 Kickstarter 前 {seats} 名支持者，以及有价格预约或潜水小队等级的名单成员。以上人民币金额仅供参考，实际支付金额以 Kickstarter 页面显示为准。",
      },
    },
    conversionTerms:
      "限 Kickstarter 前 {seats} 位支持者，以及有价格预约或潜水小队等级的名单成员。报名不代表预留优惠。",
    earlyBirdRace: "{price} 早鸟价：Kickstarter 前 {seats} 名，以及价格预约和潜水小队成员。",
    phoneTerms:
      "早鸟优惠属于 Kickstarter 上最先支持的{seats}人，以及有价格预约或潜水小队等级的名单成员。留下号码不会预留名额或保证获得优惠。",
  },
  "zh-TW": {
    landing: {
      meta: {
        description:
          "水深與水溫由外殼內建的 DIVEROID 感測器量測，數值顯示在支援的 Apple Watch 或 Galaxy Watch 上。Kickstarter 早鳥價約 NT$5,000，適用於前 {seats} 名贊助者，以及有價格預約或潛水小隊等級的名單成員。",
        ogDescription:
          "水深與水溫由外殼內建的 DIVEROID 感測器量測，數值顯示在支援的 Apple Watch 或 Galaxy Watch 上。Kickstarter 早鳥價約 NT$5,000，適用於前 {seats} 名贊助者，以及有價格預約或潛水小隊等級的名單成員。",
        twitterDescription:
          "為你現有的 Apple Watch 或 Galaxy Watch 配一個 DIVEROID 感測器外殼。Kickstarter 早鳥價約 NT$5,000，適用於前 {seats} 名贊助者，以及有價格預約或潛水小隊等級的名單成員。",
      },
      cta: { label: "通知我 · 早鳥價約 NT$5,000" },
      referral: {
        shareText:
          "WatchDive 能把我手上這支 Apple Watch / Galaxy Watch 變成潛水電腦，12 月在 Kickstarter 上線。用我的連結一起加入名單吧。",
      },
      usp: { priceTitle: "早鳥價{price}" },
      hero: { offNote: "Kickstarter 早鳥價" },
      value: { h2: "Kickstarter 早鳥價約 NT$5,000。" },
      offer: {
        kicker: "早鳥 · 5 折",
        lead: "WatchDive 開賣時，第一時間通知你。公開售價約 NT$10,000；早鳥價約 NT$5,000，適用於 Kickstarter 前 {seats} 名贊助者，以及有價格預約或潛水小隊等級的名單成員。以上台幣金額僅供參考，實際付款金額以 Kickstarter 頁面顯示為準。",
      },
    },
    conversionTerms:
      "限 Kickstarter 前 {seats} 位支持者，以及有價格預約或潛水小隊等級的名單成員。報名不代表保留優惠。",
    earlyBirdRace: "{price} 早鳥價：Kickstarter 前 {seats} 名，以及價格預約和潛水小隊成員。",
    phoneTerms:
      "早鳥優惠適用於 Kickstarter 最先贊助的{seats}人，以及有價格預約或潛水小隊等級的名單成員。留下號碼不會保留名額或保證優惠。",
  },
  ja: {
    landing: {
      meta: {
        description:
          "水深と水温は、ハウジング内蔵のDIVEROIDセンサーが計測。数値は対応する Apple Watch や Galaxy Watch に表示されます。Kickstarter の早割は2万円台。対象は先着{seats}名の支援者と、価格予約またはダイブチームの資格を持つリスト登録者です。",
        ogDescription:
          "水深と水温は、ハウジング内蔵のDIVEROIDセンサーが計測。数値は対応する Apple Watch や Galaxy Watch に表示されます。Kickstarter の早割は2万円台。対象は先着{seats}名の支援者と、価格予約またはダイブチームの資格を持つリスト登録者です。",
        twitterDescription:
          "いつもの Apple Watch や Galaxy Watch に装着する、DIVEROIDセンサー内蔵のハウジング。Kickstarter の早割は2万円台。対象は先着{seats}名の支援者と、価格予約またはダイブチームの資格を持つリスト登録者です。",
      },
      cta: { label: "公開を知らせる・早割は2万円台" },
      referral: {
        shareText:
          "WatchDive は、いつもの Apple Watch や Galaxy Watch をダイブコンピューターにしてくれます。12月に Kickstarter でローンチ予定。私のリンクから一緒に登録しませんか。",
      },
      usp: { priceTitle: "早割は{price}" },
      hero: { offNote: "Kickstarter の早割価格" },
      value: { h2: "Kickstarter の早割は2万円台。" },
      offer: {
        kicker: "早割 · 50% オフ",
        lead: "WatchDive が始まる日を、いちばん早くお知らせします。一般価格は4万円台、早割は2万円台です。早割の対象は Kickstarter の先着{seats}名の支援者と、価格予約またはダイブチームの資格を持つリスト登録者です。円の金額は目安です。実際のお支払い額は Kickstarter のキャンペーンページでご確認ください。",
      },
    },
    conversionTerms:
      "Kickstarterの先着{seats}名の支援者と、価格予約またはダイブチームの資格を持つリスト登録者が対象。登録だけでは特典は確保されません。",
    earlyBirdRace:
      "{price}の早期価格は、Kickstarterの先着{seats}名と、価格予約・ダイブチームの方が対象。",
    phoneTerms:
      "早期特典は Kickstarter で最初に支援した{seats}名と、価格予約またはダイブチームの資格を持つリスト登録者が対象です。番号の登録で枠の予約や特典の保証はされません。",
  },
  es: {
    landing: {
      meta: {
        description:
          "Un sensor DIVEROID dentro de la carcasa mide la profundidad y la temperatura del agua, y tu Apple Watch o Galaxy Watch las muestra. Early bird por unos 140 € para los {seats} primeros patrocinadores en Kickstarter y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo.",
        ogDescription:
          "Un sensor DIVEROID dentro de la carcasa mide la profundidad y la temperatura del agua, y tu Apple Watch o Galaxy Watch las muestra. Early bird por unos 140 € para los {seats} primeros patrocinadores en Kickstarter y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo.",
        twitterDescription:
          "Una carcasa con sensor DIVEROID para el Apple Watch o Galaxy Watch que ya llevas. Early bird por unos 140 € para los {seats} primeros patrocinadores en Kickstarter y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo.",
      },
      cta: { label: "Avísame · early bird a unos 140 €" },
      referral: {
        shareText:
          "WatchDive convierte el Apple Watch o Galaxy Watch que ya llevo en un ordenador de buceo. Llega a Kickstarter en diciembre. Únete a la lista con mi enlace.",
      },
      usp: { priceTitle: "Early bird: {price}" },
      hero: { offNote: "precio early bird en Kickstarter" },
      value: { h2: "Early bird por unos 140 € en Kickstarter." },
      offer: {
        kicker: "Early bird · 50 % dto.",
        lead: "Regístrate y entérate primero del día que WatchDive abre en Kickstarter. El precio público rondará los 280 € y el early bird, los 140 €: para los {seats} primeros patrocinadores y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo. Los importes en euros son orientativos; prevalecerá el que muestre Kickstarter.",
      },
    },
    conversionTerms:
      "Para los primeros {seats} patrocinadores en Kickstarter y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo. Registrarte no reserva la oferta.",
    earlyBirdRace:
      "{price} para los {seats} primeros en Kickstarter, más reservas de precio y Equipo de buceo.",
    phoneTerms:
      "La oferta early bird es para los primeros {seats} patrocinadores en Kickstarter y para quienes estén en la lista con una reserva de precio o el nivel Equipo de buceo. Dejar tu número no reserva una plaza ni garantiza la oferta.",
  },
  fr: {
    landing: {
      meta: {
        description:
          "Un capteur DIVEROID, dans le caisson, mesure la profondeur et la température de l’eau ; votre Apple Watch ou Galaxy Watch les affiche. Early bird à environ 140 € pour les {seats} premiers contributeurs Kickstarter, ainsi que pour les inscrits qui ont une réservation de prix ou font partie de la Palanquée.",
        ogDescription:
          "Un capteur DIVEROID, dans le caisson, mesure la profondeur et la température de l’eau ; votre Apple Watch ou Galaxy Watch les affiche. Early bird à environ 140 € pour les {seats} premiers contributeurs Kickstarter, ainsi que pour les inscrits qui ont une réservation de prix ou font partie de la Palanquée.",
        twitterDescription:
          "Un caisson à capteur DIVEROID pour l’Apple Watch ou la Galaxy Watch que vous portez déjà. Early bird à environ 140 € pour les {seats} premiers contributeurs Kickstarter, ainsi que pour les inscrits qui ont une réservation de prix ou font partie de la Palanquée.",
      },
      cta: { label: "Me prévenir · early bird env. 140 €" },
      referral: {
        shareText:
          "WatchDive transforme l’Apple Watch ou la Galaxy Watch que je porte déjà en ordinateur de plongée. Lancement sur Kickstarter en décembre. Rejoignez la liste avec mon lien.",
      },
      usp: { priceTitle: "Early bird à {price}" },
      hero: { offNote: "tarif early bird sur Kickstarter" },
      value: { h2: "Early bird à environ 140 € sur Kickstarter." },
      offer: {
        kicker: "Early bird · −50 %",
        lead: "Inscrivez-vous pour être prévenu en premier de l’ouverture de WatchDive sur Kickstarter. Le tarif public sera d’environ 280 € et l’early bird d’environ 140 €, pour les {seats} premiers contributeurs ainsi que pour les inscrits qui ont une réservation de prix ou font partie de la Palanquée. Ces montants sont indicatifs ; le montant affiché sur Kickstarter fera foi.",
      },
    },
    conversionTerms:
      "Pour les {seats} premiers contributeurs sur Kickstarter, ainsi que pour les inscrits qui ont une réservation de prix ou font partie de la Palanquée. L’inscription ne réserve pas l’offre.",
    earlyBirdRace:
      "{price} pour les {seats} premiers sur Kickstarter, plus les réservations de prix et la Palanquée.",
    phoneTerms:
      "L’offre early bird est réservée aux {seats} premiers contributeurs sur Kickstarter, ainsi qu’aux inscrits qui ont une réservation de prix ou font partie de la Palanquée. Ajouter un numéro ne réserve aucune place et ne garantit pas l’offre.",
  },
  de: {
    landing: {
      meta: {
        description:
          "Tiefe und Wassertemperatur misst ein DIVEROID-Sensor im Gehäuse, deine unterstützte Apple Watch oder Galaxy Watch zeigt sie an. Early Bird auf Kickstarter: rund 140 € für die ersten {seats} Unterstützer sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status.",
        ogDescription:
          "Tiefe und Wassertemperatur misst ein DIVEROID-Sensor im Gehäuse, deine unterstützte Apple Watch oder Galaxy Watch zeigt sie an. Early Bird auf Kickstarter: rund 140 € für die ersten {seats} Unterstützer sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status.",
        twitterDescription:
          "Ein Gehäuse mit DIVEROID-Sensor für die Apple Watch oder Galaxy Watch, die du ohnehin trägst. Early Bird auf Kickstarter: rund 140 € für die ersten {seats} Unterstützer sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status.",
      },
      cta: { label: "Erinnere mich · Early Bird rund 140 €" },
      referral: {
        shareText:
          "WatchDive macht die Apple Watch oder Galaxy Watch, die ich ohnehin trage, zum Tauchcomputer. Start auf Kickstarter im Dezember. Komm über meinen Link auf die Liste.",
      },
      usp: { priceTitle: "Early Bird: {price}" },
      hero: { offNote: "Early-Bird-Preis auf Kickstarter" },
      value: { h2: "Early Bird auf Kickstarter: rund 140 €." },
      offer: {
        kicker: "Early Bird · 50 % Rabatt",
        lead: "Melde dich an und erfahre als Erstes, wann WatchDive auf Kickstarter startet. Der öffentliche Preis liegt bei rund 280 €, der Early Bird bei rund 140 € – für die ersten {seats} Unterstützer sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status. Die Eurobeträge sind unverbindliche Richtwerte. Maßgeblich ist der auf Kickstarter angezeigte Betrag.",
      },
    },
    conversionTerms:
      "Für die ersten {seats} Unterstützer auf Kickstarter sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status. Die Anmeldung reserviert das Angebot nicht.",
    earlyBirdRace:
      "{price} für die ersten {seats} auf Kickstarter, dazu Preisreservierung und Tauchteam.",
    phoneTerms:
      "Das Early-Bird-Angebot gilt für die ersten {seats} Unterstützer auf Kickstarter sowie für alle auf der Warteliste mit Preisreservierung oder Tauchteam-Status. Eine Telefonnummer reserviert keinen Platz und garantiert das Angebot nicht.",
  },
  "pt-BR": {
    landing: {
      meta: {
        description:
          "Um sensor DIVEROID dentro da caixa mede a profundidade e a temperatura da água, e o seu Apple Watch ou Galaxy Watch mostra tudo. Early bird por cerca de R$ 800 para os {seats} primeiros apoiadores no Kickstarter e para quem está na lista com reserva de preço ou nível Equipe de mergulho.",
        ogDescription:
          "Um sensor DIVEROID dentro da caixa mede a profundidade e a temperatura da água, e o seu Apple Watch ou Galaxy Watch mostra tudo. Early bird por cerca de R$ 800 para os {seats} primeiros apoiadores no Kickstarter e para quem está na lista com reserva de preço ou nível Equipe de mergulho.",
        twitterDescription:
          "Uma caixa com sensor DIVEROID para o Apple Watch ou Galaxy Watch que você já usa. Early bird por cerca de R$ 800 para os {seats} primeiros apoiadores no Kickstarter e para quem está na lista com reserva de preço ou nível Equipe de mergulho.",
      },
      cta: { label: "Me avise · early bird por cerca de R$ 800" },
      referral: {
        shareText:
          "O WatchDive transforma o Apple Watch ou Galaxy Watch que eu já uso em um computador de mergulho. Chega ao Kickstarter em dezembro. Entra na lista pelo meu link.",
      },
      usp: { priceTitle: "Early bird: {price}" },
      hero: { offNote: "preço early bird no Kickstarter" },
      value: { h2: "Early bird por cerca de R$ 800 no Kickstarter." },
      offer: {
        kicker: "Early bird · 50% off",
        lead: "Cadastre-se e saiba primeiro quando o WatchDive abre no Kickstarter. O preço público deve ficar em cerca de R$ 1.600 e o early bird em cerca de R$ 800, para os {seats} primeiros apoiadores e para quem está na lista com reserva de preço ou nível Equipe de mergulho. Os valores em reais são estimativas; vale o valor exibido no Kickstarter.",
      },
    },
    conversionTerms:
      "Para os primeiros {seats} apoiadores no Kickstarter e para quem está na lista com reserva de preço ou nível Equipe de mergulho. O cadastro não reserva a oferta.",
    earlyBirdRace:
      "{price} para os {seats} primeiros no Kickstarter, mais reservas de preço e Equipe de mergulho.",
    phoneTerms:
      "A oferta early bird é para os primeiros {seats} apoiadores no Kickstarter e para quem está na lista com reserva de preço ou nível Equipe de mergulho. Informar o número não reserva uma vaga nem garante a oferta.",
  },
};

function fillSeats(value: string): string {
  return value.replaceAll("{seats}", String(EARLY_BIRD_SEATS));
}

/** The locale's claim with `{seats}` filled in; `{price}` is left for the caller. */
export function referralPriceClaim(locale: Locale): PriceClaim {
  const copy = REFERRAL_PRICE_CLAIM_COPY[locale] ?? REFERRAL_PRICE_CLAIM_COPY.en;
  const { landing } = copy;
  return {
    landing: {
      meta: {
        description: fillSeats(landing.meta.description),
        ogDescription: fillSeats(landing.meta.ogDescription),
        twitterDescription: fillSeats(landing.meta.twitterDescription),
      },
      cta: { label: fillSeats(landing.cta.label) },
      referral: { shareText: fillSeats(landing.referral.shareText) },
      usp: { priceTitle: fillSeats(landing.usp.priceTitle) },
      hero: { offNote: fillSeats(landing.hero.offNote) },
      value: { h2: fillSeats(landing.value.h2) },
      offer: { kicker: fillSeats(landing.offer.kicker), lead: fillSeats(landing.offer.lead) },
    },
    conversionTerms: fillSeats(copy.conversionTerms),
    earlyBirdRace: fillSeats(copy.earlyBirdRace),
    phoneTerms: fillSeats(copy.phoneTerms),
  };
}
