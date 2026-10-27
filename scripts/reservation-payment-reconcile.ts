// Dry-run Stripe → Notion reservation reconciliation.
// GET Stripe and POST Notion query only. Refuses apply, replay, refund, and PATCH.
// The report has fingerprints and statuses. It has no email, key, or page id.
import { pathToFileURL } from "node:url";

import { reservationEmailHash } from "../src/lib/reservation/checkout.ts";
import { reservationCanonicalEmail } from "../src/lib/reservation/emailIdentity.ts";
import {
  lookupReservationMirrorLeads,
  type ReservationNotionView,
} from "../src/lib/reservation/notionMirror.ts";
import { NOTION_DATABASE_ID } from "../src/lib/reservation/notionSchema.ts";
import { classifyPaymentSync, paymentFingerprint } from "../src/lib/reservation/paymentSync.ts";
import {
  aggregateInspections,
  inspectSession,
  isOurProduct,
  type InspectedSession,
} from "../src/lib/reservation/state.ts";
import {
  StripeApiError,
  createStripeClient,
  type StripeApi,
  type StripeCheckoutSession,
  type StripeCustomer,
} from "../src/lib/reservation/stripeApi.ts";
import { NotionRequestError, createNotionRequest } from "../src/lib/verification/notionLead.ts";

const LEAK = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}|(?:sk|rk)_(?:live|test)_|whsec_/i;

export type ReconcileReport = {
  mutations: "none";
  applied: false;
  ok: boolean;
  error?: string;
  mode?: "test" | "live";
  paidSessions?: number;
  rows?: ReconcileRow[];
};

export type ReconcileRow = {
  sessionFingerprints: string[];
  classification: string;
  httpStatus: number;
  retryable: boolean;
  wouldWrite: boolean;
  priceGuaranteeEligible: boolean;
  leadCount: number;
  stripeStatus: string;
  stripePaid: boolean;
  amountRefunded: number;
  duplicatePaid: boolean;
};

export function parseReconcileArgs(argv: string[]): { ok: true } | { ok: false; error: "refused_argument" } {
  for (const arg of argv) {
    if (arg === "--dry-run") continue;
    return { ok: false, error: "refused_argument" };
  }
  return { ok: true };
}

export function guardReconcileFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.hostname === "api.stripe.com" && method !== "GET") {
      throw new Error("stripe_mutation_refused");
    }
    if (method === "PATCH" || method === "DELETE" || method === "PUT") {
      throw new Error("mutation_refused");
    }
    if (method === "POST" && url.hostname === "api.notion.com" && !url.pathname.endsWith("/query")) {
      throw new Error("notion_mutation_refused");
    }
    return fetchImpl(input, init);
  };
}

function keyMode(secret: string): "test" | "live" | null {
  if (secret.startsWith("sk_test_") || secret.startsWith("rk_test_")) return "test";
  if (secret.startsWith("sk_live_") || secret.startsWith("rk_live_")) return "live";
  return null;
}

function publish(report: ReconcileReport): ReconcileReport {
  if (LEAK.test(JSON.stringify(report))) {
    return { mutations: "none", applied: false, ok: false, error: "redaction_guard" };
  }
  return report;
}

function stripeFailure(error: unknown): { error: string; status?: number } {
  if (error instanceof StripeApiError) return { error: error.code || "stripe_error", status: error.status };
  if (error instanceof NotionRequestError) return { error: "notion_query_failed", status: error.status };
  return { error: "reconcile_failed" };
}

