// Reservation-invite copy. The marketing mail is a short subject, one benefit
// headline, two sentences, and one $3 button. The long fee, refund, and
// statutory block stays in `disclosure` for the checkout page to state before
// payment. It is not printed as a second essay in the mail.
//
// Paying the US$3 reservation fee guarantees the lowest US$149 launch price.
// That guarantee is separate from the public first-100 benefit. The fee is not
// deducted from the product price. US$149 is paid later, by the buyer, and
// is not automatic. The total is US$152 before product shipping and tax.
// The fee is refunded only if the launch is cancelled. Mandatory rights stay.
// The charge happens when the person completes payment, not when the mail opens.
//
// Language is not a country. None of this copy names a destination country.
// The UK legal name is not written here. The footer receives it at runtime.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import type { Locale } from "../i18n/locale.ts";

export type ReservationCopy = {
  subject: string;
  /** Inbox snippet. The first sentence of the pricing block, not a second copy. */
  preheader: string;
  heading: string;
  intro: string;
  /** Second short sentence in the marketing mail. */
  detail: string;
  /** Fee fact retained for checkout, not rendered in marketing mail. */
  feeNote: string;
  /** Checkout-aligned facts. Not printed in the marketing mail. */
  disclosure: string;
  button: string;
  fallback: string;
  reason: string;
  unsubscribe: string;
  privacy: string;
  terms: string;
  help: string;
  anchors: {
    thanks: string;
    pay: string;
    notDeducted: string;
    laterManual: string;
    total: string;
    independence: string;
    cancellation: string;
    mandatory: string;
  };
};

