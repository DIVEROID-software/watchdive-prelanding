// Customer-facing reservation terms and privacy copy.
//
// The approved offer charges exactly USD $3 now. That fee is additional and
// not deducted. A paid reservation guarantees the ability to buy the product
// for USD $149 at launch, whether or not the person is in the public first
// 100. USD $149 is charged later only if the person chooses to buy, with no
// automatic charge. The two amounts together are USD $152 before applicable
// product shipping or tax, which is disclosed before the product purchase.
// These tests lock that offer. They do not call Stripe, send mail, or read secrets.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FROZEN_LANDING_LOCALES,
  FROZEN_LANDING_MESSAGES,
  type FrozenLandingLocale,
} from "../src/lib/i18n/frozen-landing-messages.ts";

const MONEY = ["USD $3", "USD $149", "USD $152", "Stripe hosted Checkout"] as const;

const EFFECTIVE: Record<FrozenLandingLocale, string> = {
  en: "October 18, 2026",
  ko: "2026년 10월 18일",
  "zh-CN": "2026 年 10 月 18 日",
  "zh-TW": "2026 年 10 月 18 日",
  ja: "2026 年 10 月 18 日",
  es: "18 de octubre de 2026",
  fr: "18 octobre 2026",
  de: "18. Oktober 2026",
  "pt-BR": "18 de outubro de 2026",
};

const GOVERNING: Record<FrozenLandingLocale, string> = {
  en: "These terms are governed by the laws of the Republic of Korea.",
  ko: "본 약관은 대한민국 법률의 적용을 받습니다.",
  "zh-CN": "本条款受大韩民国法律管辖。",
  "zh-TW": "本條款受大韓民國法律管轄。",
  ja: "本規約は大韓民国の法律に準拠します。",
  es: "Estos términos se rigen por las leyes de la República de Corea.",
  fr: "Les présentes conditions sont régies par le droit de la République de Corée.",
  de: "Diese Bedingungen unterliegen dem Recht der Republik Korea.",
  "pt-BR": "Estes termos são regidos pelas leis da República da Coreia.",
};

const FREE_SIGNUP_STILL_DOES_NOT_RESERVE: Record<FrozenLandingLocale, RegExp> = {
  en: /does not reserve/i,
  ko: /예약하거나.*보장하지/s,
  "zh-CN": /不预留/,
  "zh-TW": /不預留/,
  ja: /予約でも.*保証でもありません/s,
  es: /no reserva/i,
  fr: /ne réserve/i,
  de: /reserviert kein/,
  "pt-BR": /não reserva/i,
};

