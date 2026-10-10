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

## 2026-10-10 — phase boundary: first-100 line above the hero field

Owner-requested FOMO pass. From this deployment the form-first arm shows, directly above the hero email field and in place of its benefit line (same size and leading), one sentence: the localized early-bird price "for the first 100 Kickstarter backers at launch"; its price chip hides the short "first 100 backers at launch" note, which the sentence says in full. Control is unchanged. A draft that added the sentence to control too was rejected by Grok QA round 2: it made the control hero column 34px taller and pushed the submit button below the fold at 1440×900. Because only form-first changed, form-first results after this deployment measure the layout plus this sentence, not the layout alone.

Placement came from page-behaviour rows 2026-10-08 → 10-10 (183 consented sessions, 81% phones): median phone scroll 7%, a third of visits never scroll, the hero was seen by 77% and the "first 100 backers" section by 27%. Grok QA round 1 rejected a first draft that also showed "{total} divers already waiting" with a pulsing dot (the total is mostly a founder-stated off-platform figure and waitlist position does not allocate the 100) and that wrapped long locales onto the field on small phones. Cohorts exposed before and after this deployment are different strategy phases and must be reported separately; the change is not randomized between arms.
