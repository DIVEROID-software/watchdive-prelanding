import type { Locale } from "@/lib/i18n/locale";
import { fill, referralCopy } from "@/lib/referral/copy";
import { EARLY_NOTICE_HOURS, REFERRAL_TIERS, nextTier } from "@/lib/referral/program";
import { copyValues } from "@/lib/referral/values";

/**
 * The four Buddy Invite tiers plus the top-N prize line. Colours inherit from
 * the parent (currentColor) so it works on the dark landing card and a light page.
 *
 * `credited` is null when the visitor's count is unknown (rules/leaderboard
 * context, or the progress fetch has not answered): no tier is then marked, so
 * the list never implies progress we have not read.
 */
export function TierList({
  locale,
  credited,
  className = "",
}: {
  locale: Locale;
  credited: number | null;
  className?: string;
}) {
  const copy = referralCopy(locale);
  const values = copyValues(locale);
  const next = credited === null ? null : nextTier(credited);

  return (
    <div className={className}>
      <ul className="space-y-1.5">
        {REFERRAL_TIERS.map((tier) => {
          const reached = credited !== null && credited >= tier.minFriends;
          const isNext = next?.id === tier.id;
          const text = copy.tiers[tier.id];
          return (
            <li
              key={tier.id}
              data-tier={tier.id}
              data-state={reached ? "reached" : isNext ? "next" : "locked"}
              className={
                "flex gap-2.5 rounded-lg border px-3 py-2 " +
                (reached
                  ? "border-[color:var(--color-cyan-glow)]/50 bg-[color:var(--color-cyan-glow)]/10"
                  : isNext
                    ? "border-current/40 bg-current/10"
                    : "border-current/15 bg-current/[0.03]")
              }
            >
              <span
                aria-hidden="true"
                className={
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                  (reached
                    ? "bg-[color:var(--color-cyan-glow)] text-[color:var(--color-deep-2)]"
                    : "border border-current/40 opacity-70")
                }
              >
                {reached ? "✓" : tier.minFriends}
              </span>
              <span className="min-w-0 text-xs leading-snug">
                <span className="block font-semibold">{text.name}</span>
                <span className="block opacity-80">
                  {fill(text.reward, { ...values, hours: EARLY_NOTICE_HOURS[tier.id] })}
                </span>
              </span>
            </li>
          );
        })}
        <li
          data-tier="top"
          className="flex gap-2.5 rounded-lg border border-current/15 bg-current/[0.03] px-3 py-2"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/40 text-[11px] opacity-70"
          >
            ★
          </span>
          <span className="min-w-0 text-xs leading-snug">
            <span className="block font-semibold">{fill(copy.top.name, values)}</span>
            <span className="block opacity-80">{fill(copy.top.reward, values)}</span>
          </span>
        </li>
      </ul>
      <p className="mt-2 text-[11px] opacity-70">{copy.countingNote}</p>
    </div>
  );
}