const ANCHORS: Record<FrozenLandingLocale, Record<string, string>> = {
  en: {
    exactly: "exactly USD $3 now",
    notDeducted: "is not deducted from it",
    guarantee: "guarantees that you can buy the product for USD $149 at launch",
    independent: "whether or not you are among the public first 100",
    manual: "only when you choose to buy",
    noAuto: "do not charge, schedule, or authorize it automatically",
    sum: "USD $152 before any product shipping or tax that applies",
    disclose: "If product shipping or tax applies, we disclose it before you purchase the product.",
    refund: "nonrefundable, except if we cancel the product launch",
    rights: "do not require you to give up such a right",
    country: "separate from optional page measurement",
    unknown: "the country is stored as unknown",
    noRaw: "We do not retain the raw IP address with that country code",
    retention: "only to administer the reservation and to meet applicable legal and accounting requirements",
    freeNoPay: "A free email signup collects no payment details.",
    noCard: "do not store the full card number, the card security code, or other full card details",
  },
  ko: {
    exactly: "지금 정확히 USD $3",
    notDeducted: "제품 가격에서 공제되지 않습니다",
    guarantee: "출시 시 제품을 USD $149에 구매할 수 있음을 보장합니다",
    independent: "공개된 선착순 100명에 포함되는지와 관계없이",
    manual: "나중에 구매를 선택할 때에만 청구",
    noAuto: "자동으로 청구하거나, 청구 일정을 잡거나, 결제를 승인하지 않습니다",
    sum: "적용되는 제품 배송비와 세금 전 USD $152",
    disclose: "제품 배송비나 세금이 적용되면 제품을 구매하기 전에 안내합니다.",
    refund: "USD $3 수수료는 환불되지 않습니다. 다만 당사가 제품 출시를 취소하면",
    rights: "권리를 포기하라고 요구하지 않습니다",
    country: "선택적 페이지 측정과 별개",
    unknown: "알 수 없음으로 저장",
    noRaw: "원본 IP 주소는 보관하지 않습니다",
    retention: "적용되는 법률 및 회계 요건을 충족하기 위해서만 보관합니다",
    freeNoPay: "무료 이메일 신청에서는 결제 정보를 수집하지 않습니다",
    noCard: "전체 카드 번호, 카드 보안 코드, 그 밖의 전체 카드 정보는 저장하지 않습니다",
  },
  "zh-CN": {
    exactly: "正好 USD $3",
    notDeducted: "不从产品价格中扣除",
    guarantee: "以 USD $149 购买该产品",
    independent: "无论你是否属于公开的前 100 名",
    manual: "仅在你之后选择购买时收取",
    noAuto: "不会自动收取、安排收取或授权收取",
    sum: "适用的产品运费和税费之前的 USD $152",
    disclose: "如果产品运费或税费适用，我们会在你购买产品之前告知。",
    refund: "USD $3 费用不予退款，但如果我们取消产品发布，则退还该费用",
    rights: "也不要求你放弃此类权利",
    country: "不同于可选的页面测量",
    unknown: "国家会记为未知",
    noRaw: "我们不随该国家代码保留原始 IP 地址",
    retention: "仅用于管理该预约并满足适用的法律和会计要求",
    freeNoPay: "免费的邮箱报名不收集付款信息",
    noCard: "我们不保存完整卡号、卡片安全码或其他完整卡片信息",
  },
  "zh-TW": {
    exactly: "正好 USD $3",
    notDeducted: "不從產品價格中扣除",
    guarantee: "以 USD $149 購買該產品",
    independent: "無論你是否屬於公開的前 100 名",
    manual: "僅在你之後選擇購買時收取",
    noAuto: "不會自動收取、安排收取或授權收取",
    sum: "適用的產品運費和稅費之前的 USD $152",
    disclose: "如果產品運費或稅費適用，我們會在你購買產品之前告知。",
    refund: "USD $3 費用不予退款，但如果我們取消產品發布，則退還該費用",
    rights: "也不要求你放棄此類權利",
    country: "不同於可選的頁面測量",
    unknown: "國家會記為未知",
    noRaw: "我們不隨該國家代碼保留原始 IP 位址",
    retention: "僅用於管理該預約並滿足適用的法律和會計要求",
    freeNoPay: "免費的電子郵件報名不蒐集付款資訊",
    noCard: "我們不保存完整卡號、卡片安全碼或其他完整卡片資訊",
  },
  ja: {
    exactly: "今ちょうど USD $3",
    notDeducted: "製品価格から差し引かれません",
    guarantee: "ローンチ時に製品を USD $149 で購入できることを保証します",
    independent: "公開の先着100名に入るかどうかにかかわらず",
    manual: "後で購入を選んだときにだけ請求",
    noAuto: "自動で請求せず、請求を予定せず、決済を承認しません",
    sum: "適用される製品の送料と税金の前で USD $152",
    disclose: "製品の送料または税金がかかる場合は、製品を購入する前に開示します。",
    refund: "USD $3 の手数料は返金されません。ただし当社が製品のローンチを中止した場合は、その手数料を返金します",
    rights: "その権利を放棄するよう求めません",
    country: "任意のページ計測とは別",
    unknown: "国は不明として保存します",
    noRaw: "生の IP アドレスは保持しません",
    retention: "適用される法的・会計上の要件を満たすためだけに保管します",
    freeNoPay: "無料のメール登録では決済情報を収集しません",
    noCard: "カード番号の全体、セキュリティコード、その他のカード情報一式は保存しません",
  },
  es: {
    exactly: "exactamente USD $3 ahora",
    notDeducted: "no se deduce de él",
    guarantee: "garantiza que puedes comprar el producto por USD $149 en el lanzamiento",
    independent: "estés o no entre los 100 primeros públicos",
    manual: "solo cuando eliges comprar",
    noAuto: "no lo cobramos, programamos ni autorizamos automáticamente",
    sum: "USD $152 antes de cualquier envío o impuesto del producto que se aplique",
    disclose: "Si se aplican envío o impuestos del producto, los indicamos antes de que compres el producto.",
    refund: "no es reembolsable, salvo si cancelamos el lanzamiento del producto",
    rights: "no te exigen renunciar a ese derecho",
    country: "distinto de la medición opcional de la página",
    unknown: "el país se guarda como desconocido",
    noRaw: "No conservamos la dirección IP en bruto junto con ese código de país",
    retention: "solo para administrar la reserva y para cumplir los requisitos legales y contables aplicables",
    freeNoPay: "Un registro gratuito por email no recoge datos de pago",
    noCard: "No guardamos el número completo de la tarjeta, el código de seguridad ni el resto de los datos completos de la tarjeta",
  },
  fr: {
    exactly: "exactement USD $3 maintenant",
    notDeducted: "n’est pas déduit du prix du produit",
    guarantee: "garantit que vous pouvez acheter le produit pour USD $149 au lancement",
    independent: "que vous figuriez ou non parmi les 100 premiers annoncés publiquement",
    manual: "seulement lorsque vous choisissez d’acheter",
    noAuto: "nous ne le prélevons pas, ne le programmons pas et ne l’autorisons pas automatiquement",
    sum: "USD $152 avant tout frais de livraison ou taxe du produit qui s’applique",
    disclose: "Si des frais de livraison ou des taxes du produit s’appliquent, nous les indiquons avant que vous achetiez le produit.",
    refund: "ne sont pas remboursables, sauf si nous annulons le lancement du produit",
    rights: "ne vous demandent pas de renoncer à un tel droit",
    country: "distinct de la mesure facultative de la page",
    unknown: "le pays est enregistré comme inconnu",
    noRaw: "Nous ne conservons pas l’adresse IP brute avec ce code pays",
    retention: "uniquement pour gérer la réservation et pour respecter les obligations légales et comptables applicables",
    freeNoPay: "Une inscription gratuite par e-mail ne collecte pas de données de paiement",
    noCard: "Nous ne stockons pas le numéro complet de la carte, le cryptogramme ni les autres données complètes de carte",
  },
  de: {
    exactly: "jetzt genau USD $3",
    notDeducted: "wird nicht vom Produktpreis abgezogen",
    guarantee: "garantiert, dass du das Produkt zum Start für USD $149 kaufen kannst",
    independent: "ob du zu den öffentlichen ersten 100 gehörst oder nicht",
    manual: "später nur, wenn du den Kauf wählst",
    noAuto: "wir belasten ihn nicht automatisch, planen ihn nicht ein und autorisieren ihn nicht",
    sum: "USD $152 vor anwendbarem Produktversand oder anwendbarer Produktsteuer",
    disclose: "Wenn Produktversand oder Produktsteuer anfällt, nennen wir das, bevor du das Produkt kaufst.",
    refund: "ist nicht erstattungsfähig, außer wenn wir die Produkteinführung absagen",
    rights: "verlangen nicht, dass du auf ein solches Recht verzichtest",
    country: "von der optionalen Seitenmessung getrennt",
    unknown: "wird das Land als unbekannt gespeichert",
    noRaw: "Wir behalten die rohe IP-Adresse nicht zusammen mit diesem Ländercode",
    retention: "anwendbare gesetzliche und buchhalterische Anforderungen zu erfüllen",
    freeNoPay: "Eine kostenlose E-Mail-Anmeldung erfasst keine Zahlungsdaten",
    noCard: "Wir speichern nicht die vollständige Kartennummer, den Sicherheitscode oder sonstige vollständige Kartendaten",
  },
  "pt-BR": {
    exactly: "exatamente USD $3 agora",
    notDeducted: "não é deduzida do preço do produto",
    guarantee: "garante que você pode comprar o produto por USD $149 no lançamento",
    independent: "esteja você ou não entre os 100 primeiros anunciados publicamente",
    manual: "somente quando você escolhe comprar",
    noAuto: "não cobramos, não agendamos e não autorizamos essa cobrança automaticamente",
    sum: "USD $152 antes de qualquer frete ou imposto do produto que se aplique",
    disclose: "Se frete ou imposto do produto se aplicar, informamos antes de você comprar o produto.",
    refund: "não é reembolsável, exceto se cancelarmos o lançamento do produto",
    rights: "não exigem que você abra mão de tal direito",
    country: "separado da medição opcional da página",
    unknown: "o país é guardado como desconhecido",
    noRaw: "Não retemos o endereço IP bruto junto com esse código de país",
    retention: "somente para administrar a reserva e para cumprir exigências legais e contábeis aplicáveis",
    freeNoPay: "Um cadastro gratuito por e-mail não coleta dados de pagamento",
    noCard: "Não guardamos o número completo do cartão, o código de segurança nem os demais dados completos do cartão",
  },
};

