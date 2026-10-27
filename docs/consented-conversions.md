# Consented completion measurement (review only)

This local change is not deployed. It preserves existing Meta Lead,
EmailVerified and LeadVerified CAPI dispatchers. It appends a separately gated Meta Purchase sender using the existing CAPI
credentials. It makes no advertising audience/configuration changes and adds no new third-party scripts on
token-bearing routes.

## Event migration

- The old browser `sign_up` meant a pending email request. It is now
  `signup_pending`; it still does not prove mail delivery or a unique subscriber.
- Server `sign_up` means the row was verified and its measurement permission was
  re-read. The key is the stable signup row, not a new confirmation attempt.
  Email confirmation, social completion, and permitted late grants share this
  path; the original browser tab is unnecessary.
- Browser GA4 `generate_lead` remains as the existing verified-poll fallback
  until `VITE_GA4_SERVER_CONVERSIONS_ENABLED=true`. The server requires that
  public switch AND `WATCHDIVE_GA4_CONVERSIONS_ENABLED=true`. Production preflight
  rejects a half-enabled or incompletely configured rollout. Once enabled,
  browser GA4 completion is suppressed and the server owns verified `sign_up`.
  Reports/audiences/key events need a reviewed migration. Historical numbers
  keep their old meaning. Existing Google Ads conversion calls are unchanged.
- Browser GA4 `purchase` from `trackGoogleReservationPurchase` is the fallback
  until `VITE_GA4_SERVER_CONVERSIONS_ENABLED=true`. The public switch then keeps
  that browser event quiet. The Ads purchase label, when set, still fires on
  its own and does not mean the Ads account has that action. The server also
  requires `WATCHDIVE_GA4_CONVERSIONS_ENABLED=true`, so a public-only flag
  cannot emit both.
- Server GA4 `purchase` means a validated Stripe payment for the USD 3 reservation
  fee, with the Stripe session as `transaction_id` and one reservation-fee item.
  No event is sent for unpaid/invalid/refunded/refund-pending/disputed or duplicate
  paid state. Payment retries share one event claim. A succeeded Stripe refund
  sends GA4 `refund` only after this server recorded the session's `purchase`
  as accepted, with current measurement permission and a valid GA context.
  Each refund ID has its own durable claim; replay does not send it twice.

- Meta `Purchase` uses the same validated paid snapshot, USD 3 and the Stripe
  session, with a stable HMAC event ID and the retrieved Charge.created time.
  Missing/future/over-7-day timestamps are skipped, never re-dated. Matching uses
  the existing CAPI hashed email helper; the webhook's IP/UA is never attributed
  to the customer. No GA secret or GA cookie is required for Meta. When the durable
  flag is on, the Purchase proof carries `metaDelivery: "server"` and the browser
  skips the Meta pixel. This avoids relying on Meta's 48-hour browser/server
  dedup window for a server event accepted up to seven days later. Browser Google
  sinks keep their existing guards. The legacy CAPI path is disabled when the
  durable flag is on. Existing EmailVerified and LeadVerified remain unchanged.

## Required configuration before enabling

The VITE settings are public build-time settings; all other settings below are server-only:

- `WATCHDIVE_GA4_CONVERSIONS_ENABLED=true` (unset is disabled)
- `VITE_GA4_SERVER_CONVERSIONS_ENABLED=true` (public build switch, paired with the server switch above)
- `VITE_GA_MEASUREMENT_ID` (same stream as the browser; server can use its public build-time value)
- `GA4_API_SECRET` (Measurement Protocol secret for that stream)
- `WATCHDIVE_VERIFICATION_SECRET` (existing signing secret, at least 32 UTF-8 bytes)
- `WATCHDIVE_CONVERSION_REDIS_REST_URL` (HTTPS Redis-compatible REST endpoint)
- `WATCHDIVE_CONVERSION_REDIS_REST_TOKEN` (existing authorized write access)
- Existing `NOTION_API_KEY` and `NOTION_WAITLIST_DB_ID` for payment consent reads

Meta Purchase can be enabled independently of GA4 with
`WATCHDIVE_META_PURCHASE_ENABLED=true`, the same shared Redis/signing settings,
and the existing `META_CAPI_ENABLED`, `VITE_META_TRACKING_ENABLED`,
`META_PIXEL_ID`, `VITE_META_PIXEL_ID`, and `META_CAPI_ACCESS_TOKEN`. IDs must match
and both existing CAPI switches must be on. No new Meta token is required.

No credentials, datastore, schema, access grant, scheduler or paid service was
created. No production configuration was inspected or changed. Missing/invalid
configuration makes the new sender inert. Do not deploy the event-name migration
until these dependencies and the analytics report/audience migration are reviewed.
The Redis-compatible REST adapter uses GET, SET, DEL, SET NX and EX. An approved
existing durable store with atomic SET NX is required; process memory is not a
production replacement. Repository code already uses durable Notion records,
but Notion provides no atomic compare-and-set for this delivery claim. No Redis
integration was found in the original source, and no related Redis/GA4-secret
names were present in this executor's process environment. Those observations
cannot establish whether a store exists in production. Vercel CLI metadata
inspection was not completed: even its help command hit EPERM on the automatic
update cache write, and no environment values were retrieved. Configure an
already-authorized non-evicting durable store and review its
retention and permissions before activation.

