# Reservation policy copy — 18 October 2026

Commercial wording for the WatchDive pre-launch Terms of Use and Privacy Policy. Root owns integration, deploy, live Stripe setup, and mail. This change does not enable payments, send email, mutate schema, deploy, or change Meta ads.

The public effective date on both pages is 18 October 2026 in each locale's existing date style.

Amounts stay in US dollars in every language (`USD $3`, `USD $149`, `USD $152`, `Stripe hosted Checkout`). The charge is a real USD amount.

## Offer

Free email signup and the optional paid reservation are different.

- A free email signup is not a purchase, takes no payment, does not reserve a unit, and does not guarantee a price.
- A person may separately choose an optional price reservation by paying exactly USD $3 now through Stripe hosted Checkout.
- The fee is in addition to the product price and is not deducted from it.
- The paid reservation guarantees that the person can buy the product for USD $149 at launch, whether or not they are among the public first 100.
- USD $149 is charged later only when the person chooses to buy. It is not charged, scheduled, or authorized automatically.
- The USD $3 fee and the USD $149 product price together are USD $152 before any product shipping or tax that applies.
- If product shipping or tax applies, it is disclosed before the product purchase. The pages do not add a tax onto the USD $3 fee.
- The USD $3 fee is nonrefundable, except if the merchant cancels the product launch, in which case the fee is refunded. The terms do not limit a right that applicable law does not allow the merchant to limit, and they do not require the person to give up such a right.
- Stripe hosted Checkout processes card data. The server stores payment identifiers, payment status, and the reservation terms for that payment. It does not store the full card number, the card security code, or other full card details.
- Those payment records are kept only to administer the reservation and to meet applicable legal and accounting requirements. No retention period in years was added.
- A coarse country code may be stored with the signup, separately from optional page measurement. It is derived from the IP address by the hosting network, with the fact that the code came from that network and the time it was read. If the signal cannot be used, the country is stored as unknown. The raw IP address is not kept with that country code.
- Existing measurement wording stays: campaign tags (source, medium, and campaign), Allow in the EU/EEA, the UK and Switzerland or when the country is unknown, default-on elsewhere, Not now, Global Privacy Control, and the up-to-30-day page experiment.

## Removed from the previous draft

The previous terms draft is not the offer. These sentences are gone from all nine locales:

- "It is not a store" and the matching translations, including as the bold second sentence.
- "If the product is offered to you" and the matching translations.
- Statements that the paid reservation does not include stock or a unit.
- Comparison, further-remedy, and separate-window disclaimers.
- Sentences that say the page does not state shipping, tax, a date-change refund, or the rest of launch cancellation.
- Any tax on the USD $3 fee.
- "You cannot set this country from the form" and the matching translations.
- "This policy does not set a fixed retention period."

## Keys

English is in `src/lib/i18n/frozen-landing-en.ts`. `ko`, `zh-CN`, `zh-TW`, `ja`, `es`, `fr`, `de`, and `pt-BR` are in `src/lib/i18n/frozen-landing-messages.ts`. No legal key was added or removed.

Privacy: `metaDescription`, `effectiveDate`, `intro2`, `s2Usage`, `s2NoPayment`, `s3Outro`, `s4Body`, `s5Body`, `s6Body`.

Terms: `metaDescription`, `effectiveDate`, `intro`, `s1Body`, `s2Body`, `s5Body2`.

This correction rewrote `intro2`, `s2NoPayment`, `s2Usage`, `s6Body`, `s1Body`, and `s2Body` so the guarantee is the ability to buy at USD $149. The other keys in the list were already updated for the optional fee and were left in place when they did not contradict the offer.

Unchanged: `terms.s6Body` (laws of the Republic of Korea, and the existing translation in each locale), merchant identity, email verification, optional SMS, `s3PrivacyLink`, and the training and backup sentence.

`privacy.s2NoPayment` is still the rendered key. The privacy route was not renamed.

## Renderer

`src/routes/terms.tsx` no longer splits `terms.s1Body` on the second sentence or bolds that sentence. Section 1 renders `s1Body` as one paragraph. The public-details change disclaimer in section 2 is still bolded from the existing phrase list, including "may change". That phrase still applies to public page details. The paid USD $149 purchase guarantee is a separate sentence.

Hero, FAQ, footer, and phone-opt-in copy were not edited.

## Tests

`node --experimental-strip-types --test tests/reservation-policy.test.ts tests/i18nMessages.test.ts` — 26 passed, 0 failed.

The policy tests require the shared USD amounts, the free-signup distinction, the purchase guarantee, the later manual charge, the USD $152 sum before applicable product shipping or tax, the pre-purchase disclosure, launch-cancellation refund, non-waivable rights, signup country separate from page measurement, and purpose-limited retention. They reject the removed sentences above. The i18n legal test no longer requires "not a store" in the terms, and it rejects that sentence if it returns. Governing law, merchant identity, campaign-tag consent, and the hero and FAQ fee boundary still pass.

The offer-gate test `customer-facing copy must not advertise the fee while legal pages deny payment` passed.
