/**
 * Display amounts for the reservation page.
 *
 * The numbers and the fee policy come from the backend reservation constants.
 * The USD $3.00 fee is charged now and is additional. It is not credited
 * toward, and it does not reduce, the later USD $149.00 product price.
 * USD $152.00 is their sum before shipping and tax. Those amounts are not stated.
 * The client never sends an amount.
 */
import {
  FEE_POLICY,
  LATER_PRODUCT_PRICE_CENTS,
  PRICE_BEFORE_SHIPPING_OR_TAX_CENTS,
  RESERVATION_FEE_CENTS,
} from "../../lib/reservation/constants.ts";

export const RESERVATION_FEE_USD_CENTS = RESERVATION_FEE_CENTS;
export const PRODUCT_PRICE_USD_CENTS = LATER_PRODUCT_PRICE_CENTS;
export const TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS = PRICE_BEFORE_SHIPPING_OR_TAX_CENTS;

/** Hosted Stripe Checkout charges this once. It is the reservation fee, in cents. */
export const STRIPE_CHECKOUT_USD_CENTS = RESERVATION_FEE_USD_CENTS;

/** The fee is not a credit, deposit, or discount against the product price. */
export const RESERVATION_FEE_IS_CREDITED = false as const;

export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("USD cents must be a non-negative integer");
  }
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `USD $${whole}.${fraction}`;
}

export function assertReservationPricing(): void {
  if (FEE_POLICY !== "additional_not_credited" || RESERVATION_FEE_IS_CREDITED) {
    throw new Error("The reservation fee must not be credited toward the product price");
  }
  if (STRIPE_CHECKOUT_USD_CENTS !== RESERVATION_FEE_USD_CENTS) {
    throw new Error("Stripe must charge the reservation fee, not the product price");
  }
  if (RESERVATION_FEE_USD_CENTS + PRODUCT_PRICE_USD_CENTS !== TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS) {
    throw new Error("The displayed total must be the fee plus the product price");
  }
}

export const RESERVATION_FEE_USD = formatUsd(RESERVATION_FEE_USD_CENTS);
export const PRODUCT_PRICE_USD = formatUsd(PRODUCT_PRICE_USD_CENTS);
export const TOTAL_BEFORE_SHIPPING_TAX_USD = formatUsd(TOTAL_BEFORE_SHIPPING_TAX_USD_CENTS);

assertReservationPricing();
