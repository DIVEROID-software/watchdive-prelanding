// Bounded, separately authorized recovery batches. Never verifies a customer.
// Root holds the office verification-reminder/operator.lock across requests.
// Unknown provider outcomes retain their durable claim and cannot be replayed.
import type { LeadRecord } from './contracts.ts';
import { VERIFICATION_MAX_SENDS } from './contracts.ts';
import { optOutAddressKey, rowOptedOut } from '../referral/notices.ts';
import { reminderExpiryMs, type ReminderStore } from './reminder.ts';
import { readAll } from './manualCampaign20261019.server.ts';
import { createNotionRequest, createNotionReminderStore, createNotionLeadStore, toLeadRecord } from './notionLead.ts';
import { createResendMailer, type VerificationMailer } from './resend.ts';
import { createVerificationToken, requireSecret, requirePublicOrigin, isLeadId, type TokenEnvironment } from './token.ts';
import { checkCronAuthorization } from './cronAuth.ts';
import type { Locale } from '../i18n/locale.ts';

export const RECOVERY_CAMPAIGN = 'wd-verification-recovery-20261031';
export const HISTORICAL_RECOVERY_CAMPAIGN = 'wd-honeypot-recovery-20261031';
export const RECOVERY_CLOSE_AT = '2026-11-02T13:00:00Z';
type Case = { label: string; at: string; method?: 'email' | 'apple'; country: string; locale: Locale;
  source?: string; historical?: true; legacy?: true; domain?: string; path?: string };
export const RECOVERY_CASES: readonly Case[] = [
  { label: 'apple-morning', at: '2026-10-31T01:08:00Z', method: 'apple', country: 'TW', locale: 'zh-TW' },
  { label: 'apple-afternoon', at: '2026-10-31T07:21:00Z', method: 'apple', country: 'TW', locale: 'zh-TW' },
  { label: 'honeypot-afternoon', at: '2026-10-31T05:29:00Z', method: 'email', country: 'US', locale: 'ko' },
  { label: 'honeypot-evening', at: '2026-10-31T08:48:00Z', method: 'email', country: 'AT', locale: 'ko' },
];
// These five exact historical attempts were reviewed and separately authorized.
// The two older French attempts predate persisted method/locale/provenance.
// Their exact /fr landing path determines mail language; no CRM field is backfilled.
export const HISTORICAL_RECOVERY_CASES: readonly Case[] = [
  { label: 'historical-fr-offer', at: '2026-10-13T12:56:00Z', country: '', locale: 'fr', source: 'offer', historical: true, legacy: true, domain: 'gmail.com', path: '/fr' },
  { label: 'historical-fr-hero', at: '2026-10-14T00:31:00Z', country: 'FR', locale: 'fr', historical: true, legacy: true, domain: 'gmx.fr', path: '/fr' },
  { label: 'historical-en-jp', at: '2026-10-24T00:30:00Z', method: 'email', country: 'JP', locale: 'en', source: 'offer', historical: true, domain: 'yahoo.com.sg', path: '/' },
  { label: 'historical-ko-se', at: '2026-10-26T08:53:00Z', method: 'email', country: 'SE', locale: 'ko', historical: true, domain: 'gmail.com', path: '/ko' },
  { label: 'historical-en-sg', at: '2026-10-29T22:23:00Z', method: 'email', country: 'SG', locale: 'en', source: 'offer', historical: true, domain: 'gmail.com', path: '/scuba' },
];
const verified = (r: LeadRecord) => r.emailVerified || Boolean(r.verifiedAt) || r.status === 'verified';
const address = (r: LeadRecord) => optOutAddressKey(r.email);
const sameAttempt = (a: LeadRecord, b: LeadRecord) =>
  a.pageId === b.pageId && a.leadId === b.leadId && address(a) === address(b);
