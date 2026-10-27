# WatchDive web push setup

This is a preparation runbook. It does not create a Notion database, send a notification, or install a scheduler. The public opt-in stays off until every gate below is true on a live read.

## Separate configuration

Use a new Notion database that is not the waitlist database. Create an integration that can access only that database. Do not reuse `NOTION_API_KEY`.

| Name                               | Role                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `WATCHDIVE_PUSH_STORE`             | `notion` for production. `file` is an operator volume only and stays disabled when `VERCEL=1`. |
| `WATCHDIVE_PUSH_NOTION_TOKEN`      | Dedicated integration token.                                                                   |
| `WATCHDIVE_PUSH_NOTION_DB_ID`      | Dedicated database id. Refused when it equals `NOTION_WAITLIST_DB_ID`.                         |
| `WATCHDIVE_PUSH_ENCRYPTION_SECRET` | At-rest AES-256-GCM secret, at least 32 characters, different from the receipt secret.         |
| `WATCHDIVE_PUSH_RECEIPT_SECRET`    | HMAC subscription id and removal receipt. At least 32 characters.                              |
| `WATCHDIVE_PUSH_VAPID_PUBLIC_KEY`  | Uncompressed P-256 public key, base64url.                                                      |
| `WATCHDIVE_PUSH_VAPID_PRIVATE_KEY` | P-256 private scalar, base64url.                                                               |
| `WATCHDIVE_PUSH_VAPID_SUBJECT`     | `mailto:` or `https:` contact for the push service.                                            |
| `WATCHDIVE_PUSH_COPY_APPROVED`     | Must equal `wd-push-launch-v1` after owner approval of the service-worker copy.                |
| `WATCHDIVE_PUSH_ENABLED`           | `true` only after the gates above and the live schema check. Enrollment only.                  |
| `WATCHDIVE_PUSH_SEND_ENABLED`      | `true` only for an explicit CLI send. Independent of enrollment.                               |
| `WATCHDIVE_PUSH_RETENTION_DAYS`    | Integer 7 through 365. Required before `retain --apply`.                                       |
| `WATCHDIVE_PUBLIC_ORIGIN`          | Exact canonical `https` origin.                                                                |
| `WATCHDIVE_PUSH_STORE_DIR`         | Absolute directory for `file` mode only.                                                       |

Generate VAPID keys on the operator machine and place them in the server secret store. Do not commit the output.

```sh
node --experimental-strip-types -e "import { generateVapidKeys } from './src/lib/push/crypto.server.ts'; console.log(JSON.stringify(generateVapidKeys()))"
```

## Schema to create by hand

`src/lib/push/schema.ts` exports `PUSH_SCHEMA_PLAN`. Nothing in this repo PATCHes that plan. Create these properties on the dedicated database:

- `Push id` title. Stable HMAC of the endpoint. Not an email.
- `Push status` select: `active`, `revoked`, `expired`, `gone`.
- `Push locale` select: `en`, `ko`, `zh-CN`, `zh-TW`, `ja`, `es`, `fr`, `de`, `pt-BR`.
- `Push consent version` rich text.
- `Push consent at` date.
- `Push expires at` date.
- `Push ciphertext` rich text. Encrypted endpoint and keys.
- `Push key version` rich text.
- `Push campaign receipt` rich text. One slot for `wd-push-launch-v1`.
- `Push updated at` date.

Do not add email, lead id, phone, or name. Readiness fails closed if any required property, type, or select option is missing. `GET /api/push/config` stays `{ "enabled": false }` until that live read matches.

Enrollment `POST` uses the same check. `DELETE` still works when enrollment is off, as long as the dedicated token, database id, receipt secret, and origin are set. A serverless file directory does not count as deletion.

## Send

The payload is only `{ "copyVersion", "kind": "launch", "locale" }`. The service worker owns the nine approved strings and the on-site path. The sender rejects any other body or URL. Push requests use RFC 8291 `aes128gcm` and a 12-hour VAPID JWT. TTL is 24 hours. Topic is `watchdive-launch`.

```sh
node --experimental-strip-types scripts/push-operator.ts send
node --experimental-strip-types scripts/push-operator.ts send --send --confirm-campaign wd-push-launch-v1
```

The first command is a dry run: schema read and counts, no receipt writes and no push POST. The second command also requires `WATCHDIVE_PUSH_SEND_ENABLED=true`. There is no scheduler.

Run one send at a time. There is no cross-process lock. The Notion receipt is a write followed by a read, not a compare-and-swap, so two overlapping runs can both observe an empty receipt and both POST. Do not start a second send while one is running, and do not install a scheduler for this command.

Immediately before the POST, the sender reads that row again. A revoke, a missing row, or a consent version other than `wd-push-launch-v1` cancels the POST and clears a pending receipt that this run still owns. A change in the moment after that read and before the network call can still race. That is one reason this is not exactly-once.

A 404 or 410 archives the row as `gone`. Other failures write a receipt so the same campaign does not automatically retry. A crash after the push service accepts can leave `pending` or `unknown` and suppress a later attempt. A 401 or 403 clears that one receipt and stops the run so a bad VAPID key is not recorded as a delivery.

## Retention

```sh
node --experimental-strip-types scripts/push-operator.ts retain
node --experimental-strip-types scripts/push-operator.ts retain --apply
```

Dry run is the default. Apply expires active rows whose `Push expires at` is in the past, then archives `revoked`, `expired`, and `gone` rows last updated more than `WATCHDIVE_PUSH_RETENTION_DAYS` ago. It does not delete the database or change its schema. A truncated directory read refuses apply.

## Still not done by this preparation

No production database was created. No secret was stored. No browser notification was sent. Edge rate limiting is still required in front of the subscription route. Copy version `wd-push-launch-v1` is not owner-approved by this document.
