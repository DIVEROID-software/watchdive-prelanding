// Production activation preflight for consented GA4 and Meta purchase delivery.
//
// Prints booleans only. It does not enable a flag, send an analytics event,
// write Vercel, or print a secret. A probe, when the ledger is configured,
// uses SET NX, GET, SET EX, and DEL inside wdconv:preflight:<16 hex> only.

import { readFileSync } from "node:fs";
import {
  conversionCapability,
  parseConversionOperatorEnv,
  probeConversionRest,
  readLedgerMarker,
  syntheticNamespace,
  type LedgerMarker,
  type StoreProbe,
} from "../src/lib/analytics/activationPreflight.ts";

type Env = Record<string, string | undefined>;

function usage(): never {
  console.error(
    "usage: node --experimental-strip-types scripts/conversion-activation-preflight.ts [--env-file PATH] [--no-probe] [--require-ready]",
  );
  process.exit(1);
}

function args(argv: string[]) {
  let envFile: string | undefined;
  let probe = true;
  let requireReady = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-probe") probe = false;
    else if (arg === "--require-ready") requireReady = true;
    else if (arg === "--env-file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) usage();
      envFile = next;
      i += 1;
    } else usage();
  }
  return { envFile, probe, requireReady };
}

const emptyProbe = (): StoreProbe => ({
  attempted: false,
  namespaceSynthetic: false,
  productionPrefixesUsed: false,
  claimAtomic: false,
  readMatched: false,
  expiryFormAccepted: false,
  deleted: false,
  leftoverCleared: false,
  analyticsHostsContacted: false,
  error: "not_configured",
});

async function main() {
  const options = args(process.argv.slice(2));
  const env: Env = { ...process.env };
  if (options.envFile) {
    const text = readFileSync(options.envFile, "utf8");
    for (const [key, value] of Object.entries(parseConversionOperatorEnv(text))) {
      if ((env[key] ?? "").trim() === "") env[key] = value;
    }
  }
  const capability = conversionCapability(env);
  const ledgerMarker: LedgerMarker = await readLedgerMarker({ env });
  let storeProbe = emptyProbe();
  if (options.probe && capability.readyToProbe) {
    storeProbe = await probeConversionRest({ env, namespace: syntheticNamespace() });
  } else if (!capability.readyToProbe) {
    storeProbe = { ...emptyProbe(), error: "not_configured" };
  } else {
    storeProbe = { ...emptyProbe(), error: null };
  }
  const probePassed =
    storeProbe.attempted &&
    storeProbe.namespaceSynthetic &&
    !storeProbe.productionPrefixesUsed &&
    storeProbe.claimAtomic &&
    storeProbe.readMatched &&
    storeProbe.expiryFormAccepted &&
    storeProbe.deleted &&
    storeProbe.leftoverCleared &&
    storeProbe.error === null;
  const epochMatches = ledgerMarker === "matched";
  // Ready means root can set the paired flags. The flags themselves stay off
  // until that separate step, so a passed probe does not activate anything.
  // The epoch marker must already match. This command does not write it.
  const ga4ActivationReady =
    capability.flags.ga4FlagsPaired &&
    capability.ga4.apiSecretPresent &&
    capability.ga4.measurementIdShapeValid &&
    capability.store.configured &&
    epochMatches &&
    probePassed;
  const report = {
    kind: "watchdive-conversion-activation-preflight",
    sendsAnalytics: false,
    flagsDefaultOff:
      !capability.flags.ga4ServerEnabled &&
      !capability.flags.ga4PublicEnabled &&
      !capability.flags.metaPurchaseEnabled,
    capability,
    epochPresent: capability.store.epochPresent,
    epochMatches,
    ledgerMarker,
    storeProbe,
    probePassed,
    ga4ActivationReady,
    metaLedgerReady: probePassed && epochMatches,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (options.requireReady && !ga4ActivationReady) process.exitCode = 2;
}

main().catch(() => {
  process.stderr.write("preflight_failed\n");
  process.exit(1);
});
