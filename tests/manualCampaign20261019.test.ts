import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN, manualSkip, runManual, handleManualCampaign, readAll} from '../src/lib/verification/manualCampaign20261019.server.ts';
import type {LeadRecord} from '../src/lib/verification/contracts.ts';
import type {ReminderStore} from '../src/lib/verification/reminder.ts';
import type {VerificationMail} from '../src/lib/verification/resend.ts';
import {TEST_ENV} from './helpers/fakes.ts';
const NOW=new Date('2026-10-19T03:00:00Z');
const row=(patch:Partial<LeadRecord>={}):LeadRecord=>({pageId:'p1',email:'owner@example.com',status:'pending',emailVerified:false,refCode:'ref',source:'hero',suspect:false,flags:[],phone:'',smsConsent:'',leadId:'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',metaEventId:'evt',sends:2,sentAt:'2026-10-07T00:00:00Z',signedUpAt:'2026-10-07T00:00:00Z',signupLocale:'ko',reminder:'sent 2026-10-08T00:00:00.000Z',...patch});
function harness(rows:LeadRecord[]) {
 const map=new Map(rows.map(r=>[r.pageId,{...r}]));const sent:VerificationMail[]=[];let claims=0;
 const store:ReminderStore={findReminderCandidates:async()=>[],countUnsentPending:async()=>0,reread:async id=>map.get(id),claimReminder:async(id,c)=>{claims++;Object.assign(map.get(id)!,{reminder:c.marker,expiresAt:c.expiresAt,sends:c.sends});},recordReminderOutcome:async(id,s)=>{map.get(id)!.reminder=s;}};
 const input={rows,store,mailer:{send:async(m:VerificationMail)=>{sent.push(m);},sendWelcome:async()=>{}},env:TEST_ENV,send:true,now:()=>NOW,sleep:async()=>{}};
 return {map,sent,store,input,claims:()=>claims};
}
test('manual backlog includes old successful reminders but not recent, failed, verified or new cohort',()=>{
 assert.equal(manualSkip(row(),NOW.getTime()),undefined);
 for(const patch of [{emailVerified:true},{verifiedAt:NOW.toISOString()},{status:'unsubscribed' as const},{suspect:true},{duplicate:true},{reminder:'failed rejected 2026-10-08T00:00:00Z'},{reminder:'sent 2026-10-19T02:00:00Z'},{reminder:CAMPAIGN+' claimed'},{signedUpAt:'2026-10-19T02:30:00Z'},{sentAt:undefined},{sends:99}])assert.ok(manualSkip(row(patch),NOW.getTime()));
});
test('dry run has no writes or mail and canonical verified peer suppresses',async()=>{
 const h=harness([row(),row({pageId:'p2',emailVerified:true})]);const r=await runManual({...h.input,send:false});assert.equal(r.eligible,0);assert.equal(h.claims(),0);assert.equal(h.sent.length,0);
 const d=harness([row()]);assert.equal((await runManual({...d.input,send:false})).byLocale.ko,1);assert.equal(d.claims(),0);
});
test('one campaign send preserves attempt/previous marker and cannot replay',async()=>{
 const h=harness([row()]);const r=await runManual(h.input);assert.equal(r.accepted,1);assert.equal(h.sent[0].manualCampaign,CAMPAIGN);assert.equal(h.sent[0].locale,'ko');assert.equal(h.sent[0].leadId,row().leadId);assert.match(h.map.get('p1')!.reminder!,/previous:sent 2026-10-08/);
 const again=await runManual({...h.input,rows:[...h.map.values()]});assert.equal(again.accepted,0);assert.equal(h.sent.length,1);
});
test('confirmation between claim and send blocks mail',async()=>{
 const h=harness([row()]);h.input.sleep=async()=>{h.map.get('p1')!.emailVerified=true;};assert.equal((await runManual(h.input)).accepted,0);assert.equal(h.sent.length,0);
});
test('provider ambiguity keeps durable marker and is never retried',async()=>{
 const h=harness([row()]);h.input.mailer.send=async()=>{throw new Error('timeout');};const r=await runManual(h.input);assert.equal(r.failedOrUnknown,1);assert.ok(h.map.get('p1')!.reminder!.includes(CAMPAIGN));assert.equal((await runManual({...h.input,rows:[...h.map.values()]})).eligible,0);
});
test('canonical duplicates get one send and batch cap leaves unclaimed rows eligible',async()=>{
 const h=harness([row({email:'a.b+1@gmail.com'}),row({pageId:'p2',email:'ab@gmail.com'})]);assert.equal((await runManual(h.input)).accepted,1);
 const many=harness(Array.from({length:12},(_,i)=>row({pageId:'p'+i,email:`user${i}@example.com`,leadId:`aaaaaaaa-bbbb-4ccc-8ddd-${i.toString(16).padStart(12,'0')}`})));const r=await runManual(many.input);assert.equal(r.accepted,10);assert.equal(r.deferred,2);
});
test('closed campaign and unauthorized endpoint cannot send',async()=>{
 const h=harness([row()]);await assert.rejects(()=>runManual({...h.input,now:()=>new Date('2026-10-21T00:00:00Z')}),/closed/);
 assert.equal((await handleManualCampaign(new Request('https://example.com',{method:'POST',body:'{}'}))).status,401);
});
test('pagination failure never returns a partial list',async()=>{
 await assert.rejects(()=>readAll(async()=>({results:[],has_more:true,next_cursor:null}),'db'),/incomplete/);
});
