/** Short-lived, first-party presence. Never reads form fields, paths or account data. */
export function startSitePresence({ site, allowed = () => true, endpoint = "https://hub.diveroid.ai/api/site-presence", env = window }) {
  const expectedHosts = site === "watchdive" ? ["watchdive.diveroid.com"] : ["diveroid.com", "www.diveroid.com"];
  if (!expectedHosts.includes(env.location.hostname.toLowerCase()) || env.top !== env.self || !env.crypto?.randomUUID) return () => {};
  const key = "diveroid.presence.v1";
  const ttl = 30 * 60 * 1000;
  const tab = env.crypto.randomUUID();
  let visitor = null, sent = false, stopped = false;
  const permitted = () => !env.navigator.globalPrivacyControl && env.navigator.doNotTrack !== "1" && allowed();
  const identity = () => {
    const now = Date.now();
    try {
      const current = JSON.parse(env.localStorage.getItem(key) || "null");
      if (current && /^[0-9a-f-]{36}$/i.test(current.id) && current.expiresAt > now) visitor = current.id;
      else visitor = env.crypto.randomUUID();
      env.localStorage.setItem(key, JSON.stringify({ id: visitor, expiresAt: now + ttl }));
    } catch { visitor ||= env.crypto.randomUUID(); }
    return visitor;
  };
  const transmit = (event) => {
    if (!visitor) return;
    // text/plain avoids a preflight; omitted credentials and referrer keep the
    // Hub session and page URL out of this public, origin-checked endpoint.
    void env.fetch(endpoint, {
      method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ site, visitor, tab, event }), keepalive: true,
    }).catch(() => {});
  };
  const leave = () => { if (sent) { transmit("leave"); sent = false; } };
  const update = () => {
    if (stopped) return;
    if (!permitted()) {
      leave(); visitor = null;
      try { env.localStorage.removeItem(key); } catch {}
      return;
    }
    if (env.document.visibilityState !== "visible") { leave(); return; }
    const before = visitor;
    const next = identity();
    if (before && before !== next && sent) {
      visitor = before; leave(); visitor = next;
    }
    transmit("heartbeat"); sent = true;
  };
  const pagehide = () => leave();
  // Presence writes are shared by tabs. Reacting to those writes would cause
  // an endless storage-event/heartbeat loop between two open tabs.
  const storageChanged = (event) => {
    if (event.key === null || event.key === "watchdive.measurement-consent.v3") update();
  };
  env.document.addEventListener("visibilitychange", update);
  env.addEventListener("pagehide", pagehide);
  env.addEventListener("pageshow", update);
  env.addEventListener("storage", storageChanged);
  env.addEventListener("watchdive:optional-measurement-consent-changed", update);
  const timer = env.setInterval(update, 20000);
  update();
  return () => {
    stopped = true; leave(); env.clearInterval(timer);
    env.document.removeEventListener("visibilitychange", update);
    env.removeEventListener("pagehide", pagehide);
    env.removeEventListener("pageshow", update);
    env.removeEventListener("storage", storageChanged);
    env.removeEventListener("watchdive:optional-measurement-consent-changed", update);
  };
}
