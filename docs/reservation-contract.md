# WatchDive reservation contract

Backend owner for offer `2026-10-18`. Root integration contract v1. This file is the canonical HTTP, token, and Stripe contract. It does not enable charges. Root sets env, creates the webhook, deploys, and sends mail.

The USD 3 fee is additional. It is not credited toward the later product. The later product price is USD 149. USD 152 is the fee plus that price, before any shipping or tax that is stated separately. The USD 149 price is guaranteed to be the lowest. The fee is nonrefundable except launch cancellation, subject to applicable mandatory rights. This module does not refund, and it does not state stock, a ship date, or a benefit exclusion.

## reservation-readiness

One block. `scripts/reservation-readiness.ts` parses it. `stripe_account_id` is the approved Diveroid account `acct_1Tl9bv1UxFzpSUuA`.

```reservation-readiness
schema_version: 1
amount_cents: 300
product_price_cents: 14900
currency: usd
checkout_mode: payment
fee_credited_to_product: false
invite_token: signed
client_email: untrusted
authoritative_paid: verified-stripe
public_origin: https://watchdive.diveroid.com
success_path: /reservation?session_id={CHECKOUT_SESSION_ID}
checkout_method: POST
checkout_path: /api/reservation/checkout
status_method: GET
status_path: /api/reservation/status
webhook_method: POST
webhook_path: /api/reservation/webhook
stripe_secret_key_env: STRIPE_SECRET_KEY
stripe_webhook_secret_env: STRIPE_WEBHOOK_SECRET
token_secret_env: WATCHDIVE_RESERVATION_TOKEN_SECRET
public_origin_env: WATCHDIVE_PUBLIC_ORIGIN
enable_flag_env: WATCHDIVE_RESERVATION_ENABLED
allow_live_env: WATCHDIVE_RESERVATION_ALLOW_LIVE
stripe_account_id: acct_1Tl9bv1UxFzpSUuA
webhook_events: checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,charge.refund.updated,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,refund.created,refund.updated,refund.failed
ledger_mode: stripe-retrieve
```

`ledger_mode: stripe-retrieve` means Stripe is the payment record. There is no SQL ledger and no new waitlist column. Notion has no compare-and-set, and this module does not write a reservation or payment property. The form-first experiment stays the existing 50:50 `byte < 128` split. Attribution, privacy consent, and optional SMS are not written. A phone number is not a verified email and is not payment.

## Environment

All names are server-only. None use a `VITE_` prefix. Checkout calls Stripe only when every required value below is present. Until then the handlers return 503 and do not call Stripe.

| Name | Rule |
| --- | --- |
| `WATCHDIVE_RESERVATION_ENABLED` | Exactly `true` or every handler returns 503 `reservation_disabled`. Any other value, including unset, is off. |
| `WATCHDIVE_RESERVATION_ALLOW_LIVE` | Exactly `true` before `sk_live_` or `rk_live_` is accepted. Otherwise 503 `reservation_misconfigured`. This flag alone does not take a charge. |
| `STRIPE_SECRET_KEY` | `sk_test_` or `rk_test_` while the live flag is off. Live keys need the live flag. Checkout, status, and the webhook all use it. The live key must belong to `acct_1Tl9bv1UxFzpSUuA`. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`. Required for checkout and for the webhook, so checkout stays misconfigured until the endpoint secret exists. |
| `WATCHDIVE_RESERVATION_TOKEN_SECRET` | At least 32 bytes. Signs invites. It is not `WATCHDIVE_VERIFICATION_SECRET`. Rotating the verification secret does not cancel these invites. Rotating this secret does. |
| `WATCHDIVE_PUBLIC_ORIGIN` | Bare `https` origin with no path, query, user, or hash. Production value `https://watchdive.diveroid.com`. The Host header is ignored. |

The response body for a bad config is `{ "error": "reservation_disabled" }` or `{ "error": "reservation_misconfigured" }`. The specific missing field is not returned.

Stripe requests use `fetch` against `https://api.stripe.com` with `Stripe-Version: 2024-06-20`, a 10 second timeout, and `redirect: "error"`. There is no Stripe SDK and no publishable key in the client. Adaptive pricing and promotion codes are not sent. `payment_method_types[0]` is `card`, `ui_mode` is `hosted`, and `submit_type` is `pay`. Card-only is deliberate so `payment_status: paid` means the card payment succeeded now. Root can widen methods later only by changing this contract and the paid checks together.

## Endpoints