## Consent and data handling

The existing regional default policy is preserved: explicit refusal/GPC wins,
unknown and opt-in regions need Allow. This change is not a legal-policy audit.
A stored permission may reflect that regional default rather than an explicit
Allow click. Payment terms never serve as advertising permission.

Only an existing consented GA `_ga` client ID is captured; no synthetic client ID
is fabricated and no token-bearing URL, email, or phone is sent to GA4. Without a
valid cookie (e.g. blocked analytics), the event is skipped. The original allowed
client ID is kept for up to 7 days so a later confirmation need not open the
original tab. Meta stores a separate permission-only context without a GA client ID. The
existing signup refusal path attempts to delete both contexts; the server
rechecks the authoritative signup's permission before every delivery. If context cleanup fails, refusal is still persisted on the signup and the UI
receives `recorded: false` to retry cleanup; a fresh refused row blocks both
senders immediately. A transient CRM failure is retryable and does not count as consent. Storage failures never
make an unverified signup into a verified event.

Context storage uses an HMAC-derived key, a GA client ID and server capture time.
Event records contain an HMAC-derived key and delivery state, with no automatic
expiry to prevent old confirmation/webhook replay creating another conversion.
These are pseudonymous records, not an assertion of anonymous data. Retention
must be approved with the datastore before activation. HMAC uses the existing
verification secret; rotating it or clearing/evicting the ledger resets identity
and duplicate protection and needs a migration plan.

The checkout captures a separate current browser permission value only after
validating the signed invite. When tracking is configured, an unavailable consent
context write returns a recoverable 503 before creating/reusing Stripe checkout;
it must not silently retain an old allowed context after a refusal. Disabled
tracking has no checkout dependency. Review this availability tradeoff.

`wd_attr` and every `wd_competition_attr_v1:*` envelope have click IDs and their
capture time removed on refusal. Future reads/writes in disallowed/GPC/unknown
contexts strip them too. Unrelated browser storage and non-click campaign fields
are preserved. Optional CRM fbclid capture now checks permission/GPC in both
email and social flows. This does not retroactively delete historical CRM values.

## Delivery and retry semantics

Redis SET NX claims an event atomically before dispatch, across instances.
Concurrent repeats or restarted workers cannot automatically resend a claimed
event. A failure before dispatch can release its confirmed claim and retry;
webhook measurement failures before dispatch return 500 for Stripe retry.

A Meta receipt explicitly reporting zero received events releases its claim
for a safe retry. GA4 transport acceptance is not an equivalent event receipt.
A timeout, lost response, non-2xx result, or crash after claiming may have an
uncertain delivery outcome. Its claim is retained and never blindly retried.
Repeated requests report that state as `uncertain`, not a successful duplicate.
Only an acknowledged claim reports `duplicate`. A crash between claim and send
may therefore miss an event; this is an explicit
at-most-once tradeoff, not a promise of exactly-once delivery. An operator must
reconcile an uncertain record with downstream evidence before any approved reset. No
automatic queue/cron retry worker is introduced. Email retries occur through an
existing confirmation/grant path; no later browser polling fallback duplicates
server signups. Independent sink claims mean a Google retry cannot resend an
already accepted Meta Purchase (or vice versa). Google HTTP 2xx means transport acceptance only, not proof of GA
processing or report visibility.

## Validation and release review

Tests use fake mail/Stripe/Meta/Google/Redis transports. No real customer email,
payment or analytics event should be sent during local validation. After separate
configuration/deployment authorization, validate representative payloads and
actual downstream receipts in an approved test stream before enabling production.
Verify the chosen attribution/consent policy, report/audience migration, store
availability/retention, and uncertain-delivery handling first.

References: [GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events),
[GA4 purchase parameters](https://developers.google.com/analytics/devguides/collection/ga4/reference/events#purchase),
[Redis REST commands](https://upstash.com/docs/redis/features/restapi).

## Paid then refunded

Every webhook re-fetches Stripe state, including a replay of an old paid event.
If the payment is now refunded, no new Purchase is sent to either destination.
The prior positive Purchase remains a historical paid-completion event. GA4 can
receive a separate `refund` for each succeeded Stripe refund ID, using the same
Checkout Session transaction ID and the individual refund amount. The sender
requires an accepted server purchase claim, current consent and valid GA context.
Uncertain or browser-only purchases, pending refunds, disputes and cumulative
amounts without refund IDs do not create a refund event. Conflicting IDs and
refund totals above the USD 3 fee are held for reconciliation. No Meta retraction
is sent; its historical Purchase audience is not a current entitlement ledger.

## With no additional configuration

The browser click-ID storage/withdrawal fixes and optional CRM fbclid consent
gates work independently. Pending submissions use `signup_pending`, and the
existing browser verified `generate_lead` fallback remains. Existing Meta lead
CAPI, verification, and payment flows remain. New server GA4 events and new Meta
Purchase stay off; no durable-store dependency is added to checkout until a
new sender is explicitly configured and enabled. Production activation and
any new resource/permission require separate review; none happened here.
