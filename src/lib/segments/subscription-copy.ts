import type { Locale } from "../i18n/locale";

// Dive-computer features only: no separate subscription.
// Oceanic+ US list prices compare two costs. Both plans stay visible.
export type SubscriptionCopy = {
  usp: string;
  uspShort: string;
  benefitTitle: string;
  benefitBody: string;
  faqQuestion: string;
  faqAnswer: string;
  kicker: string;
  title: string;
  lead: string;
  competitorPlan: string;
  calculation: string;
  twoYearLabel: string;
  oneTimeLabel: string;
  watchIncludes: string;
  watchOffer: string;
  caveat: string;
  basisLabel: string;
  basis: string;
  sourceLabel: string;
};

export const SUBSCRIPTION_COPY: Record<Locale, SubscriptionCopy> = {
  en: {
    usp: "Dive-computer features, with no added subscription.",
    uspShort: "Dive-computer features · No added subscription",
    benefitTitle: "No separate subscription.",
    benefitBody: "WatchDive dive-computer features do not need a separate subscription.",
    faqQuestion: "Do the dive-computer features need a subscription?",
    faqAnswer: "No. WatchDive dive-computer features do not need a separate subscription.",
    kicker: "Two-year cost",
    title: "Two years of subscription, or one purchase.",
    lead: "What does two years of dive-computer use cost?",
    competitorPlan: "Oceanic+ · Annual scuba subscription",
    calculation: "$79.99/year × 2 years",
    twoYearLabel: "Two-year subscription total",
    oneTimeLabel: "One-time purchase",
    watchIncludes: "Housing + dive-computer features",
    watchOffer: "Kickstarter price for the first 100",
    caveat: "Smartwatch prices, shipping, and taxes are not part of this comparison.",
    basisLabel: "Price basis",
    basis:
      "US App Store USD list prices, checked 2026-10-25. These are Oceanic+ app subscription fees for Apple Watch Ultra. Assumes two continuous years at an unchanged price. Scuba is the individual annual plan, which also includes freediving: two payments, $79.99 × 2 = $159.98. Regions and prices may differ. Daily or seasonal use is not included.",
    sourceLabel: "Oceanic+ · US App Store",
  },
  ko: {
    usp: "다이브 컴퓨터 기능, 추가 구독료 없이.",
    uspShort: "다이브 컴퓨터 기능 · 추가 구독료 없음",
    benefitTitle: "추가 구독료가 없습니다.",
    benefitBody: "WatchDive의 다이브 컴퓨터 기능은 별도의 구독료 없이 사용합니다.",
    faqQuestion: "다이브 컴퓨터 기능에 구독료가 따로 있나요?",
    faqAnswer: "없습니다. WatchDive의 다이브 컴퓨터 기능은 추가 구독료 없이 사용합니다.",
    kicker: "2년 비용",
    title: "2년의 구독료, 또는 한 번의 구매.",
    lead: "다이브 컴퓨터 기능을 2년 동안 쓰는 비용은 얼마인가요?",
    competitorPlan: "Oceanic+ · 스쿠버 연간 구독",
    calculation: "$79.99/년 × 2년",
    twoYearLabel: "2년 구독 합계",
    oneTimeLabel: "한 번 구매",
    watchIncludes: "하우징 + 다이브 컴퓨터 기능",
    watchOffer: "Kickstarter 선착순 100명 가격",
    caveat: "스마트워치 가격, 배송비, 세금은 이 비교에 포함되지 않습니다.",
    basisLabel: "가격 기준",
    basis:
      "2026-10-25에 확인한 미국 App Store 달러 정가입니다. Apple Watch Ultra용 Oceanic+ 앱 구독료입니다. 2년 동안 끊김 없이 쓰고 가격은 그대로라고 가정했습니다. 스쿠버는 프리다이빙을 포함하는 개인 연간 요금제이며, 두 번 결제하면 $79.99 × 2 = $159.98입니다. 지역과 가격은 달라질 수 있습니다. 하루 또는 시즌 단위 이용은 계산에 넣지 않았습니다.",
    sourceLabel: "Oceanic+ · 미국 App Store",
  },
  "zh-CN": {
    usp: "潜水电脑功能，无需额外订阅。",
    uspShort: "潜水电脑功能 · 无额外订阅",
    benefitTitle: "无需另行订阅。",
    benefitBody: "WatchDive 的潜水电脑功能不需要另外订阅。",
    faqQuestion: "潜水电脑功能需要订阅吗？",
    faqAnswer: "不需要。WatchDive 的潜水电脑功能无需另行订阅。",
    kicker: "两年费用",
    title: "两年的订阅，或一次购买。",
    lead: "使用两年潜水电脑功能，要花多少钱？",
    competitorPlan: "Oceanic+ · 水肺潜水年费订阅",
    calculation: "$79.99/年 × 2年",
    twoYearLabel: "两年订阅合计",
    oneTimeLabel: "一次购买",
    watchIncludes: "外壳 + 潜水电脑功能",
    watchOffer: "Kickstarter 前 100 名价格",
    caveat: "智能手表价格、运费和税费不计入这次比较。",
    basisLabel: "价格依据",
    basis:
      "2026-10-25 核对的美国 App Store 美元标价。这些是 Apple Watch Ultra 的 Oceanic+ 应用订阅费。假设连续使用两年且价格不变。水肺是包含自由潜水的个人年费方案，支付两次，$79.99 × 2 = $159.98。地区和价格可能不同。未按单日或季节使用计算。",
    sourceLabel: "Oceanic+ · 美国 App Store",
  },
  "zh-TW": {
    usp: "潛水電腦功能，無需額外訂閱。",
    uspShort: "潛水電腦功能 · 無額外訂閱",
    benefitTitle: "無需另行訂閱。",
    benefitBody: "WatchDive 的潛水電腦功能不需要另外訂閱。",
    faqQuestion: "潛水電腦功能需要訂閱嗎？",
    faqAnswer: "不需要。WatchDive 的潛水電腦功能無需另行訂閱。",
    kicker: "兩年費用",
    title: "兩年的訂閱，或一次購買。",
    lead: "使用兩年潛水電腦功能，要花多少錢？",
    competitorPlan: "Oceanic+ · 水肺潛水年費訂閱",
    calculation: "$79.99/年 × 2年",
    twoYearLabel: "兩年訂閱合計",
    oneTimeLabel: "一次購買",
    watchIncludes: "防水殼 + 潛水電腦功能",
    watchOffer: "Kickstarter 前 100 名價格",
    caveat: "智慧手錶價格、運費和稅費不計入這次比較。",
    basisLabel: "價格依據",
    basis:
      "2026-10-25 核對的美國 App Store 美元標價。這些是 Apple Watch Ultra 的 Oceanic+ App 訂閱費。假設連續使用兩年且價格不變。水肺是包含自由潛水的個人年費方案，支付兩次，$79.99 × 2 = $159.98。地區和價格可能不同。未按單日或季節使用計算。",
    sourceLabel: "Oceanic+ · 美國 App Store",
  },
  ja: {
    usp: "ダイブコンピュータ機能。追加のサブスク料金なし。",
    uspShort: "ダイブコンピュータ機能 · 追加のサブスク料金なし",
    benefitTitle: "追加のサブスク料金はありません。",
    benefitBody: "WatchDiveのダイブコンピュータ機能は、別のサブスクなしで使えます。",
    faqQuestion: "ダイブコンピュータ機能に、サブスク料金は別途かかりますか？",
    faqAnswer:
      "かかりません。WatchDiveのダイブコンピュータ機能は、追加のサブスク料金なしで使えます。",
    kicker: "2年分の費用",
    title: "2年分のサブスク料金、または一度の購入。",
    lead: "ダイブコンピュータ機能を2年使うと、いくらかかりますか？",
    competitorPlan: "Oceanic+ · スキューバ年間サブスク",
    calculation: "$79.99/年 × 2年",
    twoYearLabel: "2年分のサブスク合計",
    oneTimeLabel: "一度の購入",
    watchIncludes: "ハウジング + ダイブコンピュータ機能",
    watchOffer: "Kickstarter先着100名の価格",
    caveat: "スマートウォッチの価格、送料、税金はこの比較に含めていません。",
    basisLabel: "価格の根拠",
    basis:
      "2026-10-25に確認した米国App Storeの米ドル表示価格です。Apple Watch Ultra向けOceanic+アプリのサブスク料金です。2年間途切れず使い、価格は変わらない想定です。スキューバはフリーダイビングを含む個人の年額プランで、2回支払うと$79.99 × 2 = $159.98です。地域と価格は異なる場合があり、日単位やシーズン単位の利用は含めていません。",
    sourceLabel: "Oceanic+ · 米国App Store",
  },
  es: {
    usp: "Funciones de ordenador de buceo, sin suscripción adicional.",
    uspShort: "Funciones de ordenador de buceo · Sin suscripción adicional",
    benefitTitle: "Sin suscripción aparte.",
    benefitBody:
      "Las funciones de ordenador de buceo de WatchDive no requieren una suscripción aparte.",
    faqQuestion: "¿Las funciones de ordenador de buceo necesitan suscripción?",
    faqAnswer:
      "No. Las funciones de ordenador de buceo de WatchDive no requieren una suscripción aparte.",
    kicker: "Coste a dos años",
    title: "Dos años de suscripción, o una compra.",
    lead: "¿Cuánto cuesta usar las funciones de ordenador de buceo durante dos años?",
    competitorPlan: "Oceanic+ · Suscripción anual de buceo",
    calculation: "$79.99/año × 2 años",
    twoYearLabel: "Total de suscripción a 2 años",
    oneTimeLabel: "Una sola compra",
    watchIncludes: "Carcasa + funciones de ordenador de buceo",
    watchOffer: "Precio de Kickstarter para los primeros 100",
    caveat: "El precio del smartwatch, el envío y los impuestos quedan fuera de esta comparación.",
    basisLabel: "Base del precio",
    basis:
      "Precios de lista en USD del App Store de EE. UU., revisados el 2026-10-25. Son las tarifas de suscripción de la app Oceanic+ para el Apple Watch Ultra. Se supone un acceso continuo de dos años y un precio sin cambios. Buceo autónomo: plan anual individual, que también incluye apnea, dos pagos, $79.99 × 2 = $159.98. Las regiones y los precios pueden variar. El uso por días o por temporada no está incluido.",
    sourceLabel: "Oceanic+ · App Store de EE. UU.",
  },
  fr: {
    usp: "Fonctions d'ordinateur de plongée, sans abonnement en plus.",
    uspShort: "Fonctions d'ordinateur de plongée · Sans abonnement en plus",
    benefitTitle: "Pas d'abonnement en plus.",
    benefitBody:
      "Les fonctions d'ordinateur de plongée de WatchDive ne demandent pas d'abonnement séparé.",
    faqQuestion: "Faut-il un abonnement pour les fonctions d'ordinateur de plongée ?",
    faqAnswer:
      "Non. Les fonctions d'ordinateur de plongée de WatchDive ne demandent pas d'abonnement séparé.",
    kicker: "Coût sur deux ans",
    title: "Deux ans d'abonnement, ou un seul achat.",
    lead: "Combien coûtent deux ans d'usage des fonctions d'ordinateur de plongée ?",
    competitorPlan: "Oceanic+ · Abonnement annuel de plongée bouteille",
    calculation: "$79.99/an × 2 ans",
    twoYearLabel: "Total d'abonnement sur 2 ans",
    oneTimeLabel: "Achat unique",
    watchIncludes: "Caisson + fonctions d'ordinateur de plongée",
    watchOffer: "Prix Kickstarter pour les 100 premiers",
    caveat:
      "Le prix de la montre connectée, la livraison et les taxes restent hors de cette comparaison.",
    basisLabel: "Base de prix",
    basis:
      "Prix catalogues en USD sur l'App Store américain, vérifiés le 2026-10-25. Ce sont les frais d'abonnement à l'app Oceanic+ pour l'Apple Watch Ultra. Hypothèse : accès continu pendant deux ans et prix inchangé. Plongée bouteille : formule annuelle individuelle, qui comprend aussi l'apnée, deux paiements, $79.99 × 2 = $159.98. Les régions et les prix peuvent différer. L'usage à la journée ou à la saison n'est pas compté.",
    sourceLabel: "Oceanic+ · App Store américain",
  },
  de: {
    usp: "Tauchcomputer-Funktionen, ohne zusätzliches Abo.",
    uspShort: "Tauchcomputer-Funktionen · Kein zusätzliches Abo",
    benefitTitle: "Kein separates Abo.",
    benefitBody: "Die Tauchcomputer-Funktionen von WatchDive brauchen kein separates Abo.",
    faqQuestion: "Brauchen die Tauchcomputer-Funktionen ein Abo?",
    faqAnswer: "Nein. Die Tauchcomputer-Funktionen von WatchDive brauchen kein separates Abo.",
    kicker: "Kosten über zwei Jahre",
    title: "Zwei Jahre Abo, oder ein Kauf.",
    lead: "Was kostet zwei Jahre Nutzung der Tauchcomputer-Funktionen?",
    competitorPlan: "Oceanic+ · Jahresabo fürs Gerätetauchen",
    calculation: "$79.99/Jahr × 2 Jahre",
    twoYearLabel: "Abo-Summe über 2 Jahre",
    oneTimeLabel: "Einmaliger Kauf",
    watchIncludes: "Gehäuse + Tauchcomputer-Funktionen",
    watchOffer: "Kickstarter-Preis für die ersten 100",
    caveat: "Smartwatch-Preise, Versand und Steuern gehören nicht zu diesem Vergleich.",
    basisLabel: "Preisgrundlage",
    basis:
      "USD-Listenpreise im US App Store, geprüft am 2026-10-25. Das sind Abogebühren der Oceanic+ App für die Apple Watch Ultra. Angenommen sind zwei Jahre durchgehende Nutzung und ein unveränderter Preis. Gerätetauchen: individueller Jahrestarif, der auch Apnoetauchen enthält, zwei Zahlungen, $79.99 × 2 = $159.98. Regionen und Preise können abweichen. Tages- oder Saisonnutzung ist nicht eingerechnet.",
    sourceLabel: "Oceanic+ · US App Store",
  },
  "pt-BR": {
    usp: "Funções de computador de mergulho, sem assinatura adicional.",
    uspShort: "Funções de computador de mergulho · Sem assinatura adicional",
    benefitTitle: "Sem assinatura à parte.",
    benefitBody:
      "As funções de computador de mergulho do WatchDive não exigem uma assinatura à parte.",
    faqQuestion: "As funções de computador de mergulho exigem assinatura?",
    faqAnswer:
      "Não. As funções de computador de mergulho do WatchDive não exigem uma assinatura à parte.",
    kicker: "Custo em dois anos",
    title: "Dois anos de assinatura, ou uma compra.",
    lead: "Quanto custa usar as funções de computador de mergulho por dois anos?",
    competitorPlan: "Oceanic+ · Assinatura anual de mergulho autônomo",
    calculation: "$79.99/ano × 2 anos",
    twoYearLabel: "Total da assinatura em 2 anos",
    oneTimeLabel: "Compra única",
    watchIncludes: "Caixa + funções de computador de mergulho",
    watchOffer: "Preço de Kickstarter para os primeiros 100",
    caveat: "O preço do smartwatch, o frete e os impostos ficam de fora desta comparação.",
    basisLabel: "Base do preço",
    basis:
      "Preços de tabela em USD na App Store dos EUA, conferidos em 2026-10-25. São as taxas de assinatura do app Oceanic+ para o Apple Watch Ultra. A conta supõe dois anos contínuos e preço sem mudança. Mergulho autônomo: plano anual individual, que também inclui o mergulho livre, dois pagamentos, $79.99 × 2 = $159.98. Região e preço podem mudar. Uso por dia ou por temporada não entra na conta.",
    sourceLabel: "Oceanic+ · App Store dos EUA",
  },
  nl: {
    usp: "Duikcomputerfuncties, zonder extra abonnement.",
    uspShort: "Duikcomputerfuncties · Geen extra abonnement",
    benefitTitle: "Geen apart abonnement.",
    benefitBody: "De duikcomputerfuncties van WatchDive hebben geen apart abonnement nodig.",
    faqQuestion: "Hebben de duikcomputerfuncties een abonnement nodig?",
    faqAnswer: "Nee. De duikcomputerfuncties van WatchDive hebben geen apart abonnement nodig.",
    kicker: "Kosten over twee jaar",
    title: "Twee jaar abonnement, of één aankoop.",
    lead: "Wat kosten twee jaar gebruik van duikcomputerfuncties?",
    competitorPlan: "Oceanic+ · Jaarabonnement voor scuba",
    calculation: "$79.99/jaar × 2 jaar",
    twoYearLabel: "Abonnementstotaal over 2 jaar",
    oneTimeLabel: "Eenmalige aankoop",
    watchIncludes: "Behuizing + duikcomputerfuncties",
    watchOffer: "Kickstarter-prijs voor de eerste 100",
    caveat: "Smartwatchprijzen, verzending en belastingen horen niet bij deze vergelijking.",
    basisLabel: "Prijsbasis",
    basis:
      "USD-adviesprijzen in de Amerikaanse App Store, gecontroleerd op 2026-10-25. Dit zijn abonnementskosten van de Oceanic+-app voor de Apple Watch Ultra. Uitgangspunt: twee aaneengesloten jaren tegen een ongewijzigde prijs. Scuba is het individuele jaarplan, dat ook freediven bevat: twee betalingen, $79.99 × 2 = $159.98. Regio's en prijzen kunnen verschillen. Gebruik per dag of per seizoen telt niet mee.",
    sourceLabel: "Oceanic+ · Amerikaanse App Store",
  },
};

export function subscriptionCopy(locale: Locale): SubscriptionCopy {
  return SUBSCRIPTION_COPY[locale];
}
