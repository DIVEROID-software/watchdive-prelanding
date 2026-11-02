# Popup measurement restore

Prospective only. No historic popup views were backfilled. Branch `Kim-Jay-Jungil/popup-measurement-restore` on `74def639`.

## What changed

The entry popup stays `recordFunnel={false}` and `source: "offer"`. `domId="entry-capture"` selects popup measurement inside the existing form. Body `middle` / `bottom` and the four global flags are unchanged.

`funnel.popup` version 1 rides the existing `[[wd-exp]]` block:

- `visible`: panel has size, intersects the viewport, is not parked or hidden, and `document.visibilityState` is not `hidden`.
- `formVisible`: that panel view plus the email and submit hit-test.
- `focused`, `submitAttempted`, `dismissed`.
- `accepted` plus `result: "pending" | "already_verified"` only after the server returns one of those. `pending` is an accepted response, including an existing pending resend. `already_verified` is not downgraded. `failed` and `closed` leave `accepted` false.
- `observedAt`: first client timestamp, epoch ms, only for a milestone that happened. A missing milestone gets no invented time.

`acquisitionPlacement: "entry-popup"` is copied onto that submit's experiment object. The session context and its sessionStorage row stay untagged, so a later body submit is not labeled as the popup. Lead-vs-session equality ignores only that key. UX-to-UX comparison still uses the raw session JSON.

QA stays `experiment.qa`. Ordinary popup counts exclude it and report `qaPopupSessions`. No new GA4 `sign_up`, `purchase`, or Meta Lead. The existing FormStart / pending / Clarity calls are untouched.

The same server instance remembers a popup it has already written on a session row. A later summary for that same session id and the same full experiment context is patched onto the row with that popup unioned in. Body flags and placements still come only from the summary being written. A new process does not query the old row.

A hidden document cannot mark `visible` or `formVisible`. `visibilitychange` rechecks the live panel. `wd:acquisition-capture:v1` is not a view.

## Checks

Node `/usr/local/bin/node` v22.17.0.

```text
node --experimental-strip-types --test tests/popupMeasurement.test.ts tests/pageBehavior.test.ts
# 32 pass, exit 0

npx tsc --noEmit --pretty false --incremental false
# exit 0
```

The full-file run above is this follow-up. An earlier run of `tests/*.test.ts` on the measurement commit, before this retention change, was 1746 tests, 1726 pass, 0 fail, 20 skipped. That full set was not re-run here.

Worst-case segment context (zh-TW, 32-digit campaign/adset/ad ids, all body flags, full popup including eight timestamps) keeps a 1123-character `[[wd-exp]]` suffix. The cap that drops the experiment is 1800. The encoded Sections text is 1900, equal to `SECTIONS_TEXT_MAX`, with the legacy head trimmed and the JSON whole.

## Local browser proof

Production build:

```text
VITE_CONVERSION_EXPERIMENT_ENABLED=true \
VITE_WATCHDIVE_ENTRY_CAPTURE=true \
VITE_WATCHDIVE_I18N_REVIEW=true \
npm run build
```

Exit 0. The client bundle contains `VITE_CONVERSION_EXPERIMENT_ENABLED:"true"` and `VITE_WATCHDIVE_I18N_REVIEW:"true"`. Verification env was incomplete, which is expected in this checkout. No office secrets were loaded.

Served the build on `127.0.0.1:5231` with every server function answered locally. `joinWaitlist` returned a fake pending. `recordPageBehavior` returned `{ stored: true }`. Outbound fetch threw. Cookie `wd_geo=SG`. Chrome headless with a normal desktop UA, viewports 1440×900 and 390×844.

All eight pages opened an unhidden panel whose email and submit were inside the viewport and hit-testable: `/scuba`, `/ko/scuba`, `/ja/scuba`, `/zh-tw/scuba`, each at both sizes.

Korean desktop mocked submit, same session `daed8dd6-0998-40f0-905a-03a8f990df4e`:

- Signup: `source: "offer"`, `locale: "ko"`, `experiment.acquisitionPlacement: "entry-popup"`, `experiment.qa: true`. The logged address was redacted. The raw logged body contained no `@`.
- Behavior after that response: popup `visible`, `formVisible`, `focused`, `submitAttempted`, `accepted`, `result: "pending"`. `observedAt` has those five keys only. Body `submitAttempted` false. Bottom `submitAttempted` false. Session experiment has no `acquisitionPlacement`.
- 32 behavior posts in the run. None contained `@`.

`qa: true` because the host is not `watchdive.diveroid.com`. These rows are stored-and-excluded, not ordinary production counts. English desktop on the earlier pass of the same build showed the same split: a view beacon with only `visible` and `formVisible` timestamps, then the signup copy carrying `entry-popup`, then the accepted beacon without moving the body flags.

## Preview recipe for root

1. Build with the three `VITE_` flags above. Locale routes 404 unless `VITE_WATCHDIVE_I18N_REVIEW=true`. Milestones no-op unless `VITE_CONVERSION_EXPERIMENT_ENABLED=true`.
2. Deploy the preview root already owns. Do not use this worktree's local server as the canonical readback.
3. Mark the preview visit QA, or expect `qa: true` on any host other than `watchdive.diveroid.com`.
4. Set `wd_geo=SG`, or grant measurement, before expecting a payload. Unknown country is opt-in.
5. Open the popup, focus, submit a non-customer address only if the preview cannot reach Notion or Resend. Confirm the behavior JSON has `funnel.popup` and no email, and the lead experiment has `acquisitionPlacement` while the UX session context does not.
6. Read the row back through the existing `[[wd-exp]]` parser. Confirm ordinary reports leave it in `qaPopupSessions` and leave middle, bottom, and the four body flags alone.

## Risks

A warm instance reattaches a popup only when it stored that popup itself, on a later write whose session id and full experiment context are identical. QA and every other context field count, including `acquisitionPlacement`. Flags stay set. Timestamps stay the earliest. The later write's body flags and placements are stored as sent. The map is process memory: no Notion read, no browser-storage replay, and no historic backfill.

A different session, QA bit, or any other context field does not receive that popup. A write that failed is not treated as stored. If the update fails, the page id is dropped and the replacement create still carries the popup already stored. If that create fails too, the next successful write of the same context still carries it, including after the one-minute pause that follows a 4xx. Two writes for one session on this instance run one after the other, so an empty summary cannot pass the view it overlaps. These paths are covered by the fake Notion client.

A cold instance starts empty, creates a separate row, and leaves the previous row alone. Reporting still unions rows that share a session. After 500 other sessions the map drops one, and that session then behaves like a cold start. A successful write whose context does not match replaces the row and forgets the popup, because the row no longer holds it. A denial that this process never stored still cannot be reconstructed.

The public pending response still does not say whether the address was created or resent. CRM remains the new-person cohort. Client timestamps are the browser clock at first observation.

This worker did not deploy, push, or write Notion.
