import type { Locale } from "@/lib/i18n/locale";
import { referralEvent } from "@/lib/referral/event";

/** Unknown counts never imply progress; top rank is never a held tier. */
export function TierList({
  locale,
  credited,
  className = "",
}: {
  locale: Locale;
  credited: number | null;
  className?: string;
}) {
  const event = referralEvent(locale, credited);
  return (
    <section className={`wd-buddy-tiers border-[3px] border-[#201748] bg-[#eef9ff] p-4 text-[#201748] shadow-[6px_6px_0_#201748] ${className}`}>
      <p className="inline-block border-[3px] border-[#201748] bg-[#65ceee] px-2 py-1 text-[11px] font-extrabold tracking-[0.22em] text-[#201748]">{event.label}</p>
      <h3 className="mt-2 text-xl font-bold leading-snug text-[#201748]">{event.headline}</h3>
      <p className="mt-2 text-xs leading-relaxed text-[#3d2683]">{event.subline}</p>
      <ol className="mt-5 space-y-2">
        {event.steps.map((step) => (
          <li
            key={step.id}
            data-tier={step.id}
            data-state={step.reached ? "reached" : step.next ? "next" : "locked"}
            className={`flex items-center gap-3 border-[3px] bg-white p-3 ${step.next ? "border-[#36A9E1]" : "border-[#201748]"}`}
          >
            <div className="w-16 shrink-0 border-[3px] border-[#201748] bg-[#36A9E1] px-1 py-3 text-center" data-invite-badge>
              <span
                className={`block whitespace-nowrap font-extrabold leading-none text-[#201748] ${step.id === "top" ? "text-[15px]" : "text-3xl"}`}
              >
                {step.badge}
                {step.badgeUnit && <span className="text-lg">{step.badgeUnit}</span>}
              </span>
              <span className="mt-1 block text-[10px] leading-tight [overflow-wrap:anywhere] text-[#201748]">
                {step.badgeCaption}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {step.id === "top" && (
                <span className="mb-1 inline-block border-2 border-[#201748] bg-[#65ceee] px-2 py-0.5 text-[10px] font-bold text-[#201748]">
                  {locale === "ko" ? "추가 이벤트!" : "Bonus event!"}
                </span>
              )}
              <p className="text-[11px] leading-relaxed text-[#3d2683]">{step.name}</p>
              <p className="mt-0.5 text-sm font-bold leading-snug text-[#201748]">{step.benefit}</p>
              {step.qualifier && (
                <p className="mt-1 text-[10px] leading-snug text-[#3d2683]">{step.qualifier}</p>
              )}
              {(step.reached || step.next) && (
                <p className="mt-1 text-[10px] font-semibold text-[#201748]">
                  {step.reached ? `✓ ${event.reached}` : `→ ${event.next}`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <details className="mt-4 border-t-[3px] border-[#36A9E1] pt-1">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[#3d2683]">
          {event.conditionsTitle}
        </summary>
        <div className="space-y-2 text-xs leading-relaxed text-[#3d2683]">
          {event.conditions.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <a
            className="inline-flex min-h-11 items-center text-[#201748] underline underline-offset-4"
            href={event.rulesPath}
          >
            {event.rulesLabel}
          </a>
        </div>
      </details>
    </section>
  );
}
