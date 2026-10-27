import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { NotionRequest } from "../verification/notionLead.ts";
import type { StripeApi } from "../reservation/stripeApi.ts";
import { runReservationMail, type ReservationDependencies, type ReservationRunOptions } from "../reservation-mail/run.ts";
import { receiptPaths, loadLedger, ledgerUnsafe } from "../reservation-mail/receipts.ts";
import { DRIP_DELAY, DRIP_STAGES, dripEnabled, type DripStage } from "./policy.ts";
import { DRIP_COPY_HASH, renderDripMail } from "./render.ts";
import { createDripStore } from "./store.ts";
import { stripeAllowsDrip } from "./payment.ts";

export type DripOptions = Omit<ReservationRunOptions, "receiptDir" | "delayMs"> & {
  legacyReceiptDir: string;
  dripReceiptDir: string;
};
export async function runReservationDrip(options: DripOptions, dependencies: Omit<ReservationDependencies, "store" | "renderMail" | "canSend"> & {
  request: NotionRequest;
  databaseId: string;
  stripe: StripeApi;
}) {
  const env = dependencies.env ?? process.env;
  if (options.mode === "send") {
    if (!dripEnabled(env as Record<string, string | undefined>, DRIP_COPY_HASH)) return { aborted: "drip_not_approved_or_cutover_incomplete", stages: [] };
    // Never silently open a fresh D0 ledger: preserving history prevents an
    // accepted old mail with a failed Notion write from being delivered twice.
    try {
      const file = receiptPaths(options.legacyReceiptDir).file;
      if (!(await stat(file)).isFile()) throw new Error();
      const ledger = await loadLedger(file);
      if (ledgerUnsafe(ledger) || ledger.byLead.size === 0) throw new Error();
    } catch { return { aborted: "existing_d0_receipt_ledger_required", stages: [] }; }
  }
  const legacy = resolve(options.legacyReceiptDir);
  const root = resolve(options.dripReceiptDir);
  if (root === legacy || DRIP_STAGES.slice(1).some(stage => resolve(root, stage) === legacy)) return { aborted: "receipt_directory_collision", stages: [] };
  const stages: { stage: DripStage; result: Awaited<ReturnType<typeof runReservationMail>> }[] = [];
  for (const stage of DRIP_STAGES) {
    const store = createDripStore(dependencies.request, dependencies.databaseId, stage, dependencies.now);
    const result = await runReservationMail({
      ...options,
      delayMs: DRIP_DELAY[stage],
      receiptDir: stage === "d0" ? legacy : join(root, stage),
    }, {
      ...dependencies,
      store,
      renderMail: input => renderDripMail(stage, input),
      canSend: async row => await store.recheckInbox(row) && await stripeAllowsDrip(dependencies.stripe, row.email),
      send: message => dependencies.send(stage === "d0" ? message : {
        ...message,
        idempotencyKey: `${message.idempotencyKey}-${stage}`,
        tags: [...message.tags, { name: "drip_stage", value: stage }],
      }),
    });
    stages.push({ stage, result });
    if (result.aborted) break;
  }
  return { copyHash: DRIP_COPY_HASH, stages };
}
