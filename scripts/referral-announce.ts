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

import { fill, referralCopy } from "../src/lib/referral/copy.ts";
import {
  EARLY_NOTICE_HOURS,
  REFERRAL_PROGRAM_ID,
  REFERRAL_TIERS,
  referralProgramEnabled,
} from "../src/lib/referral/program.ts";
import { DEFAULT_LOCALE, localeFromPathname, matchLocale, type Locale } from "../src/lib/i18n/locale.ts";
import { FIELD_LAUNCH_MAIL, parseLaunchMarker } from "../src/lib/launchMail/audience.ts";
import { parseReservationMarker } from "../src/lib/reservation-mail/campaign.ts";
import { FIELD_RESERVATION_MAIL } from "../src/lib/reservation-mail/store.ts";
import { conversionBlocked } from "../src/lib/verification/contracts.ts";

export const ANNOUNCE_CAMPAIGN = `${REFERRAL_PROGRAM_ID}-announce`;
const SENDER_IDENTITY =
  "DIVEROID LTD, company 16343651, Office 12146, 182-184 High Street North, East Ham, London, United Kingdom, E6 2JA";

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
  /**
   * Raw `Launch mail` / `Reservation mail` cells. The one-click unsubscribe
   * this very mail carries writes `unsubscribed <iso>` to `Launch mail`, never
   * to `Verification status`, so the status alone does not see an opt-out.
   */
  launchMail?: string;
  reservationMail?: string;
};

export type SkipReason =
  | "not_verified"
  | "unsubscribed"
  | "unsubscribed_address"
  | "suspect"
  | "blocked_flag"
  | "duplicate"
  | "duplicate_address"
  | "verified_after_release"
  | "verified_at_missing"
  | "no_ref_code"
  | "no_email"
  | "not_selected";

/** Null means eligible. `ignoreRelease` is only for the --only self-test. */
export function announceSkipReason(
  row: AnnounceRow,
  releasedAt: Date,
  ignoreRelease = false,
): SkipReason | null {
  if (optedOut(row)) return "unsubscribed";
  if (row.status !== "verified" || !row.emailVerified) return "not_verified";
  if (row.suspect) return "suspect";
  if (conversionBlocked(row.flags ?? [])) return "blocked_flag";
  if (row.duplicate) return "duplicate";
  if (!row.email.includes("@")) return "no_email";
  if (!/^[a-z0-9]{8}$/.test(row.refCode)) return "no_ref_code";
  if (!ignoreRelease) {
    const at = Date.parse(row.verifiedAt ?? "");
    if (!Number.isFinite(at)) return "verified_at_missing";
    if (at >= releasedAt.getTime()) return "verified_after_release";
  }
  return null;
}

/** Any opt-out on the row: status, or a launch/reservation one-click unsubscribe. */
function optedOut(row: AnnounceRow): boolean {
  return (
    row.status === "unsubscribed" ||
    parseLaunchMarker(row.launchMail).kind === "unsubscribed" ||
    parseReservationMarker(row.reservationMail).kind === "unsubscribed"
  );
}

function addressOf(row: Pick<AnnounceRow, "email">): string {
  return row.email.trim().toLowerCase();
}

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

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type AnnounceLinks = { share: string; status: string; rules: string; unsubscribe?: string };

