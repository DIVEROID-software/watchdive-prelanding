// Reservation-invite copy. Each language states the same commercial facts
// once, in that language. There is no shared English fact wall and no second
// restatement of the fee, the later price, and the total.
//
// Paying the US$3 reservation fee guarantees the US$149 launch price. That
// guarantee is separate from the public first-100 benefit. The fee is not
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
  /** The one pricing and terms block. */
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
  en: {
    subject: "WatchDive launch price guaranteed at $149 — $3 reservation fee",
    preheader: "Paying the US$3 reservation fee guarantees the US$149 launch price, 100%.",
    heading: "Your US$149 launch price",
    intro: "Thank you for confirming your WatchDive signup.",
    disclosure:
      "Paying the US$3 reservation fee guarantees the US$149 launch price, 100%. It applies separately from the first-100 benefit. The fee is not deducted from the product price. When you buy the product, you pay US$149 separately. The total is US$152, before product shipping and tax. The product price is not charged automatically. The reservation fee is refunded only if the launch is cancelled. Rights the law gives you are not limited.",
    button: "Guarantee the US$149 launch price",
    fallback: "Or open this link",
    reason: "You received this because you confirmed your WatchDive signup.",
    unsubscribe: "Unsubscribe from these emails",
    privacy: "Privacy",
    terms: "Terms",
    help: "Help",
    anchors: {
      thanks: "Thank you for confirming your WatchDive signup",
      pay: "Paying the US$3 reservation fee",
      notDeducted: "not deducted from the product price",
      laterManual: "not charged automatically",
      total: "US$152",
      independence: "separately from the first-100 benefit",
      cancellation: "only if the launch is cancelled",
      mandatory: "are not limited",
    },
  },
  ko: {
    subject: "WatchDive 출시가 $149 보장 — 예약금 $3",
    preheader: "예약금 US$3을 결제하면 WatchDive 출시 최저가 US$149를 100% 보장받습니다.",
    heading: "출시 최저가 US$149",
    intro: "WatchDive 가입을 확인해 주셔서 감사합니다.",
    disclosure:
      "예약금 US$3을 결제하면 WatchDive 출시 최저가 US$149를 100% 보장받습니다. 선착순 100명 혜택과 별도로 적용됩니다. 예약금은 제품 가격에서 차감되지 않으며, 제품 구매 시 US$149를 별도로 결제합니다. 합계 US$152이며 제품 배송비·세금은 별도입니다. 제품 대금은 자동 결제되지 않습니다. 예약금은 출시 취소 시에만 환불됩니다. 관련 법률에 따른 소비자 권리는 제한되지 않습니다.",
    button: "출시 최저가 US$149 보장받기",
    fallback: "또는 이 링크를 여세요",
    reason: "WatchDive 가입 이메일을 확인하셨기에 보내 드립니다.",
    unsubscribe: "이 메일 그만 받기",
    privacy: "개인정보 처리방침",
    terms: "이용약관",
    help: "도움말",
    anchors: {
      thanks: "가입을 확인해 주셔서 감사합니다",
      pay: "예약금 US$3을 결제하면",
      notDeducted: "차감되지 않으며",
      laterManual: "자동 결제되지 않습니다",
      total: "US$152",
      independence: "선착순 100명 혜택과 별도로",
      cancellation: "출시 취소 시에만 환불",
      mandatory: "제한되지 않습니다",
    },
  },
  "zh-CN": {
    subject: "WatchDive 发布价保证 $149 — 预约费 $3",
    preheader: "支付预约费 US$3，即可 100% 保证 WatchDive 发布最低价 US$149。",
    heading: "发布最低价 US$149",
    intro: "感谢你确认 WatchDive 注册。",
    disclosure:
      "支付预约费 US$3，即可 100% 保证 WatchDive 发布最低价 US$149。此保证与前 100 名优惠分别适用。预约费不从产品价格中抵扣，购买产品时另付 US$149。合计 US$152，产品运费和税费另计。产品价款不会自动扣款。预约费仅在发布取消时退还。法律规定的消费者权利不受限制。",
    button: "锁定 US$149 发布价",
    fallback: "或打开此链接",
    reason: "你收到这封邮件，是因为你确认了 WatchDive 注册。",
    unsubscribe: "退订这些邮件",
    privacy: "隐私",
    terms: "条款",
    help: "帮助",
    anchors: {
      thanks: "感谢你确认",
      pay: "支付预约费 US$3",
      notDeducted: "不从产品价格中抵扣",
      laterManual: "不会自动扣款",
      total: "US$152",
      independence: "分别适用",
      cancellation: "发布取消时退还",
      mandatory: "不受限制",
    },
  },
  "zh-TW": {
    subject: "WatchDive 發表價保證 $149 — 預約費 $3",
    preheader: "支付預約費 US$3，即可 100% 保證 WatchDive 發表最低價 US$149。",
    heading: "發表最低價 US$149",
    intro: "感謝你確認 WatchDive 註冊。",
    disclosure:
      "支付預約費 US$3，即可 100% 保證 WatchDive 發表最低價 US$149。此保證與前 100 名優惠分別適用。預約費不從產品價格中折抵，購買產品時另付 US$149。合計 US$152，產品運費和稅金另計。產品價款不會自動扣款。預約費僅在發表取消時退還。法律規定的消費者權利不受限制。",
    button: "鎖定 US$149 發表價",
    fallback: "或開啟此連結",
    reason: "你收到這封郵件，是因為你確認了 WatchDive 註冊。",
    unsubscribe: "停止接收這些郵件",
    privacy: "隱私",
    terms: "條款",
    help: "說明",
    anchors: {
      thanks: "感謝你確認",
      pay: "支付預約費 US$3",
      notDeducted: "不從產品價格中折抵",
      laterManual: "不會自動扣款",
      total: "US$152",
      independence: "分別適用",
      cancellation: "發表取消時退還",
      mandatory: "不受限制",
    },
  },
  ja: {
    subject: "WatchDive の発売価格は $149 を保証 — 予約金 $3",
    preheader:
      "予約金 US$3 をお支払いいただくと、WatchDive の発売最安値 US$149 を 100% 保証します。",
    heading: "発売最安値 US$149",
    intro: "WatchDive の登録を確認していただき、ありがとうございます。",
    disclosure:
      "予約金 US$3 をお支払いいただくと、WatchDive の発売最安値 US$149 を 100% 保証します。先着100名の特典とは別に適用されます。予約金は製品価格から差し引かれず、製品のご購入時に US$149 を別途お支払いいただきます。合計は US$152 で、製品の送料と税金は別です。製品代金が自動で請求されることはありません。予約金は発売中止のときのみ返金されます。法令による消費者の権利は制限されません。",
    button: "発売最安値 US$149 を確保する",
    fallback: "またはこのリンクを開いてください",
    reason: "WatchDive の登録メールを確認されたためお送りしています。",
    unsubscribe: "このメールの配信を停止する",
    privacy: "プライバシー",
    terms: "利用条件",
    help: "ヘルプ",
    anchors: {
      thanks: "ありがとうございます",
      pay: "予約金 US$3 をお支払いいただくと",
      notDeducted: "差し引かれず",
      laterManual: "自動で請求されることはありません",
      total: "US$152",
      independence: "先着100名の特典とは別に",
      cancellation: "発売中止のときのみ返金",
      mandatory: "制限されません",
    },
  },
  es: {
    subject: "Precio de lanzamiento de WatchDive garantizado en $149 — reserva de $3",
    preheader: "Pagar la reserva de US$3 garantiza al 100 % el precio de lanzamiento de US$149.",
    heading: "Tu precio de lanzamiento de US$149",
    intro: "Gracias por confirmar tu registro en WatchDive.",
    disclosure:
      "Pagar la reserva de US$3 garantiza al 100 % el precio de lanzamiento de US$149. Se aplica aparte del beneficio de los primeros 100. La reserva no se descuenta del precio del producto. Al comprar el producto, pagas US$149 por separado. El total es US$152, antes del envío y de los impuestos del producto. El precio del producto no se cobra automáticamente. La reserva se reembolsa solo si se cancela el lanzamiento. Los derechos que te reconoce la ley no quedan limitados.",
    button: "Garantizar el precio de US$149",
    fallback: "O abre este enlace",
    reason: "Recibes este mensaje porque confirmaste tu registro en WatchDive.",
    unsubscribe: "Cancelar estos correos",
    privacy: "Privacidad",
    terms: "Términos",
    help: "Ayuda",
    anchors: {
      thanks: "Gracias por confirmar",
      pay: "Pagar la reserva de US$3",
      notDeducted: "no se descuenta del precio del producto",
      laterManual: "no se cobra automáticamente",
      total: "US$152",
      independence: "aparte del beneficio de los primeros 100",
      cancellation: "solo si se cancela el lanzamiento",
      mandatory: "no quedan limitados",
    },
  },
  fr: {
    subject: "Prix de lancement WatchDive garanti à $149 — frais de réservation de $3",
    preheader:
      "Payer les frais de réservation de US$3 garantit à 100 % le prix de lancement de US$149.",
    heading: "Votre prix de lancement de US$149",
    intro: "Merci d'avoir confirmé votre inscription à WatchDive.",
    disclosure:
      "Payer les frais de réservation de US$3 garantit à 100 % le prix de lancement de US$149. Cette garantie s'applique séparément de l'avantage des 100 premiers. Les frais ne sont pas déduits du prix du produit. Lors de l'achat, vous payez US$149 à part. Le total est de US$152, hors livraison et taxes du produit. Le prix du produit n'est pas débité automatiquement. Les frais sont remboursés seulement si le lancement est annulé. Les droits que la loi vous accorde ne sont pas limités.",
    button: "Garantir le prix de US$149",
    fallback: "Ou ouvrez ce lien",
    reason: "Vous recevez ce message parce que vous avez confirmé votre inscription à WatchDive.",
    unsubscribe: "Se désabonner de ces e-mails",
    privacy: "Confidentialité",
    terms: "Conditions",
    help: "Aide",
    anchors: {
      thanks: "Merci d'avoir confirmé",
      pay: "Payer les frais de réservation de US$3",
      notDeducted: "ne sont pas déduits du prix du produit",
      laterManual: "n'est pas débité automatiquement",
      total: "US$152",
      independence: "séparément de l'avantage des 100 premiers",
      cancellation: "seulement si le lancement est annulé",
      mandatory: "ne sont pas limités",
    },
  },
  de: {
    subject: "WatchDive-Startpreis garantiert bei $149 — Reservierung $3",
    preheader:
      "Wenn Sie die Reservierungsgebühr von US$3 zahlen, ist der Startpreis von US$149 zu 100 % garantiert.",
    heading: "Ihr Startpreis von US$149",
    intro: "Danke, dass Sie Ihre WatchDive-Anmeldung bestätigt haben.",
    disclosure:
      "Wenn Sie die Reservierungsgebühr von US$3 zahlen, ist der Startpreis von US$149 zu 100 % garantiert. Das gilt getrennt vom Vorteil für die ersten 100. Die Gebühr wird nicht angerechnet und nicht vom Produktpreis abgezogen. Beim Kauf zahlen Sie US$149 gesondert. Die Summe ist US$152, zuzüglich Versand und Steuern des Produkts. Der Produktpreis wird nicht automatisch berechnet. Die Gebühr wird nur erstattet, wenn der Start abgesagt wird. Gesetzliche Verbraucherrechte werden nicht eingeschränkt.",
    button: "Startpreis von US$149 sichern",
    fallback: "Oder öffnen Sie diesen Link",
    reason: "Sie erhalten diese Nachricht, weil Sie Ihre WatchDive-Anmeldung bestätigt haben.",
    unsubscribe: "Diese E-Mails abbestellen",
    privacy: "Datenschutz",
    terms: "Bedingungen",
    help: "Hilfe",
    anchors: {
      thanks: "Danke, dass Sie Ihre WatchDive-Anmeldung bestätigt haben",
      pay: "Reservierungsgebühr von US$3",
      notDeducted: "nicht angerechnet",
      laterManual: "nicht automatisch berechnet",
      total: "US$152",
      independence: "getrennt vom Vorteil für die ersten 100",
      cancellation: "nur erstattet, wenn der Start abgesagt wird",
      mandatory: "nicht eingeschränkt",
    },
  },
  "pt-BR": {
    subject: "Preço de lançamento do WatchDive garantido em $149 — reserva de $3",
    preheader: "Pagar a reserva de US$3 garante 100% o preço de lançamento de US$149.",
    heading: "Seu preço de lançamento de US$149",
    intro: "Obrigado por confirmar seu cadastro no WatchDive.",
    disclosure:
      "Pagar a reserva de US$3 garante 100% o preço de lançamento de US$149. Vale separadamente do benefício dos primeiros 100. A reserva não é descontada do preço do produto. Na compra, você paga US$149 à parte. O total é US$152, antes do frete e dos impostos do produto. O preço do produto não é cobrado automaticamente. A reserva é reembolsada somente se o lançamento for cancelado. Os direitos que a lei lhe assegura não ficam limitados.",
    button: "Garantir o preço de US$149",
    fallback: "Ou abra este link",
    reason: "Você recebeu esta mensagem porque confirmou seu cadastro no WatchDive.",
    unsubscribe: "Cancelar estes e-mails",
    privacy: "Privacidade",
    terms: "Termos",
    help: "Ajuda",
    anchors: {
      thanks: "Obrigado por confirmar",
      pay: "Pagar a reserva de US$3",
      notDeducted: "não é descontada do preço do produto",
      laterManual: "não é cobrado automaticamente",
      total: "US$152",
      independence: "separadamente do benefício dos primeiros 100",
      cancellation: "somente se o lançamento for cancelado",
      mandatory: "não ficam limitados",
    },
  },
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
    copy.disclosure,
    copy.button,
    copy.fallback,
    copy.reason,
    copy.unsubscribe,
  ];
}
