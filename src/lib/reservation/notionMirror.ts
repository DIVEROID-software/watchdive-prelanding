// Copies a Stripe reservation snapshot onto the existing signup row.
// Stripe remains the only paid authority. This module never creates a charge,
// never reads a success URL, and never treats a Notion cell as permission to
// charge. A missing or failed write throws so the webhook can refuse to
// acknowledge the event.
import { canonicalEmail } from "../api/abuse.ts";
import { canonicalEmailFilters, withCanonicalEmailShape } from "../api/notionCanonicalEmail.ts";
import { NotionRequestError, type NotionRequest } from "../verification/notionLead.ts";
import {
  ENV_NOTION_API_KEY,
  ENV_NOTION_WAITLIST_DB_ID,
  ENV_RESERVATION_NOTION_MIRROR,
  RESERVATION_CURRENCY,
  RESERVATION_FEE_CENTS,
} from "./constants.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import {
  NOTION_DATABASE_ID,
  reservationNotionFields,
  RESERVATION_MIRROR_SOURCE,
} from "./notionSchema.ts";
import type { ReservationSnapshot, ReservationStatus } from "./state.ts";

const MONEY_STATUSES = new Set<ReservationStatus>([
  "paid",
  "refunded",
  "partially_refunded",
  "refund_pending",
  "disputed",
]);

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/;
const PAYMENT_ID = /^pi_[A-Za-z0-9_]{1,255}$/;
const CURRENCY = /^[a-z]{3}$/;
export type ReservationMirrorMode = "test" | "live";

export type ReservationMirrorSession = {
  id: string | null;
  paymentIntentId: string | null;
  /** Charge.created seconds. Never Checkout Session.created. */
  chargeCreated: number | null;
  livemode: boolean | null;
};

export type ReservationMirrorInput = {
  /** Customer email as Stripe returned it. */
  rawEmail: string;
  /** Trusted Stripe session metadata, originally bound by the signed signup token. */
  pageId?: string;
  /** Reservation inbox key. Plus-tags stay distinct outside Gmail. */
  email: string;
  snapshot: ReservationSnapshot;
  session: ReservationMirrorSession | null;
  mode: ReservationMirrorMode;
};

export type ReservationMirrorResult = { skipped: "no_lead" } | { updated: number };

export type ReservationPaymentMirror = {
  apply(input: ReservationMirrorInput): Promise<ReservationMirrorResult>;
};

export type NotionMirrorReason =
  "lead_missing" | "delivery" | "misconfigured" | "mode_mismatch" | "truncated" | "contract";

export class NotionMirrorError extends Error {
  readonly reason: NotionMirrorReason;
  readonly status: number | null;

  constructor(reason: NotionMirrorReason, status: number | null = null) {
    super(`notion_mirror_${reason}`);
    this.name = "NotionMirrorError";
    this.reason = reason;
    this.status = status;
  }
}

export type ReservationNotionMirrorConfig =
  | { enabled: false }
  | { enabled: true; ok: false; problem: "missing_database" | "missing_key" }
  | { enabled: true; ok: true; databaseId: string };

export function readReservationNotionMirrorConfig(
  env: Record<string, string | undefined>,
): ReservationNotionMirrorConfig {
  if ((env[ENV_RESERVATION_NOTION_MIRROR] ?? "").trim() !== "true") return { enabled: false };
  const databaseId = (env[ENV_NOTION_WAITLIST_DB_ID] ?? "").trim();
  const key = (env[ENV_NOTION_API_KEY] ?? "").trim();
  if (!NOTION_DATABASE_ID.test(databaseId))
    return { enabled: true, ok: false, problem: "missing_database" };
  if (!key) return { enabled: true, ok: false, problem: "missing_key" };
  return { enabled: true, ok: true, databaseId };
}

export function reservationMirrorRequiresLead(snapshot: ReservationSnapshot): boolean {
  return snapshot.paid || MONEY_STATUSES.has(snapshot.status);
}

type MirrorWrite = {
  status: ReservationStatus;
  paid: boolean;
  duplicatePaid: boolean;
  amountCents: number | null;
  currency: string;
  sessionId: string;
  paymentId: string;
  paidAt: string | null;
  mode: ReservationMirrorMode;
  refundedCents: number;
  refundPendingCents: number;
  dispute: "none" | "open";
};