Routes are TanStack Start file routes. `src/routeTree.gen.ts` registers all three plus the frontend `/reservation` page. Regenerating that file must keep both. `/ko/reservation` does not exist. Locale is the `lang` query on `/reservation`.

### POST `/api/reservation/checkout`

`Content-Type: application/json`. Body at most 4096 bytes.

```json
{ "inviteToken": "v1.<payload>.<mac>", "acceptedTerms": true, "termsVersion": "2026-10-18" }
```

`acceptedTerms` must be boolean `true`. `termsVersion` must be exactly `2026-10-18`. Anything else, including the string `"true"` or a missing version, is 400 `{ "error": "rejected_terms" }` and does not call Stripe. `email`, amount, and `paid` on the body are ignored. The server puts `accepted_terms=true` and `terms_version=2026-10-18` on the session, the PaymentIntent, and the product.

Success is exactly `{ "url": "<hosted Checkout URL>" }`. The URL host must be exactly `checkout.stripe.com`, `https`, with no username, no password, and no port other than 443. Any other host, including a suffix of that name, is 502 `stripe_contract_mismatch`. The URL is Stripe's, not one built from the Host header.

| Status | Body `error` | When |
| --- | --- | --- |
| 200 | | One hosted URL for a new or reused open session. |
| 400 | `invalid_invite` | Missing, tampered, expired, or unverified token. |
| 400 | `rejected_terms` | Terms were not accepted for version `2026-10-18`. |
| 400 | `bad_request` | JSON that is not an object. |
| 409 | `already_paid`, `refunded`, `partially_refunded`, `refund_pending`, or `disputed` | This canonical inbox already has that state for this offer. Body also includes `status` and `paid`. Every open session for the inbox is expired. No second session is created. The client refreshes status. It does not blind-retry the same POST. |
| 409 | `reservation_in_progress` | A racing create is still settling and no hosted URL is readable yet. Refresh status. Do not start another attempt. |
| 413 | `payload_too_large` | Body over 4096 bytes. |
| 415 | `bad_request` | Not JSON. |
| 502 | `stripe_error` | Stripe could not be read or written. The attempt number does not advance. |
| 502 | `stripe_contract_mismatch` | Stripe returned an amount, currency, success URL, line item, or checkout host other than this contract. The bad open session is expired. No URL is returned. |
| 503 | `reservation_disabled` or `reservation_misconfigured` | Flag off, or flag on without a valid config. |
| 405 | `method_not_allowed` | Not POST. |

Checkout parameters, copied onto the session, the PaymentIntent, and the product. The same inbox always sends the same parameters. A different lead id or a different token `jti` does not change them.

- `mode=payment`, `ui_mode=hosted`, one line, quantity 1, currency `usd`, `unit_amount` 300
- product name `WatchDive reservation fee`
- description stating the additional USD 3, the USD 149 lowest price, and the refund rule above
- `success_url` = `{origin}/reservation?session_id={CHECKOUT_SESSION_ID}` with the braces literal
- `cancel_url` = `{origin}/reservation?canceled=1`
- `client_reference_id` = `email_sha256` of the canonical inbox
- metadata: `product=watchdive_reservation_fee`, `offer_version=2026-10-18`, `email_sha256`, `fee_cents=300`, `currency=usd`, `fee_policy=additional_not_credited`, `later_price_cents=14900`, `price_guarantee=lowest_149_usd_100_percent`, `refund_policy=nonrefundable_except_launch_cancellation_or_mandatory_rights`, `accepted_terms=true`, `terms_version=2026-10-18`

`email_sha256` is SHA-256 hex of `reservation-email:v1:` plus the canonical email. The session idempotency key is `wdres_v1_{email_sha256}_2026-10-18_a{attempt}`. The customer idempotency key is `wdres_cus_v1_{email_sha256}`. The raw email, the lead id, and the token `jti` are not placed in either key and are not Stripe metadata. `lead_id` and `invite_jti` are not sent.

`attempt` is one plus the count of sessions for this inbox and offer whose Stripe `status` is `expired` and whose inspection is `terminal_unpaid` or `invalid`. Paid, open, and unknown errors do not spend an attempt. A session that is still `status` `open` after `expires_at` does not spend an attempt until this server has expired it and the re-read shows `expired`. An idempotency conflict re-reads Stripe and returns the blocked state, the open hosted URL, or `reservation_in_progress`. It does not allocate another attempt. After a confirmed expired session, one reissue uses the next attempt only when the reloaded expired count actually increased.

After create, the server re-reads amount, currency, success URL, line items, and the checkout host. A mismatch expires that session and returns 502 `stripe_contract_mismatch`. If the following list does not yet show a `checkout.stripe.com` URL, the response is 409 `reservation_in_progress`. The create response URL is not returned on its own.

