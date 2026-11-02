// One-off sender for the frozen 2026-11-02 website expired-link review pool.
// Root holds the office operator lock and is the only caller. This module
// does not verify a customer, does not change consent, and does not add
// identities. The approved set can only shrink through the live guards.
//
// The Resend key is send-only. GET /emails returns 401 restricted_api_key,
// so this file never reads provider suppressions or message history. Root
// checks the provider UI. A CRM opt-out is enforced here; an exhaustive
// provider suppression list is not claimed.
//
// Mail copy is renderRecovery20261102 in recovery20261102.mail.ts. This file
// does not edit that module.
import { createHash, timingSafeEqual } from "node:crypto";

import { canonicalEmail } from "../api/abuse.ts";
import { isLocale, parseLocalePath, verifyPath } from "../i18n/locale.ts";
import { nativeOneMailExcluded } from "../instantForm/reminderExclusion.ts";
import { rowOptedOut } from "../referral/notices.ts";
import {
  VERIFICATION_MAX_SENDS,
  VERIFICATION_TTL_MS,
  type LeadRecord,
} from "./contracts.ts";
import { checkCronAuthorization } from "./cronAuth.ts";
import { readAll } from "./manualCampaign20261019.server.ts";
import { createNotionReminderStore, createNotionRequest } from "./notionLead.ts";
import {
  RECOVERY_20261102_ORIGIN,
  renderRecovery20261102,
  type Recovery20261102Locale,
  type Recovery20261102Mail,
} from "./recovery20261102.mail.ts";
import type { ReminderStore } from "./reminder.ts";
import {
  assertFixedSender,
  FIXED_SENDER_MAILBOX,
  readResendConfig,
  type ResendEnvironment,
} from "./resend.ts";
import {
  createVerificationToken,
  isLeadId,
  requirePublicOrigin,
  requireSecret,
  type TokenEnvironment,
} from "./token.ts";

export const CAMPAIGN = "wd-verification-service-recovery-20261102";
export const CLOSE_AT = "2026-11-02T15:00:00.000Z";
export const FROZEN_MANIFEST_SHA256 =
  "d5b2ff525811e981a5494dc1886fa405e26344c435118f9f17f509f1d5abe699";
/** Root independently recomputed this commitment from the approved private 25.
 *  No customer identifiers are stored in source. Invalid bindings fail closed. */
export const APPROVED_PAGE_SET_SHA256 = "d6519d5d37a4f2db14c4d228754bfe6bed02f13e986ed3d4a6d83db48672e1b7";
export const MAX_IDENTITIES = 25;
export const HISTORY_LIMIT = 1900;
export const PRIOR_RECOVERY_CAMPAIGNS = [
  "wd-manual-verify-20261019",
  "wd-verification-recovery-20261031",
  "wd-honeypot-recovery-20261031",
] as const;

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const USER_AGENT = "watchdive-prelanding/1.0";
const REQUEST_TIMEOUT_MS = 10_000;
const RECENT_MS = VERIFICATION_TTL_MS;
const RECEIPT_ID = /^[A-Za-z0-9._~-]{1,256}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RECOVERY_LOCALES = ["en", "ko", "ja", "zh-TW"] as const;

const REQUEST_KEYS = [
  "campaign",
  "mode",
  "manifestDigest",
  "approvedPageIds",
  "approvedPageSetDigest",
  "pageId",
  "leadId",
  "locale",
] as const;

export type RecoveryLocale = Recovery20261102Locale;

export type RecoveryDecision = {
  ok: true;
  campaign: typeof CAMPAIGN;
  mode: "dry-run" | "send";
  status: string;
  receiptId?: string;
};

export type RecoveryProvider = {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<{ receiptId: string }>;
};

export class RecoveryProviderAmbiguousError extends Error {
  readonly ambiguous = true;
  constructor() {
    super("provider_ambiguous");
    this.name = "RecoveryProviderAmbiguousError";
  }
}

export class RecoveryProviderRejectedError extends Error {
  readonly ambiguous = false;
  constructor() {
    super("provider_rejected");
    this.name = "RecoveryProviderRejectedError";
  }
}

type RecoveryStore = Pick<ReminderStore, "reread" | "claimReminder" | "recordReminderOutcome">;

