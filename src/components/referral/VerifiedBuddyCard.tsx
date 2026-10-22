import { useEffect, useId, useState } from "react";

import { StatusPage } from "@/components/referral/StatusPage";
import { TierList } from "@/components/referral/TierList";
import { getReferralStatus, updateReferralSettings } from "@/lib/api/referral.functions";
import { localizePath, type Locale } from "@/lib/i18n/locale";
import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import type { ReferralStatus } from "@/lib/referral/contract";
import { fill, referralCopy } from "@/lib/referral/copy";
import { NICKNAME_MAX, NICKNAME_MIN, REFERRAL_TIERS } from "@/lib/referral/program";
import { referralShareCopy } from "@/lib/referral/shareCopy";
import { copyValues } from "@/lib/referral/values";

type ErrorKey = keyof ReturnType<typeof referralCopy>["status"]["errors"];

/** Only mounted with the server-issued credential from a successful ON confirmation. */
export function VerifiedBuddyCard({
  locale,
  token,
  refCode,
}: {
  locale: Locale;
  token: string;
  refCode: string;
}) {
  const copy = referralCopy(locale);
  const values = { ...copyValues(locale), min: NICKNAME_MIN, max: NICKNAME_MAX };
  const shareCopy = referralShareCopy(locale);
  const frozen = useFrozenLandingMessages();
  const id = useId();
  const [showStatus, setShowStatus] = useState(false);
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [nickname, setNickname] = useState("");
  const [leaderboard, setLeaderboard] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/r/${encodeURIComponent(refCode)}`;

  useEffect(() => {
    let alive = true;
    setLoadError(false);
    getReferralStatus({ data: { token, locale } })
      .then((result) => {
        if (!alive) return;
        if (result.status !== "ok") {
          setLoadError(true);
          return;
        }
        setStatus(result.referral);
        setNickname(result.referral.nickname ?? "");
        setLeaderboard(result.referral.leaderboard);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [token, locale, attempt]);

  async function share() {
    try {
      if (navigator.share)
        await navigator.share({ title: "WatchDive", text: shareCopy.text, url: shareUrl });
      else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
      }
    } catch {
      /* Dismissed share sheet: leave the link available to select. */
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Wait for current preferences so this small form never resets noticesOff.
    if (!status || save === "saving") return;
    setSave("saving");
    setError(null);
    try {
      const response = await updateReferralSettings({
        data: {
          token,
          nickname: nickname.trim() ? nickname : null,
          leaderboard,
          noticesOff: status.noticesOff,
        },
      });
      if (response.status === "ok") {
        setStatus({ ...status, ...response.settings });
        setNickname(response.settings.nickname ?? "");
        setLeaderboard(response.settings.leaderboard);
        setSave("saved");
      } else {
        setError(response.status === "rejected" ? response.reason : "failed");
        setSave("idle");
      }
    } catch {
      setError("failed");
      setSave("idle");
    }
  }

  const held = status
    ? Math.max(
        status.credited,
        REFERRAL_TIERS.find((tier) => tier.id === status.highestTier)?.minFriends ?? 0,
      )
    : null;
  return (
    <section
      aria-labelledby={id + "-title"}
      className="mt-5 space-y-5 rounded-xl border border-white/15 bg-white/[0.06] p-4"
    >
      <div>
        <h2 id={id + "-title"} className="text-lead font-semibold [html:root_&]:text-[1.5rem]!">
          {copy.card.title}
        </h2>
        <p className="mt-2 text-body text-white/75">{copy.card.body}</p>
        <input
          readOnly
          aria-label={copy.status.shareTitle}
          value={shareUrl}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 h-11 w-full min-w-0 rounded-lg bg-white/95 px-3 text-body text-[color:var(--color-deep-2)]"
        />
        <button
          type="button"
          onClick={share}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/45 bg-[#3D2683] px-4 py-2 text-body font-semibold text-white"
        >
          {copied ? frozen.referral.copied : shareCopy.button}
        </button>
      </div>
      {status?.shareCode && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-body font-semibold">
            {copy.shareCode.mine} <span className="block break-all">{status.shareCode}</span>
          </p>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-white/45 px-3 py-2 text-body font-semibold"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(status.shareCode!);
                setCodeCopied(true);
              } catch {
                // Keep the visible code selectable when clipboard access is denied.
              }
            }}
          >
            {codeCopied ? copy.shareCode.copied : copy.shareCode.copy}
          </button>
        </div>
      )}
      <TierList locale={locale} credited={held} />
      {loadError && (
        <div role="alert">
          <p>{frozen.errors.errorBody}</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {frozen.verify.tryAgain}
          </button>
        </div>
      )}
      <form onSubmit={submit} noValidate className="space-y-3">
        <label htmlFor={id + "-nickname"} className="block text-body font-semibold">
          {copy.status.nicknameLabel}
        </label>
        <input
          id={id + "-nickname"}
          value={nickname}
          disabled={!status || save === "saving"}
          maxLength={NICKNAME_MAX * 4}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={id + "-help" + (error ? " " + id + "-error" : "")}
          onChange={(e) => {
            setNickname(e.target.value);
            setError(null);
            setSave("idle");
          }}
          className="h-11 w-full rounded-lg bg-white/95 px-3 text-body text-[color:var(--color-deep-2)] disabled:opacity-60"
        />
        <p id={id + "-help"} className="text-caption text-white/70">
          {fill(copy.status.nicknameHelp, values)}
        </p>
        {status?.nicknameHidden && nickname.trim() === (status.nickname ?? "").trim() && (
          <p className="text-caption text-amber-200">{copy.status.nicknameHiddenNote}</p>
        )}
        <label className="flex min-h-11 items-start gap-3 text-body">
          <input
            type="checkbox"
            checked={leaderboard}
            disabled={!status || save === "saving"}
            onChange={(e) => {
              setLeaderboard(e.target.checked);
              setSave("idle");
            }}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>{fill(copy.status.leaderboardToggle, values)}</span>
        </label>
        {error && (
          <p id={id + "-error"} role="alert" className="text-caption text-red-200">
            {fill(copy.status.errors[error], values)}
          </p>
        )}
        <button
          type="submit"
          disabled={!status || save === "saving"}
          className="min-h-11 w-full rounded-xl bg-white px-4 py-3 text-body font-semibold text-[color:var(--color-deep-2)] disabled:opacity-60"
        >
          {save === "saving" ? copy.status.saving : copy.status.save}
        </button>
        <p aria-live="polite" className="min-h-5 text-caption text-[color:var(--color-cyan-glow)]">
          {save === "saved" ? copy.status.saved : ""}
        </p>
      </form>
      <nav className="flex flex-wrap gap-x-5 text-body">
        <a
          href={localizePath("/buddy-rules", locale)}
          className="inline-flex min-h-11 items-center underline"
        >
          {copy.card.rulesLink}
        </a>
        <button
          type="button"
          aria-expanded={showStatus}
          aria-controls={id + "-status"}
          onClick={() => setShowStatus((show) => !show)}
          className="inline-flex min-h-11 items-center underline"
        >
          {copy.card.statusLink}
        </button>
      </nav>
      {showStatus && (
        <div id={id + "-status"}>
          <StatusPage locale={locale} token={token} />
        </div>
      )}
    </section>
  );
}
