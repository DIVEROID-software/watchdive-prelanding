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
    <section className={`rounded-2xl bg-[#0d2533] p-4 text-[#f5fafc] ${className}`}>
      <p className="text-[11px] font-extrabold tracking-[0.22em] text-[#8fe6d4]">{event.label}</p>
      <h3 className="mt-2 text-xl font-bold leading-snug text-[#f5fafc]">{event.headline}</h3>
      <p className="mt-2 text-xs leading-relaxed text-[#c3d6df]">{event.subline}</p>
      <ol className="mt-5 space-y-2">
        {event.steps.map((step) => (
          <li
            key={step.id}
            data-tier={step.id}
            data-state={step.reached ? "reached" : step.next ? "next" : "locked"}
            className={`flex items-center gap-3 rounded-xl border p-3 ${step.next ? "border-[#8fe6d4] bg-[#173c49]" : "border-[#36515e] bg-[#112e3d]"}`}
          >
            <div className="w-14 shrink-0 text-center">
              <span
                className={`block font-extrabold leading-none text-[#8fe6d4] ${step.id === "top" ? "text-lg" : "text-3xl"}`}
              >
                {step.badge}
              </span>
              {step.id !== "top" && (
                <span className="mt-1 block text-[9px] leading-tight text-[#c3d6df]">
                  {event.friends}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-[#c3d6df]">{step.name}</p>
              <p className="mt-0.5 text-sm font-bold leading-snug text-[#f5fafc]">{step.benefit}</p>
              {step.qualifier && (
                <p className="mt-1 text-[10px] leading-snug text-[#c3d6df]">{step.qualifier}</p>
              )}
              {(step.reached || step.next) && (
                <p className="mt-1 text-[10px] font-semibold text-[#8fe6d4]">
                  {step.reached ? `✓ ${event.reached}` : `→ ${event.next}`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <details className="mt-4 border-t border-[#36515e] pt-1">
        <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[#c3d6df]">
          {event.conditionsTitle}
        </summary>
        <div className="space-y-2 text-xs leading-relaxed text-[#c3d6df]">
          {event.conditions.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <a
            className="inline-flex min-h-11 items-center text-[#8fe6d4] underline underline-offset-4"
            href={event.rulesPath}
          >
            {event.rulesLabel}
          </a>
        </div>
      </details>
    </section>
  );
}
