import type { Locale } from "../../lib/i18n/locale.ts";

export type OnsiteOfferCopy = {
  eyebrow: string; title: string; body: string; nextPrice: string;
  feeLabel: string; guarantee: string; cta: string; verifyCta: string;
  pending: string; verified: string; separate: string; refund: string;
  noCharge: string; busy: string; error: string; expired: string; imageAlt: string;
};

export const ONSITE_OFFER_COPY: Record<Locale, OnsiteOfferCopy> = {
  ko: {
    eyebrow: "WatchDive · 최저가 보장",
    title: "선착순을 놓쳐도,\n최저가는 놓치지 마세요.",
    body: "지금 $3로 예약하면, 선착순에 관계없이 출시 최저가 $149를 보장해 드립니다.",
    nextPrice: "선착순 100명 이후, 다음 가격은 $200부터.",
    feeLabel: "지금 예약금 · USD", guarantee: "$149 출시 최저가 보장",
    cta: "$3로 최저가 보장받기", verifyCta: "$3 예약 내용 확인하기",
    pending: "예약 내용을 확인한 뒤, 이메일 인증 후 결제할 수 있습니다.",
    verified: "이메일 인증 완료 · 이제 최저가를 확보하세요.",
    separate: "$3는 제품 가격과 별도이며, $149에서 차감되지 않습니다.",
    refund: "출시 취소 시에만 환불됩니다. 법정 권리는 그대로 적용됩니다.",
    noCharge: "추후 자동 결제 없음 · 배송비·세금 별도",
    busy: "예약 페이지 여는 중…", error: "예약 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.",
    expired: "인증 링크를 다시 확인해 주세요. 예약 안내 메일의 링크로도 결제할 수 있습니다.",
    imageAlt: "수영장 수중에서 WatchDive를 손목에 착용한 다이버",
  },
  en: {
    eyebrow: "WatchDive · Lowest-price guarantee", title: "Miss the first 100.\nKeep the lowest price.",
    body: "Reserve for $3 and guarantee the lowest launch price of $149, regardless of your place in line.",
    nextPrice: "After the first 100, the next tier starts at $200.",
    feeLabel: "Reserve today · USD", guarantee: "$149 lowest launch price",
    cta: "Secure my price for $3", verifyCta: "View $3 reservation details",
    pending: "Review the details now. Verify your email to continue to payment.",
    verified: "Email verified · Your lowest price is one step away.",
    separate: "The $3 fee is separate and is not deducted from the $149 product price.",
    refund: "Refundable only if the launch is cancelled. Statutory rights remain unaffected.",
    noCharge: "No automatic future charges · Shipping and taxes extra",
    busy: "Opening your reservation…", error: "We couldn’t open your reservation. Please try again shortly.",
    expired: "Please check your verification link again, or use the link in your reservation email.",
    imageAlt: "A diver wearing WatchDive underwater in a swimming pool",
  },
  ja: {
    eyebrow: "WatchDive · 最安値保証", title: "先着100名を逃しても、\n最安値は逃さない。",
    body: "今$3で予約すると、先着順に関係なく発売最安値$149を保証します。",
    nextPrice: "先着100名の次の価格は$200から。", feeLabel: "今支払う予約金 · USD", guarantee: "発売最安値$149を保証",
    cta: "$3で最安値を確保", verifyCta: "$3の予約内容を確認する",
    pending: "予約内容を確認できます。メール認証後にお支払いへ進めます。", verified: "メール認証完了 · 最安値を確保しましょう。",
    separate: "$3は商品価格とは別料金で、$149から差し引かれません。", refund: "発売中止の場合のみ返金されます。法定の権利は影響を受けません。",
    noCharge: "後日の自動請求なし · 送料・税金別", busy: "予約ページを開いています…", error: "予約ページを開けませんでした。しばらくしてから再度お試しください。",
    expired: "認証リンクを再確認するか、予約案内メールのリンクをご利用ください。", imageAlt: "プールの水中でWatchDiveを手首に装着したダイバー",
  },
  "zh-CN": {
    eyebrow: "WatchDive · 最低价保证", title: "错过前100名，\n不错过最低价。",
    body: "现在支付$3预约，无论排名先后，都能锁定$149的发布最低价。", nextPrice: "前100名之后，下一档价格从$200起。",
    feeLabel: "现在支付预约费 · USD", guarantee: "锁定$149发布最低价", cta: "$3锁定最低价", verifyCta: "查看$3预约内容",
    pending: "先查看预约详情，验证邮箱后即可继续付款。", verified: "邮箱已验证 · 现在锁定最低价。",
    separate: "$3预约费为额外费用，不抵扣$149商品价格。", refund: "仅在取消发布时退款。法定权利不受影响。", noCharge: "之后不会自动扣款 · 运费和税费另计",
    busy: "正在打开预约页面…", error: "无法打开预约页面，请稍后重试。", expired: "请重新检查验证链接，或使用预约邮件中的链接。", imageAlt: "潜水员在泳池水下佩戴WatchDive",
  },
  "zh-TW": {
    eyebrow: "WatchDive · 最低價保證", title: "錯過前100名，\n不錯過最低價。",
    body: "現在支付$3預約，無論排名先後，都能鎖定$149的上市最低價。", nextPrice: "前100名之後，下一階段價格從$200起。",
    feeLabel: "現在支付預約費 · USD", guarantee: "鎖定$149上市最低價", cta: "$3鎖定最低價", verifyCta: "查看$3預約內容",
    pending: "先查看預約詳情，驗證信箱後即可繼續付款。", verified: "信箱已驗證 · 現在鎖定最低價。",
    separate: "$3預約費為額外費用，不折抵$149商品價格。", refund: "僅在取消上市時退款。法定權利不受影響。", noCharge: "之後不會自動扣款 · 運費和稅費另計",
    busy: "正在開啟預約頁面…", error: "無法開啟預約頁面，請稍後重試。", expired: "請重新確認驗證連結，或使用預約郵件中的連結。", imageAlt: "潛水員在泳池水下佩戴WatchDive",
  },
  es: {
    eyebrow: "WatchDive · Precio mínimo garantizado", title: "Aunque no llegues entre los 100,\nconserva el mejor precio.",
    body: "Reserva por $3 y garantiza el precio mínimo de lanzamiento de $149, sin importar el orden de llegada.", nextPrice: "Después de los primeros 100, el siguiente precio parte de $200.",
    feeLabel: "Reserva hoy · USD", guarantee: "$149: precio mínimo de lanzamiento", cta: "Garantizar mi precio por $3", verifyCta: "Ver los detalles de la reserva de $3",
    pending: "Consulta los detalles ahora. Verifica tu email para continuar al pago.", verified: "Email verificado · Asegura ahora tu mejor precio.",
    separate: "Los $3 se pagan aparte y no se descuentan del precio del producto de $149.", refund: "Solo se reembolsa si se cancela el lanzamiento. Tus derechos legales no se ven afectados.", noCharge: "Sin cobros automáticos posteriores · Envío e impuestos aparte",
    busy: "Abriendo tu reserva…", error: "No pudimos abrir tu reserva. Inténtalo de nuevo en unos instantes.", expired: "Revisa tu enlace de verificación o utiliza el enlace del email de reserva.", imageAlt: "Un buceador con WatchDive en la muñeca bajo el agua en una piscina",
  },
  fr: {
    eyebrow: "WatchDive · Prix le plus bas garanti", title: "Même après les 100 premiers,\ngardez le meilleur prix.",
    body: "Réservez pour 3 $ et bénéficiez du prix de lancement le plus bas, 149 $, quel que soit votre ordre d’arrivée.", nextPrice: "Après les 100 premiers, le palier suivant commence à 200 $.",
    feeLabel: "Réservation aujourd’hui · USD", guarantee: "149 $ : prix de lancement le plus bas", cta: "Garantir mon prix pour 3 $", verifyCta: "Voir le détail de la réservation à 3 $",
    pending: "Consultez les détails. Vérifiez votre e-mail pour passer au paiement.", verified: "E-mail vérifié · Assurez-vous le meilleur prix.",
    separate: "Les 3 $ sont distincts et ne sont pas déduits du prix du produit de 149 $.", refund: "Remboursement uniquement si le lancement est annulé. Vos droits légaux restent inchangés.", noCharge: "Aucun prélèvement automatique ultérieur · Livraison et taxes en sus",
    busy: "Ouverture de votre réservation…", error: "Impossible d’ouvrir votre réservation. Veuillez réessayer dans un instant.", expired: "Vérifiez votre lien de confirmation ou utilisez le lien de l’e-mail de réservation.", imageAlt: "Un plongeur portant WatchDive au poignet sous l’eau dans une piscine",
  },
  de: {
    eyebrow: "WatchDive · Tiefstpreisgarantie", title: "Nicht unter den ersten 100?\nDer beste Preis bleibt Ihrer.",
    body: "Für $3 reservieren und den niedrigsten Einführungspreis von $149 sichern – unabhängig von der Reihenfolge.", nextPrice: "Nach den ersten 100 beginnt die nächste Preisstufe bei $200.",
    feeLabel: "Heute reservieren · USD", guarantee: "$149: niedrigster Einführungspreis", cta: "Meinen Preis für $3 sichern", verifyCta: "$3-Reservierung ansehen",
    pending: "Details jetzt ansehen. Bestätigen Sie Ihre E-Mail, um zur Zahlung zu gelangen.", verified: "E-Mail bestätigt · Jetzt den besten Preis sichern.",
    separate: "Die $3 fallen zusätzlich an und werden nicht vom Produktpreis von $149 abgezogen.", refund: "Erstattung nur bei Absage der Markteinführung. Gesetzliche Rechte bleiben unberührt.", noCharge: "Keine späteren automatischen Abbuchungen · Versand und Steuern zusätzlich",
    busy: "Reservierung wird geöffnet…", error: "Die Reservierung konnte nicht geöffnet werden. Bitte versuchen Sie es gleich erneut.", expired: "Prüfen Sie Ihren Bestätigungslink oder nutzen Sie den Link in der Reservierungs-E-Mail.", imageAlt: "Ein Taucher trägt WatchDive am Handgelenk unter Wasser in einem Schwimmbecken",
  },
  "pt-BR": {
    eyebrow: "WatchDive · Menor preço garantido", title: "Fora dos primeiros 100?\nO menor preço ainda é seu.",
    body: "Reserve por $3 e garanta o menor preço de lançamento de $149, independentemente da ordem de chegada.", nextPrice: "Após os primeiros 100, o próximo preço começa em $200.",
    feeLabel: "Reserve hoje · USD", guarantee: "$149: menor preço de lançamento", cta: "Garantir meu preço por $3", verifyCta: "Ver os detalhes da reserva de $3",
    pending: "Confira os detalhes agora. Confirme seu e-mail para continuar ao pagamento.", verified: "E-mail confirmado · Garanta agora o menor preço.",
    separate: "A taxa de $3 é separada e não é descontada do preço do produto de $149.", refund: "Reembolso apenas se o lançamento for cancelado. Seus direitos legais permanecem garantidos.", noCharge: "Sem cobranças automáticas futuras · Frete e impostos à parte",
    busy: "Abrindo sua reserva…", error: "Não foi possível abrir sua reserva. Tente novamente em instantes.", expired: "Confira seu link de confirmação ou use o link no e-mail de reserva.", imageAlt: "Um mergulhador usando WatchDive no pulso debaixo d’água em uma piscina",
  },
};
