// Argument handling for scripts/reservation-mail.ts.
//
// Dry run is the default. A real send needs BOTH `--send` and
// `--confirm-campaign wd-reservation-invite-v1`. The campaign id is not a
// parameter: a different id would be a different mailing, and that is a code
// change, not a flag.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Locale } from "../i18n/locale.ts";
import { createNotionRequest } from "../verification/notionLead.ts";
import { readResendConfig } from "../verification/resend.ts";
import { RESERVATION_CAMPAIGN_ID } from "./campaign.ts";
import { deliverReservationMessage } from "./provider.ts";
import {
  formatReservationSummary,
  runReservationMail,
  type ReservationMessage,
  type ReservationRunOptions,
} from "./run.ts";
import { createNotionReservationStore } from "./store.ts";

export const USAGE = `Usage:
  node --experimental-strip-types --env-file=<env file> scripts/reservation-mail.ts \\
    [--dry-run]                         default: count eligibility, render samples, send nothing
    [--out-dir <dir>]                   dry-run sample folder (default .reservation-mail-preview)
    [--receipt-dir <dir>]               durable receipt ledger (default .reservation-mail-receipts)
    [--send --confirm-campaign ${RESERVATION_CAMPAIGN_ID}]
                                        really send this one stable campaign
    [--postal-address "<address>"]      UK registered office, or WATCHDIVE_POSTAL_ADDRESS
    [--legal-name "<name>"]             verified UK legal name, or WATCHDIVE_LEGAL_NAME
    [--limit <n>]                       only the first n eligible recipients (oldest first)
    [--rate <per second>]               Resend request rate (default 2)

Reads NOTION_API_KEY, NOTION_WAITLIST_DB_ID, WATCHDIVE_VERIFICATION_SECRET,
and WATCHDIVE_PUBLIC_ORIGIN. A send also reads RESEND_API_KEY,
WATCHDIVE_EMAIL_FROM (and optional WATCHDIVE_EMAIL_FROM_NAME,
WATCHDIVE_EMAIL_REPLY_TO), WATCHDIVE_RESERVATION_TOKEN_SECRET (at least
32 bytes), WATCHDIVE_LEGAL_NAME, and WATCHDIVE_POSTAL_ADDRESS. The token
secret is not the verification secret. The legal name and postal address
must be the verified UK company. This command does not invent them. Stripe
keys and WATCHDIVE_RESERVATION_ENABLED are not read. Optional
RESERVATION_MAIL_RECEIPT_DIR overrides --receipt-dir. Values are never printed.

A send mints each invite with issueReservationInvite in
src/lib/reservation/invite.ts, passing the verified row email. The only query
parameter is lang, using the signup locale (en, ko, zh-CN, zh-TW, ja, es, fr, de, or pt-BR). The invite is
the URL fragment, never a query parameter, so it is not written to access
logs. This command never prints an address or a token. The office Mac mini
tick keeps one private ledger under
~/.config/watchdive-autopilot/reservation-mail/receipts. Do not put that
ledger on Vercel or any other ephemeral disk.`;

export type ParsedCli =
  { ok: true; options: ReservationRunOptions; outDir: string } | { ok: false; error: string };

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedCli {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean" },
        send: { type: "boolean" },
        "confirm-campaign": { type: "string" },
        "postal-address": { type: "string" },
        "legal-name": { type: "string" },
        "out-dir": { type: "string" },
        "receipt-dir": { type: "string" },
        limit: { type: "string" },
        rate: { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bad arguments" };
  }
  if (values.help) return { ok: false, error: "" };
  if (values.send && values["dry-run"]) {
    return { ok: false, error: "--send and --dry-run contradict each other" };
  }
  if (values.send && values["confirm-campaign"] !== RESERVATION_CAMPAIGN_ID) {
    return {
      ok: false,
      error: `--send also needs --confirm-campaign ${RESERVATION_CAMPAIGN_ID}`,
    };
  }
  const number = (raw: string | undefined, name: string): number | undefined | Error => {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : new Error(`${name} must be a number`);
  };
  const limit = number(values.limit, "--limit");
  const rate = number(values.rate, "--rate");
  if (limit instanceof Error) return { ok: false, error: limit.message };
  if (rate instanceof Error) return { ok: false, error: rate.message };
  const postalAddress = values["postal-address"] ?? env.WATCHDIVE_POSTAL_ADDRESS;
  const legalName = values["legal-name"] ?? env.WATCHDIVE_LEGAL_NAME;
  const receiptDir = resolve(
    values["receipt-dir"] ?? env.RESERVATION_MAIL_RECEIPT_DIR ?? ".reservation-mail-receipts",
  );

  return {
    ok: true,
    outDir: resolve(values["out-dir"] ?? ".reservation-mail-preview"),
    options: {
      mode: values.send ? "send" : "dry-run",
      receiptDir,
      ...(postalAddress ? { postalAddress } : {}),
      ...(legalName ? { legalName } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(rate !== undefined ? { ratePerSecond: rate } : {}),
    },
  };
}

/** Exit code: 0 done, 1 usage error, 2 refused or partly failed. */
export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  print: (line: string) => void = (line) => console.log(line),
): Promise<number> {
  const parsed = parseCli(argv, env);
  if (!parsed.ok) {
    if (parsed.error) print(`Error: ${parsed.error}\n`);
    print(USAGE);
    return parsed.error ? 1 : 0;
  }
  const { options, outDir } = parsed;
  const databaseId = env.NOTION_WAITLIST_DB_ID;
  if (!databaseId || !env.NOTION_API_KEY) {
    print(
      "Error: NOTION_API_KEY and NOTION_WAITLIST_DB_ID must be set (values are never printed).",
    );
    return 2;
  }

  let send: (message: ReservationMessage) => Promise<void> = async () => {
    throw new Error("send called outside send mode");
  };
  if (options.mode === "send") {
    try {
      const config = readResendConfig(env);
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      send = (message) => deliverReservationMessage(env, message, fetch, sleep);
      options.unsubscribeMailto = config.replyTo || "help@diveroid.com";
    } catch (error) {
      print(`Error: ${error instanceof Error ? error.message : "Resend is not configured"}`);
      return 2;
    }
  }

  const writeSample = async (
    locale: Locale,
    mail: { subject: string; html: string; text: string },
  ) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${RESERVATION_CAMPAIGN_ID}.${locale}.html`), mail.html);
    await writeFile(
      join(outDir, `${RESERVATION_CAMPAIGN_ID}.${locale}.txt`),
      `Subject: ${mail.subject}\n\n${mail.text}\n`,
    );
  };

  const result = await runReservationMail(options, {
    store: createNotionReservationStore(createNotionRequest(fetch, env), databaseId),
    send,
    env,
    writeSample: options.mode === "dry-run" ? writeSample : undefined,
  });
  print(formatReservationSummary(result));
  if (result.samples.length) print(`Samples written to ${outDir}`);
  if (result.aborted) return 2;
  if (
    options.mode === "send" &&
    (result.failed > 0 ||
      result.unrecorded > 0 ||
      result.inviteRejected > 0 ||
      result.unresolved > 0)
  ) {
    return 2;
  }
  return 0;
}
