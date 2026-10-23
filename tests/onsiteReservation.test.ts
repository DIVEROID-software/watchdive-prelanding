import test from 'node:test';
import assert from 'node:assert/strict';
import { onsiteReservation } from '../src/lib/reservation/onsite.ts';
import { verifyReservationInvite } from '../src/lib/reservation/invite.ts';
import { createVerificationToken, signPollHandle } from '../src/lib/verification/token.ts';
import { POLL_HANDLE_TTL_MS } from '../src/lib/verification/contracts.ts';
import { FakeLeadStore, TEST_ENV, TEST_SECRET } from './helpers/fakes.ts';
import { SUPPORTED_LOCALES } from '../src/lib/i18n/locale.ts';
import { ONSITE_OFFER_COPY } from '../src/components/reservation/onsite-copy.ts';

const now = Date.parse('2026-10-21T00:00:00Z');
const leadId = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const reserveSecret = 'onsite-reservation-secret-test-32-bytes';
const env = { ...TEST_ENV, WATCHDIVE_RESERVATION_ENABLED: 'true',
 STRIPE_SECRET_KEY: 'sk_test_offline_only_fake_key', STRIPE_WEBHOOK_SECRET: 'whsec_offline_fake',
 WATCHDIVE_RESERVATION_TOKEN_SECRET: reserveSecret };
function fixture(overrides = {}) {
 const store = new FakeLeadStore();
 const row = store.seed({email:'diver@example.com', canonical:'diver@example.com', leadId,
  status:'verified', emailVerified:true, ...overrides});
 return {store, row, env, now:()=>now};
}
const confirmation = {kind:'confirmation' as const, value:createVerificationToken(leadId,now+60_000,false,TEST_SECRET,'ko')};
const attempt = {kind:'attempt' as const, value:signPollHandle(leadId,now,false,TEST_SECRET,'diver@example.com')};
for (const credential of [confirmation, attempt]) {
 test(`${credential.kind} offers a signed invite only for an actually verified row`, async()=>{
  const deps=fixture(); const before=JSON.stringify([...deps.store.rows]);
  const result=await onsiteReservation({credential,locale:'ko'},deps);
  assert.equal(result.status,'ready'); if(result.status!=='ready')return;
  assert.ok(result.href.startsWith('/reservation?lang=ko#invite='));
  const token=decodeURIComponent(result.href.split('#invite=')[1]);
  const parsed=verifyReservationInvite(token,reserveSecret,now);
  assert.equal(parsed?.email,'diver@example.com'); assert.equal(parsed?.emailVerified,true);
  assert.equal(parsed?.expiresAtMs,now+86_400_000);
  assert.equal(JSON.stringify([...deps.store.rows]),before);
  assert.equal(deps.store.markVerifiedCalls,0); assert.equal(deps.store.markSentCalls,0);
 });
 test(`${credential.kind} never turns a pending signup into payment authorization`,async()=>{
  assert.equal((await onsiteReservation({credential,locale:'en'},fixture({status:'pending',emailVerified:false}))).status,'verification_required');
 });
}
for(const [name, overrides] of Object.entries({unsubscribed:{status:'unsubscribed'}, suspect:{suspect:true}, abuse:{flags:['headless']}, inconsistent:{emailVerified:false}})) {
 test(`${name} lead cannot receive a reservation invite`,async()=>{
  assert.equal((await onsiteReservation({credential:confirmation,locale:'en'},fixture(overrides))).status,'verification_required');
 });
}
test('duplicate lead cannot receive an invite',async()=>{
 const deps=fixture(); deps.row.duplicate=true;
 assert.equal((await onsiteReservation({credential:attempt,locale:'en'},deps)).status,'verification_required');
});
test('decoy and rotated-attempt handles never fall back to the sealed email',async()=>{
 const credential={kind:'attempt' as const,value:signPollHandle('aaaaaaaa-bbbb-4ccc-8ddd-000000000002',now,false,TEST_SECRET,'diver@example.com')};
 assert.equal((await onsiteReservation({credential,locale:'en'},fixture())).status,'verification_required');
});
test('expired and tampered credentials fail closed',async()=>{
 const credentials=[{...confirmation,value:confirmation.value+'x'},
  {kind:'confirmation' as const,value:createVerificationToken(leadId,now-1_000,false,TEST_SECRET)},
  {kind:'attempt' as const,value:signPollHandle(leadId,now-POLL_HANDLE_TTL_MS-1,false,TEST_SECRET)}];
 for(const credential of credentials)assert.equal((await onsiteReservation({credential,locale:'en'},fixture())).status,'verification_required');
});
test('disabled or misconfigured reservation stays unavailable',async()=>{
 for(const badEnv of [{...env,WATCHDIVE_RESERVATION_ENABLED:'false'}, {...env,WATCHDIVE_RESERVATION_TOKEN_SECRET:''}, {...env,STRIPE_SECRET_KEY:'sk_live_this_must_stay_disabled'}]) {
  assert.equal((await onsiteReservation({credential:confirmation,locale:'en'},{...fixture(),env:badEnv})).status,'unavailable');
 }
});
test('stored signup language wins; signed confirmation locale is the fallback',async()=>{
 const deps=fixture();deps.row.signupLocale='fr';
 const french=await onsiteReservation({credential:confirmation,locale:'de'},deps);
 assert.ok(french.status==='ready'&&french.href.startsWith('/reservation?lang=fr#'));
 const korean=await onsiteReservation({credential:confirmation,locale:'de'},fixture());
 assert.ok(korean.status==='ready'&&korean.href.startsWith('/reservation?lang=ko#'));
});
test('measurement refusal does not prevent a voluntary purchase',async()=>{
 const result=await onsiteReservation({credential:attempt,locale:'en'},fixture({flags:['measurement-withdrawn']}));
 assert.equal(result.status,'ready');
});
test('all nine languages expose the offer and separate-fee/refund/authentication conditions',()=>{
 assert.deepEqual(Object.keys(ONSITE_OFFER_COPY).sort(),[...SUPPORTED_LOCALES].sort());
 for(const copy of Object.values(ONSITE_OFFER_COPY)) {
  for(const value of Object.values(copy))assert.ok(value.trim().length>0);
  assert.match(copy.body,/149/);assert.match(copy.nextPrice,/100/);assert.match(copy.nextPrice,/200/);
  assert.match(copy.separate,/149/);assert.match(copy.separate,/3/);
  assert.notEqual(copy.pending,copy.verified); assert.notEqual(copy.cta,copy.verifyCta);
 }
});
