import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";

import { TierList } from "@/components/referral/TierList";
import { getReferralStatus, updateReferralSettings } from "@/lib/api/referral.functions";
import { formatNumber, homePath, privacyPath, termsPath, type Locale } from "@/lib/i18n/locale";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import type { ReferralStatus } from "@/lib/referral/contract";
import { fill, referralCopy } from "@/lib/referral/copy";
import { NICKNAME_MAX, NICKNAME_MIN } from "@/lib/referral/program";
import { copyValues } from "@/lib/referral/values";

// The private Buddy Invite page, opened from the signed link in the welcome
// and friend-joined mails (`/buddy#<token>`). The token lives only in the URL
// fragment: it is read here, after mount, and travels only in the POST body of
// the server functions, never as a path or query. The server-rendered HTML is
// the same for everyone, so it carries nothing personal a cache could keep.
// The fragment is left in the address bar on purpose: the link does not
// expire, and a reload or bookmark of the owner's own page must keep working.

/** Signed status tokens are short; anything longer is not one. */
const TOKEN_MAX = 400;

/** The token in a `#<token>` fragment, or "" when there is none. */
function tokenFromHash(hash: string): string {
  const encoded = hash.replace(/^#/, "").trim();
  // A hand-mangled fragment can be invalid percent-encoding, which throws.
  let raw: string;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    raw = encoded;
  }
  return raw.length > 0 && raw.length <= TOKEN_MAX ? raw : "";
}

/** null until mounted (the server has no fragment), then the current fragment's token. */
function useHashToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setToken(tokenFromHash(window.location.hash));
    read();
    // Opening a second mail's link in the same tab changes only the fragment.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return token;
}

type Load =
  | { state: "loading" }
  | { state: "ready"; status: ReferralStatus }
  | { state: "invalid" }
  | { state: "error" };

type ErrorKey = keyof ReturnType<typeof referralCopy>["status"]["errors"];

type Save =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; reason: ErrorKey };

// Mirrors the server's first two checks (trim, collapse whitespace, count code
// points) so the common mistake is caught while typing. The server's
// checkNickname stays authoritative for everything else.
function localNicknameError(raw: string): ErrorKey | null {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return null;
  const length = Array.from(value).length;
  if (length < NICKNAME_MIN) return "too_short";
  if (length > NICKNAME_MAX) return "too_long";
  return null;
}

function Card({ children, role }: { children: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <div
      role={role}
      className="rounded-3xl border border-white/15 bg-white/10 p-5 text-white shadow-2xl backdrop-blur sm:p-8"
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.06] p-3">
      <dt className="text-caption text-white/65">{label}</dt>
      <dd className="mt-1 text-lead font-semibold text-white">{value}</dd>
    </div>
  );
}

