// Production wiring for the public return route. Tests pass their own
// directory and sender. This file is the only place that touches Notion or Resend.
import { createNetworkGate } from "../verification/networkGate.ts";
import { createNotionRequest } from "../verification/notionLead.ts";
import { deliverReservationMessage } from "../reservation-mail/provider.ts";
import { createReservationReturnDirectory } from "./returnDirectory.ts";
import { createReturnCooldown } from "./returnCooldown.ts";
import type { ReturnHandlerDeps } from "./returnHandler.ts";

const gate = createNetworkGate({
  windowMs: 60 * 60 * 1000,
  repeatThreshold: 4,
  blockThreshold: 8,
  globalWindowMs: 60 * 60 * 1000,
  globalThreshold: 200,
});

export function productionReservationReturn(env: NodeJS.ProcessEnv = process.env): ReturnHandlerDeps {
  const databaseId = (env.NOTION_WAITLIST_DB_ID ?? "").trim();
  const ledger = (env.WATCHDIVE_RESERVATION_RETURN_LEDGER ?? env.RESERVATION_MAIL_RECEIPT_DIR ?? "").trim();
  return {
    env,
    directory: createReservationReturnDirectory(createNotionRequest(fetch, env), databaseId),
    send: (message) => deliverReservationMessage(env, message),
    cooldown: createReturnCooldown(ledger || undefined),
    networkGate: gate,
  };
}