function sessionAgrees(session: ReservationMirrorSession, mode: ReservationMirrorMode): boolean {
  if (session.livemode === null || !session.id) return false;
  const live = mode === "live";
  if (session.livemode !== live) return false;
  if (live && !session.id.startsWith("cs_live_")) return false;
  if (!live && !session.id.startsWith("cs_test_")) return false;
  return SESSION_ID.test(session.id);
}

/**
 * Turns a Stripe snapshot into Notion properties. `paid` is true only for the
 * contract fee: 300 USD cents, status paid, and a session id that matches the
 * mode. A caller-supplied paid flag with any other amount stays unchecked.
 * The date is Charge.created. Checkout Session.created is never stored.
 * Test mode writes only the Test reservation columns.
 */
export function reservationMirrorWrite(input: ReservationMirrorInput): MirrorWrite {
  const snapshot = input.snapshot;
  const session = input.session;
  const sessionId = session?.id && SESSION_ID.test(session.id) ? session.id : "";
  const paymentId =
    session?.paymentIntentId && PAYMENT_ID.test(session.paymentIntentId)
      ? session.paymentIntentId
      : "";
  const currency = snapshot.currency && CURRENCY.test(snapshot.currency) ? snapshot.currency : "";
  const amountCents =
    typeof snapshot.amountTotal === "number" && Number.isInteger(snapshot.amountTotal)
      ? snapshot.amountTotal
      : null;
  const contractMoney = amountCents === RESERVATION_FEE_CENTS && currency === RESERVATION_CURRENCY;
  let status = snapshot.status;
  let paid =
    snapshot.paid === true &&
    status === "paid" &&
    contractMoney &&
    sessionId.length > 0 &&
    paymentId.length > 0;
  if ((snapshot.paid || status === "paid") && !contractMoney) {
    status = "invalid";
    paid = false;
  }
  const money = paid || MONEY_STATUSES.has(status);
  if (session && money && !sessionAgrees(session, input.mode)) {
    throw new NotionMirrorError("mode_mismatch");
  }
  if (money && (sessionId.length === 0 || paymentId.length === 0)) {
    throw new NotionMirrorError("contract");
  }
  const chargeCreated = session?.chargeCreated;
  const paidAt = money
    ? typeof chargeCreated === "number" && Number.isInteger(chargeCreated) && chargeCreated > 0
      ? new Date(chargeCreated * 1000).toISOString()
      : null
    : null;
  if (money && !paidAt) throw new NotionMirrorError("contract");
  return {
    status,
    paid,
    duplicatePaid: snapshot.duplicatePaid === true,
    amountCents,
    currency,
    sessionId,
    paymentId,
    paidAt,
    mode: input.mode,
    refundedCents: snapshot.amountRefunded,
    refundPendingCents: snapshot.amountRefundPending,
    dispute: status === "disputed" ? "open" : "none",
  };
}

function textProp(value: string): Record<string, unknown> {
  if (!value) return { rich_text: [] };
  return { rich_text: [{ type: "text", text: { content: value } }] };
}

function selectProp(value: string | null): Record<string, unknown> {
  if (!value) return { select: null };
  return { select: { name: value } };
}

export function reservationMirrorProperties(write: MirrorWrite): Record<string, unknown> {
  const fields = reservationNotionFields(write.mode);
  return {
    [fields.status]: selectProp(write.status),
    [fields.paid]: { checkbox: write.paid },
    [fields.amountCents]: { number: write.amountCents },
    [fields.currency]: textProp(write.currency),
    [fields.sessionId]: textProp(write.sessionId),
    [fields.paymentId]: textProp(write.paymentId),
    [fields.paidAt]: { date: write.paidAt ? { start: write.paidAt } : null },
    [fields.mode]: selectProp(write.mode),
    [fields.refundedCents]: { number: write.refundedCents },
    [fields.refundPendingCents]: { number: write.refundPendingCents },
    [fields.dispute]: selectProp(write.dispute),
    [fields.duplicatePaid]: { checkbox: write.duplicatePaid },
    [fields.source]: textProp(RESERVATION_MIRROR_SOURCE),
  };
}

type NotionPage = {
  id?: unknown;
  properties?: Record<string, unknown>;
};

