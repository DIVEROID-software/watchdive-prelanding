import { useEffect, useState } from "react";

import { useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import { countdownFrom, KICKSTARTER_LAUNCH_MS, pad2, type Countdown } from "@/lib/launch";

// The server and the browser would disagree about "now", so nothing time-based
// renders until after mount. The placeholder keeps the same footprint, so the
// row does not jump when the real numbers arrive.
function useCountdown(): Countdown | undefined {
  const [now, setNow] = useState<number | undefined>(undefined);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return now === undefined ? undefined : countdownFrom(now, KICKSTARTER_LAUNCH_MS);
}

function Unit({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[3.25rem] flex-col items-center">
      <span className="font-mono text-2xl font-bold tabular-nums leading-none text-white sm:text-3xl">
        {value}
      </span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
        {label}
      </span>
    </div>
  );
}

function Separator() {
  return <span className="pb-4 font-mono text-xl text-white/25 sm:text-2xl">:</span>;
}

/**
 * The countdown to the Kickstarter launch.
 *
 * `launched` is a real state, not a corner case: the date arrives whether or not
 * the campaign does, and a timer stuck at zero is worse than a sentence.
 */
export function LaunchCountdown({ className = "" }: { className?: string }) {
  const countdown = useCountdown();
  const messages = useFrozenLandingMessages().countdown;
  const pending = countdown === undefined;

  if (countdown?.launched) {
    return (
      <div className={`text-center ${className}`}>
        <p className="text-sm font-semibold text-[color:var(--color-cyan-glow)]">
          {messages.launched}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-cyan-glow)]">
        {messages.opens}
      </p>
      <div
        className="mt-3 flex items-start justify-center gap-2 sm:gap-3"
        role="timer"
        aria-live="off"
        aria-label={
          pending
            ? messages.ariaPending
            : messages.ariaLive
                .replace("{days}", String(countdown.days))
                .replace("{hours}", String(countdown.hours))
                .replace("{minutes}", String(countdown.minutes))
                .replace("{seconds}", String(countdown.seconds))
        }
      >
        <Unit value={pending ? "--" : pad2(countdown.days)} label={messages.days} />
        <Separator />
        <Unit value={pending ? "--" : pad2(countdown.hours)} label={messages.hrs} />
        <Separator />
        <Unit value={pending ? "--" : pad2(countdown.minutes)} label={messages.min} />
        <Separator />
        <Unit value={pending ? "--" : pad2(countdown.seconds)} label={messages.sec} />
      </div>
    </div>
  );
}
