import { createHash } from 'node:crypto';
import type { StripeApi, StripeCheckoutSession } from './stripeApi.ts';
import { reservationCanonicalEmail } from './emailIdentity.ts';
import { META_EMAIL_SHA256 } from './constants.ts';
export const DIRECT_FLOW = 'stripe_email_v1';
export const directHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function isDirectSession(session: StripeCheckoutSession): boolean {
  return session.metadata.entry_flow === DIRECT_FLOW && /^[a-f0-9]{64}$/.test(session.metadata.browser_proof ?? '') && !session.metadata[META_EMAIL_SHA256];
}
// Stripe collects this address. This is payment association, NOT email ownership verification.
export async function bindDirectSession(stripe: StripeApi, session: StripeCheckoutSession): Promise<StripeCheckoutSession | null> {
  if (!isDirectSession(session) || !session.customerId) return null;
  const customer = await stripe.retrieveCustomer(session.customerId);
  if (!customer.email) return null;
  const hash = directHash(`reservation-email:v1:${reservationCanonicalEmail(customer.email)}`);
  return { ...session, clientReferenceId: hash, metadata: { ...session.metadata, [META_EMAIL_SHA256]: hash } };
}