export type RecoveryDeps = {
  now?: () => Date;
  env?: TokenEnvironment & ResendEnvironment & Record<string, string | undefined>;
  approvedPageSetSha256?: string;
  listRows?: () => Promise<LeadRecord[]>;
  store?: RecoveryStore;
  provider?: RecoveryProvider;
  render?: (input: {
    locale: RecoveryLocale;
    verificationUrl: string;
    publicOrigin: string;
  }) => Recovery20261102Mail;
};

type ParsedRequest = {
  mode: "dry-run" | "send";
  manifestDigest: string;
  approvedPageIds: string[];
  approvedPageSetDigest: string;
  pageId: string;
  leadId: string;
  locale: RecoveryLocale;
};

type Cohort =
  | { ok: true; row: LeadRecord; peers: LeadRecord[] }
  | { ok: false; status: string };

function sameHex(left: string, right: string): boolean {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function normalizePageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return undefined;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** SHA-256 of `campaign`, then the 25 normalized page ids, sorted, one per line. */
export function approvedPageSetDigest(pageIds: readonly string[]): string | undefined {
  if (pageIds.length !== MAX_IDENTITIES) return undefined;
  const normalized = pageIds.map(normalizePageId);
  if (normalized.some((id) => !id)) return undefined;
  const unique = new Set(normalized);
  if (unique.size !== MAX_IDENTITIES) return undefined;
  const lines = [CAMPAIGN, ...[...unique].sort()].join("\n");
  return createHash("sha256").update(`${lines}\n`).digest("hex");
}

export function appendCampaign(previous: string, line: string): string | undefined {
  if (!line || line.length > 240 || /[\r\n\u0000]/.test(line)) return undefined;
  if (previous.includes("\u0000")) return undefined;
  const next = previous ? `${previous}\n${line}` : line;
  if (next.length > HISTORY_LIMIT) return undefined;
  if (previous && !next.startsWith(`${previous}\n`)) return undefined;
  return next;
}

export function isRecoveryLocale(value: unknown): value is RecoveryLocale {
  return typeof value === "string" && (RECOVERY_LOCALES as readonly string[]).includes(value);
}

/** Signup locale, otherwise an explicit localized path. `/` is English.
 *  An unprefixed path such as `/scuba` does not become English. */
export function recoveryLocale(record: LeadRecord): RecoveryLocale | undefined {
  const saved = record.signupLocale?.trim();
  if (saved) return isRecoveryLocale(saved) && isLocale(saved) ? saved : undefined;
  if (!record.landingPath) return undefined;
  const parsed = parseLocalePath(record.landingPath);
  if (parsed.hasLocalePrefix) return isRecoveryLocale(parsed.locale) ? parsed.locale : undefined;
  const path = record.landingPath.split("?")[0]?.split("#")[0] ?? "";
  if (path === "/" || path === "") return "en";
  return undefined;
}

function addressKey(record: LeadRecord): string {
  return canonicalEmail(record.email);
}

function verified(record: LeadRecord): boolean {
  return record.emailVerified || Boolean(record.verifiedAt) || record.status === "verified";
}

function priorRecovery(record: LeadRecord): boolean {
  const reminder = record.reminder ?? "";
  return PRIOR_RECOVERY_CAMPAIGNS.some((campaign) => reminder.includes(campaign));
}

function alreadyClaimed(record: LeadRecord): boolean {
  return (record.reminder ?? "").includes(CAMPAIGN);
}

function recentMail(record: LeadRecord, nowMs: number): boolean {
  const sent = Date.parse(record.sentAt ?? "");
  if (Number.isFinite(sent) && nowMs - sent < RECENT_MS) return true;
  const reminder = record.reminder ?? "";
  for (const match of reminder.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z/g)) {
    const at = Date.parse(match[0]);
    if (Number.isFinite(at) && nowMs - at < RECENT_MS) return true;
  }
  return false;
}

function qaRow(record: LeadRecord): boolean {
  const email = record.email.toLowerCase();
  if (email.includes("wdqa")) return true;
  const source = record.source.toLowerCase();
  if (source === "qa" || source === "test") return true;
  return record.flags.some((flag) => {
    const name = flag.toLowerCase();
    return name === "qa" || name === "test";
  });
}

function socialRow(record: LeadRecord): boolean {
  if (record.signupMethod === "google" || record.signupMethod === "apple") return true;
  if (record.googleSubject || record.appleSubject) return true;
  const provenance = record.authVerificationProvenance ?? "";
  return provenance.startsWith("google:") || provenance.startsWith("apple:");
}

