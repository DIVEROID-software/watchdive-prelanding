import { experimentReportAuthorized } from './experimentReport.ts';
import { createBehaviorNotion } from './api/behaviorNotion.ts';
import { createNotionRequest } from './verification/notionLead.ts';
import { parseBehaviorSections, parseLeadExperiment, FIELD_CONVERSION_EXPERIMENT } from './conversionExperimentContract.ts';
import { conversionBlocked, MEASUREMENT_CONSENT_GRANTED } from './verification/contracts.ts';

type Row = {id?:string;properties?:Record<string,any>};
const text=(p:any)=>(p?.rich_text||p?.title||[]).map((s:any)=>s.plain_text??s.text?.content??'').join('');
const key=(source:string,campaign:string)=>source+'|'+campaign;
export function aggregateSocialKit(behavior:Row[],leads:Row[]){
 const groups=new Map<string,{source:string;campaign:string;sessions:Set<string>;leads:Set<string>;converting:Set<string>;unmatched:number}>();
 const bucket=(source:string,campaign:string)=>{const k=key(source,campaign);if(!groups.has(k))groups.set(k,{source,campaign,sessions:new Set(),leads:new Set(),converting:new Set(),unmatched:0});return groups.get(k)!;};
 for(const row of behavior){const p=row.properties||{};const [source,medium,campaign]=text(p.Campaign).split(' / ');if(!/^shop-[a-f0-9]{12}$/.test(source||'')||medium!=='organic_social'||!campaign)continue;
  const parsed=parseBehaviorSections(text(p.Sections)),id=text(p.Name);if(parsed.malformed||!parsed.context||parsed.context.qa||parsed.context.sessionId!==id)continue;
  bucket(source,campaign).sessions.add(id);
 }
 const seen=new Set<string>();
 for(const row of leads){const p=row.properties||{};const source=text(p['UTM Source']),campaign=text(p['UTM Campaign']);if(!/^shop-[a-f0-9]{12}$/.test(source)||text(p['UTM Medium'])!=='organic_social'||!campaign)continue;
  const flags=(p.Flags?.multi_select||[]).map((f:any)=>f.name);const parsed=parseLeadExperiment(text(p[FIELD_CONVERSION_EXPERIMENT]));
  if(p.Suspect?.checkbox||p.Duplicate?.checkbox||conversionBlocked(flags)||text(p['Measurement consent'])!==MEASUREMENT_CONSENT_GRANTED||parsed.context?.qa)continue;
  if(!(p['Email verified']?.checkbox||p['Verification status']?.select?.name==='verified')||!p['Verified at']?.date?.start||!p['Signed up']?.date?.start)continue;
  const leadId=text(p['Lead ID'])||row.id;if(!leadId||seen.has(leadId))continue;seen.add(leadId);
  const b=bucket(source,campaign);b.leads.add(leadId);const sid=parsed.context?.sessionId;if(sid&&b.sessions.has(sid))b.converting.add(sid);else b.unmatched++;
 }
 return [...groups.values()].map(g=>({source:g.source,campaign:g.campaign,landingSessions:g.sessions.size,signups:g.leads.size,convertingSessions:g.converting.size,unmatchedSignups:g.unmatched,conversionRate:g.sessions.size?g.converting.size/g.sessions.size:null}));
}
async function collect(query:(body:Record<string,unknown>)=>Promise<any>,filter:Record<string,unknown>){
 const rows:Row[]=[];let cursor:string|undefined;
 for(let n=0;n<40;n++){const page=await query({filter,page_size:100,...(cursor?{start_cursor:cursor}:{})});if(!Array.isArray(page.results))throw Error('invalid_source');rows.push(...page.results);if(!page.has_more)return rows;if(typeof page.next_cursor!=='string')throw Error('incomplete');cursor=page.next_cursor;}throw Error('incomplete');
}
let cached:{at:number;report:unknown}|undefined;
export async function handleSocialKitReport(request:Request){
 const response=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Authorization'}});
 if(!experimentReportAuthorized(request.headers.get('authorization'),process.env.WATCHDIVE_EXPERIMENT_REPORT_TOKEN))return response(401,{error:'unauthorized'});
 if(cached&&Date.now()-cached.at<300000)return response(200,cached.report);
 try{
  if(!process.env.NOTION_API_KEY||!process.env.NOTION_UX_DB_ID||!process.env.NOTION_WAITLIST_DB_ID)throw Error('unconfigured');
  const behavior=createBehaviorNotion({env:process.env,log:()=>{}}),notion=createNotionRequest(fetch,process.env);
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [visits,leads]=await Promise.all([
   collect(async body=>{const r=await behavior.queryDetailed(body);if(!r.ok)throw Error('unavailable');return r.page;},{and:[{property:'Campaign',rich_text:{starts_with:'shop-'}},{timestamp:'created_time',created_time:{on_or_after:since}}]}),
   collect(body=>notion('POST',`databases/${process.env.NOTION_WAITLIST_DB_ID}/query`,body),{and:[{property:'UTM Source',rich_text:{starts_with:'shop-'}},{property:'Signed up',date:{on_or_after:since}}]})
  ]);
  const report={complete:true,since,generatedAt:new Date().toISOString(),definition:'consented_30min_tab_sessions_and_verified_signups',rows:aggregateSocialKit(visits,leads)};cached={at:Date.now(),report};return response(200,report);
 }catch{return response(503,{complete:false,error:'measurement_unavailable'});}
}
