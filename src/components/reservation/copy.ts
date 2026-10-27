import {
  PRODUCT_PRICE_USD,
  RESERVATION_FEE_USD,
  TOTAL_BEFORE_SHIPPING_TAX_USD,
  assertReservationPricing,
} from "./pricing.ts";
import type { ReservationLocale } from "./query.ts";

assertReservationPricing();

export type PriceRow = {
  id: "fee" | "product" | "total";
  label: string;
  amount: string;
  detail: string;
};

export type ReservationCopy = {
  metaTitle: string;
  metaDescription: string;
  languageLabel: string;
  english: string;
  korean: string;
  home: string;
  title: string;
  intro: string;
  priceHeading: string;
  priceRows: readonly PriceRow[];
  termsHeading: string;
  terms: readonly string[];
  markRead: string;
  markReadDone: string;
  acceptLabel: string;
  checkout: string;
  checkingOut: string;
  checkAgain: string;
  checkingStatus: string;
  checkoutHintUnread: string;
  checkoutHintUnaccepted: string;
  checkoutHintPending: string;
  checkoutHintUnavailable: string;
  checkoutFailed: string;
  needsInvitation: string;
  invalidInvitation: string;
  offerStatus: string;
  pendingStatus: string;
  paidStatus: string;
  canceledStatus: string;
  canceledRetry: string;
  openStatus: string;
  refundedStatus: string;
  partialRefundStatus: string;
  refundPendingStatus: string;
  disputedStatus: string;
  invalidStatus: string;
  checkoutConflict: string;
  unavailableStatus: string;
  privacy: string;
  siteTerms: string;
  contact: string;
  returnLead: string;
  returnEmailLabel: string;
  returnSubmit: string;
  returnSending: string;
  returnAccepted: string;
  returnInvalid: string;
  returnUnavailable: string;
};

const fee = RESERVATION_FEE_USD;
const product = PRODUCT_PRICE_USD;
const total = TOTAL_BEFORE_SHIPPING_TAX_USD;

const english: ReservationCopy = {
  metaTitle: "Reserve the lowest launch price of $149 for $3",
  metaDescription: `The ${fee} reservation fee is separate from the ${product} product price. Together they are ${total} before shipping and tax.`,
  languageLabel: "Language",
  english: "English",
  korean: "한국어",
  home: "WatchDive home",
  title: "Reserve the lowest launch price of $149 for $3 now.",
  intro:
    "The $3 reservation fee is separate. It is not deducted from the $149 product price at launch.",
  priceHeading: "Prices",
  priceRows: [
    {
      id: "fee",
      label: "Due now",
      amount: fee,
      detail: "Reservation fee. Separate, and not credited toward the product price.",
    },
    {
      id: "product",
      label: "At launch",
      amount: product,
      detail: "Product price. You pay this yourself. It is not charged automatically.",
    },
    {
      id: "total",
      label: "Fee plus product price",
      amount: total,
      detail: "Before shipping and tax, if those apply.",
    },
  ],
  termsHeading: "Before you pay",
  terms: [
    `You pay ${fee} now. This fee is separate. It is not credited toward the ${product} product price, and it does not reduce that price.`,
    `A paid reservation gives a 100% guarantee of the lowest launch price, ${product}, even if you are not among the first 100. You pay that price yourself at launch. WatchDive does not charge it automatically.`,
    `${total} is the fee plus the product price, before shipping and tax if those apply.`,
    `The ${fee} fee is refunded only if we cancel the launch. Rights that the law requires still apply.`,
  ],
  markRead: "I have read this",
  markReadDone: "Marked as read",
  acceptLabel: "I agree, and I want to pay the reservation fee.",
  checkout: `Continue to pay ${fee}`,
  checkingOut: "Opening payment",
  checkAgain: "Check again",
  checkingStatus: "Checking the payment.",
  checkoutHintUnread: "Read the terms, then agree, before you pay.",
  checkoutHintUnaccepted: "Agree to the terms before you pay.",
  checkoutHintPending: "The payment is not confirmed yet.",
  checkoutHintUnavailable: "Payment stays closed until WatchDive can confirm the status.",
  checkoutFailed: "Payment could not be opened. Nothing was confirmed.",
  needsInvitation: "Open the reservation link from your email.",
  invalidInvitation: "This reservation link cannot be used. Open the link from your email again.",
  offerStatus: "The reservation fee has not been paid yet.",
  pendingStatus: "We are still confirming the payment.",
  paidStatus: `The ${fee} reservation fee is paid. It is separate from the ${product} product price and is not credited toward it.`,
  canceledStatus: "The payment was canceled.",
  canceledRetry: "You can agree to the terms and continue when you are ready.",
  openStatus: "A payment is already open. It is not finished.",
  refundedStatus: "The reservation fee was refunded.",
  partialRefundStatus: "Part of the reservation fee was refunded.",
  refundPendingStatus: "A refund is still in progress.",
  disputedStatus: "This payment is disputed. Checkout stays closed.",
  invalidStatus: "We could not confirm this payment.",
  checkoutConflict: "We did not start another payment. We are checking the payment again.",
  unavailableStatus: "We could not confirm the payment yet.",
  privacy: "Privacy",
  siteTerms: "Terms",
  contact: "Questions: help@diveroid.com",
  returnLead: "Send the reservation link to the email address I already used.",
  returnEmailLabel: "Email",
  returnSubmit: "Send my link",
  returnSending: "Sending",
  returnAccepted:
    "If this address has a verified, unpaid WatchDive signup, we send the reservation link there. If it is not verified yet, check the confirmation email you already received.",
  returnInvalid: "Enter a valid email address.",
  returnUnavailable: "The link could not be sent just now. Try again later.",
};