function suspectRow(record: LeadRecord): boolean {
  if (record.suspect) return true;
  return record.flags.some((flag) => {
    const name = flag.toLowerCase();
    return name === "disposable" || name === "headless" || name === "honeypot";
  });
}

function invalidRow(record: LeadRecord): boolean {
  if (!isLeadId(record.leadId)) return true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email.trim())) return true;
  if (!Number.isSafeInteger(record.sends) || record.sends < 1) return true;
  if (!record.sentAt || !Number.isFinite(Date.parse(record.sentAt))) return true;
  return false;
}

export function recoverySkip(
  row: LeadRecord,
  peers: readonly LeadRecord[],
  expected: { pageId: string; leadId: string; locale: RecoveryLocale },
  approved: ReadonlySet<string>,
  nowMs: number,
): string | undefined {
  const pageId = normalizePageId(row.pageId);
  if (!pageId || !approved.has(pageId)) return "outside_frozen_set";
  if (pageId !== expected.pageId) return "page_mismatch";
  if (!isLeadId(row.leadId)) return "invalid";
  if (row.leadId.toLowerCase() !== expected.leadId.toLowerCase()) return "lead_mismatch";
  const locale = recoveryLocale(row);
  if (!locale) return "locale_unresolved";
  if (locale !== expected.locale) return "locale_mismatch";
  if (qaRow(row) || peers.some(qaRow)) return "qa";
  if (invalidRow(row)) return "invalid";
  if (verified(row) || peers.some(verified)) return "verified";
  if (row.status === "unsubscribed" || peers.some((peer) => peer.status === "unsubscribed")) {
    return "unsubscribed";
  }
  if (rowOptedOut(row) || peers.some((peer) => rowOptedOut(peer))) return "unsubscribed";
  if (row.status !== "pending") return "not_pending";
  if (socialRow(row)) return "social";
  if (nativeOneMailExcluded(row)) return "native";
  if (suspectRow(row)) return "suspect";
  if (row.flags.some((flag) => flag.toLowerCase() === "ip-repeat")) return "ip_repeat_review";
  if (row.duplicate || peers.length > 0) return "duplicate";
  if (priorRecovery(row) || peers.some(priorRecovery)) return "prior_recovery";
  if (alreadyClaimed(row) || peers.some(alreadyClaimed)) return "already_claimed";
  if (recentMail(row, nowMs)) return "recent_mail";
  const expires = Date.parse(row.expiresAt ?? "");
  if (!Number.isFinite(expires)) return "expiry_unproven";
  if (expires > nowMs) return "live_expiry";
  if (row.sends >= VERIFICATION_MAX_SENDS) return "send_cap";
  return undefined;
}

function heldAfterClaim(
  row: LeadRecord,
  peers: readonly LeadRecord[],
  expected: { pageId: string; leadId: string; locale: RecoveryLocale },
  approved: ReadonlySet<string>,
  claim: { marker: string; previous: string; sends: number; expiresAt: string; address: string },
): string | undefined {
  const blocked = recoverySkip(row, peers, expected, approved, Date.parse(CLOSE_AT) - 1);
  if (
    blocked &&
    blocked !== "already_claimed" &&
    blocked !== "recent_mail" &&
    blocked !== "live_expiry" &&
    blocked !== "expiry_unproven" &&
    blocked !== "send_cap"
  ) {
    return blocked;
  }
  if (row.reminder !== claim.marker) return "claim_lost";
  if (claim.previous && !row.reminder.startsWith(`${claim.previous}\n`)) return "history_lost";
  if (row.sends !== claim.sends) return "attempts_changed";
  // Notion returns an equivalent +00:00 date, not necessarily our Z spelling.
  if (Date.parse(row.expiresAt ?? "") !== Date.parse(claim.expiresAt)) return "expiry_changed";
  if (addressKey(row) !== claim.address) return "identity_changed";
  if (row.status !== "pending" || verified(row)) return "verified";
  return undefined;
}

