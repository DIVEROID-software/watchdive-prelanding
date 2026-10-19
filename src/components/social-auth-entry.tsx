import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hasSocialAcknowledgement, socialAckCookie } from "@/lib/socialAuthAcknowledgement";

import { SocialSignupButtons, type SocialProvider } from "@/components/SocialSignupButtons";
import { getAttribution } from "@/lib/attribution";
import { getConversionExperiment } from "@/lib/conversionExperimentClient";
import type { Locale } from "@/lib/i18n/locale";
import { getMetaCookies, hasMetaMeasurementConsent } from "@/lib/metaPixel";
import { socialAuthResultCopy, type SocialAuthResultKind } from "@/lib/socialAuthResultCopy";
import { socialSignupCopyFor } from "@/lib/socialSignupCopy";

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
  const [guidance, setGuidance] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/providers", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { google?: unknown; apple?: unknown } | null) => {
        if (cancelled || !body) return;
        setEnabled({ google: body.google === true, apple: body.apple === true });
      })
      .catch(() => {
        if (!cancelled) setEnabled({ google: false, apple: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onProvider(provider: SocialProvider) {
    setLoading(provider);
    try {
      const attribution = getAttribution();
      const cookies = hasMetaMeasurementConsent() ? getMetaCookies() : {};
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          provider,
          source,
          locale,
          attribution,
          measurementConsent: hasMetaMeasurementConsent(),
          experiment: getConversionExperiment(),
          ...(referredBy ? { referredBy } : {}),
          ...cookies,
        }),
      });
      const body = (await response.json().catch(() => null)) as { url?: unknown; error?: unknown } | null;
      if (response.status === 409 || body?.error === "in_app_browser") {
        setGuidance(true);
        return;
      }
      if (response.ok && typeof body?.url === "string" && body.url.startsWith("https://")) {
        window.location.assign(body.url);
        return;
      }
    } catch {
      // The email form below is unchanged.
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
      {guidance ? (
        <p role="status" className="text-xs leading-relaxed text-white/80">
          {socialSignupCopyFor(locale).embedded.body}
        </p>
      ) : null}
    </div>
  );
}

const SocialResultContext = createContext<SocialAuthResultKind | null>(null);

export function SocialSignupResultProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<SocialAuthResultKind | null>(null);
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
      return;
    }
    if (value === "check-email" || value === "pending" || value === "error" || value === "open-browser") {
      setKind(value);
    }
  }, []);
  return <SocialResultContext.Provider value={kind}>{children}</SocialResultContext.Provider>;
}

export function useSocialSignupCompleted(): boolean {
  return useContext(SocialResultContext) === "confirmed";
}

export function SocialAuthResult({ locale }: { locale: Locale }) {
  const kind = useContext(SocialResultContext);
  // Completion replaces the form. It never appears above fresh signup fields.
  if (!kind || kind === "confirmed") return null;
  return (
    <p role="status" className="mb-3 text-sm leading-relaxed text-white/90">
      {socialAuthResultCopy(locale)[kind]}
    </p>
  );
}