export const RESERVATION_COPY: Record<Locale, ReservationCopy> = {
  "en": {
    "subject": "Skip the rush. Keep $149 for $3.",
    "preheader": "After the first 100, it is $200. Your launch price can stay $149.",
    "heading": "Skip the rush. Keep $149.",
    "intro": "The first 100 Kickstarter backers get WatchDive for $149. Then it is $200.",
    "detail": "Reserve for $3 and guarantee the lowest launch price, wherever you are in line.",
    "feeNote": "The $3 is separate and is not taken off the $149.",
    "disclosure": "Paying the US$3 reservation fee guarantees the lowest US$149 launch price, 100%. It applies separately from the first-100 benefit. The fee is not deducted from the product price. When you buy the product, you pay US$149 separately. The total is US$152, before product shipping and tax. The product price is not charged automatically. The reservation fee is refunded only if the launch is cancelled. Rights the law gives you are not limited.",
    "button": "Keep $149 for $3",
    "fallback": "Or open this link",
    "reason": "You received this because you confirmed your WatchDive signup.",
    "unsubscribe": "Unsubscribe from these emails",
    "privacy": "Privacy",
    "terms": "Terms",
    "help": "Help",
    "anchors": {
      "thanks": "confirmed your WatchDive signup",
      "pay": "Paying the US$3 reservation fee",
      "notDeducted": "not deducted from the product price",
      "laterManual": "not charged automatically",
      "total": "US$152",
      "independence": "separately from the first-100 benefit",
      "cancellation": "only if the launch is cancelled",
      "mandatory": "are not limited"
    }
  },
  "ko": {
    "subject": "선착순 걱정 없이 $149, 예약은 $3로",
    "preheader": "선착순 100명 이후에는 $200. 지금 $149를 보장받으세요.",
    "heading": "선착순 놓쳐도, $149.",
    "intro": "WatchDive는 선착순 100명에게 $149, 이후에는 $200입니다.",
    "detail": "지금 $3로 예약하고, 순서와 관계없이 출시 최저가 $149를 보장받으세요.",
    "feeNote": "$3는 따로 내며, $149에서 빼지 않습니다.",
    "disclosure": "예약금 US$3을 결제하면 WatchDive 출시 최저가 US$149를 100% 보장받습니다. 선착순 100명 혜택과 별도로 적용됩니다. 예약금은 제품 가격에서 차감되지 않으며, 제품 구매 시 US$149를 별도로 결제합니다. 합계 US$152이며 제품 배송비·세금은 별도입니다. 제품 대금은 자동 결제되지 않습니다. 예약금은 출시 취소 시에만 환불됩니다. 관련 법률에 따른 소비자 권리는 제한되지 않습니다.",
    "button": "$3로 $149 보장받기",
    "fallback": "또는 이 링크를 여세요",
    "reason": "WatchDive 가입 이메일을 확인하셨기에 보내 드립니다.",
    "unsubscribe": "이 메일 그만 받기",
    "privacy": "개인정보 처리방침",
    "terms": "이용약관",
    "help": "도움말",
    "anchors": {
      "thanks": "가입 이메일을 확인하셨기에",
      "pay": "예약금 US$3을 결제하면",
      "notDeducted": "차감되지 않으며",
      "laterManual": "자동 결제되지 않습니다",
      "total": "US$152",
      "independence": "선착순 100명 혜택과 별도로",
      "cancellation": "출시 취소 시에만 환불",
      "mandatory": "제한되지 않습니다"
    }
  },
  "zh-CN": {
    "subject": "不用抢前100名，$3锁定$149",
    "preheader": "前100名之后是$200，现在锁定$149发布价。",
    "heading": "错过前100名，不错过$149。",
    "intro": "WatchDive前100名支持者享$149，之后价格为$200。",
    "detail": "现在付$3预约，无需抢先，也能锁定$149发布最低价。",
    "feeNote": "$3 另计，不从 $149 里扣除。",
    "disclosure": "支付预约费 US$3，即可 100% 保证 WatchDive 发布最低价 US$149。此保证与前 100 名优惠分别适用。预约费不从产品价格中抵扣，购买产品时另付 US$149。合计 US$152，产品运费和税费另计。产品价款不会自动扣款。预约费仅在发布取消时退还。法律规定的消费者权利不受限制。",
    "button": "付$3，锁定$149",
    "fallback": "或打开此链接",
    "reason": "你收到这封邮件，是因为你确认了 WatchDive 注册。",
    "unsubscribe": "退订这些邮件",
    "privacy": "隐私",
    "terms": "条款",
    "help": "帮助",
    "anchors": {
      "thanks": "确认了 WatchDive 注册",
      "pay": "支付预约费 US$3",
      "notDeducted": "不从产品价格中抵扣",
      "laterManual": "不会自动扣款",
      "total": "US$152",
      "independence": "分别适用",
      "cancellation": "发布取消时退还",
      "mandatory": "不受限制"
    }
  },
  "zh-TW": {
    "subject": "不用搶前100名，$3鎖定$149",
    "preheader": "前100名之後是$200，現在鎖定$149上市價。",
    "heading": "錯過前100名，不錯過$149。",
    "intro": "WatchDive前100名贊助者享$149，之後價格為$200。",
    "detail": "現在付$3預約，不必搶先，也能鎖定$149上市最低價。",
    "feeNote": "$3 另計，不從 $149 裡扣除。",
    "disclosure": "支付預約費 US$3，即可 100% 保證 WatchDive 發表最低價 US$149。此保證與前 100 名優惠分別適用。預約費不從產品價格中折抵，購買產品時另付 US$149。合計 US$152，產品運費和稅金另計。產品價款不會自動扣款。預約費僅在發表取消時退還。法律規定的消費者權利不受限制。",
    "button": "付$3，鎖定$149",
    "fallback": "或開啟此連結",
    "reason": "你收到這封郵件，是因為你確認了 WatchDive 註冊。",
    "unsubscribe": "停止接收這些郵件",
    "privacy": "隱私",
    "terms": "條款",
    "help": "說明",
    "anchors": {
      "thanks": "確認了 WatchDive 註冊",
      "pay": "支付預約費 US$3",
      "notDeducted": "不從產品價格中折抵",
      "laterManual": "不會自動扣款",
      "total": "US$152",
      "independence": "分別適用",
      "cancellation": "發表取消時退還",
      "mandatory": "不受限制"
    }
  },
  "ja": {
    "subject": "先着順を気にせず、$3で$149を確保",
    "preheader": "先着100名の後は$200。あなたの発売価格は$149に。",
    "heading": "先着100名を逃しても、$149。",
    "intro": "WatchDiveは先着100名が$149、その後は$200になります。",
    "detail": "今$3で予約すれば、先着順に関係なく発売最安値$149を保証します。",
    "feeNote": "$3 は別料金で、$149 からは引きません。",
    "disclosure": "予約金 US$3 をお支払いいただくと、WatchDive の発売最安値 US$149 を 100% 保証します。先着100名の特典とは別に適用されます。予約金は製品価格から差し引かれず、製品のご購入時に US$149 を別途お支払いいただきます。合計は US$152 で、製品の送料と税金は別です。製品代金が自動で請求されることはありません。予約金は発売中止のときのみ返金されます。法令による消費者の権利は制限されません。",
    "button": "$3で$149を確保する",
    "fallback": "またはこのリンクを開いてください",
    "reason": "WatchDive の登録メールを確認されたためお送りしています。",
    "unsubscribe": "このメールの配信を停止する",
    "privacy": "プライバシー",
    "terms": "利用条件",
    "help": "ヘルプ",
    "anchors": {
      "thanks": "登録メールを確認されたため",
      "pay": "予約金 US$3 をお支払いいただくと",
      "notDeducted": "差し引かれず",
      "laterManual": "自動で請求されることはありません",
      "total": "US$152",
      "independence": "先着100名の特典とは別に",
      "cancellation": "発売中止のときのみ返金",
      "mandatory": "制限されません"
    }
  },
  "es": {
    "subject": "Sin prisas: asegura $149 por $3",
    "preheader": "Después de los primeros 100, serán $200. Tú puedes conservar $149.",
    "heading": "Sin prisas. Sin perder los $149.",
    "intro": "Los primeros 100 patrocinadores de WatchDive pagan $149; después, el precio será $200.",
    "detail": "Reserva por $3 y garantiza el precio mínimo de lanzamiento, sin importar tu turno.",
    "feeNote": "Los $3 van aparte y no se restan de los $149.",
    "disclosure": "Pagar la reserva de US$3 garantiza al 100 % el precio de lanzamiento más bajo de US$149. Se aplica aparte del beneficio de los primeros 100. La reserva no se descuenta del precio del producto. Al comprar el producto, pagas US$149 por separado. El total es US$152, antes del envío y de los impuestos del producto. El precio del producto no se cobra automáticamente. La reserva se reembolsa solo si se cancela el lanzamiento. Los derechos que te reconoce la ley no quedan limitados.",
    "button": "Asegura $149 por $3",
    "fallback": "O abre este enlace",
    "reason": "Recibes este mensaje porque confirmaste tu registro en WatchDive.",
    "unsubscribe": "Cancelar estos correos",
    "privacy": "Privacidad",
    "terms": "Términos",
    "help": "Ayuda",
    "anchors": {
      "thanks": "confirmaste tu registro en WatchDive",
      "pay": "Pagar la reserva de US$3",
      "notDeducted": "no se descuenta del precio del producto",
      "laterManual": "no se cobra automáticamente",
      "total": "US$152",
      "independence": "aparte del beneficio de los primeros 100",
      "cancellation": "solo si se cancela el lanzamiento",
      "mandatory": "no quedan limitados"
    }
  },
  "fr": {
    "subject": "Sans vous presser, gardez 149 $ pour 3 $",
    "preheader": "Après les 100 premiers, ce sera 200 $. Votre prix peut rester à 149 $.",
    "heading": "Pas besoin de courir pour garder 149 $.",
    "intro": "Les 100 premiers contributeurs obtiennent WatchDive à 149 $, puis le prix passe à 200 $.",
    "detail": "Réservez pour 3 $ et garantissez le prix de lancement le plus bas, quelle que soit votre place.",
    "feeNote": "Les 3 $ sont à part. Ils ne sont pas retirés des 149 $.",
    "disclosure": "Payer les frais de réservation de US$3 garantit à 100 % le prix de lancement le plus bas de US$149. Cette garantie s'applique séparément de l'avantage des 100 premiers. Les frais ne sont pas déduits du prix du produit. Lors de l'achat, vous payez US$149 à part. Le total est de US$152, hors livraison et taxes du produit. Le prix du produit n'est pas débité automatiquement. Les frais sont remboursés seulement si le lancement est annulé. Les droits que la loi vous accorde ne sont pas limités.",
    "button": "Garantir 149 $ pour 3 $",
    "fallback": "Ou ouvrez ce lien",
    "reason": "Vous recevez ce message parce que vous avez confirmé votre inscription à WatchDive.",
    "unsubscribe": "Se désabonner de ces e-mails",
    "privacy": "Confidentialité",
    "terms": "Conditions",
    "help": "Aide",
    "anchors": {
      "thanks": "vous avez confirmé votre inscription à WatchDive",
      "pay": "Payer les frais de réservation de US$3",
      "notDeducted": "ne sont pas déduits du prix du produit",
      "laterManual": "n'est pas débité automatiquement",
      "total": "US$152",
      "independence": "séparément de l'avantage des 100 premiers",
      "cancellation": "seulement si le lancement est annulé",
      "mandatory": "ne sont pas limités"
    }
  },
  "de": {
    "subject": "Ohne Eile: Für $3 den Preis von $149 sichern",
    "preheader": "Nach den ersten 100 kostet WatchDive $200. Dein Preis kann $149 bleiben.",
    "heading": "Kein Wettlauf. Dein Preis bleibt $149.",
    "intro": "Die ersten 100 Unterstützer erhalten WatchDive für $149, danach kostet es $200.",
    "detail": "Reserviere für $3 und sichere dir den niedrigsten Startpreis – unabhängig von der Reihenfolge.",
    "feeNote": "Die $3 sind separat und werden nicht von den $149 abgezogen.",
    "disclosure": "Wenn Sie die Reservierungsgebühr von US$3 zahlen, garantiert das den niedrigsten Startpreis von US$149 zu 100 %. Das gilt getrennt vom Vorteil für die ersten 100. Die Gebühr wird nicht angerechnet und nicht vom Produktpreis abgezogen. Beim Kauf zahlen Sie US$149 gesondert. Die Summe ist US$152, zuzüglich Versand und Steuern des Produkts. Der Produktpreis wird nicht automatisch berechnet. Die Gebühr wird nur erstattet, wenn der Start abgesagt wird. Gesetzliche Verbraucherrechte werden nicht eingeschränkt.",
    "button": "Für $3 den Preis von $149 sichern",
    "fallback": "Oder öffnen Sie diesen Link",
    "reason": "Sie erhalten diese Nachricht, weil Sie Ihre WatchDive-Anmeldung bestätigt haben.",
    "unsubscribe": "Diese E-Mails abbestellen",
    "privacy": "Datenschutz",
    "terms": "Bedingungen",
    "help": "Hilfe",
    "anchors": {
      "thanks": "Ihre WatchDive-Anmeldung bestätigt haben",
      "pay": "Reservierungsgebühr von US$3",
      "notDeducted": "nicht angerechnet",
      "laterManual": "nicht automatisch berechnet",
      "total": "US$152",
      "independence": "getrennt vom Vorteil für die ersten 100",
      "cancellation": "nur erstattet, wenn der Start abgesagt wird",
      "mandatory": "nicht eingeschränkt"
    }
  },
  "pt-BR": {
    "subject": "Sem correria: garanta $149 por $3",
    "preheader": "Depois dos primeiros 100, serão $200. Seu preço pode continuar em $149.",
    "heading": "Sem correria. Sem perder os $149.",
    "intro": "Os primeiros 100 apoiadores recebem o WatchDive por $149; depois, o preço passa para $200.",
    "detail": "Reserve por $3 e garanta o menor preço de lançamento, independentemente da sua posição.",
    "feeNote": "Os $3 são à parte e não saem dos $149.",
    "disclosure": "Pagar a reserva de US$3 garante 100% o menor preço de lançamento de US$149. Vale separadamente do benefício dos primeiros 100. A reserva não é descontada do preço do produto. Na compra, você paga US$149 à parte. O total é US$152, antes do frete e dos impostos do produto. O preço do produto não é cobrado automaticamente. A reserva é reembolsada somente se o lançamento for cancelado. Os direitos que a lei lhe assegura não ficam limitados.",
    "button": "Garanta $149 por $3",
    "fallback": "Ou abra este link",
    "reason": "Você recebeu esta mensagem porque confirmou seu cadastro no WatchDive.",
    "unsubscribe": "Cancelar estes e-mails",
    "privacy": "Privacidade",
    "terms": "Termos",
    "help": "Ajuda",
    "anchors": {
      "thanks": "confirmou seu cadastro no WatchDive",
      "pay": "Pagar a reserva de US$3",
      "notDeducted": "não é descontada do preço do produto",
      "laterManual": "não é cobrado automaticamente",
      "total": "US$152",
      "independence": "separadamente do benefício dos primeiros 100",
      "cancellation": "somente se o lançamento for cancelado",
      "mandatory": "não ficam limitados"
    }
  }
};

/** Approved tagline. Translated. Not a safety claim and not a price claim. */
export const RESERVATION_TAGLINE: Record<Locale, string> = {
  en: "Every dive maps the ocean.",
  ko: "모든 다이빙이, 바다의 지도가 됩니다.",
  "zh-CN": "每一次潜水，都在绘制这片海。",
  "zh-TW": "每一次潛水，都在繪製這片海。",
  ja: "すべてのダイビングが、海の地図になる。",
  es: "Cada inmersión traza el océano.",
  fr: "Chaque plongée dessine l'océan.",
  de: "Jeder Tauchgang zeichnet den Ozean.",
  "pt-BR": "Cada mergulho mapeia o oceano.",
};

export function copyParagraphs(copy: ReservationCopy): string[] {
  return [
    copy.heading,
    copy.intro,
    copy.detail,
    copy.button,
    copy.fallback,
    copy.reason,
    copy.unsubscribe,
  ];
}