export function parseRecoveryRequest(
  body: unknown,
  approvedPageSetSha256: string,
): { ok: true; request: ParsedRequest } | { ok: false; error: string } {
  if (!SHA256_HEX.test(approvedPageSetSha256)) return { ok: false, error: "binding_unset" };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "malformed" };
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== REQUEST_KEYS.length || REQUEST_KEYS.some((key) => !keys.includes(key))) {
    return { ok: false, error: "malformed" };
  }
  if (record.campaign !== CAMPAIGN) return { ok: false, error: "malformed" };
  if (record.mode !== "dry-run" && record.mode !== "send") return { ok: false, error: "malformed" };
  if (typeof record.manifestDigest !== "string" || !sameHex(record.manifestDigest, FROZEN_MANIFEST_SHA256)) {
    return { ok: false, error: "manifest_mismatch" };
  }
  if (!Array.isArray(record.approvedPageIds)) return { ok: false, error: "malformed" };
  const digest = approvedPageSetDigest(record.approvedPageIds);
  if (!digest || typeof record.approvedPageSetDigest !== "string") return { ok: false, error: "malformed" };
  if (!sameHex(digest, record.approvedPageSetDigest) || !sameHex(digest, approvedPageSetSha256)) {
    return { ok: false, error: "binding_mismatch" };
  }
  const pageId = normalizePageId(record.pageId);
  const approved = new Set(
    (record.approvedPageIds as unknown[]).map(normalizePageId).filter((id): id is string => Boolean(id)),
  );
  if (!pageId || !approved.has(pageId)) return { ok: false, error: "outside_frozen_set" };
  if (!isLeadId(record.leadId)) return { ok: false, error: "malformed" };
  if (!isRecoveryLocale(record.locale)) return { ok: false, error: "malformed" };
  return {
    ok: true,
    request: {
      mode: record.mode,
      manifestDigest: record.manifestDigest,
      approvedPageIds: [...approved],
      approvedPageSetDigest: digest,
      pageId,
      leadId: record.leadId,
      locale: record.locale,
    },
  };
}

function reply(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function decision(mode: "dry-run" | "send", status: string, receiptId?: string): RecoveryDecision {
  return {
    ok: true,
    campaign: CAMPAIGN,
    mode,
    status,
    ...(receiptId ? { receiptId } : {}),
  };
}

async function loadCohort(
  listRows: () => Promise<LeadRecord[]>,
  store: RecoveryStore,
  pageId: string,
): Promise<Cohort> {
  let rows: LeadRecord[];
  try {
    rows = await listRows();
  } catch {
    return { ok: false, status: "read_failed" };
  }
  const matches = rows.filter((row) => normalizePageId(row.pageId) === pageId);
  if (matches.length === 0) return { ok: false, status: "missing" };
  if (matches.length > 1) return { ok: false, status: "ambiguous_page" };
  let row: LeadRecord | undefined;
  try {
    row = await store.reread(matches[0].pageId);
  } catch {
    return { ok: false, status: "read_failed" };
  }
  if (!row || normalizePageId(row.pageId) !== pageId) return { ok: false, status: "missing" };
  const key = addressKey(row);
  const peerRows = rows.filter(
    (peer) => normalizePageId(peer.pageId) !== pageId && key && addressKey(peer) === key,
  );
  if (peerRows.length > 5) return { ok: false, status: "duplicate" };
  const peers: LeadRecord[] = [];
  for (const peer of peerRows) {
    try {
      const fresh = await store.reread(peer.pageId);
      if (!fresh) return { ok: false, status: "read_failed" };
      peers.push(fresh);
    } catch {
      return { ok: false, status: "read_failed" };
    }
  }
  return { ok: true, row, peers };
}

function recoveryUrl(locale: RecoveryLocale, token: string): string {
  return `${RECOVERY_20261102_ORIGIN}${verifyPath(locale)}#${token}`;
}

export function createRecovery20261102Provider(
  env: ResendEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): RecoveryProvider {
  const config = readResendConfig(env);
  assertFixedSender(config.from);
  if (config.replyTo !== FIXED_SENDER_MAILBOX) {
    throw new Error("Refusing to send with any Reply-To other than help@diveroid.com");
  }
  return {
    async send(input) {
      const serialized = JSON.stringify({
        from: config.from,
        reply_to: FIXED_SENDER_MAILBOX,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "Idempotency-Key": input.idempotencyKey,
          },
          body: serialized,
        });
      } catch {
        throw new RecoveryProviderAmbiguousError();
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500) {
          throw new RecoveryProviderAmbiguousError();
        }
        throw new RecoveryProviderRejectedError();
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new RecoveryProviderAmbiguousError();
      }
      const id = (parsed as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !RECEIPT_ID.test(id)) throw new RecoveryProviderAmbiguousError();
      return { receiptId: id };
    },
  };
}

async function remember(
  store: RecoveryStore,
  pageId: string,
  outcome: string | undefined,
): Promise<boolean> {
  if (!outcome) return false;
  try {
    await store.recordReminderOutcome(pageId, outcome);
    return true;
  } catch {
    return false;
  }
}