async function inboxRow(
  stripe: StripeApi,
  sessions: StripeCheckoutSession[],
  customer: StripeCustomer,
  mode: "test" | "live",
  nowMs: number,
  leadsFor: (rawEmail: string, email: string) => Promise<ReservationNotionView[]>,
): Promise<ReconcileRow> {
  const livemode = mode === "live";
  const rawEmail = customer.email ?? "";
  const email = reservationCanonicalEmail(rawEmail);
  const addressed = rawEmail.length > 0;
  const hash = addressed ? reservationEmailHash(email) : "";
  const ours = sessions.filter((session) => isOurProduct(session));
  const hashMatches =
    addressed && ours.every((session) => (session.metadata.email_sha256 ?? "") === hash);
  const livemodeMatches = ours.every((session) => session.livemode === livemode);
  const inspected: InspectedSession[] = [];
  if (livemodeMatches && (hashMatches || !addressed)) {
    for (const session of ours) {
      const sessionHash = addressed ? hash : (session.metadata.email_sha256 ?? "");
      inspected.push(await inspectSession(stripe, session, livemode, nowMs, sessionHash));
    }
  }
  const snapshot = aggregateInspections(inspected);
  const leads = addressed && hashMatches && livemodeMatches ? await leadsFor(rawEmail, email) : [];
  const decision = classifyPaymentSync({
    ourProduct: ours.length > 0,
    bound: addressed ? hashMatches : true,
    livemodeMatches,
    addressed,
    snapshot,
    leads,
    mode,
  });
  return {
    sessionFingerprints: ours.map((session) => paymentFingerprint(session.id)).sort(),
    classification: decision.classification,
    httpStatus: decision.httpStatus,
    retryable: decision.retryable,
    wouldWrite: decision.wouldWrite,
    priceGuaranteeEligible: decision.priceGuaranteeEligible,
    leadCount: leads.length,
    stripeStatus: snapshot.status,
    stripePaid: snapshot.paid,
    amountRefunded: snapshot.amountRefunded,
    duplicatePaid: snapshot.duplicatePaid,
  };
}

export async function runReservationPaymentReconcile(input: {
  args: string[];
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<{ exitCode: number; report: ReconcileReport }> {
  const parsed = parseReconcileArgs(input.args);
  if (!parsed.ok) {
    return { exitCode: 2, report: publish({ mutations: "none", applied: false, ok: false, error: parsed.error }) };
  }
  const secret = (input.env.STRIPE_SECRET_KEY ?? "").trim();
  const mode = keyMode(secret);
  const databaseId = (input.env.NOTION_WAITLIST_DB_ID ?? "").trim();
  const notionKey = (input.env.NOTION_API_KEY ?? "").trim();
  if (!mode || !notionKey || !NOTION_DATABASE_ID.test(databaseId)) {
    return { exitCode: 1, report: publish({ mutations: "none", applied: false, ok: false, error: "misconfigured" }) };
  }
  const fetchImpl = guardReconcileFetch(input.fetchImpl ?? fetch);
  const stripe = createStripeClient({
    secretKey: secret,
    fetchImpl,
    allowLive: mode === "live",
  });
  const request = createNotionRequest(fetchImpl, input.env);
  const nowMs = input.nowMs ?? Date.now();
  try {
    const sessions = await stripe.listCheckoutSessions({});
    const paid = sessions.filter((session) => isOurProduct(session) && session.paymentStatus === "paid");
    const byCustomer = new Map<string, StripeCheckoutSession[]>();
    for (const session of paid) {
      if (!session.customerId) continue;
      const list = byCustomer.get(session.customerId) ?? [];
      list.push(session);
      byCustomer.set(session.customerId, list);
    }
    const rows: ReconcileRow[] = [];
    for (const [customerId, group] of byCustomer) {
      const customer = await stripe.retrieveCustomer(customerId);
      rows.push(
        await inboxRow(stripe, group, customer, mode, nowMs, (rawEmail, email) =>
          lookupReservationMirrorLeads({
            request,
            databaseId,
            rawEmail,
            email,
            mode,
          }),
        ),
      );
    }
    rows.sort((a, b) => a.sessionFingerprints.join().localeCompare(b.sessionFingerprints.join()));
    return {
      exitCode: 0,
      report: publish({
        mutations: "none",
        applied: false,
        ok: true,
        mode,
        paidSessions: paid.length,
        rows,
      }),
    };
  } catch (error) {
    const failure = stripeFailure(error);
    return {
      exitCode: 1,
      report: publish({
        mutations: "none",
        applied: false,
        ok: false,
        error: failure.error,
        mode,
      }),
    };
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const result = await runReservationPaymentReconcile({ args: process.argv.slice(2), env: process.env });
  console.log(JSON.stringify(result.report));
  process.exit(result.exitCode);
}
