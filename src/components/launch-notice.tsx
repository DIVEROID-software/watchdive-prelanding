import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";

/**
 * The Kickstarter launch line.
 *
 * Replaced the live countdown on 2026-09-26: the exact launch day is not
 * confirmed, so the page states the month only ("Launching on Kickstarter in
 * December") and never renders a date or a timer. Reinstate a countdown only
 * once a go-live day is fixed.
 */
export function LaunchNotice({ className = "" }: { className?: string }) {
  const messages = useFrozenLandingMessages().countdown;
  return (
    <p className={`text-center text-caption uppercase text-[#36A9E1] ${className}`}>
      {messages.opens}
    </p>
  );
}
