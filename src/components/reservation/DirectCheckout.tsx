import { useEffect, useRef, useState } from 'react';
import { TERMS_VERSION } from '../../lib/reservation/constants';
import { reservationCopy } from './copy';
import { RESERVATION_PRESENTATION } from './presentation';
import type { ReservationLocale } from './query';

const KEY = 'watchdive-direct-checkout-v1';
function nonce() {
  let value = sessionStorage.getItem(KEY);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    value = Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
    sessionStorage.setItem(KEY,value);
  }
  return value;
}
export function DirectCheckout({locale}:{locale:ReservationLocale}) {
  const [accepted,setAccepted] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [finished,setFinished] = useState(false);
  const lock = useRef(false);
  const ko = locale === 'ko';
  const copy = reservationCopy(locale);
  const presentation = RESERVATION_PRESENTATION[locale];
  useEffect(()=>{
    const sessionId = new URLSearchParams(location.search).get('session_id');
    if (!sessionId) return;
    let cancelled=false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts=0;
    setFinished(true);
    const check = async () => {
      try {
        const response=await fetch('/api/reservation/direct',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',sessionId,nonce:nonce()})});
        const result=await response.json();
        if(cancelled)return;
        if(response.ok && result.paid === true) {setMessage(ko?'예약 결제가 확인되었습니다. 감사합니다!':'Your reservation payment is confirmed. Thank you!');return;}
        setMessage(ko?'결제 상태를 확인하고 있습니다. 다시 결제하지 마세요.':'Checking payment status. Please do not pay again.');
        if(++attempts<6) timer=setTimeout(check,3000);
      } catch {if(!cancelled)setMessage(copy.checkoutFailed);}
    };
    void check();
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[ko,copy.checkoutFailed]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if(lock.current || !accepted)return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      const response=await fetch('/api/reservation/direct',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'checkout',nonce:nonce(),sessionId:sessionStorage.getItem(KEY+'-session') || undefined,acceptedTerms:true,termsVersion:TERMS_VERSION})});
      const result=await response.json();
      if(response.status===409 && result.error==='session_closed') {
        if(result.status==='complete') { location.assign(`/reservation?direct=1&lang=${encodeURIComponent(locale)}&session_id=${encodeURIComponent(result.sessionId)}`);return; }
        if(result.status==='expired') {sessionStorage.removeItem(KEY);sessionStorage.removeItem(KEY+'-session');}
      }
      if(!response.ok)throw new Error('checkout');
      const target=new URL(result.url);
      if(target.protocol!=='https:' || target.hostname!=='checkout.stripe.com' || target.username || target.password)throw new Error('host');
      sessionStorage.setItem(KEY+'-session', result.sessionId);
      location.assign(target.href);
    } catch {setMessage(copy.checkoutFailed);lock.current=false;setBusy(false);}
  }
  return <form onSubmit={submit}>
    {!finished && <>
      <p>{ko?'이메일과 결제 정보는 Stripe의 안전한 결제창에서 입력합니다.':'Enter your email and payment details securely on Stripe.'}</p>
      <div className="wd-rsv-disclosure"><p>{copy.intro}</p><p>{copy.terms[copy.terms.length-1]}</p></div>
      <label className="wd-rsv-accept"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>{presentation.consent}</span></label>
      <button type="submit" className="wd-rsv-submit" disabled={!accepted || busy}>{busy?copy.checkingOut:presentation.cta} →</button>
      <p className="wd-rsv-reassurance">{presentation.reassurance}</p>
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
