import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleDirectReservation} from '../src/lib/reservation/direct.ts';
import {directHash, bindDirectSession, DIRECT_FLOW} from '../src/lib/reservation/directIdentity.ts';
import {contractMetadata} from '../src/lib/reservation/checkout.ts';
import type {StripeApi,StripeCheckoutSession} from '../src/lib/reservation/stripeApi.ts';
const origin='https://watchdive.diveroid.com';
const nonce='a'.repeat(64);
const env={WATCHDIVE_RESERVATION_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_fake_direct_reservation',STRIPE_WEBHOOK_SECRET:'whsec_fake_direct',WATCHDIVE_PUBLIC_ORIGIN:origin};
const request=(body:unknown, from=origin)=>new Request(`${origin}/api/reservation/direct`,{method:'POST',headers:{origin:from,'content-type':'application/json'},body:JSON.stringify(body)});
const payload={action:'checkout',nonce,acceptedTerms:true,termsVersion:'2026-10-18'};
function fake() {
  const calls:{url:string;params:URLSearchParams;key:string|null}[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=String(input);const params=new URLSearchParams(String(init?.body??''));calls.push({url,params,key:new Headers(init?.headers).get('idempotency-key')});
    if(url.includes('/line_items'))return Response.json({data:[{quantity:1,currency:'usd',amount_total:300,price:{currency:'usd',unit_amount:300,recurring:null}}],has_more:false});
    const metadata:Record<string,string>={};for(const [k,v] of params)if(/^metadata\[/.test(k))metadata[k.slice(9,-1)]=v;
    return Response.json({id:'cs_test_direct123',url:'https://checkout.stripe.com/c/pay/cs_test_direct123',status:'open',payment_status:'unpaid',amount_total:300,currency:'usd',mode:'payment',metadata,client_reference_id:null,customer:null,payment_intent:null,expires_at:2000000000,created:1800000000,livemode:false,success_url:params.get('success_url')});
  };return {calls,fetchImpl};
}
test('guest checkout collects email in Stripe, charges only $3, and repeats use one key',async()=>{
  const f=fake();
  for(let i=0;i<2;i++) {const res=await handleDirectReservation(request(payload),{env,fetchImpl:f.fetchImpl,nowMs:1800000000000});assert.equal(res.status,200,await res.text());}
  const creates=f.calls.filter(c=>c.url.endsWith('/sessions'));
  assert.equal(creates[0].key,creates[1].key);
  const p=creates[0].params;assert.equal(p.get('customer_creation'),'always');assert.equal(p.has('customer'),false);assert.equal(p.has('customer_email'),false);assert.equal(p.get('line_items[0][price_data][unit_amount]'),'300');assert.equal(p.has('metadata[email_sha256]'),false);
});
test('cross origin, unaccepted terms, and malformed bodies cannot create sessions',async()=>{
  const f=fake();for(const [body,from,status] of [[payload,'https://evil.test',403],[{...payload,acceptedTerms:false},origin,400],[null,origin,400]] as const){assert.equal((await handleDirectReservation(request(body,from),{env,fetchImpl:f.fetchImpl})).status,status);}assert.equal(f.calls.length,0);
});
test('binding uses Stripe customer email, does not mutate session or claim email verification',async()=>{
 const metadata=contractMetadata({emailSha256:''});delete metadata.email_sha256;
 const session={metadata:{...metadata,entry_flow:DIRECT_FLOW,browser_proof:directHash(nonce)},customerId:'cus_real',clientReferenceId:null} as StripeCheckoutSession;
 const stripe={retrieveCustomer:async()=>({id:'cus_real',email:'Owner@example.com',metadata:{}})} as unknown as StripeApi;
 const bound=await bindDirectSession(stripe,session);assert.equal(bound?.metadata.email_sha256,directHash('reservation-email:v1:owner@example.com'));assert.equal(session.metadata.email_sha256,undefined);assert.equal('emailVerified' in bound!,false);
});
test('session status requires browser proof and does not reveal payment to another browser',async()=>{
 const res=await handleDirectReservation(request({action:'status',nonce,sessionId:'cs_test_someoneelse'}),{env,fetchImpl:async()=>Response.json({id:'cs_test_someoneelse',status:'open',payment_status:'unpaid',amount_total:300,currency:'usd',mode:'payment',metadata:{entry_flow:DIRECT_FLOW,browser_proof:'b'.repeat(64)},expires_at:2000000000,created:1800000000,livemode:false})});assert.equal(res.status,404);
});
