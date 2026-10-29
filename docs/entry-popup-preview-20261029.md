# First-visit signup popup — approved rollout, 2026-10-29

Review URL: http://127.0.0.1:5229/review
Branch: feat/entry-popup-preview-20261029
Base: db61288 (contains the reviewed raw-UTM signup-scroll fix).

Implemented a non-modal entry panel on the existing landing. Official WatchDive logo, localized copy for all nine supported locales, compact email form, close and Escape controls. Opening does not autofocus the email field or lock the background. Desktop lower-right card; mobile bottom panel.

It opens 600ms after hydration when eligible, waits briefly for privacy/dialog interactions, skips verification/checkout returns and device-known pending/verified/social/paid signups, shares the existing exit-capture session cap, and records a seven-day dismissal. Browser storage denial suppresses the automatic prompt. A late privacy dialog temporarily hides it. The entry prompt replaces the exit prompt in this build.

The existing EmailForm provides validation, attribution, error handling, inbox guidance, resend, and correction. Entry views/focus/submits are excluded from the legacy middle/bottom funnel flags. The original CRM source contract is still hero/offer; a separately defined measurement rollout is needed before any popup experiment. No A/B allocation was launched.

The owner explicitly requested deployment on 2026-10-29 after local review. The production build now enables entry capture by default. Set `VITE_WATCHDIVE_ENTRY_CAPTURE=false` and rebuild to restore the existing exit prompt. A merge alone is not deployment evidence; the release receipt records the production deployment and canonical checks. Live advertisements, email sender configuration, budgets, and customer records are outside this change.

Treat the actual production-ready timestamp as a new common website phase. Preserve existing 50:50 experiment allocation and historical cohorts. Popup exposure is not included in the legacy middle/bottom form-exposure denominator, and the legacy `offer` CRM field cannot distinguish popup signups from other offer placements. Do not report a randomized popup lift or a popup-specific signup rate from those fields.

The review server serves the actual production build but mocks every server-function request. It blocks outbound server fetches and non-GET application endpoints; no real signup, email, payment or provider call occurs. The review shell explicitly labels simulated submissions. Its reset button only clears local preview display/signup fixture state.

## Verification

- TypeScript and production build passed.
- Full unit suite: 1,484 passed, 18 skipped, 0 failed (1,502 total).
- Existing JSX design snapshot updated for the requested gated entry branch; section order and stylesheet pins preserved.
- 27 browser checks passed, no page errors: 320–1440px layout, nine locales, no focus stealing, raw UTM preservation, known-signup exclusions, dismissal persistence, Escape, privacy/modal priority, email validation and simulated submission.
- Final targeted review-shell test passed: language/device switches, reopening after close, simulated submission and inbox text contrast.
- Chrome viewport emulation; no physical device or real email delivery was tested.
- Evidence: qa/entry-popup/browser-result.json, review-result.json, final-mobile-ko.png, final-desktop-ko.png, review.png, review-success.png.

## Run locally

```sh
VITE_WATCHDIVE_ENTRY_CAPTURE=true VITE_WATCHDIVE_I18N_REVIEW=true npm run build
node scripts/preview-entry-popup.mjs
```

The server binds only to 127.0.0.1:5229. /review provides device, language, scuba/freediving and replay controls. A refreshed direct landing correctly respects the session/dismissal cap.
