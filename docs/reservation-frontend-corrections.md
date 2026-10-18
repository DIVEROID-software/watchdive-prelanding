# Reservation frontend corrections — 2026-10-18

Snapshot started from root `669ae72` (payment corrections, 701 tests). This pass changes only the reservation UI, its tests, reservation guarantee wording in `frozen-landing-messages.ts`, and this report. Payment source (`src/lib/reservation/**`), mail source, env, schema, secrets, Stripe, customers, and Meta were not edited. No campaign was resumed. Root integrates and reruns.

## Result

| Check | Result |
| --- | --- |
| `npm test` (`node --experimental-strip-types --test tests/*.test.ts`) | 707 passed, 0 failed, 0 skipped. Duration 1259.95 ms. Baseline was 701. |
| `npx tsc --noEmit` | Exit 0. No `error TS` output. |
| `npm run build` (`vite build`) | Exit 0. Local shell printed the existing verification-env warning because Notion, Resend, and signing env vars are unset here. No env file was written. |

There was no rendered desktop or mobile pass. The browser was not opened, and the local `review.html` tab was not used. These checks are source, node:test, `tsc`, and the production build.

## What changed

Paid status is authoritative only when `status` is `paid`, `paid` is true, `source` is `stripe`, `currency` is `usd`, `amountTotal` is 300, and refund cents, pending-refund cents, and `disputed` do not block it. A `paid` body with `amountRefunded` or `amountRefundPending` above 0 becomes `serverStatus: "invalid"` and is not shown as paid. `refunded`, `partially_refunded`, and `refund_pending` keep those statuses even if `paid` is true, and checkout stays closed. Missing or null refund fields count as 0, so a clean 300-cent Stripe body stays paid. A non-integer refund field fails the parse.

`disputed` is a server status. The phase is `disputed`, checkout is closed, polling stops, and each locale has its own sentence. The English sentence is "This payment is disputed. Checkout stays closed."

`401` and checkout `400` whose JSON `error` is exactly `invalid_invite` become the invalid-link state. The page stores the non-secret flag `watchdive.reservation.inviteInvalid=1`. `401 missing_bearer` stays `bad_response`. A forged `#invite=` sets that flag, does not store the forged token, and `reservationUrlWithoutSecret` still drops the hash plus `inviteToken` and `token`. A later valid fragment clears the flag. A bad fragment does not delete an already stored valid token; the flag still forces the invalid-link copy unless an authoritative paid, refund, or dispute status is already in hand.

`createReservationSubmitLock` is synchronous. The page calls `tryBegin()` once, before `requestReservationCheckout`, and `ReservationPage.tsx` still names that function exactly twice. A failed attempt calls `end()`. A successful checkout keeps the lock until navigation.

## Nine-locale offer

Titles, meta titles, and the guarantee term now name the lowest launch price in en, ko, zh-CN, zh-TW, ja, es, fr, de, and pt-BR. The Korean title is `지금 $3로 최저 출시가 $149를 보장받으세요`. The Korean fee row says the fee is separate and is not deducted (`차감되지 않습니다`). Existing gates remain: separate USD $3, not credited, USD $149, 100%, independent of the first 100, no automatic USD $149 charge, USD $152 before shipping and tax, refund only if the launch is cancelled, and mandatory rights.

The Japanese UI meta no longer says `送料と税金の前で`. It now says the total does not include applicable shipping and tax. The legal catalog anchor `適用される製品の送料と税金の前で USD $152` is unchanged because `tests/reservation-policy.test.ts` still requires that phrase.

`frozen-landing-messages.ts` inserts one lowest-price sentence after the existing first-100 guarantee in privacy `intro2`, privacy `s2NoPayment`, terms `s1Body`, and terms `s2Body` for all nine locales. English source bytes in `frozen-landing-en.ts` were not edited. The exported English catalog is the imported English object plus that sentence: "That USD $149 price is the lowest launch price." Hero and FAQ were not given the fee. Rejected store, stock, remedy, and waiver sentences were not restored.

## Privacy and terms paths

`isI18nReviewEnabled` and `VITE_WATCHDIVE_I18N_REVIEW` were not changed. The flag is on only when the value is exactly `"true"`. With the flag off, reservation privacy, terms, and home links stay on the English paths. With the flag on, a non-English reservation locale uses the prefixed path (`/ko`, `/zh-cn`, and the other locale routes). Production already serving nine locales is an environment value, not a code default flipped here. Those legal pages were not rendered in this pass.

## Intentionally unchanged

Session storage stays tab-local. No `localStorage` or cross-tab token sharing was added. The invite is still not copied into the query. Third-party tags stay off the reservation route. Brand CSS tokens and the wordmark hash checks were not changed.

## Files in this correction

- `src/components/reservation/contract.ts`
- `src/components/reservation/client.ts`
- `src/components/reservation/query.ts`
- `src/components/reservation/model.ts`
- `src/components/reservation/copy.ts`
- `src/components/reservation/ReservationPage.tsx`
- `src/lib/i18n/frozen-landing-messages.ts`
- `tests/reservation-ui.test.ts`
- `tests/reservation-ui-copy.test.ts`
- `tests/reservation-ui-contract.test.ts`
- `tests/reservation-policy.test.ts`
- `docs/reservation-frontend-corrections.md`

New tests, without removing prior assertions:

- every locale names the lowest launch price and a closed dispute
- every locale says the guaranteed USD $149 price is the lowest launch price
- a refunded or disputed body is not accepted as a paid reservation
- `401 invalid_invite` is an invalid link, and another `401` stays unavailable
- an invalid fragment keeps a non-secret flag and never copies the token into the query
- the submit lock rejects a second begin in the same turn

`disputed` was added to the existing status loop that requires `authoritativePaid` false and the same `serverStatus`.

## Left for root

Integrate this tree and rerun the suite. Do not treat this build as a deployment. The local verification-env warning is the unset shell, not a reservation logic failure.
