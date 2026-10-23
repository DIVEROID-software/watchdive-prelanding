// Minimal Stripe REST client. No Stripe SDK: package.json is unchanged.
// Amounts used for a paid decision are always values this client retrieved,
// never a webhook JSON body and never a browser query string.
import { STRIPE_API_BASE, STRIPE_API_VERSION } from "./constants.ts";

export class StripeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, type: string, requestId: string | null) {
    super(`Stripe request failed (${status}${code ? `: ${code}` : ""})`);
    this.name = "StripeApiError";
    this.status = status;
    this.code = code;
    this.type = type;
    this.requestId = requestId;
  }
}

export function isIdempotencyConflict(error: unknown): boolean {
  return (
    error instanceof StripeApiError &&
    (error.type === "idempotency_error" || error.code === "idempotency_key_in_use")
  );
}

export type StripeMetadata = Record<string, string>;

export type StripeCustomer = {
  id: string;
  email: string | null;
  metadata: StripeMetadata;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  amountTotal: number | null;
  currency: string | null;
  mode: string;
  metadata: StripeMetadata;
  clientReferenceId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  expiresAt: number;
  created: number;
  livemode: boolean;
  successUrl: string | null;
  consentTermsOfService?: string | null;
  consentCollectionTermsOfService?: string | null;
};

export type StripeLineItem = {
  quantity: number;
  currency: string;
  amountTotal: number;
  unitAmount: number | null;
  recurring: boolean;
};

export type StripePaymentIntent = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata: StripeMetadata;
  latestChargeId: string | null;
};

export type StripeCharge = {
  id: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  refunded: boolean;
  /** Stripe always returns this boolean. A missing value is refused by the parser. */
  disputed: boolean;
  paymentIntentId: string | null;
  /**
   * Charge.created, seconds. Null when the retrieved object omits it.
   * This is not Checkout Session.created.
   */
  created: number | null;
};

export type StripeDispute = {
  id: string;
  status: string;
  amount: number;
  currency: string;
};

export type StripeRefund = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

export type StripeApi = {
  listCustomersByEmail(email: string): Promise<StripeCustomer[]>;
  createCustomer(
    input: { email: string; metadata: StripeMetadata },
    idempotencyKey: string,
  ): Promise<StripeCustomer>;
  retrieveCustomer(id: string): Promise<StripeCustomer>;
  createCheckoutSession(
    params: Record<string, string>,
    idempotencyKey: string,
  ): Promise<StripeCheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  listCheckoutSessions(filter: {
    customerId?: string;
    paymentIntentId?: string;
  }): Promise<StripeCheckoutSession[]>;
  expireCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  listLineItems(sessionId: string): Promise<StripeLineItem[]>;
  retrievePaymentIntent(id: string): Promise<StripePaymentIntent>;
  retrieveCharge(id: string): Promise<StripeCharge>;
  listRefunds(chargeId: string): Promise<StripeRefund[]>;
  listDisputes(chargeId: string): Promise<StripeDispute[]>;
};

const LIST_PAGE_LIMIT = 10;

function unexpected(what: string): never {
  throw new StripeApiError(502, "unexpected_shape", what, null);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) unexpected(what);
  return value as Record<string, unknown>;
}

function asMetadata(value: unknown): StripeMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: StripeMetadata = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    const id = (value as { id: string }).id;
    return id.length > 0 ? id : null;
  }
  return null;
}

function requiredString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) unexpected(what);
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string, what: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") unexpected(what);
  return value;
}

function requiredInt(record: Record<string, unknown>, key: string, what: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) unexpected(what);
  return value;
}

function optionalInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseCustomer(value: unknown): StripeCustomer {
  const record = asRecord(value, "customer");
  return {
    id: requiredString(record, "id", "customer.id"),
    email: typeof record.email === "string" ? record.email : null,
    metadata: asMetadata(record.metadata),
  };
}

