// One-off Buddy Invite announcement to people who verified BEFORE the program
// release (they never got the new welcome mail).
//
//   dry run (default):  node --experimental-strip-types --env-file=.env scripts/referral-announce.ts \
//                         --released-at 2026-11-01T00:00:00Z
//   self-test send:     ... --released-at <T> --only you@example.com --apply --confirm wd-buddy-invite-20261022
//   small batch:        ... --released-at <T> --limit 20 --apply --confirm wd-buddy-invite-20261022
//   the rest:           ... --released-at <T> --apply --confirm wd-buddy-invite-20261022
//
// --apply is refused unless WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1 AND --confirm
// equals the program id. Nothing is sent without the owner's final go-ahead.
// Batches are resumable: a durable receipt per send (no address inside) makes
// a re-run skip anyone already accepted, and an attempt with an unknown outcome
// is held, never replayed. Sends are sequential and rate limited.
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { optedOutAddresses, optOutAddressKey, rowOptedOut } from "../src/lib/referral/notices.ts";
import { REFERRAL_PROGRAM_ID, referralProgramEnabled } from "../src/lib/referral/program.ts";
import { DEFAULT_LOCALE, localeFromPathname, matchLocale, type Locale } from "../src/lib/i18n/locale.ts";
// The announcement IS the welcome guide: one renderer, one footer, one set of
// opt-out and Korean advertising rules (src/lib/verification/resend.ts).
import {
  buddyAdFooter,
  buddyGuideBody,
  buddyListUnsubscribeHeaders,
  koreanAdRulesApply,
  readSenderPhone,
} from "../src/lib/verification/resend.ts";
import { conversionBlocked } from "../src/lib/verification/contracts.ts";

export const ANNOUNCE_CAMPAIGN = `${REFERRAL_PROGRAM_ID}-announce`;

export type AnnounceRow = {
  pageId: string;
  leadId: string;
  email: string;
  status: string;
  emailVerified: boolean;
  suspect: boolean;
  duplicate: boolean;
  verifiedAt?: string;
  refCode: string;
  signupLocale?: string;
  landingPath?: string;
  /** Abuse flags on the row (`Flags`). */
  flags?: string[];
  /** Coarse signup country; `KR` applies the Korean advertising rules. */
  signupCountry?: string;
  /** Raw opt-out cells (`unsubscribed …` markers). */
  launchMail?: string;
  reservationMail?: string;
};

export type SkipReason =
  | "not_verified"
  | "unsubscribed"
  | "suspect"
  | "blocked_flag"
  | "duplicate"
  | "verified_after_release"
  | "verified_at_missing"
  | "no_ref_code"
  | "no_email"
  | "no_opt_out"
  | "unsubscribed_address"
  | "duplicate_address"
  | "not_selected";

/** Null means eligible. `ignoreRelease` is only for the --only self-test. */
export function announceSkipReason(
  row: AnnounceRow,
  releasedAt: Date,
  ignoreRelease = false,
): SkipReason | null {
  if (rowOptedOut(row)) return "unsubscribed";
  if (row.status !== "verified" || !row.emailVerified) return "not_verified";
  if (row.suspect) return "suspect";
  if (conversionBlocked(row.flags ?? [])) return "blocked_flag";
  if (row.duplicate) return "duplicate";
  if (!row.email.includes("@")) return "no_email";
  if (!/^[a-z0-9]{8}$/.test(row.refCode)) return "no_ref_code";
  // The opt-out link is signed over the Lead ID; without one, no compliant mail.
  if (!LEAD_ID.test(row.leadId)) return "no_opt_out";
  if (!ignoreRelease) {
    const at = Date.parse(row.verifiedAt ?? "");
    if (!Number.isFinite(at)) return "verified_at_missing";
    if (at >= releasedAt.getTime()) return "verified_after_release";
  }
  return null;
}

const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function announceKey(row: Pick<AnnounceRow, "leadId" | "pageId">, selfTest = false): string {
  return `${REFERRAL_PROGRAM_ID}-announce-${row.leadId || row.pageId}${selfTest ? "-selftest" : ""}`;
}

