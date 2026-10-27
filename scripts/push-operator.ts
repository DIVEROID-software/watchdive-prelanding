// Preparation CLI. Default is a read-only dry run. No scheduler is installed.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  pushEncryptionSecret,
  pushRetentionDays,
  pushSendGuard,
  pushStoreKind,
  type PushEnvironment,
} from "../src/lib/push/config.ts";
import {
  PUSH_CAMPAIGN_ID,
  runPushCampaign,
  webPushTransport,
} from "../src/lib/push/sender.server.ts";
import { applyPushRetention, planPushRetention } from "../src/lib/push/retention.server.ts";
import { inspectPushReadiness } from "../src/lib/push/readiness.server.ts";
import { openPushDirectory } from "../src/lib/push/runtime.server.ts";
import type { PushTransport } from "../src/lib/push/sender.server.ts";

export type PushOperatorIo = {
  fetchImpl?: typeof fetch;
  transport?: PushTransport;
  now?: Date;
  print?: (line: string) => void;
  allowNetwork?: boolean;
};

const HELP = [
  "WatchDive push operator. No scheduler and no schema migration.",
  "send              dry-run directory read. Prints counts only.",
  "send --send --confirm-campaign wd-push-launch-v1",
  "                  requires WATCHDIVE_PUSH_SEND_ENABLED=true and a ready schema.",
  "retain            dry-run retention plan.",
  "retain --apply    archives aged revoked/expired/gone rows when WATCHDIVE_PUSH_RETENTION_DAYS is 7..365.",
  "Refused: --apply-schema, package installs, and any campaign other than wd-push-launch-v1.",
].join("\n");

export async function main(
  argv: string[],
  env: PushEnvironment = process.env,
  io: PushOperatorIo = {},
): Promise<number> {
  const print = io.print ?? ((line: string) => console.log(line));
  if (
    argv.some(
      (arg) => arg === "--apply-schema" || arg.startsWith("--body") || arg.startsWith("--url"),
    )
  ) {
    print(JSON.stringify({ ok: false, aborted: "refused_argument" }));
    return 2;
  }
  let values: {
    send?: boolean;
    apply?: boolean;
    help?: boolean;
    "confirm-campaign"?: string;
  };
  let positionals: string[] = [];
  try {
    const parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        send: { type: "boolean" },
        apply: { type: "boolean" },
        help: { type: "boolean" },
        "confirm-campaign": { type: "string" },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    print(JSON.stringify({ ok: false, aborted: "invalid_arguments" }));
    return 1;
  }
  if (values.help || positionals.length === 0) {
    print(HELP);
    return 0;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || (command !== "send" && command !== "retain")) {
    print(JSON.stringify({ ok: false, aborted: "invalid_arguments" }));
    return 1;
  }
  if (command === "send" && values.apply) {
    print(JSON.stringify({ ok: false, aborted: "contradictory_mode" }));
    return 1;
  }
  if (command === "retain" && (values.send || values["confirm-campaign"])) {
    print(JSON.stringify({ ok: false, aborted: "contradictory_mode" }));
    return 1;
  }
  if (values.send && values["confirm-campaign"] !== PUSH_CAMPAIGN_ID) {
    print(JSON.stringify({ ok: false, aborted: "campaign_not_confirmed" }));
    return 2;
  }
  if (pushStoreKind(env) !== "notion") {
    print(JSON.stringify({ ok: false, aborted: "notion_store_required", attempted: 0 }));
    return 2;
  }
  const fetchImpl = io.fetchImpl ?? fetch;
  const readiness = await inspectPushReadiness(env, fetchImpl);
  if (!readiness.schemaReady) {
    print(
      JSON.stringify({ ok: false, aborted: "schema_not_ready", schemaReady: false, attempted: 0 }),
    );
    return 2;
  }
  if (!pushEncryptionSecret(env)) {
    print(JSON.stringify({ ok: false, aborted: "encryption_unconfigured", attempted: 0 }));
    return 2;
  }
  const now = io.now ?? new Date();
  try {
    const directory = openPushDirectory(env, fetchImpl, () => now);
    if (command === "retain") {
      const days = pushRetentionDays(env);
      const listed = await directory.listRetentionRows();
      if (listed.truncated) {
        print(JSON.stringify({ ok: false, aborted: "directory_truncated", applied: false }));
        return 2;
      }
      const plan =
        days == null
          ? { ok: false as const, reason: "retention_unconfigured" }
          : planPushRetention(listed.rows, now, days);
      if (!values.apply) {
        print(
          JSON.stringify({
            ok: plan.ok,
            mode: "dry-run",
            applied: false,
            expire: plan.ok ? plan.expire.length : 0,
            archive: plan.ok ? plan.archive.length : 0,
            ...(plan.ok ? {} : { aborted: plan.reason }),
          }),
        );
        return plan.ok ? 0 : 2;
      }
      if (!plan.ok || days == null) {
        print(JSON.stringify({ ok: false, aborted: "retention_unconfigured", applied: false }));
        return 2;
      }
      await applyPushRetention(directory, plan);
      print(
        JSON.stringify({
          ok: true,
          mode: "apply",
          applied: true,
          expire: plan.expire.length,
          archive: plan.archive.length,
        }),
      );
      return 0;
    }
    const mode = values.send ? "send" : "dry-run";
    if (mode === "send" && !pushSendGuard(env)) {
      print(JSON.stringify({ ok: false, aborted: "send_not_confirmed", attempted: 0 }));
      return 2;
    }
    const transport =
      io.transport ??
      (io.allowNetwork
        ? webPushTransport
        : async () => {
            throw new Error("push_network_disabled");
          });
    const report = await runPushCampaign({ mode, directory, transport, env, now });
    const publicReport = {
      ok: !report.aborted && report.unconfirmed === 0 && report.unrecorded === 0,
      mode: report.mode,
      aborted: report.aborted,
      examined: report.examined,
      eligible: report.eligible,
      skipped: report.skipped,
      expired: report.expired,
      undecryptable: report.undecryptable,
      attempted: report.attempted,
      gone: report.gone,
      unknown: report.unknown,
      rejected: report.rejected,
      unconfirmed: report.unconfirmed,
      exactlyOnce: false as const,
    };
    print(JSON.stringify(publicReport));
    return publicReport.ok ? 0 : 2;
  } catch {
    print(JSON.stringify({ ok: false, aborted: "push_operator_failed", attempted: 0 }));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), process.env, { allowNetwork: true });
}