function parseSession(value: unknown): StripeCheckoutSession {
  const record = asRecord(value, "checkout.session");
  const status = record.status;
  if (status !== "open" && status !== "complete" && status !== "expired") {
    unexpected("checkout.session.status");
  }
  const paymentStatus = record.payment_status;
  if (
    paymentStatus !== "paid" &&
    paymentStatus !== "unpaid" &&
    paymentStatus !== "no_payment_required"
  ) {
    unexpected("checkout.session.payment_status");
  }
  const amountTotal = record.amount_total;
  if (amountTotal !== null && (typeof amountTotal !== "number" || !Number.isInteger(amountTotal))) {
    unexpected("checkout.session.amount_total");
  }
  return {
    consentTermsOfService:
      typeof (record.consent as { terms_of_service?: unknown } | null)?.terms_of_service ===
      "string"
        ? (record.consent as { terms_of_service: string }).terms_of_service
        : null,
    consentCollectionTermsOfService:
      typeof (record.consent_collection as { terms_of_service?: unknown } | null)
        ?.terms_of_service === "string"
        ? (record.consent_collection as { terms_of_service: string }).terms_of_service
        : null,
    id: requiredString(record, "id", "checkout.session.id"),
    url: typeof record.url === "string" ? record.url : null,
    status,
    paymentStatus,
    amountTotal: amountTotal === null ? null : amountTotal,
    currency: typeof record.currency === "string" ? record.currency : null,
    mode: typeof record.mode === "string" ? record.mode : "",
    metadata: asMetadata(record.metadata),
    clientReferenceId:
      typeof record.client_reference_id === "string" ? record.client_reference_id : null,
    customerId: idOf(record.customer),
    paymentIntentId: idOf(record.payment_intent),
    expiresAt: requiredInt(record, "expires_at", "checkout.session.expires_at"),
    created: requiredInt(record, "created", "checkout.session.created"),
    livemode: requiredBoolean(record, "livemode", "checkout.session.livemode"),
    successUrl: typeof record.success_url === "string" ? record.success_url : null,
  };
}

function parseLineItem(value: unknown): StripeLineItem {
  const record = asRecord(value, "line_item");
  const price = record.price;
  const priceRecord = price && typeof price === "object" ? (price as Record<string, unknown>) : {};
  const unit = priceRecord.unit_amount;
  return {
    quantity: requiredInt(record, "quantity", "line_item.quantity"),
    currency: typeof record.currency === "string" ? record.currency : "",
    amountTotal: requiredInt(record, "amount_total", "line_item.amount_total"),
    unitAmount: typeof unit === "number" && Number.isInteger(unit) ? unit : null,
    recurring:
      priceRecord.type === "recurring" ||
      (priceRecord.recurring != null && priceRecord.type !== "one_time"),
  };
}

function parsePaymentIntent(value: unknown): StripePaymentIntent {
  const record = asRecord(value, "payment_intent");
  return {
    id: requiredString(record, "id", "payment_intent.id"),
    amount: requiredInt(record, "amount", "payment_intent.amount"),
    currency: requiredString(record, "currency", "payment_intent.currency"),
    status: typeof record.status === "string" ? record.status : "",
    metadata: asMetadata(record.metadata),
    latestChargeId: idOf(record.latest_charge),
  };
}

function parseCharge(value: unknown): StripeCharge {
  const record = asRecord(value, "charge");
  return {
    id: requiredString(record, "id", "charge.id"),
    amount: requiredInt(record, "amount", "charge.amount"),
    amountRefunded: requiredInt(record, "amount_refunded", "charge.amount_refunded"),
    currency: requiredString(record, "currency", "charge.currency"),
    refunded: requiredBoolean(record, "refunded", "charge.refunded"),
    disputed: requiredBoolean(record, "disputed", "charge.disputed"),
    paymentIntentId: idOf(record.payment_intent),
    created: optionalInt(record.created),
  };
}

function parseDispute(value: unknown): StripeDispute {
  const record = asRecord(value, "dispute");
  return {
    id: requiredString(record, "id", "dispute.id"),
    status: typeof record.status === "string" ? record.status : "",
    amount: requiredInt(record, "amount", "dispute.amount"),
    currency: requiredString(record, "currency", "dispute.currency"),
  };
}

function parseRefund(value: unknown): StripeRefund {
  const record = asRecord(value, "refund");
  return {
    id: requiredString(record, "id", "refund.id"),
    amount: requiredInt(record, "amount", "refund.amount"),
    currency: requiredString(record, "currency", "refund.currency"),
    status: typeof record.status === "string" ? record.status : "",
  };
}

