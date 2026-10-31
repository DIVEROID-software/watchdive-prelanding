import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeadRecord } from '../src/lib/verification/contracts.ts';
import { HISTORICAL_RECOVERY_CAMPAIGN, runVerificationRecovery } from '../src/lib/verification/recovery20261031.server.ts';
import { createResendMailer, type VerificationMail } from '../src/lib/verification/resend.ts';
import { TEST_ENV } from './helpers/fakes.ts';

const NOW = new Date('2026-11-01T00:00:00Z');
// Independently transcribed non-identifying incident signatures; addresses/IDs are synthetic.
function fixtures(): LeadRecord[] {
  const data = [
    ['2026-10-13T12:56:00Z', undefined, undefined, undefined, '/fr', 'offer', 'gmail.com'],
    ['2026-10-14T00:31:00Z', undefined, 'FR', undefined, '/fr', 'hero', 'gmx.fr'],
    ['2026-10-24T00:30:00Z', 'email', 'JP', 'en', '/', 'offer', 'yahoo.com.sg'],
    ['2026-10-26T08:53:00Z', 'email', 'SE', 'ko', '/ko', 'hero', 'gmail.com'],
    ['2026-10-29T22:23:00Z', 'email', 'SG', 'en', '/scuba', 'offer', 'gmail.com'],
  ];
  return data.map(([signedUpAt, signupMethod, signupCountry, signupLocale, landingPath, source, domain], i) => ({
    pageId: `historical-page-${i}`, email: `synthetic-${i}@${domain}`, status: 'pending',
    emailVerified: false, refCode: 'abcdefgh', source: source!, suspect: true, flags: ['honeypot'],
    phone: '', leadId: `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${i}`, metaEventId: '', sends: 1,
    signedUpAt, signupMethod: signupMethod as 'email' | undefined, signupCountry, signupLocale,
    landingPath, ...(signupMethod ? { authVerificationProvenance: 'email:double-opt-in' } : {}),
  }));
}
function harness(rows = fixtures()) {
  const saved = new Map(rows.map(r => [r.pageId, structuredClone(r)]));
  const sent: VerificationMail[] = [];
  let claims = 0;
  const store = {
    reread: async (id: string) => structuredClone(saved.get(id)),
    claimReminder: async (id: string, x: { marker: string; sends: number; expiresAt: string }) => {
      claims++; Object.assign(saved.get(id)!, { reminder: x.marker, sends: x.sends, expiresAt: x.expiresAt });
    },
    recordReminderOutcome: async (id: string, outcome: string) => { saved.get(id)!.reminder = outcome; },
    markSent: async (id: string, x: { sentAt: string }) => { saved.get(id)!.sentAt = x.sentAt; },
  };
  const run = (send = false, historical = true) => runVerificationRecovery({
    rows: [...saved.values()].map(r => structuredClone(r)), store,
    listRows: async () => [...saved.values()].map(r => structuredClone(r)),
    mailer: { send: async m => { sent.push(m); }, sendWelcome: async () => { throw new Error('unexpected welcome'); } },
    env: TEST_ENV, send, now: () => NOW,
    ...(historical ? { campaign: HISTORICAL_RECOVERY_CAMPAIGN } : {}),
  });
  return { run, saved, sent, claims: () => claims };
}

test('historical dry run identifies five exact cases and original batch does not include them', async () => {
  const h = harness();
  const r = await h.run();
  assert.equal(r.eligible, 5);
  assert.deepEqual(r.byLocale, { fr: 2, en: 2, ko: 1 });
  assert.equal((await h.run(false, false)).eligible, 0);
  assert.equal(h.claims(), 0);
  assert.equal(h.sent.length, 0);
});

test('historical recovery sends once in signup language and preserves suppression and verification state', async () => {
  const h = harness();
  const r = await h.run(true);
  assert.equal(r.accepted, 5);
  assert.equal(r.failedOrUnknown + r.recordFailed, 0);
  assert.deepEqual(h.sent.map(m => m.locale), ['fr', 'fr', 'en', 'ko', 'en']);
  for (const m of h.sent) assert.equal(m.manualCampaign, HISTORICAL_RECOVERY_CAMPAIGN);
  for (const row of h.saved.values()) {
    assert.equal(row.emailVerified, false); assert.equal(row.status, 'pending');
    assert.equal(row.suspect, true); assert.deepEqual(row.flags, ['honeypot']);
    assert.equal(row.sends, 2); assert.ok(row.sentAt); assert.ok(Date.parse(row.expiresAt!) > NOW.getTime());
  }
  const replay = await h.run(true);
  assert.equal(replay.eligible, 0); assert.equal(replay.accepted, 0); assert.equal(h.sent.length, 5);
});

test('legacy missing metadata is allowed only for the two reviewed French attempts', async () => {
  for (const patch of [
    { signedUpAt: '2026-10-13T12:56:01Z' }, { landingPath: '/en' }, { signupLocale: 'en' },
    { signupMethod: 'email' as const }, { authVerificationProvenance: 'email:double-opt-in' },
    { source: 'hero' }, { email: 'synthetic-0@example.test' }, { sends: 2 }, { suspect: false },
    { flags: ['honeypot', 'ip-repeat'] },
  ]) {
    const rows = fixtures(); Object.assign(rows[0], patch);
    const h = harness([rows[0]]); assert.equal((await h.run(true)).accepted, 0, JSON.stringify(patch));
  }
});

test('historical recovered, verified, duplicate and other-claim rows remain ineligible', async () => {
  for (const patch of [
    { sentAt: '2026-10-31T14:00:00Z' }, { status: 'verified' as const }, { emailVerified: true },
    { duplicate: true }, { reminder: 'wd-verification-recovery-20261031 provider_accepted 2026-10-31T14:27:42Z' },
  ]) {
    const rows = fixtures(); Object.assign(rows[2], patch);
    const h = harness([rows[2]]); assert.equal((await h.run(true)).accepted, 0);
  }
  const rows = fixtures();
  const peer = { ...rows[0], pageId: 'different-page', signedUpAt: '2026-10-15T00:00:00Z' };
  assert.equal((await harness([rows[0], peer]).run(true)).accepted, 0);
});

test('historical provider requests use fixed help sender and a distinct per-attempt idempotency key', async () => {
  const h = harness(); await h.run(true);
  const calls: { key: string | null; from: string }[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push({ key: new Headers(init?.headers).get('Idempotency-Key'), from: JSON.parse(String(init?.body)).from });
    return Response.json({ id: 'synthetic-provider-receipt' });
  };
  const mailer = createResendMailer({ RESEND_API_KEY: 'test-key-not-live', WATCHDIVE_EMAIL_FROM: 'obsolete@example.test', WATCHDIVE_EMAIL_FROM_NAME: 'WatchDive' }, fetcher, async () => undefined);
  for (const m of h.sent) await mailer.send(m);
  assert.equal(new Set(calls.map(c => c.key)).size, 5);
  calls.forEach((c, i) => {
    assert.equal(c.key, `${HISTORICAL_RECOVERY_CAMPAIGN}-${h.sent[i].leadId}`);
    assert.equal(c.from, 'WatchDive <help@diveroid.com>');
  });
});
