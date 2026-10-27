// Independent QA of the 2026-10-26 drip delta. These cases drive the runner
// and characterize the three residuals the runbook already names. They do not
// replace the owner's suite and they do not unload the office job.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DRIP_COPY_HASH } from "../src/lib/reservation-drip/render.ts";
import { DRIP_FIELD, DRIP_STAGES, DAY } from "../src/lib/reservation-drip/policy.ts";
import { runReservationDrip } from "../src/lib/reservation-drip/run.ts";
import { stripeAllowsDrip } from "../src/lib/reservation-drip/payment.ts";
import {
  RESERVATION_CAMPAIGN_ID,
  failedMarker,
  holdMarker,
} from "../src/lib/reservation-mail/campaign.ts";
import type { StripeApi } from "../src/lib/reservation/stripeApi.ts";
import type { NotionRequest } from "../src/lib/verification/notionLead.ts";
import { TEST_ENV } from "./helpers/fakes.ts";

const verifiedAt = "2026-10-26T00:00:00.000Z";
const NOW = Date.parse(verifiedAt) + 8 * DAY;
const PRIMARY_LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000a1";
const OTHER_LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000a2";
const SIBLING_LEAD = "aaaaaaaa-bbbb-4ccc-8ddd-0000000000a3";

type Rich = {
  type: "rich_text";
  rich_text: Array<{ plain_text: string; text: { content: string } }>;
};
type Title = { type: "title"; title: Array<{ plain_text: string }> };
type Page = { id: string; properties: Record<string, unknown> };

function rich(value: string): Rich {
  return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] };
}

function title(email: string): Title {
  return { type: "title", title: [{ plain_text: email }] };
}

function pageFor(id: string, leadId: string, email: string): Page {
  const properties: Record<string, unknown> = {
    Email: title(email),
    "Lead ID": rich(leadId),
    "Verification status": { type: "select", select: { name: "verified" } },
    "Email verified": { type: "checkbox", checkbox: true },
    Suspect: { type: "checkbox", checkbox: false },
    "Verified at": { type: "date", date: { start: verifiedAt } },
    "Launch mail": rich(""),
    "Reservation paid": { type: "checkbox", checkbox: false },
    "Reservation mode": { type: "select", select: { name: "live" } },
    "Signup locale": rich("ko"),
  };
  for (const stage of DRIP_STAGES) properties[DRIP_FIELD[stage]] = rich("");
  return { id, properties };
}

function textOf(page: Page, field: string): string {
  const cell = page.properties[field] as Rich | undefined;
  return cell?.rich_text?.[0]?.plain_text ?? "";
}

type StripeCustomer = { id: string; email: string; metadata: Record<string, string> };
type StripeSession = {
  livemode: boolean;
  metadata: Record<string, string>;
  paymentStatus: string;
  status: string;
};

function stripeApi(input: {
  customers?: StripeCustomer[];
  sessions?: StripeSession[];
  onEmail?: (email: string) => StripeCustomer[];
  throwOnList?: boolean;
}): StripeApi {
  return {
    listCustomersByEmail: async (email: string) => {
      if (input.throwOnList) throw new Error("stripe offline");
      if (input.onEmail) return input.onEmail(email);
      return input.customers ?? [];
    },
    listCheckoutSessions: async () => input.sessions ?? [],
  } as unknown as StripeApi;
}

function receiptLine(leadId: string, state: "accepted" | "failed" | "intent"): string {
  return `${JSON.stringify({
    v: 1,
    campaignId: RESERVATION_CAMPAIGN_ID,
    leadId,
    state,
    at: verifiedAt,
    firstIntentAt: verifiedAt,
    notion: "ok",
  })}\n`;
}

