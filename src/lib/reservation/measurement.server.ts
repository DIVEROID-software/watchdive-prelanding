import type { LeadRecord } from "../verification/contracts.ts";
import { validGoogleClientId } from "../analytics/contract.ts";
import { createMetaPurchases } from "../analytics/metaPurchases.server.ts";
import { canonicalEmail } from "../api/abuse.ts";
import {
  createGoogleConversions,
  type ConversionEvent,
  type Delivery,
} from "../analytics/googleConversions.server.ts";
import { createNotionLeadStore, createNotionRequest } from "../verification/notionLead.ts";
import { measurementAllows } from "../verification/service.ts";
import { RESERVATION_FEE_CENTS } from "./constants.ts";
import type { InspectedSession, ReservationSnapshot } from "./state.ts";

function cleanPaidFee(snapshot: ReservationSnapshot): boolean {
  return (
    snapshot.status === "paid" &&
    Boolean(snapshot.paid) &&
    !snapshot.duplicatePaid &&
    Boolean(snapshot.sessionId) &&
    snapshot.amountTotal === 300 &&
    snapshot.currency?.toLowerCase() === "usd" &&
    snapshot.amountRefunded === 0 &&
    snapshot.amountRefundPending === 0
  );
}

// Called only after Stripe signature + retrieved payment state validation.
// Ambiguous duplicate-payment state is held for reconciliation in both sinks.
export type PurchaseRefund = {
  sessionId: string;
  refundId: string;
  amountCents: number;
  currency: string;
};

const SESSION_ID = /^cs_[A-Za-z0-9_]+$/;
const REFUND_ID = /^re_[A-Za-z0-9_]+$/;

/**
 * One GA4 `refund` for one succeeded Stripe refund.
 * `transaction_id` is the Checkout Session id, the same id as server `purchase`.
 * `value` is that refund's dollars and equals price × quantity.
 * The Stripe refund id is only the claim key. It is not sent to Google.
 */
export function gaRefundEvent(refund: PurchaseRefund): ConversionEvent | null {
  if (!SESSION_ID.test(refund.sessionId) || !REFUND_ID.test(refund.refundId)) return null;
  if (refund.currency.toLowerCase() !== "usd") return null;
  if (!Number.isSafeInteger(refund.amountCents) || refund.amountCents <= 0) return null;
  if (refund.amountCents > RESERVATION_FEE_CENTS) return null;
  const value = Number((refund.amountCents / 100).toFixed(2));
  if (Math.round(value * 100) !== refund.amountCents) return null;
  return {
    name: "refund",
    key: refund.refundId,
    params: {
      transaction_id: refund.sessionId,
      currency: "USD",
      value,
      items: [
        {
          item_id: "watchdive_reservation_fee",
          item_name: "WatchDive reservation fee",
          price: value,
          quantity: 1,
        },
      ],
    },
  };
}

/**
 * Keep one row per Stripe refund id. Drop a session whose succeeded refunds
 * sum to more than the USD 3 fee, or whose same id disagrees about the amount.
 * A cumulative snapshot with no ids produces nothing.
 */
export function selectPurchaseRefunds(refunds: PurchaseRefund[]): PurchaseRefund[] {
  const grouped = new Map<string, PurchaseRefund[]>();
  for (const refund of refunds) {
    if (!gaRefundEvent(refund)) continue;
    const list = grouped.get(refund.sessionId) ?? [];
    list.push(refund);
    grouped.set(refund.sessionId, list);
  }
  const selected: PurchaseRefund[] = [];
  for (const list of grouped.values()) {
    const byId = new Map<string, PurchaseRefund>();
    let conflict = false;
    for (const refund of list) {
      const prior = byId.get(refund.refundId);
      if (
        prior &&
        (prior.amountCents !== refund.amountCents ||
          prior.currency.toLowerCase() !== refund.currency.toLowerCase())
      ) {
        conflict = true;
      }
      byId.set(refund.refundId, refund);
    }
    if (conflict) continue;
    const unique = [...byId.values()];
    const sum = unique.reduce((total, refund) => total + refund.amountCents, 0);
    if (sum <= 0 || sum > RESERVATION_FEE_CENTS) continue;
    selected.push(...unique);
  }
  return selected.sort(
    (a, b) => a.sessionId.localeCompare(b.sessionId) || a.refundId.localeCompare(b.refundId),
  );
}

export function refundsFromInspections(inspected: InspectedSession[]): PurchaseRefund[] {
  const rows: PurchaseRefund[] = [];
  for (const item of inspected) {
    if (item.kind !== "paid") continue;
    for (const refund of item.succeededRefunds ?? []) {
      rows.push({
        sessionId: item.session.id,
        refundId: refund.id,
        amountCents: refund.amount,
        currency: refund.currency,
      });
    }
  }
  return rows;
}

