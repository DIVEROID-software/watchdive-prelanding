import { reservationCanonicalEmail } from "../reservation/emailIdentity.ts";
import type { StripeApi } from "../reservation/stripeApi.ts";

/** Read-only preflight. Any paid reservation, including subsequently refunded
 * or disputed ones, ends this acquisition drip. Unknown state holds. */
export async function stripeAllowsDrip(stripe: StripeApi, email: string): Promise<boolean> {
  const canonical = reservationCanonicalEmail(email);
  const addresses = [...new Set([email.trim().toLowerCase(), canonical])];
  const customers = new Map<string, Awaited<ReturnType<StripeApi["retrieveCustomer"]>>>();
  for (const address of addresses) for (const customer of await stripe.listCustomersByEmail(address)) customers.set(customer.id, customer);
  for (const customer of customers.values()) {
    if (!customer.email || reservationCanonicalEmail(customer.email) !== canonical) return false;
    for (const session of await stripe.listCheckoutSessions({ customerId: customer.id })) {
      if (!session.livemode) return false;
      // Treat any completed/paid checkout on the same account as a hold, even
      // if legacy product metadata is missing or changed. Checkout remains
      // complete after refund/dispute; acquisition must not restart then.
      // An unrelated completed product is conservatively held for review.
      if (session.paymentStatus === "paid" || session.status === "complete") return false;
    }
  }
  return true;
}
