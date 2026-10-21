// The press link a visitor arrived through (`?press_ref=`), from a published
// article or from the press kit's own link to this page.
//
// Browser-safe. The value is an opaque token naming a press link, never a
// person. It is kept on this device for seven days, first touch wins, and it is
// sent only to this site's own server (the waitlist form and the social sign-in
// start), which reports a completed signup to the press tracker. A malformed
// value is ignored.
const STORAGE_KEY = "wd_press_ref";
const REF = /^[A-Za-z0-9_-]{43}$/;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Inline <head> script, placed before every analytics bootstrap. It keeps a
 * valid `press_ref` (storage, plus a page global if storage is blocked) and
 * removes the parameter from the address bar, so the Meta pixel, Google tag
 * and other page-URL collectors never receive it.
 */
export const PRESS_REF_BOOTSTRAP = `(function(){try{var u=new URL(location.href),r=u.searchParams.get("press_ref");if(r===null)return;u.searchParams.delete("press_ref");if(/^[A-Za-z0-9_-]{43}$/.test(r)){window.__wdPressRef=r;try{var n=Date.now(),s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||"null");if(!(s&&typeof s.ref==="string"&&/^[A-Za-z0-9_-]{43}$/.test(s.ref)&&typeof s.at==="number"&&s.at<=n&&n-s.at<${KEEP_MS}))localStorage.setItem(${JSON.stringify(STORAGE_KEY)},JSON.stringify({ref:r,at:n}));}catch(e){}}history.replaceState(history.state,"",u.pathname+u.search+u.hash);}catch(e){}})();`;

export function getPressRef(now: number = Date.now()): string | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("press_ref");
  const handed = (window as { __wdPressRef?: unknown }).__wdPressRef;
  const fromUrl = raw && REF.test(raw) ? raw : typeof handed === "string" && REF.test(handed) ? handed : undefined;
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    // Restricted webview: this page load only.
    return fromUrl;
  }
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as { ref?: unknown; at?: unknown } | null;
    if (
      stored &&
      typeof stored.ref === "string" &&
      REF.test(stored.ref) &&
      typeof stored.at === "number" &&
      stored.at <= now &&
      now - stored.at < KEEP_MS
    ) {
      return stored.ref;
    }
  } catch {
    // Unreadable entry: replaced below.
  }
  if (fromUrl) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ ref: fromUrl, at: now }));
    } catch {
      /* Quota or privacy mode: this page load only. */
    }
  }
  return fromUrl;
}
