import assert from "node:assert/strict";
import { test } from "node:test";

import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";
import {
  classifyAudience,
  classifyBrowserVisitor,
  paidDripSuppressed,
  type AudienceDecision,
  type AudiencePayment,
  type AudiencePerson,
} from "../src/lib/retargeting/audience.ts";
import { retargetingExportSql } from "../src/lib/retargeting/exportSql.ts";
import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../src/lib/reservation/constants.ts";
import type { PurchaseEvidence } from "../src/lib/retargeting/events.ts";

function payment(over: Partial<AudiencePayment> = {}): AudiencePayment {
  return {
    evidence: "none",
    status: "none",
    paid: false,
    amountCents: null,
    currency: null,
    refundedCents: 0,
    refundPendingCents: 0,
    disputed: false,
    ...over,
  };
}

function person(over: Partial<AudiencePerson> = {}): AudiencePerson {
  return {
    durableSignup: true,
    verified: true,
    duplicateRow: false,
    abusive: false,
    suspect: false,
    unsubscribed: false,
    measurementWithdrawn: false,
    signupLocale: "en",
    payment: payment(),
    ...over,
  };
}

const cleanPaid = payment({
  evidence: "stripe_inspection",
  status: "paid",
  paid: true,
  amountCents: RESERVATION_FEE_CENTS,
  currency: RESERVATION_CURRENCY.toUpperCase(),
});

type Expectation = {
  name: string;
  row: AudiencePerson;
  labels: AudienceDecision["labels"];
  upload: boolean;
  acquisitionExclusion: boolean;
  internalUnpaidSignup: boolean;
  paymentRetargeting: boolean;
  paidSuppression: boolean;
  paymentAdsSuppressed: boolean;
  paymentHold: boolean;
  dripSuppressed: boolean;
  dripReason: AudienceDecision["dripReason"];
  reservationEmailEligible: boolean;
  verified: boolean;
};

