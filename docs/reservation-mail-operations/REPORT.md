# Reservation mail delay — 2026-10-18

Snapshot `mail-delay-work` (a609bdf). This worker edited only `src/lib/reservation-mail`, `scripts/reservation-mail*`, `tests/reservation-mail*`, and `docs/reservation-mail-operations`. Paid Notion mirror code was read and not edited. No production write, customer mail, Meta change, credential print, Checkout Session, or launchd install.

## What is implemented

Eligibility is the Notion `Verified at` instant plus 180000 ms. Signup time and `Signed up` are not the clock. 179999 ms is not eligible. 180000 ms is eligible. A missing cell, a date-only value, and a timestamp without a timezone fail closed for that row. A future timestamp is not due on that tick.

A send requires `WATCHDIVE_RESERVATION_MAIL_NOT_BEFORE` or `--not-before`, an ISO-8601 instant with a timezone. Rows verified before that instant are not invited. This worker did not choose the production instant. Root sets it to the moment new verifications should start receiving mail. An empty value refuses the send. It does not default to the epoch.

`Reservation paid` true and `Reservation mode` `live` suppresses that inbox, including a Gmail or googlemail alias. Mode `test` does not suppress. A false checkbox is unpaid even when mode is live. Missing paid columns are not treated as a payment. A true checkbox with no readable mode, or a cell of the wrong shape, fails closed for that row. The same suppression and paid checks run again on the page immediately before the provider call.

A customer send requires `WATCHDIVE_RESERVATION_ENABLED` exactly `true`, `WATCHDIVE_RESERVATION_ALLOW_LIVE` exactly `true`, a live Stripe key, and public origin exactly `https://watchdive.diveroid.com`. The read-only probe GETs `/v1/account` and then GETs `https://checkout.stripe.com/` with no Authorization header. It does not POST and does not call `/v1/checkout/sessions`. The account must be `acct_1Tl9bv1UxFzpSUuA` with charges enabled and details submitted. Localhost, Vercel preview, QA hosts, and any other origin are refused. Dry-run does not call Stripe. The CLI text that said Stripe keys and `WATCHDIVE_RESERVATION_ENABLED` are not read has been removed.

The tick no longer replaces the shell, so the EXIT trap removes `tick.lock` when node exits or fails. A dead pid is reclaimed. A live pid prints `lock held; nothing sent` and is left in place. A recycled pid number can theoretically look live. The plist `StartInterval` is 30, `Disabled` is true, and `RunAtLoad` is false. Its working directory is still the implementation path. Root copies this reviewed tick there and bootstraps it on the office Mac mini. This worker did not install it and did not create `send-enabled`.

Receipt idempotency, the nine-locale renderer, and the UK merchant footer are unchanged. The idempotency key is still `watchdive-reservation-wd-reservation-invite-v1-{leadId}`.

## Sender

This worker has no `RESEND_API_KEY`. Production Resend lives in the Vercel sensitive environment and was not exported. Automatic delivery cannot succeed until root supplies a sender to the office tick or uses the authenticated server-side relay. The authorized test to Jay@diveroid.com was not sent. Root sends that test. No customer mail was sent.

## Tests

In `mail-delay-work`, after `npm ci` from the existing lockfile:

`node --experimental-strip-types --test tests/*.test.ts` — 730 passed, 0 failed.

`npx tsc --noEmit` — exit 0.

Covered here: 179999 vs 180000 ms, missing and invalid `Verified at`, `Signed up` ignored, historic cutoff, exact cutoff included, suppression, live paid versus test paid, send-time recheck, repeat run does not send twice, missing prospective start, QA and preview origins, test key does not probe, read-only probe URLs, tick lock release, dead pid reclaim, live pid hold. No browser pass: this change does not alter a page.

## Left for root

1. Choose `WATCHDIVE_RESERVATION_MAIL_NOT_BEFORE` and put it in the private env file. Do not open `send-enabled` before that.
2. Copy the reviewed tick and plist into the implementation tree, then install the disabled plist on the office Mac mini only.
3. Finish Stripe QA and the sender. The live gate does not create a Checkout Session and does not prove a paid test.
4. Send the Jay@diveroid.com test. This worker did not.
