# WatchDive pre-landing

This branch preserves the production landing while adding an optional,
consent-gated LaunchOS website funnel adapter.

## LaunchOS activation gate

LaunchOS is disabled unless both
`VITE_LAUNCHOS_MEASUREMENT_CONSENT_UI_ENABLED=true` and
`LAUNCHOS_MEASUREMENT_ENABLED=true`. Withdrawal additionally requires the exact
`LAUNCHOS_WITHDRAWAL_ENABLED=true` gate. A Vercel build then fails closed unless
the exact source-scoped credentials, distinct HMAC secrets, Meta stable-ID
allowlist, rule versions, public origin, and replay switch shown in
`.env.example` are all valid.

Before setting the switches, add a Notion `rich_text` property named exactly
`LaunchOS replay metadata`. The property stores only a PII-free, HMAC-sealed
v3 first-touch envelope. It freezes the approved Meta-ID snapshot and the hash
of the server-issued consent receipt so registry changes cannot mutate a retry.
`WAITLIST_REPLAY_HMAC_SECRET` is the single exact secret name used for that
envelope and the short-lived server consent binding.

The direct relay sends event observations only. It does **not** publish
`/api/imports/coverage`; therefore dashboard values remain partial/data-gap and
must not be treated as official or decision-ready until a separate scheduled
coverage adapter declares source completeness and watermarks.

Browser grant records use the separate versioned JSON key
`watchdive.ad-measurement-consent.v1`. A legacy plain `granted` value is never
upgraded into the new purpose. `Sec-GPC: 1` overrides a browser payload.
One valid server grant is reused for its 24-hour lifetime; issuing a fresh grant
starts a fresh funnel instance instead of mixing two authorities.

UI surface (`page`, `hero`, `offer`) is kept only in the browser retry context
for this release. LaunchOS `placement` is an immutable ad-delivery dimension,
so using it for a page section would make one funnel instance conflict. A
dedicated `event_surface` contract is required before section-level dashboard
breakdown is enabled.

Pseudonymous measurement rows follow the campaign-end/deletion-request rule in
the privacy notice and are capped at 400 days. Declining now sends one
idempotent, source-scoped request to LaunchOS; a `pending_purge` response means
the hash tombstone is auditable and the subject is excluded from dashboard
evidence, not that physical deletion has finished. Failed delivery immediately
deletes the measurement-authority cookie and leaves a PII-free local marker plus
an exact, short-lived HttpOnly withdrawal-only capability for retry. A PII-free
HMAC tombstone in the source Notion database blocks stored lead and verification
replays before transport; matching replay envelopes are cleared with bounded
pagination. The scheduled LaunchOS purge worker, email-provider physical
deletion adapter, and coverage sweeper are still separate activation blockers;
this landing does not claim that those external deletions are configured.
Any Notion quality/reconciliation export must exclude rows whose exact Source
is `privacy_withdrawal`; those synthetic rows are also `Suspect=true`, use the
existing `Verification status=suppressed` option, and carry `Measurement
consent=WD-AD-MEASUREMENT-CONSENT-V1:withdrawn`. Matching operational rows keep
their email, verification, and Counted state, but the same marker replaces and
clears every optional measurement attribution/context field, so neither row is
a measurement candidate.
