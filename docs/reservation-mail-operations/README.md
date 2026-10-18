# Reservation mail operations

Template only. Nothing here is installed, and no customer mail has been sent.

The same CLI serves the backlog and every future verified signup. It runs on the office Mac mini. The ledger is one private directory on that machine. It is not a Vercel filesystem and it is not laptop state.

## Paths

| Item             | Path                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| CLI              | `scripts/reservation-mail.ts` in the implementation clone                        |
| Tick             | `scripts/reservation-mail-tick.sh`                                               |
| Launchd template | `docs/reservation-mail-operations/com.diveroid.watchdive-reservation-mail.plist` |
| Private home     | `/Users/macm4/.config/watchdive-autopilot/reservation-mail`                      |
| Env file         | `/Users/macm4/.config/watchdive-autopilot/reservation-mail.env`                  |
| Receipt ledger   | `.../reservation-mail/receipts` (directory mode 0700)                            |
| Gate             | `.../reservation-mail/send-enabled`                                              |
| Preview samples  | `.../reservation-mail/preview`                                                   |
| Tick logs        | `tick.stdout.log` and `tick.stderr.log` in the private home                      |

The env file holds the names the CLI already reads, including `WATCHDIVE_POSTAL_ADDRESS`. Do not commit that file. The plist contains no secrets.

## Gate

The tick is a dry run unless `send-enabled` exists and its entire contents, with whitespace removed, are exactly `wd-reservation-invite-v1`. A loaded plist still cannot send until that file is created. Removing the file returns the next tick to dry run. There is no force-resend flag.

The tick takes an atomic lock with `mkdir` on `tick.lock`. If the directory already exists it prints `lock held; nothing sent` and exits 0. The node receipt lock still covers the send itself. `kill -9` can leave `tick.lock` behind. Root deletes that directory only after checking that the pid inside `tick.lock/pid` is dead.

## What root does later

1. Dry-run the CLI by hand and read the count summary. Do not cat sample HTML into chat.
2. Confirm the pay flow against the frozen contract in `docs/reservation-contract.md`.
3. Only then copy the plist into `~/Library/LaunchAgents` and bootstrap it. This template ships with `Disabled` true.
4. Open the gate only when a real send is intended.

Suggested install, not run by this change:

```sh
cp docs/reservation-mail-operations/com.diveroid.watchdive-reservation-mail.plist \
  "$HOME/Library/LaunchAgents/com.diveroid.watchdive-reservation-mail.plist"
# root enables and bootstraps only after the dry run and the pay flow
```

Do not bootstrap from a worker. Do not create `send-enabled` until root decides to send.

## Fail closed

An unknown provider outcome (transport, unreadable success, unexpected error) is stored as `hold unknown_outcome` and is not retried, including inside the 23 hour window. A 409 stays `hold provider_conflict`. A clear provider rejection is stored as `failed` and is not retried. An intent with no outcome may resume inside 23 hours on the same idempotency key. After 23 hours that intent becomes `hold expired_intent` and is not sent. A missing ledger file is an empty ledger. If the Notion sent marker is still present, the run does not send again. Deleting both the ledger and the Notion marker on purpose destroys both controls, and a later run can send. That is operator destruction of the only two records, not a missing-ledger defect, and this job does not add a third production store to paper over it.

## Link

The path is `/reservation`. `lang` is the recipient's language: `en`, `ko`, `zh-CN`, `zh-TW`, `ja`, `es`, `fr`, `de`, or `pt-BR`. The token is the `#invite` fragment. It is not a query parameter. `/ko/reservation` is not used.

Language order: an explicit `Signup locale` cell when it matches a supported locale, else a localized landing-path prefix (`/en` beats a KR country), else a supported browser language, else `Signup country` when that code maps to one language, else English. An unprefixed path is not an explicit English choice. Country is not eligibility. Phone, SMS, and IP are not read. Blank country cells are not backfilled.

## UK identity

Companies House company 16343651 is DIVEROID LTD. The registered office is Office 12146, 182-184 High Street North, East Ham, London, United Kingdom, E6 2JA. Source: https://find-and-update.company-information.service.gov.uk/company/16343651. Root also matched the Stripe account legal name DIVEROID LTD and country GB. The Stripe business address and the public descriptor are a separate root item and are not used here.

Previews and sends always include that legal name, company number 16343651, and registered office. Omitting `--legal-name` / `WATCHDIVE_LEGAL_NAME` and `--postal-address` / `WATCHDIVE_POSTAL_ADDRESS` uses those constants. A different name or office is rejected and is not printed. The plist does not contain them.

The wordmark stays the official DIVEROID image. It is not the legal-name line.

## Blockers before any send

- The sender env `~/.config/watchdive-autopilot/reservation-mail.env` is not created by this worker. Root curates it. It needs the verified legal name, the registered office, the reservation token, and Resend. Do not print its values.
- Notion key names already exist in `/Users/macm4/.config/watchdive-autopilot/meta.env`. Do not copy that file into the sender env. It also holds Meta credentials.
- The reservation token file is `/Users/macm4/.config/watchdive-autopilot/reservation.env`. This worker did not read it.
- Resend is still unresolved. A Vercel env pull is redacted and is not a credential source.
- The pay flow must work before root installs the plist or opens `send-enabled`.
- This worker did not install launchd, did not create the gate, and did not send.