export function rowLocale(row: Pick<AnnounceRow, "signupLocale" | "landingPath">): Locale {
  return matchLocale(row.signupLocale) ?? (row.landingPath ? localeFromPathname(row.landingPath) : DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

export type AnnounceLinks = { share: string; status: string; rules: string; unsubscribe?: string };

/** Whether this row's mail falls under the Korean advertising rules. */
export function rowIsKorean(row: Pick<AnnounceRow, "signupCountry">, locale: Locale): boolean {
  return koreanAdRulesApply(locale, row.signupCountry);
}

/**
 * The welcome guide, byte for byte the renderer the new welcome mail uses.
 * Throws (nothing is sent) without an https unsubscribe link, or for a Korean
 * reader without WATCHDIVE_SENDER_PHONE.
 */
export function renderAnnouncement(
  locale: Locale,
  links: AnnounceLinks,
  options: { signupCountry?: string; env: Record<string, string | undefined> },
): { subject: string; html: string; text: string; headers: Record<string, string> } {
  const footer = buddyAdFooter({
    locale,
    signupCountry: options.signupCountry,
    unsubscribeUrl: links.unsubscribe,
    env: options.env,
  });
  const mail = buddyGuideBody(
    { shareUrl: links.share, statusUrl: links.status, rulesUrl: links.rules },
    locale,
    footer,
  );
  return { ...mail, headers: buddyListUnsubscribeHeaders(footer.unsubscribeUrl) };
}

// ---- receipts ---------------------------------------------------------------

type ReceiptState = "intent" | "accepted" | "failed";

function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

/** Resolve the JSONL ledger: last state per hashed key. */
export async function loadReceipts(file: string): Promise<Map<string, ReceiptState>> {
  const out = new Map<string, ReceiptState>();
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { k?: string; state?: ReceiptState };
      if (parsed.k && parsed.state) out.set(parsed.k, parsed.state);
    } catch {
      /* a torn last line is treated as absent; the key then counts as unsent or held via its intent */
    }
  }
  return out;
}

async function appendReceipt(file: string, k: string, state: ReceiptState, at: string, failure?: string): Promise<void> {
  const handle = await open(file, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify({ v: 1, campaign: ANNOUNCE_CAMPAIGN, k, state, at, ...(failure ? { failure } : {}) })}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// ---- run --------------------------------------------------------------------

export type AnnounceMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
};

export type AnnounceOptions = {
  apply: boolean;
  confirm?: string;
  releasedAt: Date;
  limit?: number;
  only?: string;
  ratePerSecond?: number;
  receiptDir: string;
};

