// Only the cron route imports this assembly. Signing keys stay on the server.
import { checkCronAuthorization } from "../verification/cronAuth.ts";
import { createNotionRequest, toLeadRecord } from "../verification/notionLead.ts";
import { buddyUnsubscribeUrl, deliver, readResendConfig } from "../verification/resend.ts";
import { requirePublicOrigin } from "../verification/token.ts";
import { REFERRAL_COLUMNS } from "./contract.ts";
import { runAnnounce, type AnnounceDeps, type AnnounceRow } from "./announce.ts";
import { REFERRAL_PROGRAM_ID, referralProgramEnabled } from "./program.ts";
import { referralSecret, rulesUrl, shareUrl, statusUrl } from "./statusToken.ts";

type Env = Record<string, string | undefined>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function createAnnounceDeps(env: Env, signal: AbortSignal, apply: boolean): Promise<AnnounceDeps> {
  const deadlineFetch: typeof fetch = (input, init) => {
    signal.throwIfAborted();
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
  };
  const request = createNotionRequest(deadlineFetch, env);
  const databaseId = env.NOTION_WAITLIST_DB_ID;
  if (!databaseId) throw new Error("configuration_missing");
  const origin = requirePublicOrigin(env);
  const secret = referralSecret(env);
  const config = apply ? readResendConfig(env) : undefined;
  const path = `databases/${encodeURIComponent(databaseId)}`;
  const schema = await request("GET", path);
  const properties = schema.properties as Record<string, { type?: string }> | undefined;
  if (properties?.[REFERRAL_COLUMNS.announce]?.type !== "rich_text") throw new Error("schema_missing");
  const rows: AnnounceRow[] = [];
  let cursor: string | undefined;
  // Never use a partial scan: a later page may contain an inbox's opt-out.
  for (let pageNumber = 0; ; pageNumber++) {
    signal.throwIfAborted();
    if (pageNumber >= 200) throw new Error("scan_limit");
    const page = await request("POST", `${path}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(page.results)) throw new Error("invalid_page");
    for (const raw of page.results as Record<string, unknown>[]) {
      const lead = toLeadRecord(raw);
      if (!lead) throw new Error("unreadable_row");
      const props = raw.properties as Record<string, { rich_text?: { plain_text?: string; text?: { content?: string } }[] }>;
      const marker = props?.[REFERRAL_COLUMNS.announce]?.rich_text ?? [];
      if (!Array.isArray(marker)) throw new Error("receipt_missing");
      rows.push({ ...lead, duplicate: Boolean(lead.duplicate), refCode: lead.refCode ?? "",
        announceMarker: marker.map((part) => part.plain_text ?? part.text?.content ?? "").join("") });
    }
    if (!page.has_more) break;
    if (typeof page.next_cursor !== "string" || page.next_cursor === cursor) throw new Error("invalid_cursor");
    cursor = page.next_cursor;
  }
  return {
    rows, env,
    mark: async (row, marker) => {
      await request("PATCH", `pages/${encodeURIComponent(row.pageId)}`, {
        properties: { [REFERRAL_COLUMNS.announce]: { rich_text: [{ text: { content: marker } }] } },
      });
      row.announceMarker = marker;
    },
    links: (row, locale) => ({
      share: shareUrl(origin, row.refCode), status: statusUrl(origin, row.refCode, locale, secret),
      rules: rulesUrl(origin, locale), unsubscribe: buddyUnsubscribeUrl(origin, row.leadId, locale, env),
    }),
    send: async (message) => {
      signal.throwIfAborted();
      await deliver(config!, deadlineFetch, (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        message.idempotencyKey, "referral_announce", {
          to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: message.headers,
        });
    },
  };
}

// Defense within one instance only; Notion is not CAS. The office caller also
// holds an operator lock. Never run callers on multiple hosts concurrently.
let running = false;
export async function handleReferralAnnounce(
  request: Request,
  env: Env = process.env,
  assemble: typeof createAnnounceDeps = createAnnounceDeps,
): Promise<Response> {
  const auth = checkCronAuthorization(request.headers.get("authorization"), env.WATCHDIVE_REMINDER_CRON_SECRET);
  if (auth !== "authorized") return json(auth === "not_configured" ? 503 : 401, { ok: false });
  if (!referralProgramEnabled(env)) return json(404, { ok: false });
  if (request.method !== "POST") return json(405, { ok: false });
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json(400, { ok: false });
    body = JSON.parse(raw);
  } catch { return json(400, { ok: false }); }
  if (!body || typeof body !== "object" || body.confirm !== REFERRAL_PROGRAM_ID) return json(400, { ok: false });
  const limit = body.limit ?? 20;
  if (typeof body.releasedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.releasedAt)
    || !Number.isFinite(Date.parse(body.releasedAt)) || !["dry-run", "apply"].includes(body.mode)
    || !Number.isInteger(limit) || limit < 1 || limit > 200
    || (body.only !== undefined && (typeof body.only !== "string" || body.only.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(body.only)))) return json(400, { ok: false });
  if (running) return json(409, { ok: false });
  running = true;
  const started = Date.now();
  try {
    const signal = AbortSignal.timeout(45_000);
    const deps = await assemble(env, signal, body.mode === "apply");
    signal.throwIfAborted();
    const result = await runAnnounce({ apply: body.mode === "apply", confirm: body.confirm,
      releasedAt: new Date(body.releasedAt), only: body.only, limit,
      budgetMs: Math.max(0, 35_000 - (Date.now() - started)) }, deps);
    return json(200, { ok: !result.aborted, ...result });
  } catch { return json(503, { ok: false }); }
  finally { running = false; }
}
