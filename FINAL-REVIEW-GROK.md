# Buddy Invite release review (Grok)

Reviewed 2026-10-22 on branch `review/referral-final-grok` in `landing/rv-buddy-grok`. This is a release-readiness check of owner decisions D1–D9 and of `review-legal.md` blockers 1–5 and should-fixes 6–12. It is not legal advice, and it is not the separate code review in the other worktree.

The program can go through the owner checklist as far as Preview, a switch-off production deploy, and (after the owner says so) switching the program on. Korean physical prizes stay unshipped until an accountant confirms that DIVEROID LTD is the withholding agent. The 1-hour and 2-hour early-notice emails stay unsent until a sender for those CSV files exists. Neither item blocks turning the referral switch on.

## Decisions

Rules copy is `src/lib/referral/copy.ts`. All 9 locales have 12 sections and the same paragraph counts (`1,1,1,2,5,2,6,1,1,2,2,1`). A machine check confirmed every locale's rules contain `16343651`, `E6 2JA`, `Apple`, `Galaxy`, `2026`, and the placeholders `{ageKr}`, `{ageOther}`, `{longStop}`, `{deliveryBy}`, `{lightValue}`, `{prizeValue}`, `{taxRate}`. Placeholder parity is locked by `tests/referralCopy.test.ts`. Line numbers below are the English string unless a locale is named. The same section index holds the same facts in ko, zh-CN, zh-TW, ja, es, fr, de, and pt-BR.