export type AnnounceDeps = {
  rows: AnnounceRow[];
  env: Record<string, string | undefined>;
  links: (row: AnnounceRow, locale: Locale) => AnnounceLinks;
  send: (message: AnnounceMessage) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type AnnounceResult = {
  mode: "dry-run" | "send";
  aborted?:
    | "switch_off"
    | "confirm_missing"
    | "receipt_lock_held"
    | "invalid_input"
    | "sender_phone_missing";
  /** Queued Korean-rule recipients while WATCHDIVE_SENDER_PHONE is unset (send refused). */
  senderPhoneMissing?: number;
  rowsScanned: number;
  eligible: number;
  skipped: Partial<Record<SkipReason, number>>;
  byLocale: Partial<Record<Locale, number>>;
  alreadySent: number;
  heldUnresolved: number;
  planned: number;
  sent: number;
  failed: number;
  sample?: { to: string; subject: string; locale: Locale; textPreview: string };
};

export async function runAnnounce(options: AnnounceOptions, deps: AnnounceDeps): Promise<AnnounceResult> {
  const result: AnnounceResult = {
    mode: options.apply ? "send" : "dry-run",
    rowsScanned: deps.rows.length, eligible: 0, skipped: {}, byLocale: {},
    alreadySent: 0, heldUnresolved: 0, planned: 0, sent: 0, failed: 0,
  };
  if (options.apply) {
    if (!referralProgramEnabled(deps.env)) return { ...result, aborted: "switch_off" };
    if (options.confirm !== REFERRAL_PROGRAM_ID) return { ...result, aborted: "confirm_missing" };
  }
  const only = options.only?.trim().toLowerCase();
  const selfTest = Boolean(only);
  const queue: { row: AnnounceRow; locale: Locale; key: string }[] = [];
  // An opt-out on any row of an address holds every row of it.
  const optedOut = optedOutAddresses(deps.rows);
  // One announcement per address, not one per row of a repeat sign-up.
  const queuedAddresses = new Set<string>();
  for (const row of deps.rows) {
    if (only && row.email.trim().toLowerCase() !== only) {
      result.skipped.not_selected = (result.skipped.not_selected ?? 0) + 1;
      continue;
    }
    const why = announceSkipReason(row, options.releasedAt, selfTest);
    if (why) {
      result.skipped[why] = (result.skipped[why] ?? 0) + 1;
      continue;
    }
    if (optedOut.has(optOutAddressKey(row.email))) {
      result.skipped.unsubscribed_address = (result.skipped.unsubscribed_address ?? 0) + 1;
      continue;
    }
    if (queuedAddresses.has(optOutAddressKey(row.email))) {
      result.skipped.duplicate_address = (result.skipped.duplicate_address ?? 0) + 1;
      continue;
    }
    queuedAddresses.add(optOutAddressKey(row.email));
    const locale = rowLocale(row);
    result.eligible += 1;
    result.byLocale[locale] = (result.byLocale[locale] ?? 0) + 1;
    queue.push({ row, locale, key: announceKey(row, selfTest) });
  }

  // Korean advertising mail must name a sender phone. Refuse the whole run
  // before any send rather than mail part of the list non-compliant.
  const phoneMissing = readSenderPhone(deps.env)
    ? 0
    : queue.filter((item) => rowIsKorean(item.row, item.locale)).length;
  if (phoneMissing > 0) {
    result.senderPhoneMissing = phoneMissing;
    if (options.apply) return { ...result, aborted: "sender_phone_missing" };
  }

  const file = join(options.receiptDir, `${ANNOUNCE_CAMPAIGN}.jsonl`);
  const lock = join(options.receiptDir, `${ANNOUNCE_CAMPAIGN}.lock`);
  let locked = false;
  if (options.apply) {
    await mkdir(options.receiptDir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      locked = true;
    } catch {
      return { ...result, aborted: "receipt_lock_held" };
    }
  }
  try {
    const receipts = await loadReceipts(file);
    const todo: typeof queue = [];
    for (const item of queue) {
      const state = receipts.get(keyHash(item.key));
      if (state === "accepted") result.alreadySent += 1;
      else if (state === "intent") result.heldUnresolved += 1; // outcome unknown: never replayed
      else todo.push(item);
    }
    const batch = options.limit !== undefined ? todo.slice(0, Math.max(0, options.limit)) : todo;
    result.planned = batch.length;

    // Dry-run sample: the first recipient that can be rendered as things stand.
    for (const item of batch) {
      try {
        const mail = renderAnnouncement(item.locale, deps.links(item.row, item.locale), {
          signupCountry: item.row.signupCountry,
          env: deps.env,
        });
        result.sample = {
          to: maskEmail(item.row.email),
          subject: mail.subject,
          locale: item.locale,
          textPreview: mail.text.slice(0, 400).replace(/https?:\/\/\S+/g, "<link>"),
        };
        break;
      } catch {
        // Korean row without a sender phone: counted in senderPhoneMissing.
      }
    }
    if (!options.apply) return result;

    const clock = deps.now ?? (() => new Date());
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const gap = 1000 / (options.ratePerSecond ?? 2);
    for (const item of batch) {
      const links = deps.links(item.row, item.locale);
      const k = keyHash(item.key);
      let mail: ReturnType<typeof renderAnnouncement>;
      try {
        mail = renderAnnouncement(item.locale, links, {
          signupCountry: item.row.signupCountry,
          env: deps.env,
        });
      } catch {
        // No compliant mail can be built (no https opt-out): nothing was sent,
        // so this is a clear failure the next run may retry once fixed.
        await appendReceipt(file, k, "failed", clock().toISOString(), "not_renderable");
        result.failed += 1;
        continue;
      }
      // Intent is durable BEFORE the provider call, so a crash mid-send is held, not replayed.
      await appendReceipt(file, k, "intent", clock().toISOString());
      try {
        await deps.send({
          to: item.row.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: mail.headers,
          idempotencyKey: item.key,
        });
        await appendReceipt(file, k, "accepted", clock().toISOString());
        result.sent += 1;
      } catch {
        // Not "unknown": the helper only throws after its retries ended. Record it so the next run may retry.
        await appendReceipt(file, k, "failed", clock().toISOString(), "provider_error");
        result.failed += 1;
      }
      await sleep(gap);
    }
    return result;
  } finally {
    if (locked) await rm(lock, { force: true });
  }
}

export const USAGE = `Usage: node --experimental-strip-types --env-file=<env> scripts/referral-announce.ts
  --released-at <ISO>          program release instant; only people verified BEFORE it are eligible (or WATCHDIVE_REFERRAL_RELEASED_AT)
  [--limit <n>]                at most n sends this run (staged batches; re-run resumes)
  [--only <email>]             self-test: that one verified address, release gate ignored, separate idempotency key
  [--receipt-dir <dir>]        default .referral-announce-receipts
  [--rate <per second>]        default 2
  [--apply --confirm ${REFERRAL_PROGRAM_ID}]
                               really send; refused unless WATCHDIVE_REFERRAL_PROGRAM_ENABLED=1
Dry run prints counts and one rendered sample with the address masked.`;

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        apply: { type: "boolean" }, "dry-run": { type: "boolean" }, confirm: { type: "string" },
        "released-at": { type: "string" }, limit: { type: "string" }, only: { type: "string" },
        "receipt-dir": { type: "string" }, rate: { type: "string" }, help: { type: "boolean" },
      },
    }));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 1;
  }
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const releasedAt = new Date(values["released-at"] ?? env.WATCHDIVE_REFERRAL_RELEASED_AT ?? "");
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  const rate = values.rate === undefined ? 2 : Number(values.rate);
  if (!Number.isFinite(releasedAt.getTime()) || (limit !== undefined && !(Number.isInteger(limit) && limit >= 0)) || !(rate > 0 && rate <= 10)) {
    process.stderr.write(`invalid --released-at / --limit / --rate\n${USAGE}\n`);
    return 1;
  }
  if (values.apply && !referralProgramEnabled(env)) {
    process.stderr.write("refused: WATCHDIVE_REFERRAL_PROGRAM_ENABLED is not 1\n");
    return 2;
  }
  const databaseId = (env.NOTION_WAITLIST_DB_ID ?? "").trim();
  if (!env.NOTION_API_KEY || !databaseId) {
    process.stderr.write("NOTION_API_KEY and NOTION_WAITLIST_DB_ID are required\n");
    return 1;
  }
  const [{ createNotionRequest, toLeadRecord }, tokenMod, coreLinks, resendMod] = await Promise.all([
    import("../src/lib/verification/notionLead.ts"),
    import("../src/lib/verification/token.ts"),
    import("../src/lib/referral/statusToken.ts"),
    import("../src/lib/verification/resend.ts"),
  ]);
  const origin = tokenMod.requirePublicOrigin(env);
  const secret = coreLinks.referralSecret(env);
  // Fails fast: without the signing secret no mail could carry its opt-out.
  tokenMod.requireSecret(env);
  const request = createNotionRequest(fetch, env);
  const rows: AnnounceRow[] = [];
  let cursor: string | undefined;
  do {
    const page = (await request("POST", `databases/${encodeURIComponent(databaseId)}/query`, {
      page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
    })) as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null };
    for (const result of page.results ?? []) {
      const lead = toLeadRecord(result);
      if (!lead) continue;
      rows.push({
        pageId: lead.pageId, leadId: lead.leadId, email: lead.email, status: lead.status,
        emailVerified: lead.emailVerified, suspect: lead.suspect, duplicate: Boolean(lead.duplicate),
        verifiedAt: lead.verifiedAt, refCode: lead.refCode, signupLocale: lead.signupLocale, landingPath: lead.landingPath,
        flags: lead.flags,
        signupCountry: lead.signupCountry, launchMail: lead.launchMail, reservationMail: lead.reservationMail,
      });
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const config = values.apply ? resendMod.readResendConfig(env) : undefined;
  const result = await runAnnounce(
    {
      apply: Boolean(values.apply), confirm: values.confirm, releasedAt, limit, only: values.only,
      ratePerSecond: rate, receiptDir: values["receipt-dir"] ?? ".referral-announce-receipts",
    },
    {
      rows, env,
      links: (row, locale) => ({
        share: coreLinks.shareUrl(origin, row.refCode),
        status: coreLinks.statusUrl(origin, row.refCode, locale, secret),
        rules: coreLinks.rulesUrl(origin, locale),
        unsubscribe: resendMod.buddyUnsubscribeUrl(origin, row.leadId, locale, env),
      }),
      send: async (message) => {
        // Reuses the shared Resend helper (retries, idempotency, silent logging).
        await resendMod.deliver(config!, fetch, (ms) => new Promise((r) => setTimeout(r, ms)), message.idempotencyKey, "referral_announce", {
          to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: message.headers,
        });
      },
    },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.aborted || result.failed > 0 || result.heldUnresolved > 0 ? 2 : 0;
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) process.exitCode = await main(process.argv.slice(2));
