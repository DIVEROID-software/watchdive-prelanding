# Stripe sandbox checklist

For root, after a test secret key exists. This file does not contain a key. The in-memory suite is not a Stripe sandbox charge, and it is not a reason to enable production.

Official source, fetched 2026-10-18: https://docs.stripe.com/testing. Hosted Checkout is interactive, so use the card numbers on that page. Any future expiry and any 3-digit CVC are what that page allows. Use a different card when a later step depends on card state. Do not load-test.

## Production stays disabled

1. Leave the production deployment's `WATCHDIVE_RESERVATION_ENABLED` unset.
2. Do not put a test key or a live key into the production environment. Do not replace `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` on Vercel project `watchdive-prelanding`.
3. Do not set `WATCHDIVE_RESERVATION_ALLOW_LIVE`.
4. Do not change the public trading name, statement descriptor, or business address. `docs/reservation-uk-merchant.md` says those still differ from DIVEROID LTD's registered office.
5. Confirm `src/routeTree.gen.ts` still imports `/reservation` and `src/routes/api/reservation/checkout.ts`, `status.ts`, and `webhook.ts` once each. This tree already does. Regenerating it must keep those four.

## Isolated sandbox only

Use a Stripe sandbox for `acct_1Tl9bv1UxFzpSUuA`, reached from the Dashboard account picker. The sandbox is not the live integration.

1. Create a test secret key in that sandbox. Store it only in the sandbox process environment as `STRIPE_SECRET_KEY`. It must start with the test prefix. Refuse the run if it starts with the live prefix.
2. Set `WATCHDIVE_RESERVATION_ALLOW_LIVE` unset.
3. Set `WATCHDIVE_RESERVATION_ENABLED` to exactly `true` only in that sandbox process. Production stays unset.
4. Run the connection command read-only against `acct_1Tl9bv1UxFzpSUuA`. Stop if the account id differs, if charges or payouts are disabled, or if the command would create a webhook before the endpoint below is intended.
5. Add one sandbox webhook endpoint for the fourteen events in `docs/reservation-contract.md`. Store that endpoint's signing secret only in the sandbox `STRIPE_WEBHOOK_SECRET`.
6. Use a verified invite. POST `{ "inviteToken", "acceptedTerms": true, "termsVersion": "2026-10-18" }`. Expect one `https://checkout.stripe.com/` URL and a Checkout Session of USD 3.00, mode payment, card only. Nothing may authorize USD 149.

## Session checks

| Step | What to do | Pass |
| --- | --- | --- |
| 3DS success | UK-relevant required authentication card `4000000000003220` on the hosted page. Complete the 3DS challenge. The testing page says authentication must be completed for this card's payment to succeed. | Status bearer returns `paid: true`, `status: "paid"`, `amountTotal: 300`, `currency: "usd"`. Dashboard PaymentIntent shows the 3DS authentication succeeded. |
| 3DS failure | `4000008400001629`. Complete the requested authentication. The testing page says the payment is then declined with `card_declined`. | Status `paid` is false. No second Session is created by the decline. No USD 149 PaymentIntent. |
| 3DS abandon | `4000000000003220` again, on a new Session. Leave the challenge without completing it. The testing page says authentication must be completed for the payment to succeed. | Status `paid` is false. The Session is not `paid`. A later POST does not open a second payable URL while this one is still open and unexpired. |
| Decline | `4000000000000002` | The issuer declines. Status `paid` is false. Cancel or decline does not mark the inbox paid. |
| Cancel | Choose back on the hosted page before paying | No charge. A later POST reuses one open URL or, once `expires_at` has passed, expires that Session before creating the next one. |
| Duplicate click | POST checkout twice, then pay once with `4242424242424242` | One successful charge. `duplicatePaid` is false. |
| Duplicate paid | Only in the sandbox, if two contract Sessions are both paid | Status `paid` true and `duplicatePaid` true. Refund one in the Dashboard. Status stays `paid`, `duplicatePaid` false, `amountRefunded` 0 on the remaining charge. |
| Forged return | Open `/reservation?session_id=cs_test_...&paid=true` with no bearer, then with the bearer before payment | 401 without the bearer. `paid` is false until the sandbox Session is paid. |
| Partial refund | Dashboard refund of USD 1.00 on the test charge | Status `partially_refunded`, `paid` false, next checkout 409. |
| Full refund | Dashboard refund of the remaining amount | Status `refunded`, `paid` false. This code must not create a replacement charge. |
| Pending refund | If the sandbox shows a refund in `pending` or `requires_action` | Status `refund_pending`, `paid` false, next checkout 409, including when another clean charge exists. |
| Dispute | `4000000000000259` | After the dispute opens, status `disputed` and checkout 409. The webhook may deliver `charge` as a string or as an expanded object with `id`. An open sibling Session is expired. |
| Bad signature | Replay a forwarded event with one body byte changed | HTTP 400 `invalid_signature`. The sandbox charge is unchanged. |
| Replay | Deliver the same `checkout.session.completed` twice | The second response does not create a charge or a refund. `paid` matches the retrieved Session. |
| Refund webhook | Deliver `charge.refunded` or `refund.updated` once, then again | `paid` and `amountRefunded` follow the retrieved charge both times. No second fee. |

## Do not treat as done

- A live key, `WATCHDIVE_RESERVATION_ALLOW_LIVE`, or production `WATCHDIVE_RESERVATION_ENABLED`.
- Replacing production keys with the sandbox key.
- A customer email or a launchd mail run.
- Any claim that the in-memory suite already performed these sandbox payments.
- Production readiness. This checklist is the first sandbox pass, not a launch approval.