const INVENTED_EXCLUSIONS = [
  "It is not a store.",
  "스토어가 아닙니다",
  "它不是商店",
  "ストアではありません",
  "No es una tienda.",
  "Ce n’est pas une boutique.",
  "Sie ist kein Shop.",
  "Não é uma loja.",
  "If the product is offered to you",
  "그 예약에 따라 제품이 제공되면",
  "如果根据该预约向你提供产品",
  "如果根據該預約向你提供產品",
  "その予約に基づいて製品が提供される場合",
  "Si el producto se te ofrece",
  "Si le produit vous est proposé",
  "Wenn dir das Produkt unter dieser Reservierung angeboten wird",
  "Se o produto for oferecido",
  "does not reserve stock or a unit",
  "재고나 개별 수량을 예약하지",
  "不预留库存或单件产品",
  "不預留庫存或單件產品",
  "在庫も個体も確保せず",
  "no reserva existencias ni una unidad",
  "ne réservent pas de stock",
  "reserviert keinen Lagerbestand",
  "não reserva estoque nem uma unidade",
  "does not state a comparison",
  "any further remedy",
  "separate time limit",
  "does not state a refund rule",
  "does not define what else",
  "tax applies to the USD $3",
  "수수료에 세금이 붙는지",
  "费用是否另计税费",
  "費用是否另計稅費",
  "手数料に税金が加算",
  "impuesto sobre la comisión de USD $3",
  "taxe s’ajoute aux frais de USD $3",
  "auf die Gebühr von USD $3 Steuer",
  "imposto sobre a taxa de USD $3",
  "you cannot set this country from the form",
  "폼에서 이 국가를 직접 지정",
  "在表单里自行填写",
  "在表單裡自行填寫",
  "フォームからこの国を指定",
  "desde el formulario",
  "depuis le formulaire",
  "im Formular festlegen",
  "no formulário",
  "does not set a fixed retention period",
  "고정된 보유 기간을 정하지 않습니다",
  "不规定这些付款记录的固定保存期限",
  "不規定這些付款紀錄的固定保存期間",
  "固定の保存期間を定めていません",
  "no fija un plazo de conservación",
  "ne fixe pas de durée de conservation",
  "legt keine feste Aufbewahrungsfrist",
  "não fixa um prazo de retenção",
  "is not credited toward it",
  "guarantees the lowest product price",
] as const;

