# Payment corrections

Independent fix in `ads/autopilot/reservation-20261018/payment-fixes` only. Runtime `grok-4.7`. Node `/opt/homebrew/bin/node` v26.8.2. The directory has no nested git metadata, and `b5446af` is not a commit object in the parent repository. This pass edited the named directory. QA snapshots and the original implementation clone were not edited. No live Stripe call, no credential, no customer email, no schema write, no deploy, and no Meta change. Mocked tests are not sandbox charges.

`src/routeTree.gen.ts` already imports `/reservation` and the three reservation API routes once each. Its SHA-256 was `5cb650838ec787ce5fda8475bec5569cbb61b2564a338b3e187750f794351cbd` before and after `vite build`. The stale "routes are unmounted" finding does not apply to this tree.

## Corrections

1. `aggregateInspections` now keeps a clean USD 3 payment when another session for the same inbox is fully refunded or only partially refunded. `duplicatePaid` is true only when more than one clean payment exists, including when a live dispute or a pending refund is the blocking status. A live dispute on a charge that is not fully refunded still wins, even if another session is clean. A pending or `requires_action` refund still wins over a clean sibling. A charge that is both fully refunded and disputed, with no clean sibling, stays `refunded`.

2. Checkout calls the Stripe expire API for every session that is still `open` at or after `expires_at`, then re-reads before creating. A non-400 expire failure returns `stripe_error` and creates nothing. A re-read that still shows the session open returns `reservation_in_progress` and creates nothing. A 400 for an already-closed session is ignored. After a successful expire, the next idempotency attempt is used, so a dropped previous key does not leave two payable URLs. The webhook uses the same retire step and returns 500 if the re-read still shows the session open.

3. Dispute and refund events accept `charge` as a string or as an object whose `id` is a string beginning with `ch_`. Other shapes do not select a session. A resolved dispute expires every still-open sibling.

## Commands

From `payment-fixes`:

- `/opt/homebrew/bin/node --experimental-strip-types --test tests/reservation-payment-corrections.test.ts` — 22 pass, 0 fail, 168 ms.
- `/opt/homebrew/bin/node --experimental-strip-types --test tests/*.test.ts` — 701 pass, 0 fail, 1314 ms. The prior 679 count plus these 22 tests is 701.
- `./node_modules/.bin/tsc --noEmit --pretty false` — exit 0.
- `./node_modules/.bin/vite build` — exit 0. The local preflight printed that Notion, Resend, and verification env names are unset. That warning is the existing off-Vercel check. It is not a payment-test failure.

Three checkout lines logged `StripeApiError` during the correction file. Those are the live-key refusal and the forced Stripe failures. The assertions passed.

## Changed inventory

Root should integrate these source files:

- `src/lib/reservation/state.ts`
- `src/lib/reservation/checkout.ts`
- `src/lib/reservation/webhook.ts`
- `tests/reservation-payment-corrections.test.ts`
- `docs/reservation-contract.md`
- `docs/reservation-stripe-sandbox.md`
- `docs/reservation-payment-corrections.md`

`vite build` wrote `.vercel/output` and Nitro cache files under this directory. Those are build products, not the fix. `src/routeTree.gen.ts` was not modified.

## Remaining risks

Production readiness is not approved. Leave `WATCHDIVE_RESERVATION_ENABLED` unset on production. No test key and no live key were available, and none were created. The sandbox checklist is `docs/reservation-stripe-sandbox.md`. It requires an isolated sandbox with `WATCHDIVE_RESERVATION_ENABLED=true` and a test-only key, and it forbids replacing production keys.

A live dispute or a pending refund on any not-fully-refunded charge still sets `paid` false even when a different charge is clean. That is the safety rule, not the sibling-refund bug.

If Stripe accepts the expire call but the following list still shows `open`, checkout returns 409 and does not create a second URL. The original URL can remain payable until Stripe actually expires it. An expire HTTP 500 leaves that same single open session and returns 502.

Checkout, status, and the webhook still do not read `/v1/account`. Account binding remains the connect command against `acct_1Tl9bv1UxFzpSUuA`. The public Stripe name and statement descriptor were not changed.

The in-memory double does not prove Stripe idempotency retention, dispute payload shape, or expire timing. No lawyer reviewed the UK fee wording.
