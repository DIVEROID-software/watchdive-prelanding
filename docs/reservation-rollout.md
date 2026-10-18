# Reservation rollout and rollback

Read-only gate: `scripts/reservation-readiness.ts`.
It does not charge, refund, send mail, apply SQL, write env, deploy, or change ads.
It prints secret presence only. It never prints secret values.

Production enable is a root action after three conditions are true together:

1. This command exits 0 (`ready`).
2. The reservation test suite has passed on the commit that will deploy.
3. The user has logged into the official Diveroid Stripe business account. A historical personal Payment Link is not that account.

Until those are true, leave `WATCHDIVE_RESERVATION_ENABLED` unset or `false`.

## Current tree

Checked 2026-10-18 without checking out or merging.

| Ref | Commit | Meaning |
| --- | --- | --- |
| GitHub `main` | `58b1a3ef2c766f57bbe6a65573492a4a1ce47349` | Owner hero restore. Message: "Restore original hero imagery at owner request". Committer date `2026-10-18T04:19:25Z`. |
| Parent of `main` | `83b30eafd3dd00eae9291adb46805083ad9378b3` | FAQ copy and pool-photo hero. The hero restore replaced that hero. Do not deploy this parent in place of `main`. |
| This clone `HEAD` | `5f03468dd60d2b883515ed56046808f72463bdb4` | Parent of `83b30ea`. It contains neither the FAQ/pool-photo commit nor the hero restore. |

Files in `58b1a3e`: `docs/image-provenance-20261018.md`, `src/components/hero-photo.tsx`, `src/lib/i18n/frozen-landing-en.ts`, `src/lib/i18n/frozen-landing-messages.ts`, `src/styles.css`, `tests/designFreeze.test.ts`.

Checked with `gh api` on `DIVEROID-software/watchdive-prelanding` commit `main`. Nothing was checked out, fetched, or merged. `58b1a3e` is not in this clone's object database, so the protected-commit check stays failed until root fetches it. A future reservation merge lands on top of `58b1a3e`.

Do not deploy this clone while `reservation-readiness` reports that the protected commit is absent. Do not `git reset` to `5f03468dd60d2b883515ed56046808f72463bdb4`. Do not deploy `83b30ea` in place of the hero restore.

The canonical contract `docs/reservation-contract.md` is backend-owned. This command stays blocked until that file contains one `reservation-readiness` block. Backend code already names the env vars below in `src/lib/reservation/constants.ts`. The block must use those names. This command fails if the block and the constants disagree.

Root's Vercel project, as supplied for this rollout: `watchdive-prelanding` on team `jays-projects-c61403c8`. That project had no Stripe env. `SUPABASE_URL` existed. No service-role key was found. This command does not read or create either value.

The live site is the Vercel deployment of `https://watchdive.diveroid.com`. Office Mac mini owns deterministic schedules and private config. Do not install a laptop launchd job for this gate, and do not put Stripe secrets in the Maya report path.

Mail stays in `scripts/launch-mail.ts`. This gate does not send it.

## Approved commercial checks

The block is rejected unless it says all of the following:

- Fee `300` USD cents, additional, `fee_credited_to_product: false`.
- Later product price `14900` cents. The command does not add stock, a ship date, or a benefit exclusion.
- Currency `usd`, Checkout `mode` `payment`.
- Signed `invite_token`. Client email `untrusted`.
- Authoritative paid state `verified-stripe`.
- Public origin `https://watchdive.diveroid.com` with success path `/reservation?session_id={CHECKOUT_SESSION_ID}`. The braces stay literal.
- `POST /api/reservation/checkout`, `GET /api/reservation/status`, `POST /api/reservation/webhook`.
- `stripe_account_id` is a real `acct_` id. The sample below is intentionally invalid.

`src/lib/reservation/webhook.ts` `HANDLED_EVENTS` and the contract block must name the same events. The block below repeats the contract's current list. On 2026-10-18 that list has eleven events and no dispute events, while `HANDLED_EVENTS` also contains `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`. Readiness and `reservation-connect` both stop while those lists differ. The pending backend contract task has to make them one list. This rollout does not publish a third list, and it does not claim the dispute events are subscribed.

A security review asked for a local event ledger. Backend checkout currently treats Stripe as the durable lock and does not add a waitlist column. This command does not choose between those. `ledger_mode` must be explicit:

- `stripe-retrieve` means no SQL ledger is required. The command does not list Checkout Sessions.
- `sql` means one `CREATE TABLE` must contain every required column. A root receipt attests that the file was applied. `liveProbe` must be `false`. This command never connects to the database.

Any migration that drops `waitlist_signups` or adds a column to it fails schema compatibility.

The form-first experiment must keep both `byte < 128` splits (`control` / `form_first`). Attribution, privacy consent, and optional SMS stay as they are. A phone number is not a verified email and is not payment.

## Contract block

Copy this into `docs/reservation-contract.md` and replace the account id after the official account exists. Leave the placeholder and the command stays blocked.

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

Server-only names, never `VITE_`:

| Name | Ready value | Shown by the command |
| --- | --- | --- |
| `WATCHDIVE_RESERVATION_ENABLED` | unset or `false` until exit 0, then exactly `true` | the flag word only |
| `WATCHDIVE_RESERVATION_ALLOW_LIVE` | exactly `true` for the live key | the flag word only |
| `WATCHDIVE_PUBLIC_ORIGIN` | `https://watchdive.diveroid.com` | the origin |
| `STRIPE_SECRET_KEY` | live secret on the official account | present or missing, then `live` / `test` / unrecognized |
| `STRIPE_WEBHOOK_SECRET` | signing secret for the endpoint below | present or missing |
| `WATCHDIVE_RESERVATION_TOKEN_SECRET` | at least 32 bytes | present and long enough, or not |

