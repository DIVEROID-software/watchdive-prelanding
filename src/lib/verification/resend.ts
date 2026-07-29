// Direct Resend HTTP client. No SDK, so nothing can drag an API key into a
// client bundle: this module is only ever reached from a server function.
//
// Delivery is one transactional message to one recipient. It is never batched,
// never a campaign, and carries no list state.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { verificationUrl } from "./token.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

// Resend answers a request with no User-Agent with 403 code 1010. A fixed
// product string satisfies it and says nothing about the caller.
const USER_AGENT = "watchdive-prelanding/1.0";

/**
 * Two different 409s share one status. `concurrent_idempotent_requests` means
 * an identical request is still in flight and the same key may be retried;
 * `invalid_idempotent_request` means the key was reused with a different
 * payload and must never be retried. Anything else is treated as terminal.
 */
const RETRYABLE_CONFLICT = "concurrent_idempotent_requests";

export type ResendEnvironment = {
  RESEND_API_KEY?: string;
  WATCHDIVE_EMAIL_FROM?: string;
  WATCHDIVE_EMAIL_REPLY_TO?: string;
};

export type ResendConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
};

export type VerificationMail = {
  to: string;
  token: string;
  leadId: string;
  publicOrigin: string;
};

export type VerificationMailer = {
  send(input: VerificationMail): Promise<void>;
};

export function readResendConfig(env: ResendEnvironment = process.env): ResendConfig {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const from = (env.WATCHDIVE_EMAIL_FROM ?? "").trim();
  if (!from) throw new Error("WATCHDIVE_EMAIL_FROM is not set");
  const replyTo = (env.WATCHDIVE_EMAIL_REPLY_TO ?? "").trim();
  return { apiKey, from, ...(replyTo ? { replyTo } : {}) };
}

export class ResendDeliveryError extends Error {
  // Written out rather than as a constructor parameter property: `npm test`
  // runs under Node's type stripping, which rejects that syntax.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ResendDeliveryError";
    this.status = status;
  }
}

// 429, 5xx and transport faults are worth another attempt with the same
// idempotency key. A 4xx is a rejected address or our own bug, and retrying it
// only spends rate limit.
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Reads only the error code out of a bounded slice of the body. The body can
 * echo the recipient address, so it is never logged and never surfaced — the
 * one field consulted is matched against a fixed string.
 */
export async function isRetryableConflict(response: Response): Promise<boolean> {
  let raw: string;
  try {
    raw = (await response.text()).slice(0, 2048);
  } catch {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const name = (parsed as { name?: unknown } | null)?.name;
    return name === RETRYABLE_CONFLICT;
  } catch {
    // Unparseable conflict: fail closed and do not retry.
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Copy stays deliberately neutral. `docs/01-product-truth.md` still lists the
// price and conditions as unconfirmed, and the referral policy is unapproved,
// so a brand-new surface must not assert either. Confirming an email is the
// only thing this message is about.
function body(url: string): { text: string; html: string } {
  const safeUrl = escapeHtml(url);
  return {
    text: [
      "Confirm your Watch Dive waitlist email.",
      "",
      "Open this link to confirm:",
      url,
      "",
      "The link expires in 24 hours.",
      "If you did not request this, ignore this email — nothing will happen.",
    ].join("\n"),
    html: [
      '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px">',
      '<h1 style="font-size:20px;margin:0 0 12px">Confirm your Watch Dive waitlist email</h1>',
      '<p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 24px">',
      "Press the button below to confirm this address for Watch Dive pre-launch updates.",
      "</p>",
      `<p style="margin:0 0 24px"><a href="${safeUrl}" rel="noreferrer noopener" `,
      'style="display:inline-block;background:#0ea5e9;color:#04121f;font-weight:600;',
      'font-size:16px;padding:14px 28px;border-radius:12px;text-decoration:none">',
      "Confirm my email</a></p>",
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 8px">',
      "If the button does not work, paste this into your browser:<br>",
      `<span style="word-break:break-all">${safeUrl}</span>`,
      "</p>",
      '<p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">',
      "The link expires in 24 hours. ",
      "If you did not request this, ignore this email — nothing will happen.",
      "</p>",
      "</div>",
    ].join(""),
  };
}

export function createResendMailer(
  env: ResendEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): VerificationMailer {
  const config = readResendConfig(env);

  return {
    async send({ to, token, leadId, publicOrigin }) {
      const url = verificationUrl(publicOrigin, token);
      const content = body(url);
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let response: Response;
        try {
          response = await fetchImpl(RESEND_ENDPOINT, {
            method: "POST",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              "User-Agent": USER_AGENT,
              // Ties every retry of one attempt to one message. A new attempt
              // mints a new lead id, so a resend is a genuinely new key.
              "Idempotency-Key": `watchdive-verification-${leadId}`,
            },
            body: JSON.stringify({
              from: config.from,
              to: [to],
              ...(config.replyTo ? { reply_to: config.replyTo } : {}),
              subject: "Confirm your Watch Dive waitlist email",
              text: content.text,
              html: content.html,
            }),
          });
        } catch {
          // Transport fault: no status to reason about, so treat as retryable
          // and never echo the cause, which can carry the recipient address.
          lastError = new ResendDeliveryError("Resend request failed", 0);
          if (attempt < MAX_ATTEMPTS) {
            await sleep(200 * attempt);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          const error = new ResendDeliveryError(
            `Resend delivery failed (${response.status})`,
            response.status,
          );
          // A conflict is retryable only when Resend says the identical request
          // is still in flight; the same key and payload go back out.
          const conflictRetryable =
            response.status === 409 ? await isRetryableConflict(response) : false;
          if ((retryable(response.status) || conflictRetryable) && attempt < MAX_ATTEMPTS) {
            lastError = error;
            await sleep(200 * attempt);
            continue;
          }
          throw error;
        }

        // A 2xx without a usable message id is not an accepted send. Trusting
        // it would let the flow report a delivery that may never have happened.
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new ResendDeliveryError("Resend returned an unreadable success", response.status);
        }
        const id = (payload as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || !/^[A-Za-z0-9._~-]{1,256}$/.test(id)) {
          throw new ResendDeliveryError("Resend returned a malformed success", response.status);
        }
        return;
      }

      throw lastError ?? new ResendDeliveryError("Resend request failed", 0);
    },
  };
}
