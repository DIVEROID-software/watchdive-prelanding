// User-authorized one-off reminder, independent of the recurring 24h policy.
// The office operator holds verification-reminder/operator.lock across requests.
// Claims are never cleared, including timeout/ambiguous provider outcomes.
import type { LeadRecord } from './contracts.ts';
import { reviewFlags, VERIFICATION_MAX_SENDS } from './contracts.ts';
import { canonicalEmail } from '../api/abuse.ts';
import { reminderLocale, reminderExpiryMs, type ReminderStore } from './reminder.ts';
import { createNotionRequest, createNotionReminderStore, toLeadRecord, type NotionRequest } from './notionLead.ts';
import { createResendMailer, type VerificationMailer } from './resend.ts';
import { createVerificationToken, requireSecret, requirePublicOrigin, isLeadId, type TokenEnvironment } from './token.ts';
import { checkCronAuthorization } from './cronAuth.ts';

export const CAMPAIGN = 'wd-manual-verify-20261019';
export const CUTOFF = '2026-10-19T02:26:00Z';
export const CLOSE_AT = '2026-10-20T02:26:00Z';
const DAY = 86400000;
const identity = (r: LeadRecord) => canonicalEmail(r.email);
const verified = (r: LeadRecord) => r.emailVerified || Boolean(r.verifiedAt) || r.status === 'verified';
export function manualSkip(r: LeadRecord, now: number): string | undefined {
  if (r.status !== 'pending' || verified(r)) return 'not_pending_or_verified';
  if (!r.signedUpAt || !Number.isFinite(Date.parse(r.signedUpAt)) || Date.parse(r.signedUpAt)>Date.parse(CUTOFF)) return 'outside_cohort';
  if (r.duplicate) return 'duplicate';
  if (r.suspect || reviewFlags(r.flags).length) return 'flagged';
  if (!isLeadId(r.leadId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) return 'invalid_attempt';
  if (!r.sentAt || !Number.isFinite(Date.parse(r.sentAt))) return 'no_original_send';
  if (r.sends >= VERIFICATION_MAX_SENDS) return 'send_cap';
  if (r.reminder) {
    if (r.reminder.includes(CAMPAIGN)) return 'campaign_already_claimed';
    const match = /^sent (\S+)$/.exec(r.reminder);
    if (!match || !Number.isFinite(Date.parse(match[1]))) return 'prior_outcome_unknown_or_failed';
    if (now-Date.parse(match[1])<DAY) return 'recent_reminder';
  }
  return undefined;
}
export async function readAll(request: NotionRequest, databaseId: string): Promise<LeadRecord[]> {
  const rows: LeadRecord[]=[]; let cursor: string | undefined;
  for (let page=0;page<100;page++) {
    const r=await request('POST',`databases/${databaseId}/query`,{page_size:100,...(cursor?{start_cursor:cursor}:{})});
    if (!Array.isArray(r.results) || typeof r.has_more !== 'boolean') throw new Error('incomplete_query');
    for (const raw of r.results) { const row=toLeadRecord(raw as Record<string,unknown>); if (!row) throw new Error('invalid_row'); rows.push(row); }
    if (!r.has_more) return rows;
    if (typeof r.next_cursor !== 'string' || r.next_cursor===cursor) throw new Error('incomplete_query');
    cursor=r.next_cursor;
  }
  throw new Error('query_limit');
}
export async function runManual(input: {rows: LeadRecord[]; store: ReminderStore; mailer: VerificationMailer; env: TokenEnvironment; send: boolean; now?:()=>Date; sleep?:(ms:number)=>Promise<void>}) {
  const clock=input.now??(()=>new Date());const started=clock().getTime();
  const result={campaign:CAMPAIGN,cutoff:CUTOFF,dryRun:!input.send,pending:0,eligible:0,accepted:0,failedOrUnknown:0,notClaimed:0,deferred:0,byLocale:{} as Record<string,number>,skipped:{} as Record<string,number>};
  if (started>=Date.parse(CLOSE_AT)) throw new Error('campaign_closed');
  const secret=requireSecret(input.env);const origin=requirePublicOrigin(input.env);
  const groups=new Map<string,LeadRecord[]>();
  for (const r of input.rows) {const k=identity(r);if(k)groups.set(k,[...(groups.get(k)??[]),r]);}
  const chosen=new Set<string>();const eligible:LeadRecord[]=[];
  for (const r of [...input.rows].sort((a,b)=>(a.signedUpAt??'').localeCompare(b.signedUpAt??'')||a.pageId.localeCompare(b.pageId))) {
    if(r.status!=='pending')continue;result.pending++;
    const k=identity(r);let reason=manualSkip(r,started);
    if(!reason && (groups.get(k)??[]).some(x=>verified(x)||x.status==='unsubscribed'||x.reminder?.includes(CAMPAIGN)))reason='identity_verified_unsubscribed_or_claimed';
    if(!reason&&chosen.has(k))reason='canonical_duplicate';
    if(reason){result.skipped[reason]=(result.skipped[reason]??0)+1;continue;}
    chosen.add(k);eligible.push(r);const locale=reminderLocale(r);result.byLocale[locale]=(result.byLocale[locale]??0)+1;
  }
  result.eligible=eligible.length;if(!input.send)return result;
  const sleep=input.sleep??((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  for(let i=0;i<eligible.length;i++) {
    if(i>=10||clock().getTime()-started>35000){result.deferred=eligible.length-i;break;}
    const original=eligible[i];let fresh=await input.store.reread(original.pageId);
    if(!fresh||fresh.leadId!==original.leadId||identity(fresh)!==identity(original)||manualSkip(fresh,clock().getTime())){result.notClaimed++;continue;}
    // Recheck every peer just before claiming; confirmation/unsubscribe can race the initial query.
    let peerBlocked=false;
    for(const peer of groups.get(identity(original))??[]) {
      if(peer.pageId===fresh.pageId)continue;
      const p=await input.store.reread(peer.pageId);
      if(!p||verified(p)||p.status==='unsubscribed'||p.reminder?.includes(CAMPAIGN))peerBlocked=true;
    }
    if(peerBlocked){result.notClaimed++;continue;}
    const expiry=reminderExpiryMs(clock().getTime());
    const previous=fresh.reminder??'';
    const marker=`${CAMPAIGN} claimed ${clock().toISOString()} previous:${previous}`;
    try {await input.store.claimReminder(fresh.pageId,{marker,expiresAt:new Date(Math.max(expiry,Date.parse(fresh.expiresAt??'')||0)).toISOString(),sends:fresh.sends+1});}
    catch{result.notClaimed++;continue;}
    await sleep(1000);
    fresh=await input.store.reread(original.pageId);
    if(!fresh||fresh.reminder!==marker||fresh.leadId!==original.leadId||identity(fresh)!==identity(original)||fresh.status!=='pending'||verified(fresh)||fresh.duplicate||fresh.suspect||reviewFlags(fresh.flags).length){result.notClaimed++;continue;}
    let outcome:string;
    try {
      const locale=reminderLocale(fresh);const token=createVerificationToken(fresh.leadId,expiry,false,secret,locale);
      await input.mailer.send({to:fresh.email,token,leadId:fresh.leadId,publicOrigin:origin,locale,reminder:true,manualCampaign:CAMPAIGN});
      result.accepted++;outcome=`${CAMPAIGN} accepted ${clock().toISOString()} previous:${previous}`;
    }catch{result.failedOrUnknown++;outcome=`${CAMPAIGN} failed_or_unknown ${clock().toISOString()} previous:${previous}`;}
    try{await input.store.recordReminderOutcome(fresh.pageId,outcome);}catch{/* durable claim remains */}
  }
  return result;
}
export async function handleManualCampaign(request: Request): Promise<Response> {
  const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});
  if(checkCronAuthorization(request.headers.get('authorization'),process.env.WATCHDIVE_REMINDER_CRON_SECRET)!=='authorized')return reply(401,{ok:false});
  if(request.method!=='POST')return reply(405,{ok:false});
  let body: {campaign?:string;mode?:string};try{body=await request.json();}catch{return reply(400,{ok:false});}
  if(!body||body.campaign!==CAMPAIGN||!['dry-run','send'].includes(body.mode??''))return reply(400,{ok:false});
  if(!process.env.NOTION_WAITLIST_DB_ID)return reply(503,{ok:false});
  try{
    const req=createNotionRequest();const rows=await readAll(req,process.env.NOTION_WAITLIST_DB_ID);
    const r=await runManual({rows,store:createNotionReminderStore(req,process.env.NOTION_WAITLIST_DB_ID),mailer:createResendMailer(),env:process.env,send:body.mode==='send'});
    return reply(200,{ok:true,...r});
  }catch{return reply(503,{ok:false,error:'manual_campaign_failed_or_closed'});}
}
