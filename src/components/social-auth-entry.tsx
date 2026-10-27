import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { googleClientId } from "@/lib/googleTag";
import { hasSocialAcknowledgement, socialAckCookie } from "@/lib/socialAuthAcknowledgement";

import { SocialSignupButtons, type SocialProvider } from "@/components/SocialSignupButtons";
import { segmentFromPathname } from "@/lib/segments/navigation";
import { getAttribution } from "@/lib/attribution";
import { getPressRef } from "@/lib/pressRef";
import { getConversionExperiment, closeExperimentEnrollmentOnSubmit, markConversionMilestone } from "@/lib/conversionExperimentClient";
import type { Locale } from "@/lib/i18n/locale";
import { getMetaCookies, hasMetaMeasurementConsent, measurementPermitted } from "@/lib/metaPixel";
import { socialAuthResultCopy, type SocialAuthResultKind } from "@/lib/socialAuthResultCopy";

export function SocialAuthEntry({
  locale,
  source,
  disabled,
  referredBy,
}: {
  locale: Locale;
  source: "hero" | "offer";
  disabled?: boolean;
  referredBy?: string;
}) {
  const [enabled, setEnabled] = useState<{ google: boolean; apple: boolean }>({
    google: false,
    apple: false,
  });
  const [loading, setLoading] = useState<SocialProvider | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let googleBlocked = new URL(window.location.href).searchParams.get("auth") === "open-browser";
    const hideGoogle = () => {
      googleBlocked = true;
      setEnabled((current) => ({ ...current, google: false }));
    };
    window.addEventListener("wd:google-blocked", hideGoogle);
    void fetch("/api/auth/providers", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { google?: unknown; apple?: unknown } | null) => {
        if (cancelled || !body) return;
        setEnabled({ google: body.google === true && !googleBlocked, apple: body.apple === true });
      })
      .catch(() => {
        if (!cancelled) setEnabled({ google: false, apple: false });
      });
    return () => {
      cancelled = true;
      window.removeEventListener("wd:google-blocked", hideGoogle);
    };
  }, []);

  async function onProvider(provider: SocialProvider) {
    closeExperimentEnrollmentOnSubmit();
    markConversionMilestone("submitAttempted", source);
    setFailed(false);
    setLoading(provider);
    try {
      const attribution = getAttribution();
      const segment = segmentFromPathname(window.location.pathname);
      const cookies = hasMetaMeasurementConsent() ? getMetaCookies() : {};
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          provider,
          source,
          locale,
          ...(segment ? { segment } : {}),
          attribution,
          measurementConsent: measurementPermitted(),
          googleClientId: googleClientId(),
          experiment: getConversionExperiment(),
          pressRef: getPressRef(),
          ...(referredBy ? { referredBy } : {}),
          ...cookies,
        }),
      });
      const body = (await response.json().catch(() => null)) as { url?: unknown; error?: unknown } | null;
      if (response.status === 409 || body?.error === "in_app_browser") {
        setEnabled((current) => ({ ...current, google: false }));
        window.dispatchEvent(new Event("wd:google-blocked"));
        return;
      }
      if (response.ok && typeof body?.url === "string" && body.url.startsWith("https://")) {
        window.location.assign(body.url);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SocialSignupButtons
        locale={locale}
        enabledProviders={enabled}
        loadingProvider={loading}
        disabled={disabled}
        onProvider={(provider) => void onProvider(provider)}
      />
      {failed && <p role="status" className="text-xs leading-relaxed text-white/80">{socialAuthResultCopy(locale).error}</p>}
    </div>
  );
}

const SocialResultContext = createContext<SocialAuthResultKind | null>(null);

export type SocialContinuationCredential = { kind: "confirmation"; value: string };

type SocialContinuationState = {
  credential: SocialContinuationCredential | null;
  phoneSaved: boolean;
  markPhoneSaved: () => void;
};

const SocialContinuationContext = createContext<SocialContinuationState>({
  credential: null,
  phoneSaved: false,
  markPhoneSaved: () => {},
});

function continuationCredential(body: unknown): SocialContinuationCredential | null {
  if (!body || typeof body !== "object") return null;
  const row = body as { status?: unknown; credential?: { kind?: unknown; value?: unknown } };
  const value = row.credential?.value;
  if (row.status !== "ready" || row.credential?.kind !== "confirmation" || typeof value !== "string") return null;
  if (value.length < 20 || value.length > 2000 || /[\s@]/.test(value)) return null;
  return { kind: "confirmation", value };
}

export function SocialSignupResultProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SocialAuthResultKind | null>(null);
  const [credential, setCredential] = useState<SocialContinuationCredential | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const markPhoneSaved = useCallback(() => setPhoneSaved(true), []);
  useEffect(() => {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("auth");
    const acknowledged = hasSocialAcknowledgement(value, document.cookie);
    // Consume even when the query is missing, so an abandoned callback receipt
    // cannot be reused on a later visit. This flag controls presentation only.
    document.cookie = socialAckCookie(false);
    if (value?.toLowerCase() === "confirmed") {
      url.searchParams.delete("auth");
      window.history.replaceState(window.history.state, "", url.toString());
      if (acknowledged) setKind("confirmed");
    } else if (value === "check-email" || value === "pending" || value === "error" || value === "open-browser") {
      setKind(value);
    }
    // The acknowledgement cookie is not consulted. A missing grant simply
    // leaves the phone and reservation steps off.
    const stop = { current: false };
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (stop.current) return;
        try {
          const response = await fetch("/api/auth/continuation", {
            method: "POST",
            credentials: "same-origin",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: "{}",
          });
          const payload = (await response.json().catch(() => null)) as unknown;
          if (stop.current) return;
          const next = continuationCredential(payload);
          if (next) {
            setCredential(next);
            return;
          }
          const reason = payload && typeof payload === "object" ? (payload as { reason?: unknown }).reason : undefined;
          if (response.ok && reason === "retry" && attempt < 2) continue;
          return;
        } catch {
          if (attempt >= 2) return;
        }
      }
    })();
    return () => {
      stop.current = true;
    };
  }, []);
  return (
    <SocialResultContext.Provider value={kind}>
      <SocialContinuationContext.Provider value={{ credential, phoneSaved, markPhoneSaved }}>
        {children}
      </SocialContinuationContext.Provider>
    </SocialResultContext.Provider>
  );
}

export function useSocialSignupCompleted(): boolean {
  return useContext(SocialResultContext) === "confirmed";
}

export function useSocialContinuation(): SocialContinuationState {
  return useContext(SocialContinuationContext);
}

export function SocialAuthResult({ locale }: { locale: Locale }) {
  const kind = useContext(SocialResultContext);
  // Completion replaces the form. It never appears above fresh signup fields.
  if (!kind || kind === "confirmed" || kind === "open-browser") return null;
  return (
    <p role="status" className="mb-3 text-sm leading-relaxed text-white/90">
      {socialAuthResultCopy(locale)[kind]}
    </p>
  );
}
