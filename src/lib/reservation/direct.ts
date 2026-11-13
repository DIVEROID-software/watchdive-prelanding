import { readReservationNotionMirrorConfig } from './notionMirror.ts';
import { readReservationConfig } from './config.ts';
import { createStripeClient } from './stripeApi.ts';
import { reservationSessionParams, isHostedCheckoutUrl } from './checkout.ts';
import { META_EMAIL_SHA256, TERMS_VERSION } from './constants.ts';
import { DIRECT_FLOW, directHash, isDirectSession, bindDirectSession } from './directIdentity.ts';
import { aggregateInspections, inspectSession, lineItemsMatch } from './state.ts';
import type { ReservationDeps } from './handlers.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type':'application/json','cache-control':'private, no-store','referrer-policy':'no-referrer'}});
export async function handleDirectReservation(request: Request, deps: ReservationDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return json(405, {error:'method_not_allowed'});
  // No email, customer ID, price or redirect is accepted from the browser.
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json(403, {error:'origin'});
  if (!request.headers.get('content-type')?.includes('application/json')) return json(415, {error:'bad_request'});
  const raw = await request.text();
  if (raw.length > 2048) return json(413, {error:'bad_request'});
  let body: Record<string, unknown>;
  try {body = JSON.parse(raw);} catch {return json(400,{error:'bad_request'});}
  if (!body || typeof body !== 'object' || typeof body.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(body.nonce)) return json(400,{error:'bad_request'});
  const env = deps.env ?? process.env;
  const config = readReservationConfig(env,{webhookSecret:true,tokenSecret:false,origin:true});
  if (!config.ok) return json(503,{error:config.error});
  const mirror = readReservationNotionMirrorConfig(env);
  if (config.value.livemode && (!mirror.enabled || !mirror.ok)) return json(503,{error:'reservation_misconfigured'});
  const stripe = createStripeClient({secretKey:config.value.secretKey,allowLive:config.value.livemode,fetchImpl:deps.fetchImpl});
  const proof = directHash(body.nonce);
  const nowMs = deps.nowMs ?? Date.now();
  try {
    if (body.action === 'status') {
      if (typeof body.sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(body.sessionId)) return json(400,{error:'bad_request'});
      const session = await stripe.retrieveCheckoutSession(body.sessionId);
      if (!isDirectSession(session) || session.metadata.browser_proof !== proof || session.livemode !== config.value.livemode) return json(404,{error:'not_found'});
      const bound = await bindDirectSession(stripe,session);
      if (!bound) return json(200,{status:session.status === 'expired' ? 'expired' : 'pending',paid:false});
      const inspected = await inspectSession(stripe,bound,config.value.livemode,nowMs,bound.metadata[META_EMAIL_SHA256]);
      const snapshot = aggregateInspections([inspected]);
      return json(200,{status:snapshot.status,paid:snapshot.paid});
    }
    if (body.action !== 'checkout' || body.acceptedTerms !== true || body.termsVersion !== TERMS_VERSION) return json(400,{error:'rejected_terms'});
    const params = reservationSessionParams({origin:config.value.origin!,customerId:'',emailSha256:''});
    delete params.customer;
    delete params.client_reference_id;
    for (const key of Object.keys(params)) if (key.endsWith(`[${META_EMAIL_SHA256}]`)) delete params[key];
    params.customer_creation = 'always';
    params['metadata[entry_flow]'] = DIRECT_FLOW;
    params['metadata[browser_proof]'] = proof;
    params.success_url = `${config.value.origin}/reservation?direct=1&session_id={CHECKOUT_SESSION_ID}`;
    params.cancel_url = `${config.value.origin}/reservation?direct=1&canceled=1`;
    // The same browser retains its nonce across retries/cancel/return. One session per nonce.
    if (body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(body.sessionId))) return json(400,{error:'bad_request'});
    const session = typeof body.sessionId === 'string'
      ? await stripe.retrieveCheckoutSession(body.sessionId)
      : await stripe.createCheckoutSession(params,`wd_direct_v1_${proof}`);
    if (!isDirectSession(session) || session.metadata.browser_proof !== proof || session.livemode !== config.value.livemode || session.amountTotal !== 300 || session.currency !== 'usd' || session.mode !== 'payment') return json(502,{error:'contract'});
    if (session.status !== 'open' || session.expiresAt * 1000 <= nowMs) return json(409,{error:'session_closed',status:session.status,sessionId:session.id});
    if (!isHostedCheckoutUrl(session.url) || !lineItemsMatch(await stripe.listLineItems(session.id))) return json(502,{error:'contract'});
    return json(200,{url:session.url,sessionId:session.id});
  } catch {return json(503,{error:'unavailable'});}
}