function matches(r: LeadRecord, c: Case): boolean {
  return Date.parse(r.signedUpAt ?? '') === Date.parse(c.at) && r.signupMethod === c.method &&
    (r.signupCountry ?? '') === c.country && (r.signupLocale ?? '') === (c.legacy ? '' : c.locale) &&
    r.source === (c.source ?? 'hero') && (c.path === undefined || r.landingPath === c.path);
}
function skip(r: LeadRecord, c: Case, afterClaim?: string): string | undefined {
  if (!matches(r, c)) return 'incident_signature_changed';
  if (r.status !== 'pending' || verified(r) || rowOptedOut(r)) return 'verified_or_suppressed';
  if (r.duplicate) return 'duplicate';
  if (!isLeadId(r.leadId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) return 'invalid_attempt';
  if (r.sentAt) return 'already_sent';
  if (afterClaim ? r.reminder !== afterClaim : Boolean(r.reminder)) return 'claimed_or_previous_outcome';
  if (!Number.isSafeInteger(r.sends) || r.sends < 0) return 'invalid_send_count';
  if (afterClaim ? r.sends > VERIFICATION_MAX_SENDS : r.sends >= VERIFICATION_MAX_SENDS) return 'send_cap';
  if (c.method === 'apple') {
    if (r.suspect || r.flags.length || !r.appleSubject ||
        r.authVerificationProvenance !== 'apple:private-relay' ||
        !/@privaterelay\.appleid\.com$/i.test(r.email)) return 'apple_signature_mismatch';
  } else if (r.email.trim().toLowerCase().split('@')[1] !== (c.domain ?? 'gmail.com') ||
             r.flags.length !== 1 || r.flags[0] !== 'honeypot' ||
             (r.authVerificationProvenance ?? '') !== (c.legacy ? '' : 'email:double-opt-in') ||
             (c.historical && (!r.suspect || r.sends !== (afterClaim ? 2 : 1)))) return 'other_abuse_or_signature_mismatch';
  return undefined;
}
type RecoveryStore = Pick<ReminderStore, 'reread' | 'claimReminder' | 'recordReminderOutcome'> & {
  markSent(pageId: string, input: { sentAt: string }): Promise<void>;
};
export async function runVerificationRecovery(input: {
  rows: LeadRecord[]; store: RecoveryStore; mailer: VerificationMailer; env: TokenEnvironment;
  listRows: () => Promise<LeadRecord[]>;
  campaign?: typeof RECOVERY_CAMPAIGN | typeof HISTORICAL_RECOVERY_CAMPAIGN;
  send: boolean; now?: () => Date;
}) {
  const clock = input.now ?? (() => new Date());
  const campaign = input.campaign ?? RECOVERY_CAMPAIGN;
  const cases = campaign === HISTORICAL_RECOVERY_CAMPAIGN ? HISTORICAL_RECOVERY_CASES : RECOVERY_CASES;
  const result = { campaign, dryRun: !input.send, eligible: 0, accepted: 0,
    failedOrUnknown: 0, notClaimed: 0, claimedButNotSent: 0, recordFailed: 0, byLocale: {} as Record<string, number>,
    cases: [] as { case: string; status: string }[] };
  if (clock().getTime() >= Date.parse(RECOVERY_CLOSE_AT)) throw new Error('recovery_closed');
  const secret = requireSecret(input.env), origin = requirePublicOrigin(input.env);
  const eligible: { row: LeadRecord; c: Case; state: { case: string; status: string } }[] = [];
  for (const c of cases) {
    const candidates = input.rows.filter(r => matches(r, c));
    const state = { case: c.label, status: candidates.length === 0 ? 'missing' : 'ambiguous' };
    result.cases.push(state);
    if (candidates.length !== 1) continue;
    const row = candidates[0];
    const peers = input.rows.filter(r => address(r) === address(row) && r.pageId !== row.pageId);
    const reason = skip(row, c) ?? (peers.length ? 'other_identity_row_requires_review' : undefined);
    if (reason) { state.status = reason; continue; }
    state.status = 'eligible'; result.eligible++;
    result.byLocale[c.locale] = (result.byLocale[c.locale] ?? 0) + 1;
    eligible.push({ row, c, state });
  }
  if (!input.send) return result;
  // A new peer can appear after the initial read. Repeat the full bounded
  // read instead of checking only peer ids present in that first snapshot.
  const cohortStillUnique = async (row: LeadRecord, c: Case) => {
    const current = await input.listRows();
    const sameCase = current.filter(r => matches(r, c));
    return sameCase.length === 1 && sameAttempt(row, sameCase[0]) &&
      !current.some(r => address(r) === address(row) && r.pageId !== row.pageId);
  };
  for (const { row, c, state } of eligible) {
    if (clock().getTime() >= Date.parse(RECOVERY_CLOSE_AT)) { state.status = 'closed'; continue; }
    let fresh: LeadRecord | undefined;
    try {
      if (!await cohortStillUnique(row, c)) {
        state.status = 'identity_or_cohort_changed'; result.notClaimed++; continue;
      }
      fresh = await input.store.reread(row.pageId);
    } catch { state.status = 'read_failed_before_claim'; result.notClaimed++; continue; }
    if (!fresh || !sameAttempt(row, fresh) || skip(fresh, c)) {
      state.status = 'changed_before_claim'; result.notClaimed++; continue;
    }
    if (clock().getTime() >= Date.parse(RECOVERY_CLOSE_AT)) { state.status = 'closed'; continue; }
    const expiry = reminderExpiryMs(clock().getTime());
    const marker = `${campaign} claimed ${clock().toISOString()}`;
    try {
      await input.store.claimReminder(row.pageId, { marker, sends: fresh.sends + 1,
        expiresAt: new Date(Math.max(expiry, Date.parse(fresh.expiresAt ?? '') || 0)).toISOString() });
    } catch { state.status = 'claim_failed_or_unknown'; result.notClaimed++; continue; }
    try {
      if (!await cohortStillUnique(row, c)) {
        state.status = 'identity_or_cohort_changed_after_claim'; result.claimedButNotSent++; continue;
      }
      fresh = await input.store.reread(row.pageId);
    } catch { state.status = 'read_failed_after_claim'; result.claimedButNotSent++; continue; }
    if (!fresh || !sameAttempt(row, fresh) || skip(fresh, c, marker)) {
      state.status = 'changed_after_claim'; result.claimedButNotSent++; continue;
    }
    if (clock().getTime() >= Date.parse(RECOVERY_CLOSE_AT)) {
      state.status = 'closed_after_claim'; result.claimedButNotSent++; continue;
    }
    try {
      const token = createVerificationToken(fresh.leadId, expiry, false, secret, c.locale);
      await input.mailer.send({ to: fresh.email.trim(), token, leadId: fresh.leadId, publicOrigin: origin,
        locale: c.locale, manualCampaign: campaign });
      result.accepted++; state.status = 'provider_accepted';
    } catch { result.failedOrUnknown++; state.status = 'failed_or_unknown'; }
    try {
      await input.store.recordReminderOutcome(row.pageId, `${campaign} ${state.status} ${clock().toISOString()}`);
    } catch { result.recordFailed++; } // The pre-send claim remains durable.
    if (state.status === 'provider_accepted') {
      try {
        const current = await input.store.reread(row.pageId);
        if (current && sameAttempt(row, current)) await input.store.markSent(row.pageId, { sentAt: clock().toISOString() });
      } catch { result.recordFailed++; }
    }
  }
  return result;
}

export async function handleVerificationRecovery(request: Request): Promise<Response> {
  const reply = (status: number, body: unknown) => Response.json(body, { status,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  if (checkCronAuthorization(request.headers.get('authorization'), process.env.WATCHDIVE_REMINDER_CRON_SECRET) !== 'authorized') return reply(401, { ok: false });
  if (request.method !== 'POST') return reply(405, { ok: false });
  let body: { campaign?: string; mode?: string };
  try { body = await request.json(); } catch { return reply(400, { ok: false }); }
  if (!body || (body.campaign !== RECOVERY_CAMPAIGN && body.campaign !== HISTORICAL_RECOVERY_CAMPAIGN) || !['dry-run', 'send'].includes(body.mode ?? '')) return reply(400, { ok: false });
  const database = process.env.NOTION_WAITLIST_DB_ID;
  if (!database) return reply(503, { ok: false });
  try {
    const req = createNotionRequest();
    const base = createNotionReminderStore(req, database);
    const leads = createNotionLeadStore(req, database);
    const store: RecoveryStore = { ...base, markSent: leads.markSent, reread: async id => {
      const raw = await req('GET', `pages/${id}`);
      if (raw.archived || raw.in_trash) return undefined;
      return toLeadRecord(raw);
    } };
    const result = await runVerificationRecovery({ rows: await readAll(req, database), store,
      listRows: () => readAll(req, database),
      mailer: createResendMailer(), env: process.env, send: body.mode === 'send', campaign: body.campaign });
    return reply(200, { ok: true, ...result });
  } catch { return reply(503, { ok: false, error: 'recovery_failed_or_closed' }); }
}