`WATCHDIVE_RESERVATION_ALLOW_LIVE=true` does not take a charge. Checkout stays inert until `WATCHDIVE_RESERVATION_ENABLED` is exactly `true`.

For `ledger_mode: sql`, add `ledger_table` and `ledger_columns` and remove `ledger_mode: stripe-retrieve`. Optional `database_secret_env` is presence-only. Do not invent `SUPABASE_SERVICE_ROLE_KEY` here unless the contract names it.

## Run

From the implementation repo, with env already in the process. Do not commit an env file. The script does not load `.env` by itself.

```bash
node --experimental-strip-types scripts/reservation-readiness.ts --target production
node --experimental-strip-types scripts/reservation-readiness.ts --target production --network-readonly --json
```

Exit 0 is ready. Exit 2 is blocked. Exit 1 is usage. There is no `--apply`, `--send`, or `--deploy`.

`--network-readonly` sends only:

- `GET https://api.stripe.com/v1/account`
- `GET https://api.stripe.com/v1/webhook_endpoints?limit=100`

It sends those only when the secret key prefix is a live key and the contract already pins `acct_`. A test key, a missing key, or a missing account id sends nothing. The command refuses every other Stripe path, including refunds.

An operator receipt, only for `ledger_mode: sql`, is a JSON file root writes after applying the migration outside this command:

```json
{
  "schemaVersion": 1,
  "migrationFile": "20261018_reservation_payments.sql",
  "sha256": "<sha256 of that file's exact bytes>",
  "table": "reservation_payments",
  "attestation": "root-applied-read-only-confirmation",
  "liveProbe": false
}
```

Pass it with `--ledger-receipt`. `liveProbe: true` is rejected.

## Staged rollout

1. **Stay dark.** Expected verdict on this clone is `blocked`. Do not set the enable flag. Do not resume Meta ads. The owner pause still stands.
2. **Put reservation commits on top of `58b1a3e`.** Rebase or merge onto `58b1a3ef2c766f57bbe6a65573492a4a1ce47349`. On conflicts in the hero photo, landing copy, or `src/styles.css`, keep the hero-restore versions. The FAQ changes remain because `83b30ea` is the parent of that commit. The protected-commit check must pass before a deploy. Root fetches the commit. This rollout does not.
3. **Run tests.** `node --experimental-strip-types --test tests/reservation-readiness.test.ts`, then the repo suite root chooses. This command does not start the suite.
4. **Official Stripe account.** Root has verified the live DIVEROID account in Chrome. `scripts/reservation-connect.ts` pins that account and is documented in `docs/reservation-connection.md`. Its default is dry-run. Root runs `--apply` after review. The canonical contract pins `stripe_account_id: acct_1Tl9bv1UxFzpSUuA`. Readiness remains blocked until real credentials and webhook readback pass. This rollout does not edit the contract and does not create the webhook.
5. **Vercel env, still disabled.** Project `watchdive-prelanding`, team `jays-projects-c61403c8`, production, server-only. Set the six names in the table. Leave `WATCHDIVE_RESERVATION_ENABLED` off. Set the public origin and `WATCHDIVE_RESERVATION_ALLOW_LIVE=true`. Do not copy values into git, chat, or the office schedule config.
6. **Ledger.** For `stripe-retrieve`, do not invent a migration. For `sql`, root reviews and applies the migration, then writes the receipt. Do not add a paid column to the existing waitlist table from this rollout.
7. **Probe.** Run the command with `--network-readonly`. `ready` requires the retrieved account id to match the contract, `charges_enabled` and `details_submitted` to be true, and one enabled live webhook at the production path covering the contract events. Root still confirms in the Dashboard that the account is the Diveroid business account. The API flags are not that confirmation. `payouts_enabled` is reported by the connect command, not by this gate.
8. **Enable.** Only after steps 2–7 and the three conditions at the top: set `WATCHDIVE_RESERVATION_ENABLED=true`, redeploy a commit that contains `58b1a3e`, and run the command again.

No staging hostname is approved. `--target staging` is a usage error.

## Rollback

1. Set `WATCHDIVE_RESERVATION_ENABLED` to `false` or remove it, then redeploy the same commit. Do that before deleting the Stripe webhook or the account.
2. If code must be reverted, `git revert` only the reservation commit or commits. The resulting commit must still have `58b1a3ef2c766f57bbe6a65573492a4a1ce47349` as an ancestor.
3. Do not `git reset --hard 5f03468dd60d2b883515ed56046808f72463bdb4`. Do not `git revert 58b1a3ef2c766f57bbe6a65573492a4a1ce47349`. Do not promote a deployment of `83b30eafd3dd00eae9291adb46805083ad9378b3` or `5f03468` in place of the hero restore.
4. Do not resume ads, extend a flight, or change campaign `120251534679960215`. Rollback of the fee is not an ads change.
5. Do not run `scripts/launch-mail.ts` as part of rollback.
6. If a SQL ledger migration was applied, add a new reviewed migration or restore from root's backup. Do not drop `waitlist_signups`. This command will not run the SQL.

## Limits

- Exit 0 means the listed checks passed. It does not create the Stripe account, log the user in, or prove a lawyer has approved the terms pages.
- `stripe-retrieve` does not prove a session is stored. `sql` attestation is root's statement plus a file hash, not a database connection.
- The command does not call Vercel. Env presence is whatever the process environment contains.
- Webhook list pagination stops after three pages of 100.
- `CREATE TABLE` column parsing is for ordinary column lists. A required column that appears only inside a SQL comment does not count.
