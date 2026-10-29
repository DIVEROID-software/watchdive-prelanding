import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { reservationCopy, reservationCopyText } from "../src/components/reservation/copy.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";

const root = new URL("../", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function checkoutCopyText(locale: "en" | "ko"): string {
  const copy = { ...reservationCopy(locale) };
  delete copy.returnLead;
  delete copy.returnEmailLabel;
  delete copy.returnSubmit;
  delete copy.returnSending;
  delete copy.returnAccepted;
  delete copy.returnInvalid;
  delete copy.returnUnavailable;
  return JSON.stringify(copy);
}

const reservationSources = [
  "src/routes/reservation.tsx",
  "src/components/reservation/ReservationPage.tsx",
  "src/components/reservation/model.ts",
  "src/components/reservation/client.ts",
  "src/components/reservation/contract.ts",
  "src/components/reservation/query.ts",
  "src/components/reservation/pricing.ts",
  "src/components/reservation/copy.ts",
  "src/components/reservation/reservation.css",
  "src/components/reservation/ReturnLinkForm.tsx",
  "src/components/reservation/returnClient.ts",
  "src/components/reservation/returnResume.ts",
];

test("every site locale states the fee, the product price, and the pre-tax total separately", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = reservationCopy(locale);
    const text = reservationCopyText(locale);
    assert.equal(copy.priceRows[0]?.amount, "USD $3.00");
    assert.equal(copy.priceRows[1]?.amount, "USD $149.00");
    assert.equal(copy.priceRows[2]?.amount, "USD $152.00");
    assert.notEqual(copy.priceRows[0]?.label, copy.priceRows[1]?.label);
    assert.match(text, /USD \$3\.00/);
    assert.match(text, /USD \$149\.00/);
    assert.match(text, /USD \$152\.00/);
    assert.match(text, /100\s*%/);
    assert.doesNotMatch(text, /\b20\d{2}-\d{2}-\d{2}\b/);
    assert.doesNotMatch(
      text,
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/,
    );
    assert.doesNotMatch(text, /재고 수량은 \d|한정 \d|units left|in stock|ships on|free shipping/i);
    assert.equal(text.includes("USD $146.00"), false);
  }
});

test("buyer copy states the separate fee, the launch price, and the refund rule", () => {
  const englishCopy = reservationCopy("en");
  const english = reservationCopyText("en");
  assert.equal(englishCopy.terms.length >= 3 && englishCopy.terms.length <= 4, true);
  assert.match(englishCopy.title, /\$149/);
  assert.match(englishCopy.title, /\$3/);
  assert.match(english, /not credited/i);
  assert.match(english, /does not reduce/i);
  assert.match(english, /first 100/i);
  assert.match(english, /not charged automatically/i);
  assert.match(english, /100%/);
  assert.match(english, /cancel the launch/i);
  assert.match(english, /law requires/i);
  assert.match(english, /before shipping and tax/i);
  assert.match(englishCopy.needsInvitation, /email/i);
  assert.doesNotMatch(
    checkoutCopyText("en"),
    /signed invitation|not proof of payment|credential|stock quantity|session id/i,
  );
  assert.doesNotMatch(
    english,
    /will be credited|is credited toward|fee is a credit|deposit|discount/i,
  );

  const koreanCopy = reservationCopy("ko");
  const korean = reservationCopyText("ko");
  assert.equal(koreanCopy.title, "지금 $3로 최저 출시가 $149를 보장받으세요");
  assert.equal(
    koreanCopy.intro,
    "예약금 $3는 별도이며, 출시 시 제품 가격 $149에서 차감되지 않습니다.",
  );
  assert.equal(koreanCopy.needsInvitation, "이메일로 받은 예약 링크를 열어 주세요.");
  assert.equal(koreanCopy.terms.length >= 3 && koreanCopy.terms.length <= 4, true);
  assert.match(korean, /처음 100명/);
  assert.match(korean, /자동으로 청구되지 않습니다/);
  assert.match(korean, /100%/);
  assert.match(korean, /출시를 취소하는 경우에만 환불/);
  assert.match(korean, /법이 요구하는 권리/);
  assert.match(korean, /배송비와 세금/);
  assert.doesNotMatch(checkoutCopyText("ko"), /서명된 초대|재고|인증|증거|세션/);
  assert.doesNotMatch(checkoutCopyText("ko"), /할인|보증금|전액 환불|언제든 환불/);
  assert.equal(
    koreanCopy.returnAccepted,
    "인증된 미결제 신청 내역이 있으면 예약 링크를 보내드립니다. 인증 전이라면 기존 인증 메일을 확인해 주세요.",
  );
  assert.match(englishCopy.returnAccepted, /verified, unpaid/);
  assert.match(englishCopy.returnAccepted, /not verified yet/);
  assert.doesNotMatch(englishCopy.returnAccepted, /on its way|already on the WatchDive list/i);
  assert.match(koreanCopy.priceRows[0]?.detail ?? "", /차감되지 않습니다/);
});

