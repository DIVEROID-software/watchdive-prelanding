// Contract correction 2026-10-26. B includes an unverified unpaid signup.
// measurementWithdrawn (withdrawal or denial) and unsubscribe block platform
// upload and payment ads. The signup remains an internal acquisition exclusion.
// A refund, dispute, Notion paid flag, success URL, or unknown snapshot holds
// payment ads and payment drip and does not prove D.
// The full failure matrix is tests/retargeting-audience-review.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyAudience,
  classifyBrowserVisitor,
  paidDripSuppressed,
  type AudiencePayment,
  type AudiencePerson,
} from "../src/lib/retargeting/audience.ts";
import { retargetingExportSql } from "../src/lib/retargeting/exportSql.ts";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/locale.ts";

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
  amountCents: 300,
  currency: "usd",
});

test("B, C, and D follow the current Stripe snapshot, including refunds and repeat visits", () => {
  const unpaid = classifyAudience(person());
  assert.deepEqual(unpaid.labels, ["C", "B"]);
  assert.equal(unpaid.acquisitionExclusion, true);
  assert.equal(unpaid.paymentRetargeting, true);
  assert.equal(unpaid.paidSuppression, false);
  assert.equal(paidDripSuppressed(person()), false);
  assert.deepEqual(classifyAudience(person()), unpaid);

  const open = classifyAudience(
    person({ payment: payment({ evidence: "stripe_inspection", status: "open" }) }),
  );
  assert.equal(open.paymentRetargeting, true);
  assert.equal(open.paidSuppression, false);

  const pendingSignup = classifyAudience(person({ verified: false }));
  assert.deepEqual(pendingSignup.labels, ["C", "B"]);
  assert.equal(pendingSignup.paymentRetargeting, true);
  assert.equal(pendingSignup.reservationEmailEligible, false);
  assert.equal(pendingSignup.verified, false);

  const paid = classifyAudience(person({ payment: cleanPaid }));
  assert.deepEqual(paid.labels, ["C", "D"]);
  assert.equal(paid.paymentRetargeting, false);
  assert.equal(paid.dripReason, "paid");
  assert.equal(paidDripSuppressed(person({ payment: cleanPaid })), true);

  const refunded = classifyAudience(
    person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "refunded",
        paid: false,
        amountCents: 300,
        currency: "usd",
        refundedCents: 300,
      }),
    }),
  );
  assert.equal(refunded.paidSuppression, false);
  assert.equal(refunded.paymentAdsSuppressed, true);
  assert.equal(refunded.paymentRetargeting, false);
  assert.equal(refunded.paymentHold, true);
  assert.equal(refunded.dripReason, "payment_hold");
  assert.equal(refunded.labels.includes("D"), false);
  assert.equal(
    paidDripSuppressed(
      person({
        payment: payment({
          evidence: "stripe_inspection",
          status: "refunded",
          refundedCents: 300,
          amountCents: 300,
          currency: "usd",
        }),
      }),
    ),
    true,
  );

  for (const status of ["partially_refunded", "refund_pending", "disputed", "invalid"] as const) {
    const decision = classifyAudience(
      person({
        payment: payment({
          evidence: "stripe_inspection",
          status,
          paid: false,
          amountCents: 300,
          currency: "usd",
          refundedCents: status === "partially_refunded" ? 100 : 0,
          refundPendingCents: status === "refund_pending" ? 300 : 0,
          disputed: status === "disputed",
        }),
      }),
    );
    assert.equal(decision.paidSuppression, false, status);
    assert.equal(decision.paymentAdsSuppressed, true, status);
    assert.equal(decision.paymentRetargeting, false, status);
    assert.equal(decision.paymentHold, true, status);
    assert.equal(decision.dripReason, "payment_hold", status);
    assert.equal(
      paidDripSuppressed(
        person({
          payment: decision.paymentHold
            ? payment({
                evidence: "stripe_inspection",
                status,
                paid: false,
                amountCents: 300,
                currency: "usd",
                refundedCents: status === "partially_refunded" ? 100 : 0,
                refundPendingCents: status === "refund_pending" ? 300 : 0,
                disputed: status === "disputed",
              })
            : payment(),
        }),
      ),
      true,
      status,
    );
  }

  const notion = classifyAudience(
    person({
      payment: payment({
        evidence: "notion_paid_flag",
        status: "paid",
        paid: true,
        amountCents: 300,
        currency: "usd",
      }),
    }),
  );
  assert.equal(notion.paidSuppression, false);
  assert.equal(notion.paymentHold, true);
  assert.equal(notion.paymentRetargeting, false);
  assert.equal(notion.verified, true);
  assert.equal(
    paidDripSuppressed(
      person({ payment: payment({ evidence: "notion_paid_flag", status: "paid", paid: true }) }),
    ),
    true,
  );

  const success = classifyAudience(
    person({
      verified: false,
      payment: payment({ evidence: "success_url", status: "paid", paid: true }),
    }),
  );
  assert.equal(success.labels.includes("D"), false);
  assert.equal(success.paymentHold, true);
  assert.equal(success.verified, false);
  assert.equal(success.dripReason, "payment_hold");
  assert.equal(
    paidDripSuppressed(
      person({ payment: payment({ evidence: "success_url", status: "paid", paid: true }) }),
    ),
    true,
  );

  const unsubscribed = classifyAudience(person({ unsubscribed: true }));
  assert.equal(unsubscribed.acquisitionExclusion, true);
  assert.equal(unsubscribed.upload, false);
  assert.equal(unsubscribed.paymentRetargeting, false);
  assert.equal(unsubscribed.internalUnpaidSignup, true);

  const withdrawn = classifyAudience(person({ measurementWithdrawn: true, verified: false }));
  assert.equal(withdrawn.acquisitionExclusion, true);
  assert.equal(withdrawn.upload, false);
  assert.equal(withdrawn.paymentRetargeting, false);
  assert.equal(withdrawn.labels.includes("B"), true);
  assert.equal(withdrawn.verified, false);

  const abuse = classifyAudience(person({ abusive: true }));
  assert.equal(abuse.upload, false);
  assert.equal(abuse.acquisitionExclusion, false);
  assert.deepEqual(classifyAudience(person({ suspect: true })).labels, ["excluded"]);
  assert.equal(classifyAudience(person({ duplicateRow: true })).upload, false);
  assert.equal(classifyAudience(person({ durableSignup: false })).upload, false);
});