async function harness(input?: {
  email?: string;
  pages?: Page[];
  mutateAfterList?: (pages: Page[]) => void;
  stripe?: StripeApi;
  ledger?: string | null;
}) {
  const primary = pageFor("page-primary", PRIMARY_LEAD, input?.email ?? "fixture@example.com");
  const pages = input?.pages ?? [primary];
  const gets: string[] = [];
  let listed = false;
  const request: NotionRequest = async (method, path, body) => {
    if (method === "GET" && path.startsWith("databases/")) return { properties: pages[0]?.properties ?? {} };
    if (method === "GET" && path.startsWith("pages/")) {
      gets.push(path);
      const id = path.slice("pages/".length);
      const found = pages.find((item) => item.id === id);
      if (!found) throw new Error(`missing ${id}`);
      return found;
    }
    if (method === "POST") {
      const snapshot = structuredClone(pages);
      if (!listed) {
        listed = true;
        input?.mutateAfterList?.(pages);
      }
      return { results: snapshot, has_more: false };
    }
    if (method === "PATCH" && body && typeof body === "object" && "properties" in body) {
      const id = path.startsWith("pages/") ? path.slice("pages/".length) : "";
      const target = pages.find((item) => item.id === id) ?? pages[0];
      const properties = (body as { properties: Record<string, { rich_text?: Array<{ text?: { content?: string } }> }> }).properties;
      if (target) {
        for (const [key, value] of Object.entries(properties)) {
          target.properties[key] = rich(value.rich_text?.[0]?.text?.content ?? "");
        }
      }
      return target ?? pages[0];
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  const root = await mkdtemp(join(tmpdir(), "wd-drip-independent-"));
  const legacyReceiptDir = join(root, "legacy");
  await mkdir(legacyReceiptDir);
  const ledgerPath = join(legacyReceiptDir, `${RESERVATION_CAMPAIGN_ID}.jsonl`);
  if (input?.ledger === null) {
    // Missing file. The send gate must not create a fresh history.
  } else {
    await writeFile(ledgerPath, input?.ledger ?? receiptLine(OTHER_LEAD, "accepted"));
  }
  const messages: Array<{ idempotencyKey: string }> = [];
  const env = {
    ...TEST_ENV,
    WATCHDIVE_RESERVATION_TOKEN_SECRET: "fixture-reservation-secret-32characters",
    WATCHDIVE_RESERVATION_DRIP_ENABLED: "true",
    WATCHDIVE_RESERVATION_DRIP_APPROVED_COPY_SHA256: DRIP_COPY_HASH,
    WATCHDIVE_RESERVATION_DRIP_LEGACY_JOB_DISABLED: "true",
  };
  const deps = {
    env,
    request,
    databaseId: "db-independent",
    stripe: input?.stripe ?? stripeApi({}),
    now: () => new Date(NOW),
    liveGate: async () => ({ ok: true as const }),
    send: async (message: { idempotencyKey: string }) => {
      messages.push(message);
    },
  };
  const options = {
    mode: "send" as const,
    legacyReceiptDir,
    dripReceiptDir: join(root, "drip"),
    notBefore: verifiedAt,
  };
  return { pages, primary, gets, messages, deps, options, ledgerPath };
}

test("paid or complete checkout holds even when product metadata is empty or foreign", async () => {
  for (const metadata of [{}, { product: "old_offer" }, { product: "watchdive_reservation_fee" }]) {
    const run = await harness({
      stripe: stripeApi({
        customers: [{ id: "cus_same", email: "fixture@example.com", metadata: {} }],
        sessions: [{ livemode: true, metadata, paymentStatus: "paid", status: "complete" }],
      }),
    });
    const result = await runReservationDrip(run.options, run.deps);
    assert.equal(result.aborted, undefined);
    assert.equal(run.messages.length, 0, JSON.stringify(metadata));
  }
});

test("an unpaid expired live session with empty metadata can still send D0", async () => {
  const run = await harness({
    stripe: stripeApi({
      customers: [{ id: "cus_same", email: "fixture@example.com", metadata: {} }],
      sessions: [{ livemode: true, metadata: {}, paymentStatus: "unpaid", status: "expired" }],
    }),
  });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
  assert.equal(run.messages[0]?.idempotencyKey.endsWith("-d1"), false);
});

test("a checkout that stays complete after refund still holds, with no refund API", async () => {
  let refundCalls = 0;
  const stripe = stripeApi({
    customers: [{ id: "cus_same", email: "fixture@example.com", metadata: {} }],
    sessions: [{ livemode: true, metadata: {}, paymentStatus: "paid", status: "complete" }],
  }) as StripeApi & { listRefunds?: () => Promise<unknown> };
  stripe.listRefunds = async () => {
    refundCalls += 1;
    return [];
  };
  assert.equal(await stripeAllowsDrip(stripe, "fixture@example.com"), false);
  assert.equal(refundCalls, 0);
});

test("empty, blank, corrupt, foreign, and missing ledgers refuse before any send", async () => {
  const cases: Array<{ name: string; ledger: string | null }> = [
    { name: "empty", ledger: "" },
    { name: "blank", ledger: " \n\n" },
    { name: "corrupt", ledger: `${receiptLine(OTHER_LEAD, "accepted")}{not-json\n` },
    {
      name: "foreign",
      ledger: `${receiptLine(OTHER_LEAD, "accepted")}${JSON.stringify({
        v: 1,
        campaignId: "some-other-campaign",
        leadId: OTHER_LEAD,
        state: "accepted",
        at: verifiedAt,
        firstIntentAt: verifiedAt,
        notion: "ok",
      })}\n`,
    },
    { name: "missing", ledger: null },
  ];
  for (const item of cases) {
    const run = await harness({ ledger: item.ledger });
    if (item.ledger === null) await unlink(run.ledgerPath).catch(() => undefined);
    const result = await runReservationDrip(run.options, run.deps);
    assert.equal(result.aborted, "existing_d0_receipt_ledger_required", item.name);
    assert.equal(run.messages.length, 0, item.name);
  }
});

test("one parseable same-campaign receipt lets D0 proceed", async () => {
  const run = await harness({ ledger: receiptLine(OTHER_LEAD, "accepted") });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
});

test("a ledger of only a failed receipt is not an empty-ledger refusal", async () => {
  const run = await harness({ ledger: receiptLine(OTHER_LEAD, "failed") });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
});

test("one clock tick cannot emit all four stages", async () => {
  const run = await harness();
  run.deps.now = () => new Date(NOW + 10 * DAY);
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(result.stages?.length, 4);
  assert.equal(run.messages.length, 1);
  assert.equal(run.messages[0]?.idempotencyKey.includes("-d1"), false);
});

test("a real failed marker and a real hold marker stop the later stages", async () => {
  const failed = await harness();
  failed.primary.properties[DRIP_FIELD.d0] = rich(failedMarker("transport_error", new Date(NOW - DAY)));
  await runReservationDrip(failed.options, failed.deps);
  assert.equal(failed.messages.length, 0);

  const held = await harness();
  held.primary.properties[DRIP_FIELD.d0] = rich(holdMarker("unknown_outcome", new Date(NOW - DAY)));
  await runReservationDrip(held.options, held.deps);
  assert.equal(held.messages.length, 0);
});

test("unsubscribe on a sibling already known at list time blocks the send", async () => {
  const primary = pageFor("page-primary", PRIMARY_LEAD, "a.b+one@gmail.com");
  const sibling = pageFor("page-sibling", SIBLING_LEAD, "ab+two@googlemail.com");
  const run = await harness({
    pages: [primary, sibling],
    mutateAfterList: () => {
      sibling.properties["Launch mail"] = rich("unsubscribed");
    },
  });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 0);
  assert.ok(run.gets.some((path) => path === "pages/page-sibling"));
});

test("an alias created after listRows is invisible and the send still happens", async () => {
  const primary = pageFor("page-primary", PRIMARY_LEAD, "a.b+one@gmail.com");
  const sibling = pageFor("page-late", SIBLING_LEAD, "ab+two@googlemail.com");
  sibling.properties["Launch mail"] = rich("unsubscribed");
  const run = await harness({
    pages: [primary],
    mutateAfterList: (pages) => {
      pages.push(sibling);
    },
  });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
  assert.equal(run.gets.includes("pages/page-late"), false);
  assert.equal(textOf(sibling, "Launch mail"), "unsubscribed");
});

test("a payment under a different Stripe email is not visible to the Notion address", async () => {
  const queried: string[] = [];
  const run = await harness({
    stripe: stripeApi({
      onEmail: (email) => {
        queried.push(email);
        if (email === "payer@other.example") {
          return [{ id: "cus_payer", email: "payer@other.example", metadata: {} }];
        }
        return [];
      },
      sessions: [{ livemode: true, metadata: {}, paymentStatus: "paid", status: "complete" }],
    }),
  });
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
  assert.equal(queried.includes("payer@other.example"), false);
});

test("unsubscribe inside the provider callback is after the last recheck", async () => {
  const run = await harness();
  const original = run.deps.send;
  run.deps.send = async (message) => {
    run.primary.properties["Launch mail"] = rich("unsubscribed");
    await original(message);
  };
  const result = await runReservationDrip(run.options, run.deps);
  assert.equal(result.aborted, undefined);
  assert.equal(run.messages.length, 1);
  assert.equal(textOf(run.primary, "Launch mail"), "unsubscribed");
});