function formBody(params: Record<string, string>): string {
  const encoded = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    encoded.set(key, params[key] ?? "");
  }
  return encoded.toString();
}

async function readList<T>(
  request: (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>,
  path: string,
  base: Record<string, string>,
  parse: (value: unknown) => T,
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter = "";
  for (let page = 0; page < LIST_PAGE_LIMIT; page += 1) {
    const params: Record<string, string> = { ...base, limit: "100" };
    if (startingAfter) params.starting_after = startingAfter;
    const body = await request(path, params);
    const data = body.data;
    if (!Array.isArray(data)) unexpected("list.data");
    const parsed = data.map(parse);
    out.push(...parsed);
    const hasMore = body.has_more === true;
    if (!hasMore || parsed.length === 0) return out;
    const last = data[data.length - 1] as { id?: unknown };
    if (typeof last?.id !== "string" || last.id.length === 0) unexpected("list.id");
    startingAfter = last.id;
  }
  throw new StripeApiError(502, "list_truncated", "list", null);
}

export function createStripeClient(options: {
  secretKey: string;
  fetchImpl?: typeof fetch;
  allowLive?: boolean;
}): StripeApi {
  const secretKey = options.secretKey;
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    if (options.allowLive !== true) {
      throw new StripeApiError(403, "live_key_refused", "config", null);
    }
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  async function call(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, STRIPE_API_BASE);
    const headers = new Headers({
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    });
    let body: string | undefined;
    if (method === "GET") {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    } else {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = formBody(params);
    }
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    if (!response.ok) {
      const errorRecord =
        parsed && typeof parsed === "object" && "error" in parsed
          ? (parsed as { error?: { code?: unknown; type?: unknown } }).error
          : undefined;
      const code = typeof errorRecord?.code === "string" ? errorRecord.code : "";
      const type = typeof errorRecord?.type === "string" ? errorRecord.type : "";
      throw new StripeApiError(response.status, code, type, response.headers.get("request-id"));
    }
    return asRecord(parsed, "response");
  }

  const getList = (path: string, params: Record<string, string>) => call("GET", path, params);

  return {
    listCustomersByEmail(email) {
      return readList(getList, "/v1/customers", { email }, parseCustomer);
    },
    async createCustomer(input, idempotencyKey) {
      const params: Record<string, string> = { email: input.email };
      for (const [key, value] of Object.entries(input.metadata)) {
        params[`metadata[${key}]`] = value;
      }
      return parseCustomer(await call("POST", "/v1/customers", params, idempotencyKey));
    },
    async retrieveCustomer(id) {
      return parseCustomer(await call("GET", `/v1/customers/${encodeURIComponent(id)}`, {}));
    },
    async createCheckoutSession(params, idempotencyKey) {
      return parseSession(await call("POST", "/v1/checkout/sessions", params, idempotencyKey));
    },
    async retrieveCheckoutSession(id) {
      return parseSession(await call("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, {}));
    },
    listCheckoutSessions(filter) {
      const params: Record<string, string> = {};
      if (filter.customerId) params.customer = filter.customerId;
      if (filter.paymentIntentId) params.payment_intent = filter.paymentIntentId;
      return readList(getList, "/v1/checkout/sessions", params, parseSession);
    },
    async expireCheckoutSession(id) {
      return parseSession(
        await call("POST", `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}),
      );
    },
    listLineItems(sessionId) {
      return readList(
        getList,
        `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items`,
        {},
        parseLineItem,
      );
    },
    async retrievePaymentIntent(id) {
      return parsePaymentIntent(
        await call("GET", `/v1/payment_intents/${encodeURIComponent(id)}`, {}),
      );
    },
    async retrieveCharge(id) {
      return parseCharge(await call("GET", `/v1/charges/${encodeURIComponent(id)}`, {}));
    },
    listRefunds(chargeId) {
      return readList(getList, "/v1/refunds", { charge: chargeId }, parseRefund);
    },
    listDisputes(chargeId) {
      return readList(getList, "/v1/disputes", { charge: chargeId }, parseDispute);
    },
  };
}
