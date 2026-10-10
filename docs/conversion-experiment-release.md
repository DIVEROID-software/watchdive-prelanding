# WatchDive conversion experiment — 2026-10-08

The release compares the existing layout with a mobile form-first layout at a stable 50:50 allocation, within the existing ad-team attribution. It does not change ads, creatives, targeting or budgets.

Primary outcome: measured sessions producing an actual new CRM email within 48 hours of first exposure. Verified emails are a separate outcome over the same observation window. Generic accepted form responses are diagnostic attempts, not new leads. QA, duplicate, withdrawn, blocked and inconsistent records are excluded. A source outage is reported as unavailable, never as zero. Consent is required before experiment linkage is persisted; this is not a census of all visitors.

The existing pending release from PR #21 is integrated, including its durable late-consent state (`withheld → granted-lead-pending → granted`). Late submit events are server-only and use an event ID stable across resends. A failed or ambiguous send remains retryable. Trusted GPC, independent withdrawal replay limits, fresh CRM checks, and honest withdrawal failure UI are preserved. There is no atomic transaction between Notion and Meta: a withdrawal arriving during an outbound Meta request cannot recall that request.

Validation before deployment:
- 500 tests pass; TypeScript passes.
- The earlier preview passed 36 mobile layout cases (9 locales × 2 widths × 2 themes), plus sticky CTA focus/scroll checks.
- The actual website Notion integration now reads the behavior database and its schema successfully.
- A consented QA exposure, visible form and focus were stored and excluded from the private report.
- Browser QA did not send a real email. CRM outcomes and consent/retry races are covered with injected-store tests.
- Final build/deployment evidence and the first production snapshot are recorded in the parent workspace at `ads/autopilot/competition/conversion-experiment-20261008/`.

A read-only local collector is prepared to snapshot the authenticated report every 30 minutes. The server collects while the local computer is offline; local snapshot execution requires that computer to be running. No winner is selected automatically. The first comparable 48-hour cohorts are a timing threshold, not proof of sufficient sample size.

## 2026-10-10 — phase boundary: first-100 race line

Owner-requested FOMO pass. From this deployment both arms show, directly above the hero email field, "Only the first 100 backers get {price}" with the live public waitlist figure (the progress bar's number). In form-first it replaces the benefit line; in control it follows the price block, which drops its "first 100 backers at launch" note. Layout differences between arms are unchanged.

Placement came from page-behaviour rows 2026-10-08 → 10-10 (183 consented sessions, 81% phones): median phone scroll 7%, a third of visits never scroll, the hero was seen by 77% and the "first 100 backers" section by 27%. Cohorts exposed before and after this deployment are different strategy phases and must be reported separately; the change is not randomized between arms.