| ID | Owner decision | Evidence | Status |
|---|---|---|---|
| D1 | Disclose the $149 exceptions: first 100 Kickstarter backers, plus price-reservation holders, plus Dive Team. Do not cap the secret reward. | Switch on: `src/lib/i18n/price-claim-loader.ts` 17–25 loads `referral-price-claim-copy.ts` only when the server says the program is enabled. English claim at lines 35, 51, 55, 57 names first `{seats}`, a price reservation, and Dive Team, and the public price `$299`. Korean at 65, 81, 85, 87 names 선착순, 가격 예약, and 다이브 팀. Launch mail uses the same sentence when the program env is on (`src/lib/launchMail/copy.ts` `LAUNCH_REFERRAL_PRICE`, 598–602). Rules Dive Team paragraph (`copy.ts` 264) says the private link still works after the first `{seats}` and is one pledge, not shared. Switch off keeps the frozen first-100 sentence; that is the intended off state. | Implemented for the on state. |
| D2 | Age 19 in Korea, 18 elsewhere and the age of majority where they live. Staff, contractors, operators, and their households are out of physical rewards only. Physical rewards only to WatchDive Kickstarter shipping countries. Void where prohibited. Italy and Québec are not separately banned. | `program.ts` 104–106 `MIN_AGE_KR` / `MIN_AGE_OTHER`. Rules "Who can take part" `copy.ts` 224–227. Signup does not collect date of birth or employment. Fulfilment checks are in `docs/referral-program-ops.md` (보상 처리). The shipping-country list is not on the page yet; the rules say it will be published before close. | Implemented in the rules. Age, staff, and shipping country are owner checks at fulfilment. Publishing the country list is an owner item before close. |
| D3 | Light worth about USD 70, model not named. WatchDive prize is one sensor housing, Apple Watch or Galaxy Watch version, USD 299 planned public price, watch not included, supported models only, no cash alternative. | `program.ts` 100–101 `LIGHT_VALUE_USD = 70`, `PRIZE_VALUE_USD = 299`. Rules rewards `copy.ts` 265–267. `values.ts` 216–217 formats those numbers per locale. | Implemented. The light model name remains an owner item. When it is chosen, update the rules and the winner mail together. |
| D4 | Long-stop close 2027-01-31 23:59 KST even if Kickstarter is not live. An announced close moves at most once, with at least 48 hours' email notice, and cannot pass the long stop. Prizes ship before March 2027. Top 3 still receive a WatchDive if the campaign misses its goal, is cancelled, or is delayed. | `program.ts` 89–97 `LONG_STOP_CLOSE` and `referralClosesAt` (an earlier env close wins; a later one is ignored; empty env returns the long stop). `PRIZE_DELIVERY_BY = "2027-03"` at line 103. Rules period 232, late-campaign 273, delivery 285. The legal brief's draft column mentioned a cash fallback. The owner decision, and the rules, give the WatchDive and say there is no cash alternative (`copy.ts` 267). | Implemented. |
| D5 | Sender phone `+82 10-6517-6232` via `WATCHDIVE_SENDER_PHONE`. Korean ad rules apply when the mail locale is `ko` or the signup country is `KR`: subject prefix `(광고) `, sender block, bilingual opt-out. | `src/lib/verification/resend.ts` 618–676 and 755–773. The prefix is added at send time, so the subject strings in `copy.ts` do not contain `(광고)`. `scripts/referral-announce.ts` 276–283 aborts the whole `--apply` run with `sender_phone_missing` before any send if a Korean recipient is queued and the phone is missing. Fake `renderAnnouncement("ko", …)` with the phone set produced a subject starting `(광고) `, the sender line `보내는 곳: DIVEROID LTD · help@diveroid.com · +82 10-6517-6232 · Office 12146…`, both opt-out sentences, and `List-Unsubscribe` / `List-Unsubscribe-Post`. The same call with an empty env threw `AdComplianceError`. | Implemented for Buddy Invite mail. Reservation mail and launch mail still have no `(광고)` and no sender phone. Fix those before any Korean send of those two templates. Out of this edit scope. |
| D6 | Korean winners pay 22% (기타소득세 + 지방소득세) to the company before shipping. The company reports and pays it. Collect legal name, resident registration number, and address, tax-only, for as long as tax law requires. Applies to the light and the WatchDive. An accountant must still confirm that the UK entity is the withholding agent. | `program.ts` 107–109 `KR_PRIZE_TAX_FREE_KRW = 50000`, `KR_PRIZE_WITHHOLDING_RATE = 0.22`. Rules `copy.ts` 286. Both prizes are named in that paragraph. The runbook says not to ship a physical prize to Korea until the accountant confirms the UK entity. No gross-up. | Implemented in the rules and the runbook. Accountant confirmation is an owner item, and it blocks Korean physical shipment. |
| D7 | Reached tiers stay unless reward review is rejected. Counts freeze at close. A counted friend who later unsubscribes still counts. A friend who deletes their data, or who is removed in review, stops counting. An unsubscribed referrer keeps rewards already reached and loses early-launch mail and notices. Ranking uses the current credited count. | `eligibility.ts` 149–170 `wasConfirmed` counts `verified` or `unsubscribed` when `emailVerified` and `Verified at` exist. `excludeReason` 195–198 drops a friend who unsubscribed before confirming. `ledger.ts` 20–46 and `heldCount` 231–235: held count is `max(credited, notified count)` unless `rewardReview === "rejected"`. Ranking is `rankedStandings` on `credited` (252–254). Rules "What counts" `copy.ts` 248–249. Status `lightEligible` (167) says the light order is provisional. The official frozen result is the report stored at close (`ledger.ts` 42–44), not a later rerun. Setting only `unsubscribed` does not drop a confirmed friend; deletion means removing the row or clearing `Email verified` and `Verified at` (runbook). | Implemented. Live ledger can still change after close if ops marks a friend suspect or duplicate. The stored close report is the official result. |
| D8 | Friends who confirmed through the link before the program start on 2026-10-22 count, and the rules say so. | `ledger.ts` 45–46: no start-date filter on `verifiedAt`. Rules `copy.ts` 246. | Implemented. |
| D9 | Neutral share text. No price, reward, or scarcity in the share sheet. The button says Share. Share only with people you know. No bulk or unsolicited messages, no posting where promotion is banned (including comments on WatchDive's own ads), no buying ads with the link, no referral-exchange sites, no signing others up. A public post must say the sharer receives a reward. | Share button and prefilled text: `src/lib/referral/shareCopy.ts` 19–56. Landing uses it only while the program is on (`src/routes/index.tsx` 603–605). Card, welcome, and fair play in all 9 locales: `copy.ts` card.body 141 / 336 and the matching lines in the other locales; fair play 255, 450, 645, and the same paragraph in zh-TW, ja, es, fr, de, pt-BR. The general list is defined in the first rewards paragraph (en 262, ko 457, zh-CN 652, zh-TW 846, ja 1043, es 1242, fr 1441, de 1640, pt-BR 1836). Test: `tests/referralCopy.test.ts` "share wording names people you know, and the rules define the general list". | Implemented in rules, card, welcome, and the share button. The frozen share text stays while the switch is off. |

## Legal blockers and should-fixes

| Item | Status |
|---|---|
| Blocker 1, $149 scarcity | D1. On-state claims name the exceptions. |
| Blocker 2, eligibility | D2. In the rules. Checked by a person at fulfilment. |
| Blocker 3, promoter address and prize detail | Organizer paragraph `copy.ts` 220: DIVEROID LTD, 16343651, Office 12146, 182-184 High Street North, East Ham, London E6 2JA, help@diveroid.com. Prize detail is D3. Light model name is still open. |
| Blocker 4, campaign slip / close / delivery | D4. |
| Blocker 5, Korean advertising mail | D5 for Buddy Invite mail. Reservation and launch templates are still open. |
| Should-fix 6, Korean prize tax | D6. |
| Should-fix 7, tiers, unsubscribe, freeze | D7. |
| Should-fix 8, pre-start friends | D8. |
| Should-fix 9, "send" as the instigator of the friend's message | D9. |
| Should-fix 10, privacy | While the switch is on, privacy renders section 11 (`src/lib/referralPrivacy.ts` title `"11. {program}"`, `src/routes/privacy.tsx` 190 and 205, `id="buddy-invite"`). The invited visitor is told, in the welcome line, that confirming adds one to the inviter's count and that the inviter sees the number only (`copy.ts` `card.invitedNote` 147–148, shown at `index.tsx` 589–592). Tax fields are kept only as long as tax law requires. A 30-day leaderboard sunset is not in the code. The runbook says not to promise one. The live board is the top 3 nicknames (`program.ts` `LEADERBOARD_SIZE = 3`). Publishing winner nicknames after review is a manual ops step. |
| Should-fix 11, reassignment | Rules review paragraph `copy.ts` 279: 14 days to reply; a light passes to the next Dive Leader by order of reaching 10; a WatchDive passes to the next rank. Doing that reassignment is manual (`docs/referral-program-ops.md`). |
| Should-fix 12, early-notice pipeline | `scripts/referral-report.ts` writes `early-notice-2h.csv` (3 or more credited friends) and `early-notice-1h.csv` (1–2). `scripts/launch-mail.ts --help` offers only `--wave t-1d\|t-1h\|t-0`. It does not read those CSV files. The general list is now defined in the rules as everyone on the waitlist who has not reached a Buddy Invite tier. The live link at T still has to go to everyone, including the early tiers. The `t-1d` sentence that says the next mail is one hour before still disagrees with the 2-hour tier. Fix that sentence, and add a CSV sender, before the campaign opens. This does not block the referral switch. |
| Nice 1–2, UK contest structure and US | No copy change. The rules still say no purchase is required (`copy.ts` 239). |
| Nice 3, Italy and Québec | Not excluded. D2 limits physical rewards to Kickstarter shipping countries. |
| Nice 4, keep the contest off the Kickstarter page | Ops note in the Dive Team section of the runbook: the private link is one pledge, on the Kickstarter website, signed in, and is not for the app, late pledges, or the pledge manager. |
| Nice 5, avoid "free" | Leader reward text states a value and that the recipient pays shipping and tax. It does not call the light free. |
| Nice 6, governing law | Not added. The owner decision did not ask for a governing-law sentence. |

## Runbook

`docs/referral-program-ops.md` is the operator runbook. `docs/referral-owner-checklist.md` is the morning click-and-command list in Korean.

Confirmed and corrected in the runbook:

- The env table used to say an empty `WATCHDIVE_REFERRAL_CLOSES_AT` means the close is undecided. `referralClosesAt` returns the long stop in that case, and drops a value later than the long stop. The table now says so.
- `referral-schema.ts` has no `--help`. `--help` exits 1 with `unknown_argument`. No Notion env exits 1 with `misconfigured` and writes nothing.
- Production deploy stays with the master switch off, and the checklist tells the owner to re-check that `/buddy-rules` is 404 and the first-100 sentence is still the off-state sentence.
- Welcome mail is the signup verification pipeline. Announce self-test is a separate `--only` command. `--only` ignores the release gate.
- Announce `--apply` with the switch off is refused before any Notion read: exit 2, `refused: WATCHDIVE_REFERRAL_PROGRAM_ENABLED is not 1`. Missing `--released-at` exits 1 and sends nothing.
- The official close result is the one report run at the close, stored privately. A later `--now` rerun does not reconstruct the rows.
- `--with-emails` without `--out-dir` exits 1 and writes nothing. The summary writer refuses a JSON file that contains `@` (`referral-report.ts` 665–667).
- Early notices are no longer described as something `launch-mail.ts` sends.
- Prize fulfilment covers age and staff (not checked at signup), the shipping-country list, one light and one WatchDive per person and household, the Dive Team link constraints, the unnamed light, the WatchDive even if the campaign fails, and Korean tax with the accountant gate.
- Rollback is turning both switches off and redeploying if the env needs a deploy. It is not a git revert. Mail already sent is not recalled. Unsubscribe links keep working.
- Deleting a friend means removing the row or clearing `Email verified` and `Verified at`. An `unsubscribed` status alone keeps the credit.

The checklist uses the public locale prefixes from `src/lib/i18n/locale.ts` (`/zh-cn/buddy-rules`, `/pt-br`). `localeFromPathSegment` also accepts the uppercase form because it lowercases first. The footer links are the lowercase ones.

## Script checks

No Notion, Resend, or Vercel calls. Env vars for those were unset. Send functions in the fake run were counters that throw; both stayed at 0.

| Command | Exit | Result |
|---|---|---|
| `scripts/referral-announce.ts --help` | 0 | Flags: `--released-at`, `--limit`, `--only`, `--receipt-dir`, `--rate`, `--apply --confirm wd-buddy-invite-20261022`, `--dry-run`. |
| `scripts/referral-announce.ts` (no `--released-at`) | 1 | `invalid --released-at / --limit / --rate`. No send. |
| `scripts/referral-announce.ts --released-at 2026-10-22T00:00:00Z --apply --confirm wd-buddy-invite-20261022` with the switch unset | 2 | `refused: WATCHDIVE_REFERRAL_PROGRAM_ENABLED is not 1` before the Notion env check. |
| `runAnnounce` dry-run, one fake verified Korean row, phone set, `send` throws | — | `mode=dry-run`, eligible 1, planned 1, sent 0, `send` calls 0. Sample subject started with `(광고) `. Address in the sample was masked. |
| `runAnnounce` dry-run, same row, phone unset | — | `senderPhoneMissing=1`, no sample, sent 0. |
| `runAnnounce` `--apply` equivalent, switch on, phone unset | — | `aborted=sender_phone_missing`, sent 0, `send` calls 0. |
| `runAnnounce` apply, switch off | — | `aborted=switch_off`, sent 0. |
| `scripts/referral-report.ts --help` | 0 | `--out`, `--with-emails --out-dir`, `--now`. Read-only. |
| `scripts/referral-report.ts --with-emails` | 1 | `--with-emails needs --out-dir`, before the Notion env check. |
| `scripts/referral-schema.ts --help` | 1 | `{"apply":false,"ok":false,"error":"unknown_argument"}` |
| `scripts/referral-schema.ts` with no Notion env | 1 | `{"apply":false,"ok":false,"error":"misconfigured"}` |
| `scripts/launch-mail.ts --help` | 0 | Waves `t-1d`, `t-1h`, `t-0` only. |

`referralCopy.test.ts`: 16 pass, 0 fail, including the new share and general-list test.

`npm test` in this worktree: 1090 tests, 1074 pass, 16 fail. Thirteen failures are the known `tests/socialAuth.test.ts` set (runner numbers 866, 868, 870, 871, 873, 874, 875, 876, 877, 878, 879, 880, 890). Three more are `tests/reservation-mail-tick.test.ts`: `new URL(...).pathname` percent-encodes the Korean parent directory, and `/bin/sh` then cannot find `scripts/reservation-mail-tick.sh` (exit 127). The script file is present. Those three tests and that script were not edited. They fail the same way in isolation. They are outside this change.

## Still with the owner

- Name the underwater light, then update the rules and the winner mail.
- Publish the Kickstarter shipping-country list on the rules page before close. Do not ship outside it.
- Accountant: confirm whether UK DIVEROID LTD withholds Korean prize tax. Do not ship a physical prize to Korea before that.
- Before the campaign opens: a sender that mails only the early-notice CSVs, and a fix to the `t-1d` line that says the next mail is one hour before.
- Before any Korean reservation mail or launch mail: add `(광고)`, the sender block, and `WATCHDIVE_SENDER_PHONE` to those templates. Buddy Invite mail already has them.
- Italy and Québec stay eligible for physical rewards when the shipping list includes them.

## Not verified here

No production or Preview deploy, so the click path in the checklist was not opened in a browser. No live Notion read, no real email, no Resend dashboard. The accountant has not confirmed the withholding agent. Winner-nickname publication and the 14-day reassignment are procedures, not code. This review did not re-audit the ledger's duplicate and daily-cap algorithms beyond the functions cited above.
