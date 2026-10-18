# Reservation Notion payment mirror

Stripe is the paid authority. This mirror copies the current Stripe snapshot onto the existing signup row in `NOTION_WAITLIST_DB_ID`. It does not create a lead, does not charge, and does not decide that a person may be charged. Checkout and `GET /api/reservation/status` never call it, including when the browser opens `/reservation?session_id={CHECKOUT_SESSION_ID}`.

The feature is off. `WATCHDIVE_RESERVATION_NOTION_MIRROR` must be exactly `true`. Any other value, including unset, makes the webhook keep today's Stripe-only acknowledgement and makes zero Notion calls. Root enables that flag only after both column sets below exist. A test key and a live key must not share columns: a test event used to overwrite a live paid checkbox.

## Columns

The same signup database holds two parallel sets. A test-key webhook patches only names that start with `Test reservation `. A live-key webhook patches only names that start with `Reservation ` and not `Test reservation `. Notion leaves the other set untouched. There is no new database.

Live names, for production mail and real charges:

| Property | Type | Meaning |
| --- | --- | --- |
| Reservation status | select | unpaid, open, paid, refunded, partially_refunded, refund_pending, disputed, invalid |
| Reservation paid | checkbox | True only for a clean live 300 USD cent payment |
| Reservation amount cents | number | Integer cents. 300 is the fee, not 300 dollars |
| Reservation currency | rich text | `usd` when Stripe says so |
| Reservation Stripe session | rich text | Checkout Session id |
| Reservation Stripe payment | rich text | PaymentIntent id |
| Reservation paid at | date | Retrieved Charge `created`, or empty when unpaid |
| Reservation mode | select | `live` when this set is written |
| Reservation refunded cents | number | Absolute refunded cents from the current Stripe charge |
| Reservation refund pending cents | number | Absolute pending refund cents |
| Reservation dispute | select | `none` or `open` |
| Reservation duplicate paid | checkbox | More than one clean payment |
| Reservation mirror source | rich text | `stripe-retrieve` |

Test names are the same thirteen with the prefix `Test reservation `. Examples: `Test reservation paid`, `Test reservation paid at`, `Test reservation mode`. A QA send can filter `Test reservation paid` checked. That checkbox is not a live purchase and must not be the production mail gate.

`Reservation paid at` is not Checkout Session `created`. Session creation is when the hosted page opened. The value is the `created` time on the charge retrieved for that payment. Stripe's card charge object has no separate succeeded-at field; this card-only Checkout creates the charge when the payment succeeds. If that integer is missing, the webhook returns HTTP 500 and does not substitute the session time.

The mail reader in `mail-delay-work` currently selects verified invite rows from `Reservation mail`. It does not read these payment columns. When it does, production eligibility is `Reservation paid` and not `Test reservation paid`.

A refund, dispute, failed payment, or unpaid snapshot sets the checkbox false on the column set for that key only. The same delivery writes the absolute numbers again. It does not add to them.

The row is chosen from the Stripe customer email. Gmail and googlemail.com plus-tags and dots match the signup canonical row. A non-Gmail plus-tag does not attach to a different person's plus-stripped row. No matching row on a paid, refunded, or disputed snapshot is a retryable failure. The webhook does not create a page.

## Failure

When the flag is on, a lost mirror is not acknowledged. Notion 400, 429, and 5xx, a truncated query, a mode mismatch, a missing lead, and a missing key or database id return HTTP 500 with `retryable: true` and without `received: true`. Stripe retries. The next delivery re-reads Stripe and writes the current snapshot, so an older `checkout.session.completed` body cannot restore a refunded payment. Amounts in the event JSON are ignored.

A test key writes `Test reservation mode` = `test` and does not change `Reservation paid`. A live key writes `Reservation mode` = `live` and does not change `Test reservation paid`. A live event delivered to a test webhook is ignored and does not call Notion. A `cs_live_` session is not stored on the test columns.

## Migration

Root runs this. The default is a dry run. It prints property names and actions only.

```bash
node --experimental-strip-types scripts/reservation-notion-migrate.ts
node --experimental-strip-types scripts/reservation-notion-migrate.ts --apply --database-id "$NOTION_WAITLIST_DB_ID"
```

`--apply` writes only when `--database-id` equals `NOTION_WAITLIST_DB_ID`. The patch adds missing properties from either set and missing select options. Existing live columns are left unchanged when only the test columns are missing, and the reverse. Existing select option ids are kept. A name that already exists as a different type exits 2 and writes nothing, including when the other set is still missing. Run it again after a successful apply and the plan is empty.

Order for root: dry-run, review collisions, `--apply`, then set `WATCHDIVE_RESERVATION_NOTION_MIRROR=true`. Turning the flag on before both column sets exist makes every money webhook return 500, which is intentional. This task did not run `--apply` and did not read the live database.