export function StatusPage({ locale }: { locale: Locale }) {
  const copy = referralCopy(locale);
  // Navigation and retry labels come from the site's existing reviewed catalog.
  const site = useFrozenLandingMessages().verify;
  const token = useHashToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === null) return;
    // No fragment: nothing to look up, and no request is made.
    if (!token) {
      setLoad({ state: "invalid" });
      return;
    }
    let alive = true;
    setLoad({ state: "loading" });
    getReferralStatus({ data: { token, locale } })
      .then((response) => {
        if (!alive) return;
        setLoad(
          response.status === "ok"
            ? { state: "ready", status: response.referral }
            : { state: "invalid" },
        );
      })
      .catch(() => alive && setLoad({ state: "error" }));
    return () => {
      alive = false;
    };
  }, [token, locale, attempt]);

  return (
    <main className="min-h-screen bg-[color:var(--color-deep-2)] px-4 py-10 sm:px-5 sm:py-14">
      <div className="mx-auto w-full max-w-xl">
        <Link
          to={homePath(locale)}
          className="mb-5 inline-flex min-h-11 items-center text-body text-white/70 underline"
        >
          {site.back}
        </Link>

        {load.state === "loading" && (
          <Card role="status">
            <h1 className="text-heading">{copy.status.title}</h1>
            <div aria-hidden className="mt-5 h-24 animate-pulse rounded-xl bg-white/10" />
          </Card>
        )}

        {load.state === "invalid" && (
          <Card role="alert">
            <h1 className="text-heading">{copy.status.title}</h1>
            <p className="mt-3 text-body leading-relaxed text-white/75">
              {copy.status.invalidLink}
            </p>
          </Card>
        )}

        {load.state === "error" && (
          <Card role="alert">
            <h1 className="text-heading">{copy.status.title}</h1>
            <p className="mt-3 text-body leading-relaxed text-white/75">
              {copy.status.errors.failed}
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/30 px-5 py-3 text-body text-white"
            >
              {site.tryAgain}
            </button>
          </Card>
        )}

        {load.state === "ready" && token && (
          <StatusCard
            key={token}
            token={token}
            locale={locale}
            status={load.status}
            onSettings={(settings) =>
              setLoad({ state: "ready", status: { ...load.status, ...settings } })
            }
          />
        )}

        <footer className="mt-8 text-center text-caption text-white/55">
          <nav className="flex justify-center gap-4">
            <Link to={privacyPath(locale)} className="inline-flex min-h-11 items-center underline">
              {site.footerPrivacy}
            </Link>
            <Link to={termsPath(locale)} className="inline-flex min-h-11 items-center underline">
              {site.footerTerms}
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}

