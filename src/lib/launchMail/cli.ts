// Argument handling for scripts/launch-mail.ts. Lives under src/ so it is
// type-checked and tested with everything else.
//
// Dry run is the default. A real send needs BOTH `--send` and
// `--confirm-wave <same wave>`, so neither a stray flag nor a wave typo can
// mail the whole list.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Locale } from "../i18n/locale.ts";
import { createNotionRequest } from "../verification/notionLead.ts";
import { deliver, readResendConfig } from "../verification/resend.ts";
import { isLaunchWave, LAUNCH_WAVES } from "./audience.ts";
import { createNotionLaunchStore } from "./notionLaunchStore.ts";
import {
  formatLaunchSummary,
  runLaunchMail,
  type LaunchDependencies,
  type LaunchMessage,
  type LaunchRunOptions,
} from "./run.ts";

export const USAGE = `Usage:
  node --experimental-strip-types --env-file=<env file> scripts/launch-mail.ts \\
    --wave <${LAUNCH_WAVES.join("|")}> \\
    --kickstarter-url https://www.kickstarter.com/projects/<creator>/<project> \\
    --launch-at <ISO 8601 with zone, e.g. 2026-12-01T14:00:00Z> \\
    [--dry-run]                     default: count per language, render samples, send nothing
    [--out-dir <dir>]               dry-run sample folder (default .launch-mail-preview)
    [--send --confirm-wave <wave>]  really send; --confirm-wave must repeat --wave
    [--postal-address "<address>"]  footer postal address (or WATCHDIVE_POSTAL_ADDRESS); required to send
    [--limit <n>]                   send to the first n eligible recipients only (canary)
    [--rate <per second>]           Resend request rate (default 2, the Resend default limit)

Reads NOTION_API_KEY, NOTION_WAITLIST_DB_ID, WATCHDIVE_VERIFICATION_SECRET,
WATCHDIVE_PUBLIC_ORIGIN, and (send only) RESEND_API_KEY, WATCHDIVE_EMAIL_FROM.`;

export type ParsedCli =
  { ok: true; options: LaunchRunOptions; outDir: string } | { ok: false; error: string };

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedCli {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        wave: { type: "string" },
        "kickstarter-url": { type: "string" },
        "launch-at": { type: "string" },
        "dry-run": { type: "boolean" },
        send: { type: "boolean" },
        "confirm-wave": { type: "string" },
        "postal-address": { type: "string" },
        "out-dir": { type: "string" },
        limit: { type: "string" },
        rate: { type: "string" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "bad arguments" };
  }
  if (values.help) return { ok: false, error: "" };
  const wave = values.wave;
  if (!isLaunchWave(wave))
    return { ok: false, error: `--wave must be one of ${LAUNCH_WAVES.join(", ")}` };
  if (!values["kickstarter-url"]) return { ok: false, error: "--kickstarter-url is required" };
  if (!values["launch-at"]) return { ok: false, error: "--launch-at is required" };
  if (values.send && values["dry-run"]) {
    return { ok: false, error: "--send and --dry-run contradict each other" };
  }
  if (values.send && values["confirm-wave"] !== wave) {
    return {
      ok: false,
      error: `--send also needs --confirm-wave ${wave} (repeat the wave you mean to send)`,
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

  return {
    ok: true,
    outDir: resolve(values["out-dir"] ?? ".launch-mail-preview"),
    options: {
      wave,
      kickstarterUrl: values["kickstarter-url"],
      launchAt: values["launch-at"],
      mode: values.send ? "send" : "dry-run",
      ...(postalAddress ? { postalAddress } : {}),
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

  let send: LaunchDependencies["send"] = async () => {
    throw new Error("send called outside send mode");
  };
  if (options.mode === "send") {
    let config;
    try {
      config = readResendConfig(env);
    } catch (error) {
      print(`Error: ${error instanceof Error ? error.message : "Resend is not configured"}`);
      return 2;
    }
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    send = async (message: LaunchMessage) =>
      deliver(config, fetch, sleep, message.idempotencyKey, "launch_mail", {
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        tags: message.tags,
      });
    options.unsubscribeMailto = config.replyTo || "help@diveroid.com";
  }

  const writeSample = async (
    locale: Locale,
    mail: { subject: string; html: string; text: string },
  ) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${options.wave}.${locale}.html`), mail.html);
    await writeFile(
      join(outDir, `${options.wave}.${locale}.txt`),
      `Subject: ${mail.subject}\n\n${mail.text}\n`,
    );
  };

  const result = await runLaunchMail(options, {
    store: createNotionLaunchStore(createNotionRequest(fetch, env), databaseId),
    send,
    env,
    writeSample,
  });
  print(formatLaunchSummary(result));
  if (result.samples.length) print(`Samples written to ${outDir}`);
  if (result.aborted) return 2;
  if (options.mode === "send" && (result.failed > 0 || result.unrecorded > 0)) return 2;
  return 0;
}