const ABSOLUTE_DENIALS = [
  "no payment is taken here",
  "does not process any payment",
  "We do not collect payment details on this page.",
  "어떤 결제도 처리하지 않습니다",
  "어떤 결제도 받지 않습니다",
  "不处理任何付款",
  "也不收取任何款项",
  "也不處理任何付款",
  "也不收取任何款項",
  "決済は一切行いません",
  "支払いも発生しません",
  "no procesa ningún pago",
  "ni se cobra ningún pago",
  "aucun paiement n’y est traité",
  "aucun paiement n’y est encaissé",
  "verarbeitet keine Zahlungen",
  "keine Zahlung entgegengenommen",
  "não processa nenhum pagamento",
  "nenhum pagamento é cobrado aqui",
] as const;

const WAIVERS = [
  /you agree to waive/i,
  /you hereby waive/i,
  /권리를 포기합니다/,
  /你同意放弃/,
  /你同意放棄/,
  /権利を放棄します/,
  /aceptas renunciar/i,
  /vous acceptez de renoncer/i,
  /du verzichtest/i,
  /você concorda em abrir mão/i,
] as const;

function flat(value: object): string {
  return Object.values(value).join("\n");
}

test("every locale states the same optional USD reservation", () => {
  for (const locale of FROZEN_LANDING_LOCALES) {
    const terms = flat(FROZEN_LANDING_MESSAGES[locale].terms);
    const privacy = flat(FROZEN_LANDING_MESSAGES[locale].privacy);
    const haystack = `${terms}\n${privacy}`;
    for (const token of MONEY) {
      assert.ok(terms.includes(token), `${locale} terms missing ${token}`);
      assert.ok(privacy.includes(token), `${locale} privacy missing ${token}`);
    }
    assert.match(terms, FREE_SIGNUP_STILL_DOES_NOT_RESERVE[locale], `${locale} free signup`);
    for (const [name, phrase] of Object.entries(ANCHORS[locale])) {
      assert.ok(haystack.includes(phrase), `${locale} missing ${name}: ${phrase}`);
    }
    assert.ok(FROZEN_LANDING_MESSAGES[locale].terms.s1Body.includes(ANCHORS[locale].guarantee), locale);
    assert.ok(FROZEN_LANDING_MESSAGES[locale].terms.s2Body.includes(ANCHORS[locale].guarantee), locale);
    assert.ok(FROZEN_LANDING_MESSAGES[locale].terms.s1Body.includes(ANCHORS[locale].disclose), locale);
    assert.equal(
      FROZEN_LANDING_MESSAGES[locale].terms.effectiveDate,
      EFFECTIVE[locale],
      locale,
    );
    assert.equal(FROZEN_LANDING_MESSAGES[locale].privacy.effectiveDate, EFFECTIVE[locale], locale);
  }
});