### GET `/api/reservation/status`

Optional query: `session_id`. It must match `^cs_(?:test|live)_[A-Za-z0-9]+$`.

The request requires `Authorization: Bearer` and the invite token. The scheme is case-insensitive and there is exactly one token. A missing header, a missing token, or more than one token is 401 `{ "error": "missing_bearer" }` and does not call Stripe. A bad or expired bearer is 401 `{ "error": "invalid_invite" }` and does not call Stripe. A query `inviteToken`, a client email, and `paid=true` are ignored. `session_id` alone is not identity.

200 body, with no email, phone, or country:

```json
{
  "status": "unpaid",
  "paid": false,
  "source": "stripe",
  "amountTotal": null,
  "currency": null,
  "amountRefunded": 0,
  "amountRefundPending": 0,
  "duplicatePaid": false,
  "sessionId": null
}
```

`status` is one of `unpaid`, `open`, `paid`, `refunded`, `partially_refunded`, `refund_pending`, `disputed`, `invalid`. `source` is always `stripe`. `paid` is true only for the paid definition below.

The page treats success only when `status` is `paid` and `paid` is true and `source` is `stripe` and `amountTotal` is 300 and `currency` is `usd`.

The bearer names the canonical inbox. The response is that inbox's aggregate, not a single session. When `session_id` is present, the session must be this offer, its metadata `email_sha256` and `client_reference_id` must be that inbox's hash, and the Stripe customer email must canonicalize to the invite email. Otherwise 404 `not_found`. A token for the same lead and a different inbox is 404.

Other statuses: 400 `bad_request`, 404 `not_found`, 502 `stripe_error`, 503 as above, 405 except GET. The handler function also accepts HEAD, but the route file registers GET only.

The success redirect and `?paid=true` are not payment.

### POST `/api/reservation/webhook`

Production URL: `https://watchdive.diveroid.com/api/reservation/webhook`.

The signature is HMAC-SHA256 over the raw body, of the string `{timestamp}.{rawBody}`, hex `v1` in the `Stripe-Signature` header. Every `v1` is checked so a secret can rotate. Timestamp tolerance is 300 seconds in both directions. JSON is parsed only after the MAC matches. A bad or missing signature is 400 `invalid_signature` and does not call Stripe again.

A matching signature then re-fetches Stripe. Event amounts are not trusted. Livemode must match the key or the event is 200 ignored. Unknown event types are 200 ignored. A session that is not this product and offer is 200 ignored. If the customer email hash is not the session `email_sha256`, the event is 200 ignored `not_bound`. Stripe read failures throw and the handler returns 500 `stripe_error` so Stripe retries. Flag off or misconfigured is 503 so Stripe retries. Body over 1_000_000 bytes is 413.

The webhook does not create a charge and does not refund. Replaying it returns the same derived `paid` and `amountRefunded`. Dispute and refund events accept `charge` as a string id or as an object whose `id` is a string beginning with `ch_`. A number, an array, a missing id, or an id that does not begin with `ch_` does not select a session. When the inbox is paid, refunded, partially refunded, refund-pending, or disputed, every session that is still `status` `open` is expired, including one whose `expires_at` has passed. When the inbox is open, the oldest `checkout.stripe.com` URL that is not past `expires_at` is kept and every other open session is expired, including a URL on any other host. A session that is still `open` after `expires_at` is expired and the inbox is re-read before that choice. If that expire fails, or the re-read still shows it open, the webhook returns 500 so Stripe retries.

