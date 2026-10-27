// Local projection plan only. Do not run this against Notion, Stripe, or a customer file.
// The predicates match classifyAudience in audience.ts. The statement has no address column.

import { RESERVATION_CURRENCY, RESERVATION_FEE_CENTS } from "../reservation/constants.ts";

const FEE = String(RESERVATION_FEE_CENTS);
const CURRENCY = RESERVATION_CURRENCY;

export function retargetingExportSql(): string {
  return `-- WatchDive retargeting audience projection ${"retargeting-events-20261026"}
-- DO NOT RUN AGAINST PRODUCTION. DO NOT UPLOAD THE RESULT.
-- Local projection plan only. The caller fills non-PII columns.
-- person_key is a hash. signup_locale is one of the nine landing locales or null.
-- payment_evidence: stripe_inspection | notion_paid_flag | success_url | none
-- platform_upload 0 stays out of every customer file.
-- segment_b is payment-ad eligibility and requires platform_upload.
-- internal_b is the unpaid signup fact and can remain 1 when upload is 0.
-- segment_d is a clean Stripe USD 3 only. payment_hold never proves a purchase.
-- drip_suppress stops payment solicitation for segment_d and payment_hold.
-- reservation_mail_eligible is not a send. Measurement refusal is not an input there.
-- A and A1 are browser audiences and have no row here.

CREATE TABLE IF NOT EXISTS retargeting_signup_snapshot (
  person_key TEXT PRIMARY KEY,
  signup_locale TEXT,
  durable_signup INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  duplicate_row INTEGER NOT NULL,
  abusive INTEGER NOT NULL,
  suspect INTEGER NOT NULL,
  unsubscribed INTEGER NOT NULL,
  measurement_withdrawn INTEGER NOT NULL,
  payment_evidence TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  paid INTEGER NOT NULL,
  amount_cents INTEGER,
  currency TEXT,
  refunded_cents INTEGER NOT NULL,
  refund_pending_cents INTEGER NOT NULL,
  disputed INTEGER NOT NULL
);

CREATE VIEW IF NOT EXISTS retargeting_audience AS
WITH facts AS (
  SELECT
    person_key,
    CASE
      WHEN signup_locale IN ('en','ko','zh-CN','zh-TW','ja','es','fr','de','pt-BR') THEN signup_locale
      ELSE NULL
    END AS signup_locale,
    CASE
      WHEN durable_signup = 1 AND abusive = 0 AND suspect = 0 AND duplicate_row = 0 THEN 1
      ELSE 0
    END AS canonical,
    CASE WHEN verified = 1 THEN 1 ELSE 0 END AS verified_row,
    CASE WHEN unsubscribed = 1 THEN 1 ELSE 0 END AS unsubscribed_row,
    CASE WHEN measurement_withdrawn = 1 THEN 1 ELSE 0 END AS withdrawn_row,
    CASE
      WHEN payment_evidence = 'stripe_inspection' AND payment_status = 'paid' AND paid = 1
        AND amount_cents = ${FEE} AND lower(coalesce(currency, '')) = '${CURRENCY}'
        AND refunded_cents = 0 AND refund_pending_cents = 0 AND disputed = 0
      THEN 1
      ELSE 0
    END AS clean_paid,
    CASE
      WHEN paid = 0 AND disputed = 0 AND refunded_cents = 0 AND refund_pending_cents = 0
        AND (
          (payment_evidence = 'none' AND payment_status IN ('none', 'unpaid'))
          OR (payment_evidence = 'stripe_inspection' AND payment_status IN ('unpaid', 'open'))
        )
      THEN 1
      ELSE 0
    END AS clear_unpaid
  FROM retargeting_signup_snapshot
)
SELECT
  person_key,
  signup_locale,
  CASE
    WHEN canonical = 1 AND unsubscribed_row = 0 AND withdrawn_row = 0 THEN 1
    ELSE 0
  END AS platform_upload,
  canonical AS segment_c,
  CASE WHEN canonical = 1 AND clear_unpaid = 1 THEN 1 ELSE 0 END AS internal_b,
  CASE
    WHEN canonical = 1 AND clear_unpaid = 1 AND unsubscribed_row = 0 AND withdrawn_row = 0 THEN 1
    ELSE 0
  END AS segment_b,
  CASE WHEN canonical = 1 AND clean_paid = 1 THEN 1 ELSE 0 END AS segment_d,
  CASE WHEN canonical = 1 AND verified_row = 1 THEN 1 ELSE 0 END AS verified_signup,
  CASE
    WHEN canonical = 1 AND clean_paid = 0 AND clear_unpaid = 0 THEN 1
    ELSE 0
  END AS payment_hold,
  CASE WHEN canonical = 1 AND clear_unpaid = 0 THEN 1 ELSE 0 END AS payment_ads_suppressed,
  CASE WHEN canonical = 1 AND clear_unpaid = 0 THEN 1 ELSE 0 END AS drip_suppress,
  CASE
    WHEN canonical = 1 AND clear_unpaid = 1 AND verified_row = 1 AND unsubscribed_row = 0 THEN 1
    ELSE 0
  END AS reservation_mail_eligible
FROM facts;
`;
}
