// In-memory Stripe API: no fetch and no real credentials.
import type {
  StripeApi,
  StripeCheckoutSession,
  StripeCustomer,
} from "../../src/lib/reservation/stripeApi.ts";
import { contractMetadata, reservationEmailHash } from "../../src/lib/reservation/checkout.ts";

export class ReservationStripeFake implements StripeApi {
  customers: StripeCustomer[] = [];
  sessions: StripeCheckoutSession[] = [];
  params: Record<string, string>[] = [];
  keys: string[] = [];
  ids = new Map<string, StripeCheckoutSession>();
  nowMs: number;
  constructor(nowMs: number) {
    this.nowMs = nowMs;
  }
  async listCustomersByEmail(email: string) {
    return this.customers.filter((c) => c.email === email);
  }
  async createCustomer(input: { email: string; metadata: Record<string, string> }) {
    const prior = this.customers.find((c) => c.email === input.email);
    if (prior) return prior;
    const customer = { id: `cus_fake${this.customers.length + 1}`, ...input };
    this.customers.push(customer);
    return customer;
  }
  async retrieveCustomer(id: string) {
    const row = this.customers.find((c) => c.id === id);
    if (!row) throw new Error("missing customer");
    return row;
  }
  async createCheckoutSession(params: Record<string, string>, key: string) {
    this.params.push(params);
    this.keys.push(key);
    const prior = this.ids.get(key);
    if (prior) return prior;
    const metadata: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
      const match = /^metadata\[(.+)\]$/.exec(name);
      if (match) metadata[match[1]] = value;
    }
    const id = `cs_test_fake${this.sessions.length + 1}`;
    const session: StripeCheckoutSession = {
      id,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      status: "open",
      paymentStatus: "unpaid",
      amountTotal: 300,
      currency: "usd",
      mode: "payment",
      metadata,
      clientReferenceId: params.client_reference_id,
      customerId: params.customer,
      paymentIntentId: null,
      expiresAt: Math.floor(this.nowMs / 1000) + 3600,
      created: Math.floor(this.nowMs / 1000),
      livemode: false,
      successUrl: params.success_url,
      consentCollectionTermsOfService: params["consent_collection[terms_of_service]"],
      consentTermsOfService: null,
    };
    this.sessions.push(session);
    this.ids.set(key, session);
    return session;
  }
  async retrieveCheckoutSession(id: string) {
    const row = this.sessions.find((s) => s.id === id);
    if (!row) throw new Error("missing session");
    return row;
  }
  async listCheckoutSessions(filter: { customerId?: string; paymentIntentId?: string }) {
    return this.sessions.filter(
      (s) =>
        (!filter.customerId || s.customerId === filter.customerId) &&
        (!filter.paymentIntentId || s.paymentIntentId === filter.paymentIntentId),
    );
  }
  async expireCheckoutSession(id: string) {
    const row = await this.retrieveCheckoutSession(id);
    row.status = "expired";
    return row;
  }
  async listLineItems() {
    return [{ quantity: 1, currency: "usd", amountTotal: 300, unitAmount: 300, recurring: false }];
  }
  async retrievePaymentIntent(id: string) {
    return {
      id,
      amount: 300,
      currency: "usd",
      status: "succeeded",
      metadata: {},
      latestChargeId: "ch_fake",
    };
  }
  async retrieveCharge(id: string) {
    return {
      id,
      amount: 300,
      amountRefunded: 0,
      currency: "usd",
      refunded: false,
      disputed: false,
      paymentIntentId: "pi_fake",
      created: Math.floor(this.nowMs / 1000),
    };
  }
  async listRefunds() {
    return [];
  }
  async listDisputes() {
    return [];
  }
  async seedPaid(email: string) {
    const customer = await this.createCustomer({ email, metadata: {} });
    const session = await this.createCheckoutSession(
      {
        customer: customer.id,
        client_reference_id: reservationEmailHash(email),
        success_url: "https://watchdive.diveroid.com/reservation?session_id={CHECKOUT_SESSION_ID}",
        ...Object.fromEntries(
          Object.entries(contractMetadata({ emailSha256: reservationEmailHash(email) })).map(
            ([key, value]) => [`metadata[${key}]`, value],
          ),
        ),
      },
      "paid-fixture",
    );
    session.status = "complete";
    session.paymentStatus = "paid";
    session.paymentIntentId = "pi_fake";
    return session;
  }
}