Handled snapshot events, matching `HANDLED_EVENTS`:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.refund.updated`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `refund.created`
- `refund.updated`
- `refund.failed`

`charge.dispute.*` is resolved from the dispute's `charge` before the generic `charge.*` path. A dispute id is `du_`, not `ch_`.

Local forwarding, after root has the Stripe CLI logged into `acct_1Tl9bv1UxFzpSUuA`: `stripe listen --forward-to localhost:<port>/api/reservation/webhook`. Dashboard path for the live endpoint: Workbench, Developers, Webhooks, add endpoint, snapshot payload, the fourteen events above. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. Do not paste the secret into git, chat, or this file.

JSON responses from all three handlers send `cache-control: private, no-store`, `referrer-policy: no-referrer`, and `x-robots-tag: noindex`. The HTML page's referrer policy is the frontend route.

## Invite token

Format: `v1.` + base64url(JSON) + `.` + base64url HMAC-SHA256. The MAC input is `reservation-invite:v1:` plus the base64url body. Compare is timing-safe.

Claims: `leadId`, canonical email, `exp` (unix seconds), `jti`, `offerVersion` `2026-10-18`, `emailVerified: true`, purpose `reservation-invite:v1`. Canonical email uses `canonicalEmail` in `src/lib/api/abuse.ts` (trim, lower case, plus-tags, Gmail dots, `googlemail.com` to `gmail.com`). A token whose email is not already canonical does not verify. There is no default expiry. The issuer throws unless `emailVerified` is exactly true.

The only token helper is this export from `src/lib/reservation/invite.ts` (also re-exported from `src/lib/reservation/index.ts`):

```ts
issueReservationInvite({
  leadId,
  email,
  emailVerified: true,
  expiresAtMs,
  secret, // WATCHDIVE_RESERVATION_TOKEN_SECRET
  jti?, // optional
  nowMs?, // optional
});
```

The email worker passes the verified row email server-side, `emailVerified: true`, and an explicit `expiresAtMs`. This module does not export `createReservationInviteToken` or `createReservationInviteUrl`. A loader that still calls those names will not bind.

The mailed URL is `https://watchdive.diveroid.com/reservation?lang=ko#invite=TOKEN`. Supported language values are `en`, `ko`, `zh-CN`, `zh-TW`, `ja`, `es`, `fr`, `de`, or `pt-BR`. The saved signup language takes priority; trusted signup country is a fallback only when language is missing, otherwise English. The token is the fragment `#invite=`, not a query parameter. `/ko/reservation` does not exist. The page consumes `#invite`, strips the fragment, and keeps the token in `sessionStorage` for the return from Stripe. Checkout still posts the token as JSON `inviteToken`. This backend does not edit the page or the mailer.

Token max length on verify is 4096. The signed token is base64url, so the address is not visible in the token text.

Checkout does not re-read Notion to prove `emailVerified`. The signature is that proof. A person who can read `WATCHDIVE_RESERVATION_TOKEN_SECRET` can mint a token this checkout will accept. Keep that secret server-side.

## Paid

`paid: true` only when a retrieved Checkout Session has all of the following:

- this product and offer version
- `livemode` matches the secret key
- `mode` `payment`, currency `usd`, `amount_total` 300
- metadata fee, currency, fee policy, later price, price guarantee, refund policy, `accepted_terms` `true`, and `terms_version` `2026-10-18` match the constants
- `client_reference_id` equals metadata `email_sha256` and that hash matches the canonical inbox
- exactly one line item, quantity 1, currency `usd`, line `amount_total` 300, `unit_amount` 300, not recurring
- session `status` `complete` and `payment_status` `paid`
- PaymentIntent and Charge amounts are 300 `usd`, and the charge belongs to that PaymentIntent
- charge `amount_refunded` is 0, the charge is not fully refunded, and no refund is `pending` or `requires_action`
- charge `disputed` is false, or every dispute on that charge has status `won`, `warning_closed`, or `prevented`

Anything else on that charge is `paid: false`. An open dispute, a missing dispute list on a disputed charge, or any other dispute status is an open dispute. A won dispute with no refund can stay a clean payment. An open session that matches the money is `open` and its URL may be reused only when the host is `checkout.stripe.com` and `expires_at` is still in the future. A completed session that is not `paid` is not paid, even if the webhook event says it is. On a single charge, a full refund, a partial refund, and a pending refund are `refunded`, `partially_refunded`, and `refund_pending`. Each of those blocks a new charge with 409 when no clean payment remains. This offer version does not automatically start another charge after a refund. A new charge would need a future explicit offer-version change. This code does not refund.

`amount_total` is the figure Stripe returns after discounts. This client also requires the line `unit_amount` and line `amount_total` to be 300. It does not read `total_details.amount_discount` as its own field. Promotion codes are not enabled on create.

Priority when several of our sessions exist:

1. A live dispute: any paid session with an open dispute whose refund is not full. Status `disputed` and `paid` false, even when another session is a clean USD 3 payment. Checkout is 409 `disputed`.
2. A `pending` or `requires_action` refund on any paid session. Status `refund_pending` and `paid` false, even when another session is a clean payment. Checkout is 409 `refund_pending`.
3. A clean paid session: refund state none and dispute none. Status `paid` and `paid` true. The reported session is the oldest clean session, with `amountRefunded` 0. A fully refunded sibling, or a partially refunded sibling, does not clear this. Checkout is 409 `already_paid`.
4. A partial refund, when no live dispute, pending refund, or clean payment remains. Status `partially_refunded`.
5. A full refund, including a charge that is both fully refunded and disputed, when no earlier item applies. Status `refunded` and `paid` false. A full refund is reported even when that same charge is also disputed.
6. The oldest open session whose `expires_at` is still in the future, then invalid, otherwise unpaid.

