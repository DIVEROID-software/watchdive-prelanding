# Reservation mail changelog

## 2026-10-18 three minutes after verification

- Eligibility is `Verified at` plus 180000 ms. Signup time is not the clock. A missing, date-only, or timezone-less timestamp is not eligible. 179999 ms is too early and 180000 ms is eligible.
- A send requires `WATCHDIVE_RESERVATION_MAIL_NOT_BEFORE` or `--not-before`. Earlier verifications are not invited. The historical backlog is not mailed.
- `Reservation paid` true with `Reservation mode` `live` suppresses that inbox. Mode `test` does not. Missing paid columns are not a payment. Suppression and paid state are read again immediately before the provider call.
- A customer send requires reservation enabled, live allowed, a live Stripe key, origin `https://watchdive.diveroid.com`, and a read-only account plus Checkout-host check. It does not create a Checkout Session. QA, preview, and localhost origins are refused. Dry-run does not call Stripe.
- The office Mac mini template interval is 30 seconds and stays disabled. The tick no longer replaces the shell, so the lock is removed on exit. A dead pid is reclaimed. A live pid is not stolen.
- No customer mail was sent. The Resend sender is still absent from this worker.

## 2026-10-18 identity, lowest price, reservation inbox

- Previews and sends always name DIVEROID LTD, company 16343651, and the registered office Office 12146, 182-184 High Street North, East Ham, London, United Kingdom, E6 2JA. Omitting the flags uses those constants. A conflicting name or office is rejected and is not echoed.
- English, Spanish, French, German, and Brazilian Portuguese state the lowest launch price in the same places Korean, Chinese, and Japanese already did.
- Reservation authorization uses `reservationCanonicalEmail`. Gmail and googlemail.com share one inbox. Plus-tags and dots on every other domain stay distinct. The waitlist canonicalizer in `src/lib/api/abuse.ts` is unchanged. Mail To stays the verified row address.
- An unsubscribed Gmail alias holds the whole Gmail inbox. A receipt on one lead of that inbox holds the other leads that are still in the audience. The ledger stores no email, so a deleted sibling row cannot be matched.
- Deleting both the receipt ledger and the Notion sent marker is operator destruction of both controls. A missing ledger with the marker still present does not send. This job does not add another production store.

## 2026-10-18 brand, nine languages, UK footer

- Visible copy is one pricing block per language. The Korean block is the reviewed wording. Other languages state the same facts once. The inbox preview is the first sentence, not a second legal wall.
- The charge is described as payment of the reservation fee. The mail does not say that opening it charges the reader.
- `lang` on `/reservation#invite=` is the actual supported locale, not an English fallback.
- Language order is explicit `Signup locale`, then a localized landing path, then browser language, then unambiguous `Signup country`, then English. `/en` beats KR. Phone, SMS, IP, and the legacy Country select are not read. Blank country cells are not backfilled.
- The HTML uses the brand palette and the official white wordmark URL. The image file is published by the frontend under `public/brand/reservation/`.
- The footer was documented here as refusing a send without `WATCHDIVE_LEGAL_NAME` and the registered postal address. That claim did not match the code, which accepted any shape-valid company. The section above is the correction: the constants are always used, and a conflicting identity is rejected.

## 2026-10-18 contract v1

- The mailed URL is `/reservation?lang=ko` or `lang=en`, with the signed invite only in the `#invite` fragment. `/ko/reservation` is not used. `inviteToken` is not a query parameter.
- Signing calls `issueReservationInvite` with the verified row email, `emailVerified: true`, a deterministic `jti`, and `expiresAtMs` from the frozen first intent.
- Subjects lead with the $149 guarantee and the $3 fee. Korean subject is `WatchDive 출시가 $149 보장 — 예약금 $3`.
- Each locale carries its own facts. The English fact line is not pasted into other languages. The "not a receipt / not a reservation" sentence is removed.
- Korean uses 예약금 and 차감. It does not use 체크아웃 or 크레딧. The US$3 fee is extra and is paid at checkout. The US$149 is later and not automatic. The total is US$152 before product shipping or tax. The guarantee is separate from the public first-100 benefit.
- Unknown provider outcomes and clear rejections are not replayed. An intent with no outcome can still resume inside 23 hours.
- The office Mac mini tick and launchd plist are templates. They are not installed. The gate file is not created. No customer mail has been sent.

Test evidence is recorded in `ads/autopilot/reservation-20261018/email.md` after the run that produced it. A passing test is not a live send.
