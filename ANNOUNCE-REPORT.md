# Server-side Buddy Invite announcement

Implemented on `feat/referral-announce-server`, based on `origin/main` fcc96b4. No push, deploy, production API calls or real mail were performed. Supplied REVIEW-BRIEF.md and REF-reminder_tick.py remain untracked and unchanged.

## Change

- Added lazy server-only POST `/api/cron/referral-announce` and generated route-tree entry. Uses the reminder cron's exact `checkCronAuthorization` and `WATCHDIVE_REMINDER_CRON_SECRET`. Auth, master-switch and confirmation/input validation happen before Notion access; OFF returns 404.
- Moved shared eligibility, canonical inbox opt-out/deduplication, locale/KR phone rules and welcome-guide renderer into `src/lib/referral/announce.ts`. The CLI now calls the route; it no longer has a local send implementation or needs signing/Notion/Resend secrets.
- Added `REFERRAL_COLUMNS.announce` and schema spec for `Referral announce` rich_text. Full database scan precedes eligibility so later duplicate/opt-out rows cannot be missed. Schema/type mismatch, incomplete scans and malformed pagination fail closed.
- Writes `intent <ISO> <24-char keyhash>` before the provider call and `sent <ISO> <keyhash>` after acceptance. Any nonempty marker on any row holds that inbox across batches. Failed/uncertain delivery never clears intent; a failed sent-marker write reports both provider acceptance and held outcome. Self-test uses the existing separate `-selftest` key and does not mark rows.
- Counts-only responses and CLI output; no addresses, links, samples or provider errors returned. Default batch 20, maximum 200, 500ms sequential spacing, 35-second work budget, 45-second overall external-fetch abort signal, maximum 200 query pages. Incomplete scans never send. Shared provider retry cleanup may add a short bounded delay after abort.
- CLI reads a private JSON `secret` field, fixes the canonical HTTPS endpoint, refuses redirects, uses an exclusive config-adjacent operator lock and retains it after unknown HTTP outcomes. Help, dry-run, only, limit and confirm remain available. Operations and owner checklist step 8 now describe this flow.

## Validation

- `node --experimental-strip-types --test tests/referralOps.test.ts tests/referralAnnounce.test.ts`: initial 35/35 passed; subsequently added a caller contract test, also passing in full suite.
- `node --experimental-strip-types --test tests/referralE2E.test.ts`: 2/2 passed, with real server assembly and fake Notion/Resend transport, including switch OFF, self-test, KR phone and cross-row unsubscribe scenarios. Updated these tests because they previously invoked the removed local-send CLI contract.
- `npm test`: **1106 tests, 1093 passed, exactly 13 known socialAuth OAuth failures**, no additional failures. Local ignored evidence: `announce-full-test.log`.
- `npm run build`: passed (`announce-build.log`).
- `npx tsc --noEmit -p .`, after build: passed (`announce-tsc.log`).
- `git diff --check`: passed.

New unit coverage includes unauthorized/unconfigured auth, OFF/no reads, missing confirm, invalid input/limits, dry counts/no writes/no PII, intent → provider → sent ordering, resumability, duplicate-row marker holds, failed intent/sent writes, deadline deferral, missing schema, and HTTP caller auth/defaults/output filtering. Existing announcement tests cover one per inbox, canonical opt-out across rows, Korean phone refusal and self-test behavior.

## Remaining operations and limits

Production schema application, deployment, enabling the master switch, owner self-test and reviewed batches are intentionally unperformed. Add/verify the new column before enabling program notices; the shared referral store checks all declared columns.

Notion PATCH is not compare-and-swap: operator lock plus same-instance busy guard do not constitute a distributed lock. Run only one office Mac mini caller/config and never overlap direct API calls or other hosts. An unknown HTTP outcome retains the CLI lock: verify the server has finished and reconcile Notion/Resend before manually removing it, without clearing intents. Self-test has no durable row receipt by design; repeating it after the provider's idempotency retention period can send again. Provider acceptance is not inbox delivery.

The latest task explicitly required committing `src/routeTree.gen.ts`; that overrides the historical REVIEW-BRIEF instruction to leave it to integration.
