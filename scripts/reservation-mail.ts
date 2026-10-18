// Reservation invitation to confirmed waitlist addresses.
// A person runs this CLI, or the office Mac mini tick runs the same CLI.
// See scripts/reservation-mail-tick.sh. This file does not send by itself.
// See src/lib/reservation-mail/cli.ts.
//
// Dry run (default), from this implementation directory:
//   node --experimental-strip-types --env-file=.env scripts/reservation-mail.ts \
//     --postal-address "<UK registered office>" \
//     --legal-name "<verified UK legal name>"
//
// Send — only after the dry run is reviewed and the pay flow works.
// The confirm flag must be exact. Without the verified UK legal name and
// registered office, send refuses and nothing is delivered.
//   node --experimental-strip-types --env-file=.env scripts/reservation-mail.ts \
//     --send --confirm-campaign wd-reservation-invite-v1 \
//     --postal-address "<UK registered office>" \
//     --legal-name "<verified UK legal name>"
//
// Canary, oldest confirmed address first:
//   node --experimental-strip-types --env-file=.env scripts/reservation-mail.ts \
//     --send --confirm-campaign wd-reservation-invite-v1 --limit 1 \
//     --postal-address "<UK registered office>" \
//     --legal-name "<verified UK legal name>"
//
// A send also needs WATCHDIVE_RESERVATION_TOKEN_SECRET (at least 32 bytes).
// That secret signs the invite. It is not the verification secret. Stripe is
// not read. Dry run prints counts only. It does not send, and it does not
// write Notion or the receipt ledger.
import { main } from "../src/lib/reservation-mail/cli.ts";

process.exitCode = await main(process.argv.slice(2));