test("A and A1 stay browser audiences and locales do not invent a verified signup", () => {
  assert.equal(classifyBrowserVisitor({ durableSignup: false, formStarted: false }), "A");
  assert.equal(classifyBrowserVisitor({ durableSignup: false, formStarted: true }), "A1");
  assert.equal(classifyBrowserVisitor({ durableSignup: true, formStarted: true }), null);
  for (const locale of SUPPORTED_LOCALES) {
    const decision = classifyAudience(person({ signupLocale: locale, verified: false }));
    assert.equal(decision.signupLocale, locale);
    assert.equal(decision.verified, false);
    assert.equal(decision.paymentRetargeting, true);
    assert.equal(decision.reservationEmailEligible, false);
  }
  assert.equal(
    classifyAudience(person({ signupLocale: "fr-FR", verified: false })).signupLocale,
    null,
  );
});

test("the export SQL matches the classifier on the audience matrix", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec(retargetingExportSql());
  const insert = db.prepare(`INSERT INTO retargeting_signup_snapshot (
    person_key, signup_locale, durable_signup, verified, duplicate_row, abusive, suspect, unsubscribed,
    measurement_withdrawn,
    payment_evidence, payment_status, paid, amount_cents, currency, refunded_cents, refund_pending_cents, disputed
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const rows: AudiencePerson[] = [
    person(),
    person({ verified: false, signupLocale: "zh-CN" }),
    person({ payment: cleanPaid, signupLocale: "de" }),
    person({
      payment: payment({
        evidence: "stripe_inspection",
        status: "refunded",
        amountCents: 300,
        currency: "usd",
        refundedCents: 300,
      }),
      signupLocale: "zh-TW",
    }),
    person({
      payment: payment({
        evidence: "notion_paid_flag",
        status: "paid",
        paid: true,
        amountCents: 300,
        currency: "usd",
      }),
    }),
    person({ payment: payment({ evidence: "success_url", status: "paid", paid: true }) }),
    person({
      payment: payment({ evidence: "stripe_inspection", status: "open" }),
      signupLocale: "es",
    }),
    person({ unsubscribed: true }),
    person({ measurementWithdrawn: true, verified: false, signupLocale: "ja" }),
    person({ abusive: true }),
    person({ duplicateRow: true }),
    person({ durableSignup: false }),
  ];

  rows.forEach((row, index) => {
    const pay = row.payment;
    insert.run(
      `person-${index}`,
      row.signupLocale ?? null,
      row.durableSignup ? 1 : 0,
      row.verified ? 1 : 0,
      row.duplicateRow ? 1 : 0,
      row.abusive ? 1 : 0,
      row.suspect ? 1 : 0,
      row.unsubscribed ? 1 : 0,
      row.measurementWithdrawn ? 1 : 0,
      pay.evidence,
      pay.status,
      pay.paid ? 1 : 0,
      pay.amountCents,
      pay.currency,
      pay.refundedCents,
      pay.refundPendingCents,
      pay.disputed ? 1 : 0,
    );
    const decision = classifyAudience(row);
    const view = db
      .prepare(
        `SELECT platform_upload, segment_b, internal_b, segment_c, segment_d, payment_hold,
                payment_ads_suppressed, drip_suppress, reservation_mail_eligible, signup_locale
         FROM retargeting_audience WHERE person_key = ?`,
      )
      .get(`person-${index}`) as {
      platform_upload: number;
      segment_b: number;
      internal_b: number;
      segment_c: number;
      segment_d: number;
      payment_hold: number;
      payment_ads_suppressed: number;
      drip_suppress: number;
      reservation_mail_eligible: number;
      signup_locale: string | null;
    };
    assert.ok(view, `missing sql row ${index}`);
    assert.equal(view.platform_upload, decision.upload ? 1 : 0, `upload ${index}`);
    assert.equal(view.segment_c, decision.acquisitionExclusion ? 1 : 0, `C ${index}`);
    assert.equal(view.internal_b, decision.internalUnpaidSignup ? 1 : 0, `internal B ${index}`);
    assert.equal(view.segment_b, decision.paymentRetargeting ? 1 : 0, `B ${index}`);
    assert.equal(view.segment_d, decision.paidSuppression ? 1 : 0, `D ${index}`);
    assert.equal(view.payment_hold, decision.paymentHold ? 1 : 0, `hold ${index}`);
    assert.equal(
      view.payment_ads_suppressed,
      decision.paymentAdsSuppressed ? 1 : 0,
      `ads ${index}`,
    );
    assert.equal(view.drip_suppress, decision.dripSuppressed ? 1 : 0, `drip ${index}`);
    assert.equal(
      view.reservation_mail_eligible,
      decision.reservationEmailEligible ? 1 : 0,
      `mail ${index}`,
    );
    assert.equal(view.signup_locale, decision.signupLocale);
  });
  db.close();
});