`duplicatePaid` is true only when more than one clean paid session exists. The flag stays accurate when a live dispute or a pending refund is the status that blocks checkout. The server does not refund the extra. Root refunds it manually in Stripe. After that manual refund, a remaining clean USD 3 charge stays `paid` and `duplicatePaid` becomes false.

## Idempotency

Customer and session lists are reads. They are not an atomic lock. Notion is not a lock. There is no SQL reservation row.

1. List customers by the canonical email and keep only customers whose stored email canonicalizes to that inbox.
2. List Checkout Sessions for those customers. Lists paginate 100 at a time and fail closed with 502 `list_truncated` after 10 pages.
3. If the inbox is already paid, refunded, partially refunded, refund pending, or disputed, expire every session that is still `status` `open`, including one past `expires_at`, and do not create a session.
4. Expire open sessions that claim this product but have the wrong money, then re-read.
5. Expire every session that is still `status` `open` and whose `expires_at` is at or before now, by calling the Checkout expire API, then re-read. A 400 because the session is already closed is not a failure. Any other expire failure returns `stripe_error` and does not create a session. If the re-read still shows one of those sessions open, return `reservation_in_progress` and do not create a session.
6. If an open session matches the contract, is not past `expires_at`, and its URL host is `checkout.stripe.com`, keep the oldest URL and expire the others. A non-matching host is expired and is not returned.
7. Otherwise create one session with the inbox idempotency key for the current spent attempt. Two racing creates for the same inbox share that key for Stripe's idempotency window (24 hours), including when the lead ids and token jtis differ. After that window, the next attempt is used only when the re-read shows a session with Stripe `status` `expired`. That includes a session this server just expired because `expires_at` passed while `status` was still `open`. Dropping the previous idempotency key must not leave two payable URLs.
8. Re-read the inbox after create. Return a URL only when the list shows a hosted keeper that is not past `expires_at`. If the inbox is now blocked, expire every open session and do not return a second URL.

The same Gmail inbox cannot pay twice under another spelling or another lead id. A different canonical email is a different charge. Two lead ids for one canonical inbox share one customer and one payment state.

Residual: if someone later edits the Stripe customer email off the canonical address, list-by-email can miss the old payment. Within 24 hours a new create for the original inbox uses the same idempotency key with a different customer id, Stripe returns an idempotency conflict, and the server returns `reservation_in_progress`. After 24 hours that edited customer can be missed. Do not paper over that by attaching extra customer ids. Do not treat that edit as a way to take a second fee.

## Root still does

1. Leave `WATCHDIVE_RESERVATION_ENABLED` unset until `reservation-readiness` is ready and the user has approved a live charge.
2. Confirm the live secret key is for `acct_1Tl9bv1UxFzpSUuA`. The readiness block already names that account.
3. Create the snapshot webhook on the production URL for the fourteen events. Set `STRIPE_WEBHOOK_SECRET` from that endpoint.
4. Set the other server env names on Vercel project `watchdive-prelanding` only when deploying. Do not put values in git or in this file.
5. Set `WATCHDIVE_RESERVATION_ALLOW_LIVE=true` only with the live secret key, and only after the readiness command exits 0.
6. Keep `/reservation` and the three API routes if `routeTree.gen.ts` is regenerated. Do not add `/ko/reservation`.
7. The email worker must call `issueReservationInvite` with the verified email, `emailVerified: true`, and `expiresAtMs`, and must mail `https://watchdive.diveroid.com/reservation?lang=ko#invite=TOKEN` (use the saved supported locale in `lang`; fallback to English only when no supported preference exists).
8. The page must read `#invite`, strip the fragment, store the token in `sessionStorage`, POST `{ inviteToken, acceptedTerms: true, termsVersion: "2026-10-18" }`, and GET status with `Authorization: Bearer` plus that token. Success is only the paid rule above.
9. Watch `duplicatePaid` and refund extras manually. This code will not do it. Refunding one extra must leave the remaining clean USD 3 charge `paid` with `duplicatePaid` false. Do not treat a live dispute or a pending refund on any charge as that clean payment.
10. Do not deploy from a tree that drops the protected FAQ and pool-photo commit named in `docs/reservation-rollout.md`.

This implementation did not call live Stripe, send customer email, mutate a schema, deploy, change Meta ads, edit `package.json`, or commit.
