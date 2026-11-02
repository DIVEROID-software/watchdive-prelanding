import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/lib/sitePresenceClient.js',import.meta.url),'utf8');
const {startSitePresence}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function browser(storage = new Map()) {
  const events=new Map(), documentEvents=new Map(), requests=[];
  let tick;
  const env={location:{hostname:'www.diveroid.com'},crypto:{randomUUID},navigator:{},
    document:{visibilityState:'visible',addEventListener:(k,v)=>documentEvents.set(k,v),removeEventListener:k=>documentEvents.delete(k)},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return{ok:true};},
    addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k),
    setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{tick=null;}};
  env.top=env.self=env;
  return{env,requests,events,documentEvents,storage,tick:()=>tick?.()};
}
test('visible heartbeat, hidden departure, resumption and teardown',()=>{
 const b=browser(),stop=startSitePresence({site:'diveroid',env:b.env});
 assert.equal(b.requests[0].body.event,'heartbeat');
 assert.equal(b.requests[0].credentials,'omit');assert.equal(b.requests[0].referrerPolicy,'no-referrer');
 b.env.document.visibilityState='hidden';b.documentEvents.get('visibilitychange')();
 assert.equal(b.requests.at(-1).body.event,'leave');const count=b.requests.length;b.tick();assert.equal(b.requests.length,count);
 b.env.document.visibilityState='visible';b.documentEvents.get('visibilitychange')();assert.equal(b.requests.at(-1).body.event,'heartbeat');
 stop();assert.equal(b.requests.at(-1).body.event,'leave');assert.equal(b.events.size,0);assert.equal(b.documentEvents.size,0);
});
test('same browser shares an ID but has distinct tab IDs; storage events do not loop',()=>{
 const shared=new Map(),a=browser(shared),b=browser(shared);
 const stopA=startSitePresence({site:'diveroid',env:a.env}),stopB=startSitePresence({site:'diveroid',env:b.env});
 assert.equal(a.requests[0].body.visitor,b.requests[0].body.visitor);assert.notEqual(a.requests[0].body.tab,b.requests[0].body.tab);
 a.events.get('storage')({key:'diveroid.presence.v1'});assert.equal(a.requests.length,1);
 stopA();stopB();
});
test('consent opt-out removes presence and ID; GPC, hidden pages and preview hosts do not count',()=>{
 let allowed=false;const b=browser();const stop=startSitePresence({site:'diveroid',env:b.env,allowed:()=>allowed});assert.equal(b.requests.length,0);assert.equal(b.storage.size,0);
 allowed=true;b.tick();assert.equal(b.requests.at(-1).body.event,'heartbeat');allowed=false;b.tick();assert.equal(b.requests.at(-1).body.event,'leave');assert.equal(b.storage.size,0);stop();
 for(const kind of ['gpc','preview','hidden']){const a=browser();if(kind==='gpc')a.env.navigator.globalPrivacyControl=true;if(kind==='preview')a.env.location.hostname='preview.vercel.app';if(kind==='hidden')a.env.document.visibilityState='hidden';const cleanup=startSitePresence({site:'diveroid',env:a.env});assert.equal(a.requests.length,0);cleanup();}
});