test("every locale names the lowest launch price and a closed dispute", () => {
  const lowest: Record<(typeof SUPPORTED_LOCALES)[number], RegExp> = {
    en: /lowest launch price/,
    ko: /최저 출시가/,
    "zh-CN": /最低发布价/,
    "zh-TW": /最低上市價/,
    ja: /最低発売価格/,
    es: /precio de lanzamiento más bajo/,
    fr: /prix de lancement le plus bas/,
    de: /niedrigsten Startpreis/i,
    "pt-BR": /menor preço de lançamento/,
    nl: /laagste lanceringsprijs/,
  };
  for (const locale of SUPPORTED_LOCALES) {
    const copy = reservationCopy(locale);
    const text = reservationCopyText(locale);
    assert.match(copy.title, lowest[locale], locale);
    assert.match(copy.metaTitle, lowest[locale], locale);
    assert.match(text, lowest[locale], locale);
    assert.match(copy.terms[1] ?? "", lowest[locale], locale);
    assert.match(copy.disputedStatus, /\S/, locale);
    assert.doesNotMatch(
      copy.disputedStatus,
      /paid|결제되었습니다|已支付|已付款|支払われました|está pagad|est payé|ist bezahlt|foi paga/i,
    );
  }
  assert.doesNotMatch(reservationCopy("ja").metaDescription, /の前で/);
  assert.match(reservationCopy("ja").metaDescription, /含まれません/);
});

test("checkout stays card-free and the return form is the only email field", () => {
  const page = read("src/components/reservation/ReservationPage.tsx");
  const route = read("src/routes/reservation.tsx");
  const client = read("src/components/reservation/client.ts");
  const form = read("src/components/reservation/ReturnLinkForm.tsx");
  assert.doesNotMatch(page, /type=["'](?:email|tel|password|number)["']/);
  assert.doesNotMatch(page, /sms|phone-number|PhoneOptIn|card number|cardNumber/i);
  assert.match(page, /shouldOfferReturnForm/);
  assert.match(page, /<ReturnLinkForm/);
  assert.equal(form.match(/type="email"/g)?.length, 1);
  assert.match(form, /name="company"/);
  assert.doesNotMatch(form, /type=["'](?:tel|password|number)["']|sms|cardNumber|markConversion|metaPixel/i);
  assert.doesNotMatch(route, /sms|PhoneOptIn|metaPixel|conversionExperiment/i);
  assert.equal(page.match(/requestReservationCheckout/g)?.length, 2);
  assert.equal(page.match(/tryBegin\(/g)?.length, 1);
  assert.ok(page.indexOf("tryBegin()") < page.indexOf("requestReservationCheckout(inviteToken)"));
  assert.match(page, /rememberReservationEntry/);
  assert.match(page, /isTerminalReservationStatus/);
  assert.match(page, /writeInvalidInviteFlag/);
  assert.match(page, /disabled=\{!view\.checkoutEnabled\}/);
  assert.match(page, /type="checkbox"\s+checked=\{termsAccepted\}/);
  assert.doesNotMatch(page, /wd-rsv-langs|copy\.priceRows\.map/);
  assert.match(page, /role="status"/);
  assert.match(page, /lang=\{view\.locale\}/);
  assert.match(route, /no-referrer/);
  assert.match(route, /noindex/);
  assert.match(client, /checkoutPayload\(token\)/);
  assert.doesNotMatch(client, /email|amount|sms|phone/i);
  assert.doesNotMatch(`${page}\n${client}\n${route}`, /sk_live|sk_test|whsec_|STRIPE_SECRET/);
});

test("signup and global styles are not used to force this reservation", () => {
  const index = read("src/routes/index.tsx");
  const styles = read("src/styles.css");
  const messages = read("src/lib/i18n/frozen-landing-messages.ts");
  // The owner-approved post-submit offer is voluntary; the payment page and
  // checkout calls still cannot mount or run inside the signup form.
  assert.match(index, /components\/reservation\/SignupReservationOffer/);
  assert.doesNotMatch(index, /ReservationPage|requestReservationCheckout|window\.location\.(?:assign|replace)\(["']\/reservation/);
  assert.doesNotMatch(styles, /wd-rsv/);
  assert.doesNotMatch(messages, /reservation fee|예약금/);
  for (const path of reservationSources) {
    const source = read(path);
    assert.doesNotMatch(source, /conversionExperiment|measurementConsent|metaPixel|googleTag/);
  }
});