test("invented exclusions, blanket payment denials, and waivers are absent", () => {
  for (const locale of FROZEN_LANDING_LOCALES) {
    const text = `${flat(FROZEN_LANDING_MESSAGES[locale].terms)}\n${flat(
      FROZEN_LANDING_MESSAGES[locale].privacy,
    )}`;
    for (const denial of ABSOLUTE_DENIALS) {
      assert.equal(text.includes(denial), false, `${locale} still says ${denial}`);
    }
    for (const exclusion of INVENTED_EXCLUSIONS) {
      assert.equal(text.includes(exclusion), false, `${locale} still says ${exclusion}`);
    }
    for (const waiver of WAIVERS) {
      assert.doesNotMatch(text, waiver, `${locale} ${waiver}`);
    }
    assert.doesNotMatch(text, /while supplies last|재고가 있는 한|售完为止|售完為止/);
    assert.doesNotMatch(text, /December\s+\d|12월\s*\d{1,2}일|12 月 \d{1,2} 日/);
    assert.doesNotMatch(text, /\b7 years\b|seven years|7년|七年|7 Jahre|7 ans|7 años|7 anos/);
    assert.equal(text.includes("all-in"), false, locale);
  }
});

test("terms renderer no longer bolds a positional not-a-store sentence", () => {
  const route = readFileSync(new URL("../src/routes/terms.tsx", import.meta.url), "utf8");
  assert.equal(route.includes("splitSecondSentence"), false);
  assert.match(route, /<p>\{copy\.s1Body\}<\/p>/);
  const block = route.match(/const CHANGE_DISCLAIMERS = \[([\s\S]*?)\] as const/);
  assert.ok(block);
  const phrases = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(phrases.length, FROZEN_LANDING_LOCALES.length);

  for (const phrase of phrases) {
    const hits = FROZEN_LANDING_LOCALES.filter((locale) =>
      FROZEN_LANDING_MESSAGES[locale].terms.s2Body.includes(phrase),
    );
    assert.deepEqual(hits.length, 1, phrase);
  }
});


test("governing law, merchant identity, consent, and UTM measurement stay", () => {
  for (const locale of FROZEN_LANDING_LOCALES) {
    const terms = FROZEN_LANDING_MESSAGES[locale].terms;
    const privacy = FROZEN_LANDING_MESSAGES[locale].privacy;
    assert.equal(terms.s6Body, GOVERNING[locale], locale);
    assert.ok(terms.s5Body1.length > 40, `${locale} training disclaimer dropped`);
    assert.ok(privacy.s4Body.includes("Global Privacy Control") || privacy.s4Body.includes("Global-Privacy-Control"), locale);
    for (const tag of ["source", "medium", "campaign"]) {
      assert.ok(privacy.s2Usage.includes(tag), `${locale} ${tag}`);
    }
    assert.match(privacy.s2Usage, /30/);
    assert.ok(privacy.s1Reg.includes("16343651"), locale);
    assert.ok(privacy.s1Rep.includes("Jay Kim"), locale);
    assert.ok(privacy.s1Company.includes("Diveroid Ltd"), locale);
    assert.ok(terms.s3Body.includes(terms.s3PrivacyLink), locale);
    assert.ok(terms.s7Body.includes("help@diveroid.com"), locale);
    assert.ok(privacy.s10Body.includes("help@diveroid.com"), locale);
    assert.ok(privacy.s2Security.includes("IP"), `${locale} security IP sentence dropped`);
  }
});

test("hero and FAQ do not pick up the reservation fee", () => {
  for (const locale of FROZEN_LANDING_LOCALES) {
    const messages = FROZEN_LANDING_MESSAGES[locale];
    const outside = JSON.stringify({ hero: messages.hero, faq: messages.faq, footer: messages.footer });
    assert.equal(outside.includes("Stripe hosted Checkout"), false, locale);
    assert.equal(outside.includes("USD $3"), false, locale);
  }
});