/** Same guide as the new welcome mail: copy.mail.welcome* plus the tier list. Every value is escaped. */
export function renderAnnouncement(
  locale: Locale,
  links: AnnounceLinks,
  values: Record<string, string | number>,
): { subject: string; html: string; text: string } {
  const copy = referralCopy(locale);
  const mail = copy.mail;
  const tiers = REFERRAL_TIERS.map((tier) => ({
    name: fill(copy.tiers[tier.id].name, values),
    reward: fill(copy.tiers[tier.id].reward, { ...values, hours: EARLY_NOTICE_HOURS[tier.id] }),
  }));
  tiers.push({ name: fill(copy.top.name, values), reward: fill(copy.top.reward, values) });
  const t = (s: string) => fill(s, values);
  const items = tiers
    .map((tier) => `<li style="margin:0 0 10px;"><strong>${esc(tier.name)}</strong><br>${esc(tier.reward)}</li>`)
    .join("");
  const unsub = links.unsubscribe
    ? `<p style="margin:16px 0 0;font-size:12px;color:#667;"><a href="${esc(links.unsubscribe)}" style="color:#667;">Unsubscribe</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f7fa;font-family:Arial,Helvetica,sans-serif;color:#10212f;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="font-size:22px;margin:0 0 12px;">${esc(t(mail.welcomeHeading))}</h1>
<p style="line-height:1.5;">${esc(t(mail.welcomeIntro))}</p>
<h2 style="font-size:16px;margin:20px 0 8px;">${esc(t(mail.welcomeTiersHeading))}</h2>
<ul style="padding-left:18px;line-height:1.45;margin:0 0 8px;">${items}</ul>
<p style="font-size:13px;color:#445;">${esc(t(copy.countingNote))}</p>
<p style="margin:20px 0;"><a href="${esc(links.share)}" style="background:#0a6cff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">${esc(t(mail.welcomeButton))}</a></p>
<p style="font-size:13px;">${esc(t(mail.welcomeFallback))}<br><a href="${esc(links.share)}">${esc(links.share)}</a></p>
<p style="font-size:13px;">${esc(t(mail.welcomeStatus))}<br><a href="${esc(links.status)}">${esc(links.status)}</a></p>
<p style="font-size:13px;">${esc(t(mail.welcomeRules))}<br><a href="${esc(links.rules)}">${esc(links.rules)}</a></p>
<p style="font-size:13px;">${esc(t(mail.welcomeOutro))}</p>
<hr style="border:0;border-top:1px solid #dde;margin:20px 0;">
<p style="margin:0;font-size:12px;color:#667;">${esc(SENDER_IDENTITY)}</p>${unsub}
</div></body></html>`;
  const text = [
    t(mail.welcomeHeading),
    "",
    t(mail.welcomeIntro),
    "",
    t(mail.welcomeTiersHeading),
    ...tiers.map((tier) => `- ${tier.name}: ${tier.reward}`),
    t(copy.countingNote),
    "",
    `${t(mail.welcomeButton)}: ${links.share}`,
    `${t(mail.welcomeStatus)} ${links.status}`,
    `${t(mail.welcomeRules)} ${links.rules}`,
    "",
    t(mail.welcomeOutro),
    "",
    SENDER_IDENTITY,
    ...(links.unsubscribe ? [`Unsubscribe: ${links.unsubscribe}`] : []),
  ].join("\n");
  return { subject: t(mail.welcomeSubject), html, text };
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
  values: (locale: Locale) => Record<string, string | number>;
  send: (message: AnnounceMessage) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export type AnnounceResult = {
  mode: "dry-run" | "send";
  aborted?: "switch_off" | "confirm_missing" | "receipt_lock_held" | "invalid_input";
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
  // An opt-out on any row of an address covers the address (the person may
  // have signed up twice), and an address gets one announcement, not one per row.
  const optedOutAddresses = new Set(deps.rows.filter(optedOut).map(addressOf));
  const queuedAddresses = new Set<string>();
  for (const row of deps.rows) {
    if (only && addressOf(row) !== only) {
      result.skipped.not_selected = (result.skipped.not_selected ?? 0) + 1;
      continue;
    }
    let why = announceSkipReason(row, options.releasedAt, selfTest);
    if (!why && optedOutAddresses.has(addressOf(row))) why = "unsubscribed_address";
    if (!why && queuedAddresses.has(addressOf(row))) why = "duplicate_address";
    if (why) {
      result.skipped[why] = (result.skipped[why] ?? 0) + 1;
      continue;
    }
    const locale = rowLocale(row);
    result.eligible += 1;
    result.byLocale[locale] = (result.byLocale[locale] ?? 0) + 1;
    queuedAddresses.add(addressOf(row));
    queue.push({ row, locale, key: announceKey(row, selfTest) });
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

    if (batch[0]) {
      const first = batch[0];
      const mail = renderAnnouncement(first.locale, deps.links(first.row, first.locale), deps.values(first.locale));
      result.sample = {
        to: maskEmail(first.row.email),
        subject: mail.subject,
        locale: first.locale,
        textPreview: mail.text.slice(0, 400).replace(/https?:\/\/\S+/g, "<link>"),
      };
    }
    if (!options.apply) return result;

    const clock = deps.now ?? (() => new Date());
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const gap = 1000 / (options.ratePerSecond ?? 2);
    for (const item of batch) {
      const links = deps.links(item.row, item.locale);
      const mail = renderAnnouncement(item.locale, links, deps.values(item.locale));
      const k = keyHash(item.key);
      // Intent is durable BEFORE the provider call, so a crash mid-send is held, not replayed.
      await appendReceipt(file, k, "intent", clock().toISOString());
      try {
        await deps.send({
          to: item.row.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: links.unsubscribe
            ? { "List-Unsubscribe": `<${links.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
            : { "List-Unsubscribe": "<mailto:help@diveroid.com?subject=unsubscribe>" },
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

/** Text of a rich_text/title/select cell, "" when absent. */
function plainCell(property: unknown): string {
  const value = property as
    | { rich_text?: { plain_text?: string }[]; title?: { plain_text?: string }[]; select?: { name?: string } | null }
    | undefined;
  if (!value) return "";
  if (value.rich_text) return value.rich_text.map((part) => part.plain_text ?? "").join("");
  if (value.title) return value.title.map((part) => part.plain_text ?? "").join("");
  return value.select?.name ?? "";
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
  const [{ createNotionRequest, toLeadRecord }, tokenMod, coreLinks, coreValues, unsubMod, resendMod] = await Promise.all([
    import("../src/lib/verification/notionLead.ts"),
    import("../src/lib/verification/token.ts"),
    import("../src/lib/referral/statusToken.ts"),
    import("../src/lib/referral/values.ts"),
    import("../src/lib/launchMail/unsubscribeToken.ts"),
    import("../src/lib/verification/resend.ts"),
  ]);
  const origin = tokenMod.requirePublicOrigin(env);
  const secret = coreLinks.referralSecret(env);
  const unsubSecret = tokenMod.requireSecret(env);
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
        launchMail: plainCell((result.properties as Record<string, unknown> | undefined)?.[FIELD_LAUNCH_MAIL]),
        reservationMail: plainCell((result.properties as Record<string, unknown> | undefined)?.[FIELD_RESERVATION_MAIL]),
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
      values: (locale) => coreValues.copyValues(locale),
      links: (row, locale) => ({
        share: coreLinks.shareUrl(origin, row.refCode),
        status: coreLinks.statusUrl(origin, row.refCode, locale, secret),
        rules: coreLinks.rulesUrl(origin, locale),
        ...(tokenMod.isLeadId(row.leadId)
          ? { unsubscribe: unsubMod.unsubscribeUrl(origin, unsubMod.createUnsubscribeToken(row.leadId, locale, unsubSecret)) }
          : {}),
      }),
      send: async (message) => {
        // Reuses the shared Resend helper (retries, idempotency, silent logging).
        await resendMod.deliver(config!, fetch, (ms) => new Promise((r) => setTimeout(r, ms)), message.idempotencyKey, "welcome", {
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