export function purchaseEvent(snapshot: ReservationSnapshot) {
  if (!cleanPaidFee(snapshot) || snapshot.duplicatePaid || !snapshot.sessionId) return null;
  return {
    name: "purchase" as const,
    key: snapshot.sessionId,
    params: {
      transaction_id: snapshot.sessionId,
      value: 3,
      currency: "USD",
      items: [
        {
          item_id: "watchdive_reservation_fee",
          item_name: "WatchDive reservation fee",
          price: 3,
          quantity: 1,
        },
      ],
    },
  };
}

export function reservationMeasurement(env: Record<string, string | undefined>, fetchImpl = fetch) {
  const google = createGoogleConversions({ env, fetchImpl });
  const meta = createMetaPurchases({ env, fetchImpl });
  const databaseId = env.NOTION_WAITLIST_DB_ID;
  if ((!google.enabled && !meta.enabled) || !databaseId) return undefined;
  const store = createNotionLeadStore(createNotionRequest(fetchImpl, env), databaseId);
  return createReservationMeasurement(google, meta, (email) =>
    store.findByEmail(canonicalEmail(email), email),
  );
}

export function createReservationMeasurement(
  google: ReturnType<typeof createGoogleConversions>,
  meta: ReturnType<typeof createMetaPurchases>,
  find: (email: string) => Promise<LeadRecord | undefined>,
) {
  const allowed = async (email: string) => {
    const row = await find(email);
    return Boolean(
      row &&
      !row.duplicate &&
      (row.emailVerified || row.status === "verified") &&
      measurementAllows(row, false),
    );
  };
  const dropBoth = async (address: string) => {
    const failures: unknown[] = [];
    for (const forget of [() => google.forget(address), () => meta.forget(address)]) {
      try {
        await forget();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  };
  return {
    async capture(email: string, clientId: unknown, permitted: boolean) {
      // A missing/denied choice or GPC never inherits checkout terms as consent.
      const row = await find(email);
      // Use the stored row address for the context key, also used by signup
      // withdrawal. Stripe's Gmail normalization must not leave an alias key.
      const address = row?.email ?? email;
      const permittedNow = permitted && (await allowed(email));
      if (!permittedNow) {
        await dropBoth(address);
        return;
      }
      // Replace the current checkout permission and drop an absent GA cookie.
      // A new checkout must not inherit a previous checkout's context.
      await google.forget(address);
      if (validGoogleClientId(clientId)) await google.capture(address, clientId, true);
      await meta.forget(address);
      await meta.capture(address, true);
    },
    async completed(
      email: string,
      snapshot: ReservationSnapshot,
      occurredAt: number | null = null,
      refunds: PurchaseRefund[] = [],
    ): Promise<Delivery> {
      const event = purchaseEvent(snapshot);
      const metaSessionId = cleanPaidFee(snapshot) ? snapshot.sessionId : null;
      const corrections = selectPurchaseRefunds(refunds);
      if (!event && !metaSessionId && corrections.length === 0) return "skipped";
      const row = await find(email);
      if (!row) return "skipped";
      // Each destination has its own claim. A Google failure never prevents a
      // valid Meta receipt, and a webhook retry cannot resend the accepted sink.
      // A GA4 refund is a separate claim per Stripe refund id. It runs only
      // after this ledger has accepted the purchase for that same session.
      // Meta is not sent a refund event.
      const results: Delivery[] = [];
      for (const refund of corrections) {
        const purchase = await google.recorded("purchase", refund.sessionId);
        if (purchase === "uncertain") {
          results.push("uncertain");
          continue;
        }
        if (purchase !== "accepted") {
          results.push("skipped");
          continue;
        }
        const correction = gaRefundEvent(refund);
        if (!correction) {
          results.push("skipped");
          continue;
        }
        results.push(await google.send(row.email, correction, () => allowed(email)));
      }
      if (event) results.push(await google.send(row.email, event, () => allowed(email)));
      if (metaSessionId) {
        results.push(await meta.send(row.email, metaSessionId, occurredAt, () => allowed(email)));
      }
      return combineDeliveryResults(results);
    },
  };
}

export function combineDeliveryResults(results: Delivery[]): Delivery {
  if (results.includes("retry")) return "retry";
  if (results.includes("uncertain")) return "uncertain";
  if (results.includes("accepted")) return "accepted";
  if (results.includes("duplicate")) return "duplicate";
  if (results.every((result) => result === "disabled")) return "disabled";
  return "skipped";
}