function readTitle(property: unknown): string {
  const title = (property as { title?: { plain_text?: string }[] } | undefined)?.title;
  if (!Array.isArray(title)) return "";
  return title.map((part) => part.plain_text ?? "").join("");
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function pageTitle(page: NotionPage): string {
  return readTitle(page.properties?.Email);
}

function deliveryError(error: unknown): NotionMirrorError {
  if (error instanceof NotionMirrorError) return error;
  if (error instanceof NotionRequestError) return new NotionMirrorError("delivery", error.status);
  return new NotionMirrorError("delivery");
}

function filterClauses(rawEmail: string, email: string): Record<string, unknown>[] {
  const titles = [
    rawEmail.trim(),
    email.trim(),
    reservationCanonicalEmail(rawEmail),
    canonicalEmail(rawEmail),
  ];
  const uniqueTitles = [...new Set(titles.filter((value) => value.length > 0))];
  const clauses: Record<string, unknown>[] = uniqueTitles.map((value) => ({
    property: "Email",
    title: { equals: value },
  }));
  const abuse = canonicalEmail(rawEmail);
  if (abuse === email || abuse === reservationCanonicalEmail(rawEmail)) {
    clauses.push(...canonicalEmailFilters(abuse));
  }
  const seen = new Set<string>();
  return clauses.filter((clause) => {
    const key = JSON.stringify(clause);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadPages(
  request: NotionRequest,
  databaseId: string,
  filter: Record<string, unknown>[],
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor = "";
  for (let page = 0; page < 3; page += 1) {
    const body: Record<string, unknown> = { filter: { or: filter }, page_size: 25 };
    if (cursor) body.start_cursor = cursor;
    const result = await withCanonicalEmailShape(() =>
      request("POST", `databases/${encodeURIComponent(databaseId)}/query`, body),
    );
    const batch = Array.isArray(result.results) ? (result.results as NotionPage[]) : [];
    pages.push(...batch);
    if (result.has_more !== true) return pages;
    cursor = typeof result.next_cursor === "string" ? result.next_cursor : "";
    if (!cursor) throw new NotionMirrorError("truncated");
  }
  throw new NotionMirrorError("truncated");
}

function pagesToUpdate(pages: NotionPage[], rawEmail: string, email: string): NotionPage[] {
  const exact = pages.filter((page) => {
    const title = pageTitle(page);
    return sameAddress(title, rawEmail) || sameAddress(title, email);
  });
  if (exact.length > 0) return exact;
  const abuse = canonicalEmail(rawEmail);
  if (abuse !== email && abuse !== reservationCanonicalEmail(rawEmail)) return [];
  return pages;
}

export function createReservationNotionMirror(input: {
  request: NotionRequest;
  databaseId: string;
}): ReservationPaymentMirror {
  return {
    async apply(mirrorInput) {
      let write: MirrorWrite;
      try {
        write = reservationMirrorWrite(mirrorInput);
      } catch (error) {
        throw deliveryError(error);
      }
      const clauses = filterClauses(mirrorInput.rawEmail, mirrorInput.email);
      let pages: NotionPage[];
      try {
        pages = await loadPages(input.request, input.databaseId, clauses);
      } catch (error) {
        throw deliveryError(error);
      }
      if (
        mirrorInput.pageId &&
        /^[A-Za-z0-9-]{1,100}$/.test(mirrorInput.pageId) &&
        !pages.some((page) => page.id === mirrorInput.pageId)
      ) {
        try {
          const bound = (await input.request(
            "GET",
            `pages/${encodeURIComponent(mirrorInput.pageId)}`,
          )) as NotionPage;
          if (reservationCanonicalEmail(pageTitle(bound)) !== mirrorInput.email)
            throw new NotionMirrorError("contract");
          pages.push(bound);
        } catch (error) {
          throw deliveryError(error);
        }
      }
      const targets = pagesToUpdate(pages, mirrorInput.rawEmail, mirrorInput.email).filter(
        (page) => typeof page.id === "string" && page.id.length > 0,
      );
      const bound = mirrorInput.pageId && pages.find((page) => page.id === mirrorInput.pageId);
      if (bound && reservationCanonicalEmail(pageTitle(bound)) !== mirrorInput.email)
        throw new NotionMirrorError("contract");
      if (bound && !targets.includes(bound)) targets.push(bound);
      if (targets.length === 0) {
        if (reservationMirrorRequiresLead(mirrorInput.snapshot))
          throw new NotionMirrorError("lead_missing");
        return { skipped: "no_lead" };
      }
      const properties = reservationMirrorProperties(write);
      try {
        for (const page of targets) {
          await input.request("PATCH", `pages/${encodeURIComponent(String(page.id))}`, {
            properties,
          });
        }
      } catch (error) {
        throw deliveryError(error);
      }
      return { updated: targets.length };
    },
  };
}

export function unavailableReservationMirror(): ReservationPaymentMirror {
  return {
    async apply() {
      throw new NotionMirrorError("misconfigured");
    },
  };
}
