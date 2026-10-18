# Reservation Stripe connection

This session did not connect Stripe. It did not open Chrome, call the Stripe API, or run `--apply`. Root controls the logged-in browser. The live readback is still root's.

Runtime for this review is `grok-4.7` (`current_model_id` in the session summary). The command is `scripts/reservation-connect.ts`.

## What is pinned

Root verified the live DIVEROID dashboard for `acct_1Tl9bv1UxFzpSUuA`, with business and email verification complete. The command GETs `/v1/account` and stops before any webhook write unless the returned id is that value. A placeholder in the contract does not replace the pin. A different real `acct_` in the contract stops the command before the network call.

The command reports `charges_enabled` and `payouts_enabled` as booleans. A non-boolean stops the run. `charges_enabled: false` stops before the webhook list and before any POST. `payouts_enabled: false` is reported and does not by itself block the webhook write. Those flags do not prove the legal entity. Root still confirms the Dashboard account.

API version is read from `export const STRIPE_API_VERSION` in `src/lib/reservation/constants.ts`. The current value is `2024-06-20`. Requests send `Stripe-Version` and time out after 10 seconds. Redirects are errors.

## Events

The command reads `webhook_events` from the one `reservation-readiness` block in `docs/reservation-contract.md` and `HANDLED_EVENTS` from `src/lib/reservation/webhook.ts`. It sends nothing when those sets differ. It does not keep a third list.

Observed on 2026-10-18, without editing the contract:

- Contract, 11 events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `refund.created`, `refund.updated`, `refund.failed`.
- Code, those 11 plus `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`.

The pending backend contract task has to make those lists identical. Until then, dry-run and `--apply` both stop before Stripe. Do not subscribe disputes by hand while the contract block omits them, and do not drop them from the module in this step.

Webhook URL, only this value: `https://watchdive.diveroid.com/api/reservation/webhook`.

## Private env

Path: `/Users/macm4/.config/watchdive-autopilot/reservation.env`.

The command reads it only when it is a regular file, mode `0600`, owned by the user running the command, and outside the repo. On 2026-10-18 that file was mode `0600`, uid 501, and its only assignment name was `WATCHDIVE_RESERVATION_TOKEN_SECRET`. No Stripe key and no webhook secret were present. The value was not printed. Unrelated names are recorded and their values are not kept. A symlink, a looser mode, or a path inside the repo is refused before the values are read.

A restricted-key approval was still pending when this tool was reviewed. The key was not in the file. Install `STRIPE_SECRET_KEY` as `sk_live_…` or `rk_live_…` for the pinned account. The key must be allowed to retrieve the account and to list and create webhook endpoints. A permission error stops the tool. Test keys send no request.

## Dry-run and apply

From the implementation clone:

```bash
node --experimental-strip-types scripts/reservation-connect.ts --json
node --experimental-strip-types scripts/reservation-connect.ts --json --apply
```

The default is dry-run: GET `/v1/account` and GET `/v1/webhook_endpoints` only, and only after the live key and the event lists pass. Exit 0 with `connected: false` means the dry-run found nothing to block. It does not mean the account is connected.

`--apply` is the only mutation, and only root runs it. The only POST is `/v1/webhook_endpoints`, with the canonical URL, the shared event list, `api_version`, description `WatchDive reservation webhook`, and idempotency key `wdres_wh_v1_` plus 24 hex characters. There is no customer, Checkout Session, charge, refund, payment intent, or mail flag. Unknown arguments, including those words, are usage errors.

Exit 0 on apply means the readback showed exactly one matching endpoint and `connected` is true. Exit 2 is blocked or not connected. Exit 1 is usage. `connected` stays false for every dry-run.

## Reuse, conflicts, and the signing secret

An exact match is one endpoint with that URL, status `enabled`, `livemode` true, the same API version, and the same event set. The command reuses it. Listing does not return the signing secret. If `STRIPE_WEBHOOK_SECRET` is absent, the report says `unavailable` and tells root to paste the existing secret into the private file. It does not delete, recreate, or rotate the endpoint.

A stored secret with no matching endpoint is a stop. The command will not create a second endpoint and will not replace the stored secret.

More than one endpoint on the URL, or one endpoint that differs in status, livemode, API version, or events, is a conflict. Nothing is modified.

A new endpoint is created only when the URL is absent, no signing secret is stored, and `--apply` is set. Stripe returns `secret` once. The command writes `STRIPE_WEBHOOK_SECRET` with a `0600` temp file, fsync, and rename, then reads the endpoint list again. The secret is removed from the local report value and is redacted if it appears in an error string. If the write fails, the report names the new `we_` id and tells root to delete that endpoint in the Dashboard before any rerun. It does not add another endpoint beside it. A failed readback sets `connected` false even if the POST returned an id.

## Still blocked

- The private env has no live key, so no account read has been performed by this tool.
- The contract event list and `HANDLED_EVENTS` differ, so apply cannot start.
- `docs/reservation-contract.md` still says `stripe_account_id: acct_REPLACE_AFTER_LOGIN`. Readiness stays blocked on that placeholder. This command does not edit the contract.
- GitHub `main` is hero-restore `58b1a3ef2c766f57bbe6a65573492a4a1ce47349` (`Restore original hero imagery at owner request`, parent `83b30eafd3dd00eae9291adb46805083ad9378b3`). This clone's HEAD is `5f03468dd60d2b883515ed56046808f72463bdb4`, and `58b1a3e` is not in its object database. The future reservation merge lands on `58b1a3e`. Do not reset to `5f03468` and do not deploy `83b30ea` in place of the hero restore. Details are in `docs/reservation-rollout.md`.

## Tests

`node --experimental-strip-types --test tests/reservation-connect.test.ts tests/reservation-readiness.test.ts` passed, 26 tests, 0 failures. The connect tests use a fake Stripe API. They cover a missing key, a test key, the wrong account, `charges_enabled: false`, duplicate URLs, a conflicting event set and API version, reuse without rotation, secret redaction, a foreign contract account, and refusal of `/v1/customers`, `/v1/refunds`, and `/v1/checkout/sessions`. One test runs the CLI against the real private env with a fetch that throws, expects exit 2, and checks that the report does not contain `whsec_` or `sk_live_`. The full `npm test` suite was not run.

Do not treat this document as a live connection receipt.
