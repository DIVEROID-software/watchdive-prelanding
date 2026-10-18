# Reservation mail changelog

## 2026-10-18 brand, nine languages, UK footer

- Visible copy is one pricing block per language. The Korean block is the reviewed wording. Other languages state the same facts once. The inbox preview is the first sentence, not a second legal wall.
- The charge is described as payment of the reservation fee. The mail does not say that opening it charges the reader.
- `lang` on `/reservation#invite=` is the actual supported locale, not an English fallback.
- Language order is explicit `Signup locale`, then a localized landing path, then browser language, then unambiguous `Signup country`, then English. `/en` beats KR. Phone, SMS, IP, and the legacy Country select are not read. Blank country cells are not backfilled.
- The HTML uses the brand palette and the official white wordmark URL. The image file is published by the frontend under `public/brand/reservation/`.
- The footer legal name is runtime configuration. Send refuses without `WATCHDIVE_LEGAL_NAME` and the registered postal address. Previews use the Companies House identity for 16343651: DIVEROID LTD, Office 12146, 182-184 High Street North, East Ham, London, United Kingdom, E6 2JA.

## 2026-10-18 contract v1

- The mailed URL is `/reservation?lang=ko` or `lang=en`, with the signed invite only in the `#invite` fragment. `/ko/reservation` is not used. `inviteToken` is not a query parameter.
- Signing calls `issueReservationInvite` with the verified row email, `emailVerified: true`, a deterministic `jti`, and `expiresAtMs` from the frozen first intent.
- Subjects lead with the $149 guarantee and the $3 fee. Korean subject is `WatchDive 출시가 $149 보장 — 예약금 $3`.
- Each locale carries its own facts. The English fact line is not pasted into other languages. The "not a receipt / not a reservation" sentence is removed.
- Korean uses 예약금 and 차감. It does not use 체크아웃 or 크레딧. The US$3 fee is extra and is paid at checkout. The US$149 is later and not automatic. The total is US$152 before product shipping or tax. The guarantee is separate from the public first-100 benefit.
- Unknown provider outcomes and clear rejections are not replayed. An intent with no outcome can still resume inside 23 hours.
- The office Mac mini tick and launchd plist are templates. They are not installed. The gate file is not created. No customer mail has been sent.

Test evidence is recorded in `ads/autopilot/reservation-20261018/email.md` after the run that produced it. A passing test is not a live send.
