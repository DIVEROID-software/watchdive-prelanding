// The signing key stays in Vercel. Office is the only caller and owns durable
// claims before HTTP dispatch; a timeout is held for reconciliation, not retried.
// No file system persistence or raw address/token logging in this function.
import { createHash } from "node:crypto";
import { canonicalEmail } from "../../api/abuse.ts";
import { createNotionLeadStore, createNotionRequest } from "../../verification/notionLead.ts";
import { createResendMailer } from "../../verification/resend.ts";
import { requestVerificationService } from "../../verification/service.ts";
import { reminderSkipReason } from "../../verification/reminder.ts";
import { confirmNativeIntent, configurationClosed, type ConfirmationDeps, type ConfirmationResult } from "./adapter.ts";
import { authenticateConfirmation, memoryNonces } from "./auth.ts";
import { SIGNATURE_HEADER, MARKET_LOCALE } from "./constants.ts";
import { confirmationGate } from "./gate.ts";
import { memoryLedger } from "./ledger.ts";
import { NATIVE_FORMS, NATIVE_NOT_BEFORE } from "./registry.ts";
import { writeNativeAttribution } from "./attribution.ts";
import { confirmationIdempotencyKey } from "./intent.ts";

const ledger = memoryLedger();
const nonces = memoryNonces();
const qaNonces = memoryNonces();
const HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };

export function buildRelayDeps(env: NodeJS.ProcessEnv): ConfirmationDeps {
  const request = createNotionRequest(fetch, env);
  return {
    env: { ...env, INSTANT_FORM_CONFIRMATION_DRY_RUN: "0", INSTANT_FORM_PROSPECTIVE_NOT_BEFORE: NATIVE_NOT_BEFORE },
    now: () => new Date(), allowlist: NATIVE_FORMS,
    store: createNotionLeadStore(request, env.NOTION_WAITLIST_DB_ID ?? ""),
    mailer: createResendMailer(env), requestVerification: requestVerificationService,
    writeAttribution: (pageId, properties) => writeNativeAttribution(request, pageId, properties),
    reminderSkipReason, ledger, nonces, sleep: async () => undefined,
  };
}

function response(result: ConfirmationResult): Response {
  return Response.json(result, { status: result.http, headers: HEADERS });
}

// Explicit owner fixture, no fabricated Meta lead/ad IDs or paid acquisition.
// A private exact-recipient hash and a short fixed QA window gate this path.
async function ownerQa(raw: string, signature: string | null, body: Record<string, unknown>, deps: ConfirmationDeps): Promise<Response> {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const hash = createHash("sha256").update(email).digest("hex");
  if (deps.now().getTime() > Date.parse("2026-10-30T00:00:00Z") ||
      hash !== deps.env.INSTANT_FORM_OWNER_QA_HASH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !Object.values(MARKET_LOCALE).includes(body.locale as never)) return response(configurationClosed("qa_closed", 403));
  const auth = authenticateConfirmation(signature, raw, deps.env.INSTANT_FORM_CONFIRMATION_SECRET ?? "", deps.now().getTime(), qaNonces);
  if (!auth.ok) return response(configurationClosed(auth.error, 401));
  const canonical = canonicalEmail(email);
  const key = confirmationIdempotencyKey(canonical);
  let existing;
  try { existing = await deps.store.findByEmail(canonical, email); }
  catch { return response(configurationClosed("lookup_failed", 503)); }
  if (existing) return response({ ...configurationClosed("duplicate", 200), ok: true, error: undefined, outcome: "accepted", idempotency_key: key });
  let calls = 0;
  let failed = false;
  await deps.requestVerification({
    email, canonical, source: "instant-form", flags: [], suspect: true,
    measurementConsent: false, networkSendBlocked: false,
    locale: body.locale as "nl", signupLocale: body.locale as "nl", signupMethod: "email",
    attribution: { utmSource: "owner_qa", utmMedium: "test", utmCampaign: "instant_form_qa_20261030", landingPath: "/nl/scuba" },
    nativeConfirmationKey: key,
  }, {
    store: deps.store, env: deps.env, now: deps.now, sleep: deps.sleep,
    mailer: { sendWelcome: async () => { throw new Error("qa_no_welcome"); }, send: async (input) => { try { await deps.mailer.send(input); calls += 1; } catch { failed = true; throw new Error("mail_failed"); } } },
    compatibilityEnabled: false,
    dispatchVerifiedLead: async () => false, dispatchSubmitLead: async () => false,
    dispatchGoogleVerified: async () => undefined, dispatchDurableMeasurement: async () => undefined,
  });
  const sent = calls === 1 && !failed;
  return response({ ...configurationClosed(sent ? "confirmation_requested" : "mail_failed", 200),
    ok: sent, error: sent ? undefined : "mail_failed", outcome: sent ? "accepted" : "unknown", idempotency_key: key,
    mail_provider_sends: sent ? 1 : 0, mail_sent: sent, side_effects: true,
  });
}

export async function handleNativeConfirmation(request: Request, env: NodeJS.ProcessEnv = process.env, injected?: ConfirmationDeps): Promise<Response> {
  const deps = injected ?? buildRelayDeps(env);
  if (confirmationGate(deps.env, deps.allowlist).length || !env.RESEND_API_KEY || !env.NOTION_API_KEY || !env.NOTION_WAITLIST_DB_ID) {
    return response(configurationClosed());
  }
  if (Number(request.headers.get("content-length")) > 8192) return response(configurationClosed("bad_body", 413));
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 8192) return response(configurationClosed("bad_body", 413));
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return response(configurationClosed("bad_body", 400)); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(configurationClosed("bad_body", 400));
  const signature = request.headers.get(SIGNATURE_HEADER);
  try {
    if (body.qa === true) return await ownerQa(raw, signature, body, deps);
    // Corrected forms collect EMAIL only. One consent permits one confirmation.
    if (body.resend !== false || body.phone_present !== false || body.sms_consent_claimed !== false ||
        typeof body.submitted_at !== "string") return response(configurationClosed("bad_body", 400));
    return response(await confirmNativeIntent(raw, signature, deps));
  } catch {
    // Could have created a row or submitted mail: caller must reconcile it.
    return response(configurationClosed("unknown_outcome", 503));
  }
}