export async function runVerificationServiceRecovery(input: {
  request: ParsedRequest;
  approvedPageSetSha256: string;
  listRows: () => Promise<LeadRecord[]>;
  store: RecoveryStore;
  provider?: RecoveryProvider;
  render?: RecoveryDeps["render"];
  env: TokenEnvironment;
  now?: () => Date;
}): Promise<RecoveryDecision> {
  const mode = input.request.mode;
  const clock = input.now ?? (() => new Date());
  const approvedDigest = approvedPageSetDigest(input.request.approvedPageIds);
  if (
    !approvedDigest ||
    !sameHex(approvedDigest, input.approvedPageSetSha256) ||
    !sameHex(approvedDigest, input.request.approvedPageSetDigest) ||
    !sameHex(input.request.manifestDigest, FROZEN_MANIFEST_SHA256)
  ) {
    return decision(mode, "binding_mismatch");
  }
  if (clock().getTime() >= Date.parse(CLOSE_AT)) return decision(mode, "closed");
  const approved = new Set(input.request.approvedPageIds);
  const expected = {
    pageId: input.request.pageId,
    leadId: input.request.leadId,
    locale: input.request.locale,
  };
  const first = await loadCohort(input.listRows, input.store, expected.pageId);
  if (!first.ok) return decision(mode, first.status);
  const reason = recoverySkip(first.row, first.peers, expected, approved, clock().getTime());
  if (reason) return decision(mode, reason);
  if (mode === "dry-run") return decision(mode, "eligible");
  if (!input.provider) return decision(mode, "not_configured");

  if (clock().getTime() >= Date.parse(CLOSE_AT)) return decision(mode, "closed");
  let secret: string;
  let origin: string;
  try {
    secret = requireSecret(input.env);
    origin = requirePublicOrigin(input.env);
  } catch {
    return decision(mode, "not_configured");
  }
  if (origin !== RECOVERY_20261102_ORIGIN) return decision(mode, "origin_rejected");
  // A production create/PATCH/read probe confirmed Notion truncates to minutes.
  // Sign the same instant we can reread, preserving the strict ownership check.
  const expiryMs = Math.floor((clock().getTime() + VERIFICATION_TTL_MS) / 60_000) * 60_000;
  const expiresAt = new Date(expiryMs).toISOString();
  let mail: Recovery20261102Mail;
  let href = "";
  try {
    const token = createVerificationToken(first.row.leadId, expiryMs, false, secret, expected.locale);
    href = recoveryUrl(expected.locale, token);
    const render = input.render ?? renderRecovery20261102;
    mail = render({ locale: expected.locale, verificationUrl: href, publicOrigin: origin });
  } catch {
    return decision(mode, "template_rejected");
  }
  if (
    !mail ||
    typeof mail.subject !== "string" ||
    typeof mail.html !== "string" ||
    typeof mail.text !== "string" ||
    !mail.subject.trim() ||
    mail.subject.length > 200 ||
    mail.html.length > 200_000 ||
    mail.text.length > 100_000 ||
    !mail.html.includes(href) ||
    !mail.text.includes(href)
  ) {
    return decision(mode, "template_rejected");
  }

  const before = await loadCohort(input.listRows, input.store, expected.pageId);
  if (!before.ok) return decision(mode, before.status);
  if (before.row.leadId !== first.row.leadId || addressKey(before.row) !== addressKey(first.row)) {
    return decision(mode, "identity_changed");
  }
  const again = recoverySkip(before.row, before.peers, expected, approved, clock().getTime());
  if (again) return decision(mode, again);
  if (clock().getTime() >= Date.parse(CLOSE_AT)) return decision(mode, "closed");
  const previous = before.row.reminder ?? "";
  const claimedAt = clock().toISOString();
  const marker = appendCampaign(previous, `${CAMPAIGN} claimed ${claimedAt}`);
  if (!marker) return decision(mode, "history_too_long");
  const sends = before.row.sends + 1;
  try {
    await input.store.claimReminder(before.row.pageId, { marker, sends, expiresAt });
  } catch {
    return decision(mode, "claim_uncertain");
  }

  const after = await loadCohort(input.listRows, input.store, expected.pageId);
  if (!after.ok) {
    await remember(input.store, before.row.pageId, appendCampaign(marker, `${CAMPAIGN} claimed_not_sent ${claimedAt}`));
    return decision(mode, "read_failed_after_claim");
  }
  const held = heldAfterClaim(after.row, after.peers, expected, approved, {
    marker,
    previous,
    sends,
    expiresAt,
    address: addressKey(before.row),
  });
  if (held || clock().getTime() >= Date.parse(CLOSE_AT)) {
    const status = held ?? "closed_after_claim";
    await remember(input.store, before.row.pageId, appendCampaign(marker, `${CAMPAIGN} ${status} ${claimedAt}`));
    return decision(mode, status);
  }
  let receiptId: string | undefined;
  let providerStatus = "provider_ambiguous";
  try {
    const sent = await input.provider.send({
      to: after.row.email.trim(),
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `${CAMPAIGN}-${after.row.leadId}`,
    });
    receiptId = sent.receiptId;
    providerStatus = "provider_accepted";
  } catch (error) {
    providerStatus = error instanceof RecoveryProviderRejectedError ? "provider_rejected" : "provider_ambiguous";
  }
  const outcome = appendCampaign(marker, `${CAMPAIGN} ${providerStatus} ${claimedAt}`);
  const recorded = await remember(input.store, before.row.pageId, outcome);
  let confirmed = recorded;
  if (recorded && outcome) {
    try {
      const saved = await input.store.reread(before.row.pageId);
      const peers = after.peers;
      for (const peer of peers) await input.store.reread(peer.pageId);
      confirmed = Boolean(saved && saved.reminder === outcome && saved.reminder.includes(previous || CAMPAIGN));
      if (saved && (saved.emailVerified || saved.status === "verified" || saved.measurementConsent !== before.row.measurementConsent)) {
        confirmed = false;
      }
    } catch {
      confirmed = false;
    }
  }
  if (receiptId && !confirmed) return decision(mode, "provider_accepted_record_unconfirmed", receiptId);
  if (receiptId) return decision(mode, "provider_accepted", receiptId);
  return decision(mode, providerStatus);
}

