// Launch-day mail to the confirmed waitlist. Fired by a human, never by cron.
// See src/lib/launchMail/cli.ts for the flags; `--help` prints them.
//
//   node --experimental-strip-types --env-file=.env.launch scripts/launch-mail.ts \
//     --wave t-1d --kickstarter-url <url> --launch-at 2026-12-01T14:00:00Z
//
// Dry run by default: nothing is sent and nothing is written to Notion.
import { main } from "../src/lib/launchMail/cli.ts";

process.exitCode = await main(process.argv.slice(2));