const korean: ReservationCopy = {
  metaTitle: "지금 $3로 최저 출시가 $149를 보장받으세요",
  metaDescription: `예약금 ${fee}는 제품 가격 ${product}와 별도입니다. 둘을 더한 금액은 배송비와 세금 전 ${total}입니다.`,
  languageLabel: "언어",
  english: "English",
  korean: "한국어",
  home: "WatchDive 홈",
  title: "지금 $3로 최저 출시가 $149를 보장받으세요",
  intro: "예약금 $3는 별도이며, 출시 시 제품 가격 $149에서 차감되지 않습니다.",
  priceHeading: "가격",
  priceRows: [
    {
      id: "fee",
      label: "지금",
      amount: fee,
      detail: "예약금입니다. 제품 가격과 별도이며, 그 가격에서 차감되지 않습니다.",
    },
    {
      id: "product",
      label: "출시 때",
      amount: product,
      detail: "제품 가격입니다. 출시 때 직접 결제하며, 자동으로 청구되지 않습니다.",
    },
    {
      id: "total",
      label: "합계",
      amount: total,
      detail: "예약금과 제품 가격입니다. 적용되는 배송비와 세금은 포함되지 않습니다.",
    },
  ],
  termsHeading: "결제 전에",
  terms: [
    `지금 ${fee}를 결제합니다. 예약금은 별도이며, 제품 가격 ${product}에서 차감되지 않고 그 가격을 낮추지 않습니다.`,
    `결제한 예약은 처음 100명에 들지 않아도 최저 출시가인 제품 가격 ${product}를 100% 보장합니다. 이 가격은 출시 때 직접 결제하며, 자동으로 청구되지 않습니다.`,
    `${total}는 예약금과 제품 가격을 더한 금액이며, 적용되는 배송비와 세금은 포함되지 않습니다.`,
    `${fee} 예약금은 출시를 취소하는 경우에만 환불됩니다. 법이 요구하는 권리는 그대로 적용됩니다.`,
  ],
  markRead: "위 내용을 읽었습니다",
  markReadDone: "읽음으로 표시했습니다",
  acceptLabel: "동의하고 예약금을 결제합니다.",
  checkout: `${fee} 결제하기`,
  checkingOut: "결제를 여는 중",
  checkAgain: "다시 확인",
  checkingStatus: "결제를 확인하고 있습니다.",
  checkoutHintUnread: "결제하기 전에 내용을 읽고 동의해 주세요.",
  checkoutHintUnaccepted: "결제하기 전에 동의해 주세요.",
  checkoutHintPending: "결제가 아직 확인되지 않았습니다.",
  checkoutHintUnavailable: "WatchDive가 상태를 확인할 때까지 결제는 열리지 않습니다.",
  checkoutFailed: "결제를 열지 못했습니다. 확인된 금액은 없습니다.",
  needsInvitation: "이메일로 받은 예약 링크를 열어 주세요.",
  invalidInvitation: "이 예약 링크는 사용할 수 없습니다. 이메일로 받은 링크를 다시 열어 주세요.",
  offerStatus: "예약금은 아직 결제되지 않았습니다.",
  pendingStatus: "결제를 아직 확인하고 있습니다.",
  paidStatus: `${fee} 예약금이 결제되었습니다. 이 금액은 ${product} 제품 가격과 별도이며, 그 가격에서 차감되지 않습니다.`,
  canceledStatus: "결제를 취소했습니다.",
  canceledRetry: "준비되면 내용에 동의하고 계속할 수 있습니다.",
  openStatus: "이미 열린 결제가 있습니다. 아직 끝나지 않았습니다.",
  refundedStatus: "예약금이 환불되었습니다.",
  partialRefundStatus: "예약금의 일부가 환불되었습니다.",
  refundPendingStatus: "환불이 아직 진행 중입니다.",
  disputedStatus: "이 결제는 분쟁 중입니다. 결제는 열리지 않습니다.",
  invalidStatus: "이 결제를 확인하지 못했습니다.",
  checkoutConflict: "다른 결제를 시작하지 않았습니다. 결제를 다시 확인하고 있습니다.",
  unavailableStatus: "결제를 아직 확인하지 못했습니다.",
  privacy: "개인정보처리방침",
  siteTerms: "이용약관",
  contact: "문의: help@diveroid.com",
  returnLead: "이미 사용한 이메일로 예약 링크를 보내 주세요.",
  returnEmailLabel: "이메일",
  returnSubmit: "링크 보내기",
  returnSending: "보내는 중",
  returnAccepted:
    "인증된 미결제 신청 내역이 있으면 예약 링크를 보내드립니다. 인증 전이라면 기존 인증 메일을 확인해 주세요.",
  returnInvalid: "올바른 이메일 주소를 입력해 주세요.",
  returnUnavailable: "지금은 링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

const chineseSimplified: ReservationCopy = {
  metaTitle: "现在用 $3 锁定最低发布价 $149",
  metaDescription: `预约金 ${fee} 与产品价格 ${product} 分开计算。两者合计为运费和税费前的 ${total}。`,
  languageLabel: "语言",
  english: "English",
  korean: "한국어",
  home: "WatchDive 首页",
  title: "现在用 $3 锁定最低发布价 $149",
  intro: "$3 预约金是另计的，不会从发布时的 $149 产品价格中扣除。",
  priceHeading: "价格",
  priceRows: [
    { id: "fee", label: "现在", amount: fee, detail: "预约金。与产品价格分开，不抵扣产品价格。" },
    {
      id: "product",
      label: "发布时",
      amount: product,
      detail: "产品价格。由您自行支付，不会自动扣款。",
    },
    {
      id: "total",
      label: "合计",
      amount: total,
      detail: "预约金加产品价格。不含适用的运费和税费。",
    },
  ],
  termsHeading: "付款前",
  terms: [
    `您现在支付 ${fee}。这笔费用是另计的，不抵扣 ${product} 产品价格，也不会降低该价格。`,
    `已支付的预约 100% 保证最低发布价 ${product}，即使您不在前 100 名之列。该价格由您在发布时自行支付。WatchDive 不会自动扣款。`,
    `${total} 是预约金加产品价格，不含适用的运费和税费。`,
    `${fee} 预约金仅在我们取消发布时退还。法律要求保留的权利仍然适用。`,
  ],
  markRead: "我已阅读以上内容",
  markReadDone: "已标为已读",
  acceptLabel: "我同意，并支付预约金。",
  checkout: `继续支付 ${fee}`,
  checkingOut: "正在打开付款",
  checkAgain: "再次查看",
  checkingStatus: "正在确认付款。",
  checkoutHintUnread: "付款前请先阅读并同意。",
  checkoutHintUnaccepted: "付款前请先同意。",
  checkoutHintPending: "付款尚未确认。",
  checkoutHintUnavailable: "在 WatchDive 能够确认状态之前，付款保持关闭。",
  checkoutFailed: "未能打开付款。没有已确认的金额。",
  needsInvitation: "请打开邮件中的预约链接。",
  invalidInvitation: "这个预约链接无法使用。请重新打开邮件中的链接。",
  offerStatus: "预约金尚未支付。",
  pendingStatus: "我们仍在确认付款。",
  paidStatus: `${fee} 预约金已支付。它与 ${product} 产品价格分开，不从该价格中抵扣。`,
  canceledStatus: "付款已取消。",
  canceledRetry: "准备好后，您可以同意条款并继续。",
  openStatus: "已有一笔未完成的付款。",
  refundedStatus: "预约金已退还。",
  partialRefundStatus: "预约金已部分退还。",
  refundPendingStatus: "退款仍在处理中。",
  disputedStatus: "这笔付款存在争议。结账保持关闭。",
  invalidStatus: "我们无法确认这笔付款。",
  checkoutConflict: "我们没有开始另一笔付款。正在重新确认付款。",
  unavailableStatus: "我们还不能确认付款。",
  privacy: "隐私",
  siteTerms: "条款",
  contact: "咨询：help@diveroid.com",
  returnLead: "把预约链接发到我已经使用的邮箱。",
  returnEmailLabel: "邮箱",
  returnSubmit: "发送链接",
  returnSending: "正在发送",
  returnAccepted:
    "如果这个地址有已验证且尚未付款的 WatchDive 申请，我们会把预约链接发到那里。如果尚未验证，请查看之前收到的确认邮件。",
  returnInvalid: "请输入有效的邮箱地址。",
  returnUnavailable: "现在无法发送链接。请稍后再试。",
};

const chineseTraditional: ReservationCopy = {
  metaTitle: "現在用 $3 鎖定最低上市價 $149",
  metaDescription: `預約金 ${fee} 與產品價格 ${product} 分開計算。兩者合計為運費和稅費前的 ${total}。`,
  languageLabel: "語言",
  english: "English",
  korean: "한국어",
  home: "WatchDive 首頁",
  title: "現在用 $3 鎖定最低上市價 $149",
  intro: "$3 預約金是另計的，不會從上市時的 $149 產品價格中扣除。",
  priceHeading: "價格",
  priceRows: [
    { id: "fee", label: "現在", amount: fee, detail: "預約金。與產品價格分開，不抵扣產品價格。" },
    {
      id: "product",
      label: "上市時",
      amount: product,
      detail: "產品價格。由您自行支付，不會自動扣款。",
    },
    {
      id: "total",
      label: "合計",
      amount: total,
      detail: "預約金加產品價格。不含適用的運費和稅費。",
    },
  ],
  termsHeading: "付款前",
  terms: [
    `您現在支付 ${fee}。這筆費用是另計的，不抵扣 ${product} 產品價格，也不會降低該價格。`,
    `已支付的預約 100% 保證最低上市價 ${product}，即使您不在前 100 名之列。該價格由您在上市時自行支付。WatchDive 不會自動扣款。`,
    `${total} 是預約金加產品價格，不含適用的運費和稅費。`,
    `${fee} 預約金僅在我們取消上市時退還。法律要求保留的權利仍然適用。`,
  ],
  markRead: "我已閱讀以上內容",
  markReadDone: "已標為已讀",
  acceptLabel: "我同意，並支付預約金。",
  checkout: `繼續支付 ${fee}`,
  checkingOut: "正在開啟付款",
  checkAgain: "再次查看",
  checkingStatus: "正在確認付款。",
  checkoutHintUnread: "付款前請先閱讀並同意。",
  checkoutHintUnaccepted: "付款前請先同意。",
  checkoutHintPending: "付款尚未確認。",
  checkoutHintUnavailable: "在 WatchDive 能夠確認狀態之前，付款保持關閉。",
  checkoutFailed: "未能開啟付款。沒有已確認的金額。",
  needsInvitation: "請開啟電子郵件中的預約連結。",
  invalidInvitation: "這個預約連結無法使用。請重新開啟郵件中的連結。",
  offerStatus: "預約金尚未支付。",
  pendingStatus: "我們仍在確認付款。",
  paidStatus: `${fee} 預約金已支付。它與 ${product} 產品價格分開，不從該價格中抵扣。`,
  canceledStatus: "付款已取消。",
  canceledRetry: "準備好後，您可以同意條款並繼續。",
  openStatus: "已有一筆未完成的付款。",
  refundedStatus: "預約金已退還。",
  partialRefundStatus: "預約金已部分退還。",
  refundPendingStatus: "退款仍在處理中。",
  disputedStatus: "這筆付款存在爭議。結帳保持關閉。",
  invalidStatus: "我們無法確認這筆付款。",
  checkoutConflict: "我們沒有開始另一筆付款。正在重新確認付款。",
  unavailableStatus: "我們還不能確認付款。",
  privacy: "隱私",
  siteTerms: "條款",
  contact: "諮詢：help@diveroid.com",
  returnLead: "把預約連結寄到我已經使用的電子郵件。",
  returnEmailLabel: "電子郵件",
  returnSubmit: "寄送連結",
  returnSending: "正在寄送",
  returnAccepted:
    "如果這個地址有已驗證且尚未付款的 WatchDive 申請，我們會把預約連結寄到那裡。如果尚未驗證，請查看之前收到的確認郵件。",
  returnInvalid: "請輸入有效的電子郵件地址。",
  returnUnavailable: "現在無法寄送連結。請稍後再試。",
};

const japanese: ReservationCopy = {
  metaTitle: "今 $3 で最低発売価格 $149 を確保",
  metaDescription: `予約金 ${fee} は製品価格 ${product} とは別です。合計 ${total} には、適用される送料と税金は含まれません。`,
  languageLabel: "言語",
  english: "English",
  korean: "한국어",
  home: "WatchDive ホーム",
  title: "今 $3 で最低発売価格 $149 を確保する",
  intro: "予約金 $3 は別料金です。発売時の製品価格 $149 からは差し引かれません。",
  priceHeading: "価格",
  priceRows: [
    {
      id: "fee",
      label: "今",
      amount: fee,
      detail: "予約金です。製品価格とは別で、製品価格には充当されません。",
    },
    {
      id: "product",
      label: "発売時",
      amount: product,
      detail: "製品価格です。ご自身で支払い、自動では請求されません。",
    },
    {
      id: "total",
      label: "合計",
      amount: total,
      detail: "予約金と製品価格です。適用される送料と税金は含まれません。",
    },
  ],
  termsHeading: "支払いの前に",
  terms: [
    `今 ${fee} を支払います。この料金は別料金で、${product} の製品価格には充当されず、その価格を下げることもありません。`,
    `支払い済みの予約は、最初の100名に入らなくても、最低発売価格である製品価格 ${product} を100%保証します。この価格は発売時にご自身で支払います。WatchDive が自動で請求することはありません。`,
    `${total} は予約金と製品価格の合計で、適用される送料と税金は含まれません。`,
    `${fee} の予約金が返金されるのは、発売を中止した場合だけです。法律が求める権利は残ります。`,
  ],
  markRead: "上記を読みました",
  markReadDone: "読んだことを記録しました",
  acceptLabel: "同意して、予約金を支払います。",
  checkout: `${fee} の支払いに進む`,
  checkingOut: "支払いを開いています",
  checkAgain: "もう一度確認",
  checkingStatus: "支払いを確認しています。",
  checkoutHintUnread: "支払う前に内容を読み、同意してください。",
  checkoutHintUnaccepted: "支払う前に同意してください。",
  checkoutHintPending: "支払いはまだ確認されていません。",
  checkoutHintUnavailable: "WatchDive が状態を確認できるまで、支払いは開きません。",
  checkoutFailed: "支払いを開けませんでした。確認された金額はありません。",
  needsInvitation: "メールで届いた予約リンクを開いてください。",
  invalidInvitation: "この予約リンクは使えません。メールのリンクを開き直してください。",
  offerStatus: "予約金はまだ支払われていません。",
  pendingStatus: "支払いをまだ確認しています。",
  paidStatus: `${fee} の予約金が支払われました。${product} の製品価格とは別で、その価格からは差し引かれません。`,
  canceledStatus: "支払いを取り消しました。",
  canceledRetry: "準備ができたら、内容に同意して続けられます。",
  openStatus: "未完了の支払いがすでに開いています。",
  refundedStatus: "予約金は返金されました。",
  partialRefundStatus: "予約金の一部が返金されました。",
  refundPendingStatus: "返金はまだ処理中です。",
  disputedStatus: "この支払いは係争中です。支払い画面は閉じたままです。",
  invalidStatus: "この支払いを確認できませんでした。",
  checkoutConflict: "別の支払いは始めていません。支払いを再度確認しています。",
  unavailableStatus: "支払いはまだ確認できていません。",
  privacy: "プライバシー",
  siteTerms: "利用規約",
  contact: "お問い合わせ：help@diveroid.com",
  returnLead: "すでに使ったメールアドレスへ予約リンクを送ります。",
  returnEmailLabel: "メール",
  returnSubmit: "リンクを送る",
  returnSending: "送信中",
  returnAccepted:
    "このアドレスに確認済みで未払いの WatchDive 申請があれば、予約リンクをそこへ送ります。まだ確認前なら、すでにお届けした確認メールをご覧ください。",
  returnInvalid: "有効なメールアドレスを入力してください。",
  returnUnavailable: "今はリンクを送れません。しばらくしてからもう一度お試しください。",
};

const spanish: ReservationCopy = {
  metaTitle: "Reserva el precio de lanzamiento más bajo de $149 por $3",
  metaDescription: `La reserva de ${fee} es aparte del precio del producto de ${product}. Juntas son ${total} antes de envío e impuestos.`,
  languageLabel: "Idioma",
  english: "English",
  korean: "한국어",
  home: "Inicio de WatchDive",
  title: "Reserva ahora el precio de lanzamiento más bajo de $149 por $3.",
  intro:
    "La reserva de $3 es aparte. No se descuenta del precio del producto de $149 en el lanzamiento.",
  priceHeading: "Precios",
  priceRows: [
    {
      id: "fee",
      label: "Ahora",
      amount: fee,
      detail: "Reserva. Aparte, y no se abona al precio del producto.",
    },
    {
      id: "product",
      label: "En el lanzamiento",
      amount: product,
      detail: "Precio del producto. Lo pagas tú. No se cobra automáticamente.",
    },
    {
      id: "total",
      label: "Reserva más precio",
      amount: total,
      detail: "Antes del envío y de los impuestos, si corresponden.",
    },
  ],
  termsHeading: "Antes de pagar",
  terms: [
    `Pagas ${fee} ahora. Esta cuota es aparte. No se abona al precio de ${product} ni lo reduce.`,
    `Una reserva pagada garantiza al 100% el precio de lanzamiento más bajo, ${product}, aunque no estés entre las primeras 100 personas. Ese precio lo pagas tú en el lanzamiento. WatchDive no lo cobra automáticamente.`,
    `${total} es la cuota más el precio del producto, antes del envío y de los impuestos que correspondan.`,
    `La cuota de ${fee} se reembolsa solo si cancelamos el lanzamiento. Siguen aplicando los derechos que exige la ley.`,
  ],
  markRead: "He leído esto",
  markReadDone: "Marcado como leído",
  acceptLabel: "Acepto y quiero pagar la reserva.",
  checkout: `Continuar para pagar ${fee}`,
  checkingOut: "Abriendo el pago",
  checkAgain: "Comprobar de nuevo",
  checkingStatus: "Comprobando el pago.",
  checkoutHintUnread: "Lee las condiciones y acepta antes de pagar.",
  checkoutHintUnaccepted: "Acepta las condiciones antes de pagar.",
  checkoutHintPending: "El pago todavía no está confirmado.",
  checkoutHintUnavailable: "El pago sigue cerrado hasta que WatchDive pueda confirmar el estado.",
  checkoutFailed: "No se pudo abrir el pago. No hay ningún importe confirmado.",
  needsInvitation: "Abre el enlace de reserva que recibiste por correo.",
  invalidInvitation: "Este enlace de reserva no se puede usar. Abre de nuevo el enlace del correo.",
  offerStatus: "La reserva todavía no se ha pagado.",
  pendingStatus: "Seguimos confirmando el pago.",
  paidStatus: `La reserva de ${fee} está pagada. Es aparte del precio del producto de ${product} y no se descuenta de él.`,
  canceledStatus: "El pago se canceló.",
  canceledRetry: "Cuando quieras, puedes aceptar las condiciones y continuar.",
  openStatus: "Ya hay un pago abierto. No ha terminado.",
  refundedStatus: "La reserva se reembolsó.",
  partialRefundStatus: "Se reembolsó una parte de la reserva.",
  refundPendingStatus: "Un reembolso sigue en curso.",
  disputedStatus: "Este pago está en disputa. El pago sigue cerrado.",
  invalidStatus: "No pudimos confirmar este pago.",
  checkoutConflict: "No iniciamos otro pago. Estamos comprobando el pago otra vez.",
  unavailableStatus: "Todavía no pudimos confirmar el pago.",
  privacy: "Privacidad",
  siteTerms: "Condiciones",
  contact: "Preguntas: help@diveroid.com",
  returnLead: "Enviad el enlace de reserva al correo que ya usé.",
  returnEmailLabel: "Correo",
  returnSubmit: "Enviar mi enlace",
  returnSending: "Enviando",
  returnAccepted:
    "Si esta dirección tiene una solicitud de WatchDive verificada y sin pago, enviamos el enlace de reserva ahí. Si aún no está verificada, revisa el correo de confirmación que ya recibiste.",
  returnInvalid: "Introduce un correo válido.",
  returnUnavailable: "No se pudo enviar el enlace ahora. Inténtalo más tarde.",
};

const french: ReservationCopy = {
  metaTitle: "Réservez le prix de lancement le plus bas de $149 pour $3",
  metaDescription: `Les ${fee} de réservation sont distincts du prix du produit de ${product}. Ensemble, ils font ${total} avant livraison et taxes.`,
  languageLabel: "Langue",
  english: "English",
  korean: "한국어",
  home: "Accueil WatchDive",
  title: "Réservez maintenant le prix de lancement le plus bas de $149 pour $3.",
  intro:
    "Les $3 de réservation sont distincts. Ils ne sont pas déduits du prix du produit de $149 au lancement.",
  priceHeading: "Prix",
  priceRows: [
    {
      id: "fee",
      label: "Maintenant",
      amount: fee,
      detail: "Réservation. Distincte, et non déduite du prix du produit.",
    },
    {
      id: "product",
      label: "Au lancement",
      amount: product,
      detail: "Prix du produit. Vous le payez vous-même. Il n’est pas prélevé automatiquement.",
    },
    {
      id: "total",
      label: "Réservation et prix",
      amount: total,
      detail: "Avant les frais de livraison et les taxes, s’ils s’appliquent.",
    },
  ],
  termsHeading: "Avant de payer",
  terms: [
    `Vous payez ${fee} maintenant. Ces frais sont distincts. Ils ne sont pas déduits du prix de ${product} et ne le réduisent pas.`,
    `Une réservation payée garantit à 100 % le prix de lancement le plus bas, ${product}, même si vous n’êtes pas parmi les 100 premières personnes. Vous payez ce prix vous-même au lancement. WatchDive ne le prélève pas automatiquement.`,
    `${total} correspond aux frais plus le prix du produit, avant les frais de livraison et les taxes s’ils s’appliquent.`,
    `Les frais de ${fee} sont remboursés seulement si nous annulons le lancement. Les droits exigés par la loi restent applicables.`,
  ],
  markRead: "J’ai lu ceci",
  markReadDone: "Marqué comme lu",
  acceptLabel: "J’accepte et je veux payer la réservation.",
  checkout: `Continuer pour payer ${fee}`,
  checkingOut: "Ouverture du paiement",
  checkAgain: "Vérifier à nouveau",
  checkingStatus: "Vérification du paiement.",
  checkoutHintUnread: "Lisez les conditions, puis acceptez-les, avant de payer.",
  checkoutHintUnaccepted: "Acceptez les conditions avant de payer.",
  checkoutHintPending: "Le paiement n’est pas encore confirmé.",
  checkoutHintUnavailable:
    "Le paiement reste fermé tant que WatchDive ne peut pas confirmer le statut.",
  checkoutFailed: "Le paiement n’a pas pu s’ouvrir. Aucun montant n’est confirmé.",
  needsInvitation: "Ouvrez le lien de réservation reçu par e-mail.",
  invalidInvitation:
    "Ce lien de réservation ne peut pas être utilisé. Ouvrez à nouveau le lien de l’e-mail.",
  offerStatus: "Les frais de réservation ne sont pas encore payés.",
  pendingStatus: "Nous confirmons encore le paiement.",
  paidStatus: `Les frais de réservation de ${fee} sont payés. Ils sont distincts du prix du produit de ${product} et n’en sont pas déduits.`,
  canceledStatus: "Le paiement a été annulé.",
  canceledRetry: "Vous pouvez accepter les conditions et continuer quand vous êtes prêt.",
  openStatus: "Un paiement est déjà ouvert. Il n’est pas terminé.",
  refundedStatus: "Les frais de réservation ont été remboursés.",
  partialRefundStatus: "Une partie des frais de réservation a été remboursée.",
  refundPendingStatus: "Un remboursement est encore en cours.",
  disputedStatus: "Ce paiement est contesté. Le paiement reste fermé.",
  invalidStatus: "Nous n’avons pas pu confirmer ce paiement.",
  checkoutConflict:
    "Nous n’avons pas commencé un autre paiement. Nous vérifions à nouveau le paiement.",
  unavailableStatus: "Nous n’avons pas encore pu confirmer le paiement.",
  privacy: "Confidentialité",
  siteTerms: "Conditions",
  contact: "Questions : help@diveroid.com",
  returnLead: "Envoyez le lien de réservation à l’adresse que j’ai déjà utilisée.",
  returnEmailLabel: "E-mail",
  returnSubmit: "Envoyer mon lien",
  returnSending: "Envoi",
  returnAccepted:
    "Si cette adresse a une inscription WatchDive vérifiée et non payée, nous envoyons le lien de réservation à cette boîte. Si elle n’est pas encore vérifiée, ouvrez le message de confirmation déjà reçu.",
  returnInvalid: "Indiquez une adresse e-mail valide.",
  returnUnavailable: "Le lien n’a pas pu partir pour le moment. Réessayez plus tard.",
};

const german: ReservationCopy = {
  metaTitle: "Niedrigsten Startpreis von $149 jetzt für $3 sichern",
  metaDescription: `Die Reservierung von ${fee} ist vom Produktpreis ${product} getrennt. Zusammen sind das ${total} vor Versand und Steuer.`,
  languageLabel: "Sprache",
  english: "English",
  korean: "한국어",
  home: "WatchDive Start",
  title: "Sichern Sie sich jetzt den niedrigsten Startpreis von $149 für $3.",
  intro:
    "Die Reservierungsgebühr von $3 ist separat. Sie wird beim Start nicht vom Produktpreis von $149 abgezogen.",
  priceHeading: "Preise",
  priceRows: [
    {
      id: "fee",
      label: "Jetzt",
      amount: fee,
      detail: "Reservierungsgebühr. Separat und nicht auf den Produktpreis angerechnet.",
    },
    {
      id: "product",
      label: "Beim Start",
      amount: product,
      detail: "Produktpreis. Sie zahlen ihn selbst. Er wird nicht automatisch belastet.",
    },
    {
      id: "total",
      label: "Gebühr plus Preis",
      amount: total,
      detail: "Vor Versand und Steuer, falls diese anfallen.",
    },
  ],
  termsHeading: "Vor der Zahlung",
  terms: [
    `Sie zahlen jetzt ${fee}. Diese Gebühr ist separat. Sie wird nicht auf den Produktpreis von ${product} angerechnet und senkt ihn nicht.`,
    `Eine bezahlte Reservierung garantiert den niedrigsten Startpreis von ${product} zu 100 %, auch wenn Sie nicht zu den ersten 100 gehören. Diesen Preis zahlen Sie beim Start selbst. WatchDive belastet ihn nicht automatisch.`,
    `${total} sind Gebühr plus Produktpreis, vor Versand und Steuer, falls diese anfallen.`,
    `Die Gebühr von ${fee} wird nur erstattet, wenn wir den Start absagen. Rechte, die das Gesetz verlangt, bleiben bestehen.`,
  ],
  markRead: "Ich habe das gelesen",
  markReadDone: "Als gelesen markiert",
  acceptLabel: "Ich stimme zu und möchte die Reservierung bezahlen.",
  checkout: `Weiter zur Zahlung von ${fee}`,
  checkingOut: "Zahlung wird geöffnet",
  checkAgain: "Erneut prüfen",
  checkingStatus: "Die Zahlung wird geprüft.",
  checkoutHintUnread: "Lesen Sie die Bedingungen und stimmen Sie zu, bevor Sie zahlen.",
  checkoutHintUnaccepted: "Stimmen Sie den Bedingungen zu, bevor Sie zahlen.",
  checkoutHintPending: "Die Zahlung ist noch nicht bestätigt.",
  checkoutHintUnavailable:
    "Die Zahlung bleibt geschlossen, bis WatchDive den Status bestätigen kann.",
  checkoutFailed: "Die Zahlung konnte nicht geöffnet werden. Es wurde kein Betrag bestätigt.",
  needsInvitation: "Öffnen Sie den Reservierungslink aus Ihrer E-Mail.",
  invalidInvitation:
    "Dieser Reservierungslink kann nicht verwendet werden. Öffnen Sie den Link aus der E-Mail erneut.",
  offerStatus: "Die Reservierungsgebühr ist noch nicht bezahlt.",
  pendingStatus: "Wir bestätigen die Zahlung noch.",
  paidStatus: `Die Reservierungsgebühr von ${fee} ist bezahlt. Sie ist vom Produktpreis ${product} getrennt und wird nicht davon abgezogen.`,
  canceledStatus: "Die Zahlung wurde abgebrochen.",
  canceledRetry: "Sie können den Bedingungen zustimmen und fortfahren, wenn Sie bereit sind.",
  openStatus: "Eine Zahlung ist bereits offen. Sie ist noch nicht abgeschlossen.",
  refundedStatus: "Die Reservierungsgebühr wurde erstattet.",
  partialRefundStatus: "Ein Teil der Reservierungsgebühr wurde erstattet.",
  refundPendingStatus: "Eine Erstattung läuft noch.",
  disputedStatus: "Diese Zahlung ist angefochten. Die Zahlung bleibt geschlossen.",
  invalidStatus: "Wir konnten diese Zahlung nicht bestätigen.",
  checkoutConflict: "Wir haben keine weitere Zahlung gestartet. Wir prüfen die Zahlung erneut.",
  unavailableStatus: "Wir konnten die Zahlung noch nicht bestätigen.",
  privacy: "Datenschutz",
  siteTerms: "Bedingungen",
  contact: "Fragen: help@diveroid.com",
  returnLead: "Schickt den Reservierungslink an die Adresse, die ich schon verwendet habe.",
  returnEmailLabel: "E-Mail",
  returnSubmit: "Meinen Link senden",
  returnSending: "Wird gesendet",
  returnAccepted:
    "Wenn zu dieser Adresse eine bestätigte, unbezahlte WatchDive-Anmeldung vorliegt, senden wir den Reservierungslink dorthin. Wenn sie noch nicht bestätigt ist, sieh in der Bestätigungsmail nach, die du schon bekommen hast.",
  returnInvalid: "Gib eine gültige E-Mail-Adresse ein.",
  returnUnavailable: "Der Link konnte gerade nicht gesendet werden. Versuch es später noch einmal.",
};

const portuguese: ReservationCopy = {
  metaTitle: "Garanta o menor preço de lançamento de $149 por $3",
  metaDescription: `A reserva de ${fee} é separada do preço do produto de ${product}. Juntas, são ${total} antes do frete e dos impostos.`,
  languageLabel: "Idioma",
  english: "English",
  korean: "한국어",
  home: "Início da WatchDive",
  title: "Garanta agora o menor preço de lançamento de $149 por $3.",
  intro:
    "A taxa de reserva de $3 é separada. Ela não é descontada do preço do produto de $149 no lançamento.",
  priceHeading: "Preços",
  priceRows: [
    {
      id: "fee",
      label: "Agora",
      amount: fee,
      detail: "Taxa de reserva. Separada, e não creditada no preço do produto.",
    },
    {
      id: "product",
      label: "No lançamento",
      amount: product,
      detail: "Preço do produto. Você paga. Ele não é cobrado automaticamente.",
    },
    {
      id: "total",
      label: "Taxa mais preço",
      amount: total,
      detail: "Antes do frete e dos impostos, se eles se aplicarem.",
    },
  ],
  termsHeading: "Antes de pagar",
  terms: [
    `Você paga ${fee} agora. Esta taxa é separada. Ela não é creditada no preço de ${product} e não reduz esse preço.`,
    `Uma reserva paga garante 100% o menor preço de lançamento, ${product}, mesmo que você não esteja entre as primeiras 100 pessoas. Você paga esse preço no lançamento. A WatchDive não o cobra automaticamente.`,
    `${total} é a taxa mais o preço do produto, antes do frete e dos impostos que se aplicarem.`,
    `A taxa de ${fee} é reembolsada somente se cancelarmos o lançamento. Os direitos exigidos por lei continuam valendo.`,
  ],
  markRead: "Li isto",
  markReadDone: "Marcado como lido",
  acceptLabel: "Concordo e quero pagar a reserva.",
  checkout: `Continuar para pagar ${fee}`,
  checkingOut: "Abrindo o pagamento",
  checkAgain: "Verificar de novo",
  checkingStatus: "Verificando o pagamento.",
  checkoutHintUnread: "Leia as condições e concorde antes de pagar.",
  checkoutHintUnaccepted: "Concorde com as condições antes de pagar.",
  checkoutHintPending: "O pagamento ainda não foi confirmado.",
  checkoutHintUnavailable: "O pagamento fica fechado até a WatchDive poder confirmar o status.",
  checkoutFailed: "O pagamento não pôde ser aberto. Nenhum valor foi confirmado.",
  needsInvitation: "Abra o link de reserva que você recebeu por e-mail.",
  invalidInvitation: "Este link de reserva não pode ser usado. Abra de novo o link do e-mail.",
  offerStatus: "A taxa de reserva ainda não foi paga.",
  pendingStatus: "Ainda estamos confirmando o pagamento.",
  paidStatus: `A taxa de reserva de ${fee} foi paga. Ela é separada do preço do produto de ${product} e não é descontada dele.`,
  canceledStatus: "O pagamento foi cancelado.",
  canceledRetry: "Você pode concordar com as condições e continuar quando quiser.",
  openStatus: "Já existe um pagamento aberto. Ele não terminou.",
  refundedStatus: "A taxa de reserva foi reembolsada.",
  partialRefundStatus: "Parte da taxa de reserva foi reembolsada.",
  refundPendingStatus: "Um reembolso ainda está em andamento.",
  disputedStatus: "Este pagamento está em disputa. O pagamento permanece fechado.",
  invalidStatus: "Não conseguimos confirmar este pagamento.",
  checkoutConflict: "Não iniciamos outro pagamento. Estamos verificando o pagamento de novo.",
  unavailableStatus: "Ainda não conseguimos confirmar o pagamento.",
  privacy: "Privacidade",
  siteTerms: "Termos",
  contact: "Dúvidas: help@diveroid.com",
  returnLead: "Enviem o link de reserva para o e-mail que eu já usei.",
  returnEmailLabel: "E-mail",
  returnSubmit: "Enviar meu link",
  returnSending: "Enviando",
  returnAccepted:
    "Se este endereço tem uma inscrição WatchDive verificada e sem pagamento, enviamos o link de reserva para lá. Se ela ainda não foi verificada, confira o e-mail de confirmação que você já recebeu.",
  returnInvalid: "Informe um e-mail válido.",
  returnUnavailable: "Não foi possível enviar o link agora. Tente de novo mais tarde.",
};

const COPY: Record<ReservationLocale, ReservationCopy> = {
  en: english,
  ko: korean,
  "zh-CN": chineseSimplified,
  "zh-TW": chineseTraditional,
  ja: japanese,
  es: spanish,
  fr: french,
  de: german,
  "pt-BR": portuguese,
};

export function reservationCopy(locale: ReservationLocale): ReservationCopy {
  return COPY[locale];
}

export function reservationCopyText(locale: ReservationLocale): string {
  return JSON.stringify(reservationCopy(locale));
}