function StatusCard({
  token,
  locale,
  status,
  onSettings,
}: {
  token: string;
  locale: Locale;
  status: ReferralStatus;
  onSettings: (settings: Pick<ReferralStatus, "nickname" | "leaderboard" | "noticesOff">) => void;
}) {
  const copy = referralCopy(locale).status;
  const tiers = referralCopy(locale).tiers;
  const values = { ...copyValues(locale), min: NICKNAME_MIN, max: NICKNAME_MAX };
  const landing = useFrozenLandingMessages().referral;
  const ids = { nickname: useId(), help: useId(), error: useId() };

  const [nickname, setNickname] = useState(status.nickname ?? "");
  const [leaderboard, setLeaderboard] = useState(status.leaderboard);
  const [noticesOff, setNoticesOff] = useState(status.noticesOff);
  const [save, setSave] = useState<Save>({ state: "idle" });
  const [copied, setCopied] = useState(false);

  const localError = localNicknameError(nickname);
  const shownError = save.state === "error" ? save.reason : localError;
  const hiddenStill = status.nicknameHidden && nickname.trim() === (status.nickname ?? "").trim();

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "WatchDive",
          text: landing.shareText,
          url: status.shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(status.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* share sheet dismissed — nothing to do */
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (localError || save.state === "saving") return;
    setSave({ state: "saving" });
    try {
      const response = await updateReferralSettings({
        data: { token, nickname: nickname.trim() ? nickname : null, leaderboard, noticesOff },
      });
      if (response.status === "ok") {
        setNickname(response.settings.nickname ?? "");
        onSettings(response.settings);
        setSave({ state: "saved" });
      } else if (response.status === "rejected") {
        setSave({ state: "error", reason: response.reason });
      } else {
        setSave({ state: "error", reason: "failed" });
      }
    } catch {
      setSave({ state: "error", reason: "failed" });
    }
  }

  const dirty = () => {
    if (save.state !== "saving") setSave({ state: "idle" });
  };

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-heading">{copy.title}</h1>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <Stat label={copy.countLabel} value={formatNumber(status.credited, locale)} />
          <Stat
            label={copy.rankLabel}
            value={status.rank ? `#${formatNumber(status.rank, locale)}` : copy.rankNone}
          />
          <div className="col-span-2">
            <Stat
              label={copy.tierLabel}
              value={status.highestTier ? tiers[status.highestTier].name : copy.tierNone}
            />
          </div>
        </dl>

        {status.earlyNoticeHours > 0 && (
          <p className="mt-4 text-body leading-relaxed text-white/80">
            {fill(copy.earlyNotice, { ...values, hours: status.earlyNoticeHours })}
          </p>
        )}
        {status.lightEligible && (
          <p className="mt-3 text-body leading-relaxed text-[color:var(--color-cyan-glow)]">
            {fill(copy.lightEligible, values)}
          </p>
        )}
        {!status.lightEligible && status.highestTier === "leader" && (
          <p className="mt-3 text-body leading-relaxed text-white/70">
            {fill(copy.lightGone, values)}
          </p>
        )}

        <div className="mt-5 rounded-xl border border-white/15 bg-[color:var(--color-deep-2)]/50 p-4">
          <div className="text-body font-semibold text-[color:var(--color-cyan-glow)]">
            {copy.shareTitle}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              aria-label={copy.shareTitle}
              value={status.shareUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 flex-1 rounded-lg bg-white/95 px-3 text-body text-[color:var(--color-deep-2)] outline-none"
            />
            <button
              type="button"
              onClick={share}
              className="inline-flex h-11 min-h-11 items-center justify-center rounded-lg border border-white/45 bg-[#3D2683] px-4 text-body font-semibold text-[#F6FAFC] hover:brightness-110"
            >
              {copied ? landing.copied : landing.shareButton}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? landing.copied : ""}
          </span>
        </div>
      </Card>

      <Card>
        <TierList locale={locale} credited={status.credited} />
      </Card>

      <Card>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor={ids.nickname} className="text-body font-semibold">
              {copy.nicknameLabel}
            </label>
            <input
              id={ids.nickname}
              value={nickname}
              maxLength={NICKNAME_MAX * 4}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={shownError ? true : undefined}
              aria-describedby={`${ids.help}${shownError ? ` ${ids.error}` : ""}`}
              onChange={(event) => {
                setNickname(event.target.value);
                dirty();
              }}
              className="mt-2 h-11 w-full rounded-lg bg-white/95 px-3 text-body text-[color:var(--color-deep-2)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-cyan-glow)]"
            />
            <p id={ids.help} className="mt-1.5 text-caption text-white/60">
              {fill(copy.nicknameHelp, values)}
            </p>
            {hiddenStill && (
              <p className="mt-1.5 text-caption text-amber-200">{copy.nicknameHiddenNote}</p>
            )}
            {shownError && shownError !== "failed" && (
              <p id={ids.error} role="alert" className="mt-1.5 text-caption text-red-200">
                {fill(copy.errors[shownError], values)}
              </p>
            )}
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body">
            <input
              type="checkbox"
              checked={leaderboard}
              onChange={(event) => {
                setLeaderboard(event.target.checked);
                dirty();
              }}
              className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-cyan-glow)]"
            />
            <span>{fill(copy.leaderboardToggle, values)}</span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-body">
            {/* Stored as "notices off"; shown as the positive choice people expect. */}
            <input
              type="checkbox"
              checked={!noticesOff}
              onChange={(event) => {
                setNoticesOff(!event.target.checked);
                dirty();
              }}
              className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-cyan-glow)]"
            />
            <span>{copy.noticesToggle}</span>
          </label>

          <button
            type="submit"
            disabled={save.state === "saving" || Boolean(localError)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-body font-semibold text-[color:var(--color-deep-2)] disabled:opacity-60"
          >
            {save.state === "saving" ? copy.saving : copy.save}
          </button>
          <p aria-live="polite" className="min-h-5 text-center text-caption">
            {save.state === "saved" && (
              <span className="text-[color:var(--color-cyan-glow)]">{copy.saved}</span>
            )}
            {save.state === "error" && save.reason === "failed" && (
              <span className="text-red-200">{copy.errors.failed}</span>
            )}
          </p>
        </form>
      </Card>
    </div>
  );
}
