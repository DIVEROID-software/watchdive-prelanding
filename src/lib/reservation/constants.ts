// Commercial terms the user approved on 2026-10-18. These are the only
// charges and promises this module is allowed to encode. Do not add stock,
// ship dates, or benefit exclusions here.

/** Charged today. Additional to the later product price, not a credit toward it. */
export const RESERVATION_FEE_CENTS = 300;
export const RESERVATION_CURRENCY = "usd";

/** Later WatchDive product price. Not charged by reservation checkout. */
export const LATER_PRODUCT_PRICE_CENTS = 14_900;

/**
 * Fee plus later product price, before any shipping or tax that is stated
 * separately. This module never charges this sum.
 */
export const PRICE_BEFORE_SHIPPING_OR_TAX_CENTS =
  RESERVATION_FEE_CENTS + LATER_PRODUCT_PRICE_CENTS;

export const RESERVATION_OFFER_VERSION = "2026-10-18";
export const PRODUCT_CODE = "watchdive_reservation_fee";
export const FEE_POLICY = "additional_not_credited";
export const PRICE_GUARANTEE = "lowest_149_usd_100_percent";
export const REFUND_POLICY =
  "nonrefundable_except_launch_cancellation_or_mandatory_rights";

export const PRODUCT_NAME = "WatchDive reservation fee";
export const PRODUCT_DESCRIPTION =
  "USD 3 reservation fee. Additional to the later USD 149 price and not credited toward it. The USD 149 price is guaranteed to be the lowest. Nonrefundable except launch cancellation, subject to applicable mandatory rights.";

export const TERMS_VERSION = "2026-10-18";

export const META_PRODUCT = "product";
export const META_OFFER_VERSION = "offer_version";
export const META_EMAIL_SHA256 = "email_sha256";
export const META_FEE_CENTS = "fee_cents";
export const META_CURRENCY = "currency";
export const META_FEE_POLICY = "fee_policy";
export const META_LATER_PRICE_CENTS = "later_price_cents";
export const META_PRICE_GUARANTEE = "price_guarantee";
export const META_REFUND_POLICY = "refund_policy";
export const META_ACCEPTED_TERMS = "accepted_terms";
export const META_TERMS_VERSION = "terms_version";

/** Hosted Checkout pages are returned only from this host. */
export const CHECKOUT_HOST = "checkout.stripe.com";

export const CHECKOUT_PATH = "/api/reservation/checkout";
export const STATUS_PATH = "/api/reservation/status";
export const WEBHOOK_PATH = "/api/reservation/webhook";
export const SUCCESS_PATH = "/reservation?session_id={CHECKOUT_SESSION_ID}";
export const CANCEL_PATH = "/reservation?canceled=1";

/** Pinned so Checkout responses stay on the fields this client parses. */
export const STRIPE_API_VERSION = "2024-06-20";
export const STRIPE_API_BASE = "https://api.stripe.com";

export const ENV_RESERVATION_ENABLED = "WATCHDIVE_RESERVATION_ENABLED";
export const ENV_RESERVATION_ALLOW_LIVE = "WATCHDIVE_RESERVATION_ALLOW_LIVE";
export const ENV_STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY";
export const ENV_STRIPE_WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET";
export const ENV_RESERVATION_TOKEN_SECRET = "WATCHDIVE_RESERVATION_TOKEN_SECRET";
export const ENV_PUBLIC_ORIGIN = "WATCHDIVE_PUBLIC_ORIGIN";

export const RESERVATION_INVITE_PURPOSE = "reservation-invite:v1";
