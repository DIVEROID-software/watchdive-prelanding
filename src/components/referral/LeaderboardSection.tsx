import { useEffect, useState } from "react";

import { getReferralProgramState } from "@/lib/api/referral.functions";
import { formatNumber, getDateTimeFormatter, localizePath, type Locale } from "@/lib/i18n/locale";
import type { LeaderboardSnapshot } from "@/lib/referral/contract";
import { fill, referralCopy } from "@/lib/referral/copy";
import { copyValues } from "@/lib/referral/values";

export function buddyRulesPath(locale: Locale): string {
  return localizePath("/buddy-rules", locale);
}

function formatAsOf(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  return getDateTimeFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(at);
}

/** Pure view over a snapshot, so tests and the fetching wrapper share it. */
export function LeaderboardView({
  locale,
  snapshot,
}: {
  locale: Locale;
  snapshot: LeaderboardSnapshot;
}) {
  const copy = referralCopy(locale);
  const values = copyValues(locale);
  const asOf = formatAsOf(snapshot.asOf, locale);

  return (
    <section
      id="buddy-leaderboard"
      aria-labelledby="buddy-leaderboard-title"
      className="wd-section mx-auto max-w-3xl"
    >
      <div className="mb-6 text-center">
        <h2 id="buddy-leaderboard-title" className="text-title">
          {fill(copy.leaderboard.title, values)}
        </h2>
        <p className="mt-2 text-caption text-muted-foreground">
          {fill(copy.leaderboard.subtitle, { ...values, time: asOf })}
        </p>
      </div>

      {snapshot.closed ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-center text-body text-muted-foreground">
          {copy.leaderboard.closed}
        </p>
      ) : snapshot.entries.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-center text-body text-muted-foreground">
          {copy.leaderboard.empty}
        </p>
      ) : (
        <ol className="divide-y divide-border rounded-2xl border border-border bg-card">
          {snapshot.entries.map((entry) => (
            <li
              key={entry.rank}
              className="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-6"
              data-rank={entry.rank}
            >
              <span className="w-7 shrink-0 text-center text-heading font-semibold text-primary">
                {entry.rank}
              </span>
              {/* Nickname is user-set text: React escapes it, `break-words` keeps long ones in the row. */}
              <span className="min-w-0 flex-1 break-words font-medium">
                {entry.nickname ?? copy.leaderboard.privateDiver}
              </span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {fill(copy.leaderboard.entry, { count: formatNumber(entry.credited, locale) })}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-center text-caption">
        <a href={buddyRulesPath(locale)} className="text-primary underline underline-offset-4">
          {copy.leaderboard.rulesLink}
        </a>
      </p>
    </section>
  );
}

function isSnapshot(value: unknown): value is LeaderboardSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LeaderboardSnapshot>;
  return (
    Array.isArray(v.entries) &&
    typeof v.asOf === "string" &&
    typeof v.closed === "boolean" &&
    v.entries.every(
      (e) =>
        e &&
        typeof e.rank === "number" &&
        typeof e.credited === "number" &&
        (e.nickname === null || typeof e.nickname === "string"),
    )
  );
}

/**
 * Whether the program is live, asked once per page load. False until the server
 * answers yes, so a disabled (or unreachable) program adds nothing to the page.
 */
let programState: Promise<boolean> | null = null;
export function useReferralProgramEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    programState ??= getReferralProgramState()
      .then((r) => r.enabled === true)
      .catch(() => false);
    void programState.then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

/**
 * Fetches after hydration so the leaderboard never delays first paint, and
 * renders nothing on any failure: a missing board is better than a broken one.
 */
export function LeaderboardSection({ locale }: { locale: Locale }) {
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);

  const enabled = useReferralProgramEnabled();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/referral/leaderboard", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (isSnapshot(body)) setSnapshot(body);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled]);

  if (!enabled || !snapshot) return null;
  return <LeaderboardView locale={locale} snapshot={snapshot} />;
}
