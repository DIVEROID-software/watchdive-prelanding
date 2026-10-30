// Operator-only birth of wdconv:ledger:epoch.
//
// Prints booleans and a result enum. It does not print the epoch, the Redis
// URL, or the token. It does not send analytics. It does not enable a flag.
// --force, --repair, --reset, --overwrite, and --replace are rejected before
// any Redis call. A different marker or an existing event/context key is refused.

import { readFileSync } from "node:fs";
import {
  initializeLedgerEpoch,
  parseConversionOperatorEnv,
  readLedgerMarker,
  type LedgerInitResult,
  type LedgerMarker,
} from "../src/lib/analytics/activationPreflight.ts";

type Env = Record<string, string | undefined>;
const REJECTED = new Set(["--force", "--repair", "--reset", "--overwrite", "--replace"]);

function usage(): never {
  console.error(
    "usage: node --experimental-strip-types scripts/conversion-ledger-init.ts [--env-file PATH] [--check]",
  );
  process.exit(1);
}

function report(body: {
  wrote: boolean;
  checkedOnly: boolean;
  result: LedgerInitResult | LedgerMarker | "rejected";
  epochPresent: boolean;
  epochMatches: boolean;
}): void {
  process.stdout.write(
    `${JSON.stringify({
      kind: "watchdive-conversion-ledger-init",
      sendsAnalytics: false,
      ...body,
    })}\n`,
  );
}

function args(argv: string[]) {
  if (argv.some((arg) => REJECTED.has(arg))) return { rejected: true as const };
  let envFile: string | undefined;
  let check = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--env-file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) usage();
      envFile = next;
      i += 1;
    } else usage();
  }
  return { rejected: false as const, envFile, check };
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.rejected) {
    report({
      wrote: false,
      checkedOnly: false,
      result: "rejected",
      epochPresent: false,
      epochMatches: false,
    });
    process.exitCode = 3;
    return;
  }
  const env: Env = { ...process.env };
  if (options.envFile) {
    const text = readFileSync(options.envFile, "utf8");
    for (const [key, value] of Object.entries(parseConversionOperatorEnv(text))) {
      if ((env[key] ?? "").trim() === "") env[key] = value;
    }
  }
  if (options.check) {
    const marker = await readLedgerMarker({ env });
    report({
      wrote: false,
      checkedOnly: true,
      result: marker,
      epochPresent: marker !== "unconfigured",
      epochMatches: marker === "matched",
    });
    if (marker === "unconfigured") process.exitCode = 2;
    else if (marker === "unavailable") process.exitCode = 1;
    else if (marker === "mismatched") process.exitCode = 3;
    return;
  }
  const initialized = await initializeLedgerEpoch({ env });
  report({
    wrote: initialized.wrote,
    checkedOnly: false,
    result: initialized.result,
    epochPresent: initialized.result !== "unconfigured",
    epochMatches: initialized.result === "already" || initialized.result === "initialized",
  });
  if (initialized.result === "unconfigured") process.exitCode = 2;
  else if (initialized.result === "unavailable") process.exitCode = 1;
  else if (
    initialized.result === "mismatch" ||
    initialized.result === "nonempty" ||
    initialized.result === "conflict"
  ) {
    process.exitCode = 3;
  }
}

main().catch(() => {
  process.stderr.write("ledger_init_failed\n");
  process.exit(1);
});