function httpFor(result: RecoveryDecision): number {
  if (result.status === "closed" || result.status === "binding_mismatch") return 403;
  if (
    result.status === "not_configured" ||
    result.status === "origin_rejected" ||
    result.status === "read_failed" ||
    result.status === "binding_unset"
  ) {
    return 503;
  }
  return 200;
}

export async function handleVerificationServiceRecovery(
  request: Request,
  deps: RecoveryDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  if (checkCronAuthorization(request.headers.get("authorization"), env.WATCHDIVE_REMINDER_CRON_SECRET) !== "authorized") {
    return reply(401, { ok: false });
  }
  if (request.method !== "POST") return reply(405, { ok: false });
  const approvedPageSetSha256 = deps.approvedPageSetSha256 ?? APPROVED_PAGE_SET_SHA256;
  if (!SHA256_HEX.test(approvedPageSetSha256)) return reply(503, { ok: false, error: "binding_unset" });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { ok: false, error: "malformed" });
  }
  const parsed = parseRecoveryRequest(body, approvedPageSetSha256);
  if (!parsed.ok) {
    const status = parsed.error === "binding_mismatch" || parsed.error === "manifest_mismatch" ? 403 : parsed.error === "binding_unset" ? 503 : 400;
    return reply(status, { ok: false, error: parsed.error });
  }
  if ((deps.now ?? (() => new Date()))().getTime() >= Date.parse(CLOSE_AT)) {
    return reply(403, { ok: false, error: "closed" });
  }
  try {
    let listRows = deps.listRows;
    let store = deps.store;
    if (!listRows || !store) {
      const database = env.NOTION_WAITLIST_DB_ID;
      if (!database) return reply(503, { ok: false, error: "not_configured" });
      const notion = createNotionRequest();
      listRows = listRows ?? (() => readAll(notion, database));
      store = store ?? createNotionReminderStore(notion, database);
    }
    let provider = deps.provider;
    if (parsed.request.mode === "send" && !provider) {
      try {
        provider = createRecovery20261102Provider(env);
      } catch {
        return reply(503, { ok: false, error: "not_configured" });
      }
    }
    const result = await runVerificationServiceRecovery({
      request: parsed.request,
      approvedPageSetSha256,
      listRows,
      store,
      provider,
      render: deps.render,
      env,
      now: deps.now,
    });
    return reply(httpFor(result), result);
  } catch {
    return reply(503, { ok: false, error: "recovery_failed" });
  }
}