const cases: Expectation[] = [
  {
    name: "unverified unpaid",
    row: person({ verified: false }),
    labels: ["C", "B"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: true,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "verified unpaid",
    row: person(),
    labels: ["C", "B"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: true,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: true,
    verified: true,
  },
  {
    name: "verified open checkout",
    row: person({ payment: payment({ evidence: "stripe_inspection", status: "open" }) }),
    labels: ["C", "B"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: true,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: true,
    verified: true,
  },
  {
    name: "clean paid",
    row: person({ payment: cleanPaid }),
    labels: ["C", "D"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: true,
    paymentAdsSuppressed: true,
    paymentHold: false,
    dripSuppressed: true,
    dripReason: "paid",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "clean paid does not verify an unverified signup",
    row: person({ verified: false, payment: cleanPaid }),
    labels: ["C", "D"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: true,
    paymentAdsSuppressed: true,
    paymentHold: false,
    dripSuppressed: true,
    dripReason: "paid",
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "refunded",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "refunded",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
        refundedCents: RESERVATION_FEE_CENTS,
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "partial refund",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "partially_refunded",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
        refundedCents: 100,
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "refund pending",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "refund_pending",
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
        refundPendingCents: RESERVATION_FEE_CENTS,
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "disputed",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "disputed",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
        disputed: true,
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "invalid stripe snapshot",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "invalid",
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "historical stripe status",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "expired",
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "wrong amount",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "paid",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS - 1,
        currency: "usd",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "wrong currency",
    row: person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "paid",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "eur",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "notion paid flag",
    row: person({
      verified: false,
      payment: payment({
        evidence: "notion_paid_flag",
        status: "paid",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "success url",
    row: person({
      verified: false,
      payment: payment({ evidence: "success_url", status: "paid", paid: true }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "unknown payment evidence",
    row: person({
      payment: payment({
        evidence: "ledger_note" as PurchaseEvidence,
        status: "paid",
        paid: true,
        amountCents: RESERVATION_FEE_CENTS,
        currency: "usd",
      }),
    }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "unknown unpaid status",
    row: person({ payment: payment({ status: "processing" }) }),
    labels: ["C", "payment_hold"],
    upload: true,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: true,
    paymentHold: true,
    dripSuppressed: true,
    dripReason: "payment_hold",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "measurement withdrawal",
    row: person({ verified: false, measurementWithdrawn: true }),
    labels: ["C", "B"],
    upload: false,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "measurement denial on a verified unpaid signup",
    row: person({ measurementWithdrawn: true }),
    labels: ["C", "B"],
    upload: false,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: true,
    verified: true,
  },
  {
    name: "unsubscribed",
    row: person({ unsubscribed: true }),
    labels: ["C", "B"],
    upload: false,
    acquisitionExclusion: true,
    internalUnpaidSignup: true,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "withdrawn clean paid",
    row: person({ measurementWithdrawn: true, unsubscribed: true, payment: cleanPaid }),
    labels: ["C", "D"],
    upload: false,
    acquisitionExclusion: true,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: true,
    paymentAdsSuppressed: true,
    paymentHold: false,
    dripSuppressed: true,
    dripReason: "paid",
    reservationEmailEligible: false,
    verified: true,
  },
  {
    name: "duplicate unpaid",
    row: person({ duplicateRow: true, verified: false }),
    labels: ["excluded"],
    upload: false,
    acquisitionExclusion: false,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "duplicate clean paid",
    row: person({ duplicateRow: true, payment: cleanPaid }),
    labels: ["excluded"],
    upload: false,
    acquisitionExclusion: false,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "abusive",
    row: person({ abusive: true }),
    labels: ["excluded"],
    upload: false,
    acquisitionExclusion: false,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "suspect",
    row: person({ suspect: true }),
    labels: ["excluded"],
    upload: false,
    acquisitionExclusion: false,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
  {
    name: "no durable signup",
    row: person({ durableSignup: false, verified: false }),
    labels: [],
    upload: false,
    acquisitionExclusion: false,
    internalUnpaidSignup: false,
    paymentRetargeting: false,
    paidSuppression: false,
    paymentAdsSuppressed: false,
    paymentHold: false,
    dripSuppressed: false,
    dripReason: null,
    reservationEmailEligible: false,
    verified: false,
  },
];

function assertDecision(spec: Expectation): AudienceDecision {
  const decision = classifyAudience(spec.row);
  assert.deepEqual(classifyAudience(spec.row), decision, `${spec.name} stable`);
  assert.deepEqual(decision.labels, spec.labels, spec.name);
  assert.equal(decision.upload, spec.upload, `${spec.name} upload`);
  assert.equal(decision.acquisitionExclusion, spec.acquisitionExclusion, `${spec.name} C`);
  assert.equal(decision.internalUnpaidSignup, spec.internalUnpaidSignup, `${spec.name} internal B`);
  assert.equal(decision.paymentRetargeting, spec.paymentRetargeting, `${spec.name} payment ads`);
  assert.equal(decision.paidSuppression, spec.paidSuppression, `${spec.name} D`);
  assert.equal(
    decision.paymentAdsSuppressed,
    spec.paymentAdsSuppressed,
    `${spec.name} ad suppress`,
  );
  assert.equal(decision.paymentHold, spec.paymentHold, `${spec.name} hold`);
  assert.equal(decision.dripSuppressed, spec.dripSuppressed, `${spec.name} drip`);
  assert.equal(decision.dripReason, spec.dripReason, `${spec.name} drip reason`);
  assert.equal(
    decision.reservationEmailEligible,
    spec.reservationEmailEligible,
    `${spec.name} reservation hint`,
  );
  assert.equal(decision.verified, spec.verified, `${spec.name} verified`);
  assert.equal(paidDripSuppressed(spec.row), spec.dripSuppressed, `${spec.name} helper`);
  if (!decision.upload)
    assert.equal(decision.paymentRetargeting, false, `${spec.name} blocked ads`);
  if (decision.paymentRetargeting) {
    assert.equal(decision.upload, true, spec.name);
    assert.equal(decision.internalUnpaidSignup, true, spec.name);
    assert.equal(decision.labels.includes("B"), true, spec.name);
  }
  if (decision.labels.includes("D")) {
    assert.equal(decision.paidSuppression, true, spec.name);
    assert.equal(decision.paymentHold, false, spec.name);
    assert.equal(decision.dripReason, "paid", spec.name);
    assert.equal(spec.row.payment.evidence, "stripe_inspection", spec.name);
  }
  if (decision.paymentHold) {
    assert.equal(decision.labels.includes("D"), false, spec.name);
    assert.equal(decision.paidSuppression, false, spec.name);
    assert.equal(decision.dripReason, "payment_hold", spec.name);
    assert.equal(decision.paymentRetargeting, false, spec.name);
    assert.equal(paidDripSuppressed(spec.row), true, spec.name);
  }
  if (decision.reservationEmailEligible) {
    assert.equal(decision.verified, true, spec.name);
    assert.equal(decision.internalUnpaidSignup, true, spec.name);
    assert.equal(spec.row.unsubscribed, false, spec.name);
  }
  if (decision.acquisitionExclusion) {
    assert.equal(decision.labels[0], "C", spec.name);
    assert.equal(decision.labels.length, 2, spec.name);
  }
  return decision;
}

test("audience projection keeps signup facts and blocks unsafe upload", () => {
  assert.equal(cases.length >= 20, true);
  const names = new Set(cases.map((spec) => spec.name));
  assert.equal(names.size, cases.length);
  for (const spec of cases) assertDecision(spec);
});

test("locales stay on an unverified unpaid signup and do not verify it", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const decision = classifyAudience(person({ signupLocale: locale, verified: false }));
    assert.equal(decision.signupLocale, locale);
    assert.equal(decision.verified, false);
    assert.equal(decision.internalUnpaidSignup, true);
    assert.equal(decision.paymentRetargeting, true);
    assert.equal(decision.reservationEmailEligible, false);
  }
  assert.equal(
    classifyAudience(person({ signupLocale: "fr-FR", verified: false })).signupLocale,
    null,
  );
  assert.equal(classifyBrowserVisitor({ durableSignup: false, formStarted: false }), "A");
  assert.equal(classifyBrowserVisitor({ durableSignup: false, formStarted: true }), "A1");
  assert.equal(classifyBrowserVisitor({ durableSignup: true, formStarted: true }), null);
});

test("the projection plan matches the classifier in memory and writes no customer file", async () => {
  const sql = retargetingExportSql();
  assert.equal(/\bemail\b/i.test(sql), false);
  assert.match(sql, /DO NOT RUN AGAINST PRODUCTION/);
  assert.match(sql, /DO NOT UPLOAD/);
  assert.match(sql, /platform_upload/);
  assert.match(sql, /measurement_withdrawn/);
  assert.doesNotMatch(sql, /notion\.so|api\.stripe\.com|graph\.facebook\.com/i);
  for (const locale of SUPPORTED_LOCALES) assert.match(sql, new RegExp(locale.replace("-", "\\-")));

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  const insert = db.prepare(`INSERT INTO retargeting_signup_snapshot (
    person_key, signup_locale, durable_signup, verified, duplicate_row, abusive, suspect,
    unsubscribed, measurement_withdrawn, payment_evidence, payment_status, paid, amount_cents,
    currency, refunded_cents, refund_pending_cents, disputed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const read = db.prepare(`SELECT platform_upload, segment_c, internal_b, segment_b, segment_d,
      verified_signup, payment_hold, payment_ads_suppressed, drip_suppress, reservation_mail_eligible,
      signup_locale
    FROM retargeting_audience WHERE person_key = ?`);

  cases.forEach((spec, index) => {
    const decision = assertDecision(spec);
    const pay = spec.row.payment;
    const key = `case-${index}`;
    insert.run(
      key,
      spec.row.signupLocale ?? null,
      spec.row.durableSignup ? 1 : 0,
      spec.row.verified ? 1 : 0,
      spec.row.duplicateRow ? 1 : 0,
      spec.row.abusive ? 1 : 0,
      spec.row.suspect ? 1 : 0,
      spec.row.unsubscribed ? 1 : 0,
      spec.row.measurementWithdrawn ? 1 : 0,
      pay.evidence,
      pay.status,
      pay.paid ? 1 : 0,
      pay.amountCents,
      pay.currency,
      pay.refundedCents,
      pay.refundPendingCents,
      pay.disputed ? 1 : 0,
    );
    const view = read.get(key) as {
      platform_upload: number;
      segment_c: number;
      internal_b: number;
      segment_b: number;
      segment_d: number;
      verified_signup: number;
      payment_hold: number;
      payment_ads_suppressed: number;
      drip_suppress: number;
      reservation_mail_eligible: number;
      signup_locale: string | null;
    };
    assert.ok(view, spec.name);
    assert.equal(view.platform_upload, decision.upload ? 1 : 0, spec.name);
    assert.equal(view.segment_c, decision.acquisitionExclusion ? 1 : 0, spec.name);
    assert.equal(view.internal_b, decision.internalUnpaidSignup ? 1 : 0, spec.name);
    assert.equal(view.segment_b, decision.paymentRetargeting ? 1 : 0, spec.name);
    assert.equal(view.segment_d, decision.paidSuppression ? 1 : 0, spec.name);
    assert.equal(view.verified_signup, decision.verified ? 1 : 0, spec.name);
    assert.equal(view.payment_hold, decision.paymentHold ? 1 : 0, spec.name);
    assert.equal(view.payment_ads_suppressed, decision.paymentAdsSuppressed ? 1 : 0, spec.name);
    assert.equal(view.drip_suppress, decision.dripSuppressed ? 1 : 0, spec.name);
    assert.equal(
      view.reservation_mail_eligible,
      decision.reservationEmailEligible ? 1 : 0,
      spec.name,
    );
    assert.equal(view.signup_locale, decision.signupLocale, spec.name);
  });
  db.close();
});
