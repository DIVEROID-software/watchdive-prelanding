import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import { track } from "@vercel/analytics";
import { joinWaitlist, getReferralCount } from "@/lib/api/waitlist.functions";

import heroBackground from "../assets/live/hero-background.png";
import heroSideImage from "../assets/live/watchdive-image10.png";
import whyImage from "../assets/live/watchdive-why-new.png";
import step1Image from "../assets/live/watchdive-step1.png";
import step2Image from "../assets/live/watchdive-step2.png";
import syncImage from "../assets/live/watchdive-sync.png";
import app3_1 from "../assets/live/app3/app3-1.jpg";
import app3_4 from "../assets/live/app3/app3-4.jpg";
import app3_6 from "../assets/live/app3/app3-6.jpg";
import maxDepthIcon from "../assets/live/app3/icons/max-depth.svg?raw";
import scubaFigureIcon from "../assets/live/app3/icons/scuba-figure.svg?raw";
import freeFigureIcon from "../assets/live/app3/icons/free-figure.svg?raw";
import diveTimeIcon from "../assets/live/app3/icons/dive-time.svg?raw";
import temperatureIcon from "../assets/live/app3/icons/temperature.svg?raw";
import gearBagIcon from "../assets/live/app3/icons/gear-bag.svg?raw";
import autoSyncIcon from "../assets/live/app3/icons/auto-sync.svg?raw";
import logbookIcon from "../assets/live/app3/icons/logbook.svg?raw";
import shareIcon from "../assets/live/app3/icons/share.svg?raw";
import locationPinIcon from "../assets/live/app3/icons/location-pin.svg?raw";
import connectedAppVideo from "../assets/live/connected-app.mp4";
import connectedAppPoster from "../assets/live/connected-app-poster.jpg";
import functionsVideo from "../assets/live/watchdive-functions.mp4";
import functionsPoster from "../assets/live/watchdive-functions-poster.jpg";
import kickstarterImage from "../assets/live/kickstarter-crop.png";
import nvidiaInceptionBadge from "../assets/live/nvidia-inception.svg";
import awsLogo from "../assets/live/aws-logo.png";
import watchdiveClip from "../assets/live/watchdive-clip.mp4";
import clipPoster from "../assets/live/watchdive-clip-poster.jpg";
import watchScreen from "../assets/live/watch-screen.png";
import housingImage from "../assets/live/housing.png";
import samsungFeature from "../assets/live/samsung-feature.jpg";
import samsungLogo from "../assets/live/samsung-logo.svg";

// Inlines an App 3.0 icon SVG (imported ?raw) so it inherits the current text
// color via currentColor — real product icons match our accent, any size.
function AppIcon({ svg, className }: { svg: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Watch Dive — The world's most affordable dive computer" },
      {
        name: "description",
        content:
          "Turn the Apple Watch or Galaxy Watch you already own into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
      },
      {
        property: "og:title",
        content: "Watch Dive — The world's most affordable dive computer",
      },
      {
        property: "og:description",
        content:
          "Turn your Apple or Galaxy Watch into a 60 m dive computer. $149 early bird — 50% off at Kickstarter launch.",
      },
      { property: "og:image", content: "https://watchdive.diveroid.com/og-image.png" },
      { name: "twitter:image", content: "https://watchdive.diveroid.com/og-image.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <StickyLaunchBanner />
      <Hero />
      <ValueSection />
      <FunctionsSection />
      <HowItWorks />
      <AppEcosystem />
      <Compatibility />
      <ActionCameras />
      <SafetySection />
      <OfferSection />
      <Credentials />
      <FAQ />
      <Footer />
    </div>
  );
}

const CTA_LABEL = "Claim My $149 Early Bird";

function LaunchBanner() {
  return (
    <div className="relative z-20 border-b border-white/10 bg-[color:var(--color-deep-2)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-3 text-white sm:flex-row sm:justify-between sm:gap-6">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[color:var(--color-cyan-glow)] animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--color-cyan-glow)]">
            Launching soon on Kickstarter
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--color-cyan-glow)] sm:text-sm">
            Early bird · 50% off
          </span>
          <a
            href="#offer-form"
            className="rounded-full bg-gradient-to-r from-[color:var(--color-cyan-glow)] to-[color:var(--color-cyan)] px-4 py-2 text-xs font-semibold text-[color:var(--color-deep-2)] shadow-[0_8px_24px_-12px_oklch(0.696_0.129_235/0.7)] hover:brightness-105"
          >
            Join the waitlist
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionImage({
  src,
  alt,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} className={className} />;
}

function StickyLaunchBanner() {
  return (
    <a
      href="#offer-form"
      className="fixed bottom-3 right-3 z-50 flex max-w-[320px] items-center gap-3 rounded-2xl border border-white/15 bg-[color:var(--color-deep-2)]/92 px-4 py-3 text-white shadow-[0_20px_60px_-25px_oklch(0.13_0.065_287/0.95)] backdrop-blur-xl transition hover:-translate-y-0.5 sm:bottom-5 sm:right-5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-cyan-glow)] text-[color:var(--color-deep-2)] shadow-[0_0_24px_oklch(0.8_0.11_232/0.55)]">
        ↓
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-[0.22em] text-white/55">
          Kickstarter early bird
        </span>
        <span className="block text-sm font-semibold leading-tight">
          Reserve the launch price before it’s gone
        </span>
      </span>
    </a>
  );
}

// Ref codes are exactly 8 lowercase alphanumerics. Some share targets glue the
// share text right onto the link (…?ref=ycafdyfkI'm turning…), so we strip any
// character that can't be part of a code and keep only the first 8.
function sanitizeRef(v: string | null | undefined): string {
  return (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

// Read the referral code from the URL (?ref=) and persist it, so attribution
// survives scrolling, refreshes, and navigation to the offer form.
function getRef(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromUrl = sanitizeRef(new URLSearchParams(window.location.search).get("ref"));
  try {
    if (fromUrl) {
      localStorage.setItem("wd_ref", fromUrl);
      return fromUrl;
    }
    const stored = sanitizeRef(localStorage.getItem("wd_ref"));
    return stored || undefined;
  } catch {
    return fromUrl || undefined;
  }
}

// Client-only welcome banner shown when a visitor arrives via a friend's link.
function ReferralWelcome() {
  const [ref, setRef] = useState<string | undefined>(undefined);
  useEffect(() => setRef(getRef()), []);
  if (!ref) return null;
  return (
    <div className="mb-5 inline-flex max-w-xl items-center gap-2 self-start rounded-xl border border-[color:var(--color-cyan-glow)]/30 bg-[color:var(--color-cyan-glow)]/10 px-4 py-2.5 text-sm text-white/90">
      <span className="text-base">🎉</span>
      <span>
        A friend invited you — <span className="font-semibold text-white">you both get $5 off</span>{" "}
        at launch.
      </span>
    </div>
  );
}

const REFERRAL_FREE_AT = 30; // 30 friends × $5 ≈ the full $149 → yours is free

function ReferralSuccess({ refCode }: { refCode: string }) {
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const shareUrl =
    typeof window !== "undefined" && refCode ? `${window.location.origin}/?ref=${refCode}` : "";

  useEffect(() => {
    if (!refCode) return;
    let alive = true;
    getReferralCount({ data: { refCode } })
      .then((r) => alive && setCount(r.count))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refCode]);

  const pct = count === null ? 0 : Math.min(100, (count / REFERRAL_FREE_AT) * 100);

  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur p-5 text-white">
      <div className="text-base font-semibold">You're on the list. 🎉</div>
      <p className="mt-1 text-sm text-white/80">
        We'll email you the moment Watch Dive goes live on Kickstarter.
      </p>

      {shareUrl && (
        <div className="mt-4 rounded-xl border border-white/15 bg-[color:var(--color-deep-2)]/50 p-4">
          <div className="text-sm font-semibold text-[color:var(--color-cyan-glow)]">
            Give $5, get $5 — for every friend who joins
          </div>
          <p className="mt-1 text-xs text-white/70">
            Share your link: your friend gets $5 off, and so do you — stackable, no limit.{" "}
            <span className="font-semibold text-white/90">
              Invite 30 friends and yours is free.
            </span>{" "}
            We'll email your discount code when Watch Dive launches on Kickstarter.
          </p>

          {count !== null && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/85">
                  {count} friend{count === 1 ? "" : "s"} joined ·{" "}
                  <span className="font-semibold text-[color:var(--color-cyan-glow)]">
                    ${count * 5} off so far
                  </span>
                </span>
                <span className="text-white/50">
                  {count >= REFERRAL_FREE_AT
                    ? "It's on us 🎉"
                    : `${REFERRAL_FREE_AT - count} more until it's free`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-[color:var(--color-cyan-glow)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 flex-1 rounded-lg bg-white/95 px-3 text-xs text-[color:var(--color-deep-2)] outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  if (navigator.share) {
                    await navigator.share({
                      title: "Watch Dive",
                      text: "I'm turning my Apple/Galaxy Watch into a $149 dive computer with Watch Dive 🤿 Join with my link and we both get $5 off.",
                      url: shareUrl,
                    });
                    return;
                  }
                  await navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* user dismissed share sheet — no-op */
                }
              }}
              className="h-11 rounded-lg bg-gradient-to-r from-[color:var(--color-cyan-glow)] to-[color:var(--color-cyan)] px-4 text-sm font-semibold text-[color:var(--color-deep-2)] hover:brightness-105"
            >
              {copied ? "Copied!" : "Share & get yours free"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailForm({ id, includePhone = false }: { id: string; includePhone?: boolean }) {
  const [submitted, setSubmitted] = useState(false);
  const [refCode, setRefCode] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [hp, setHp] = useState(""); // honeypot — real users never fill this
  const [loading, setLoading] = useState(false);

  if (submitted) {
    return <ReferralSuccess refCode={refCode} />;
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (loading) return;
        setLoading(true);
        try {
          const res = await joinWaitlist({
            data: {
              email: email.trim().toLowerCase(),
              phone: phone.trim() || undefined,
              source: id,
              referredBy: getRef(),
              honeypot: hp,
            },
          });
          setRefCode(res.refCode ?? "");
          setSubmitted(true);
          // 전환 이벤트 — 광고 유입→가입 측정 (source=CTA 위치)
          track("waitlist_signup", { source: id, referred: !!getRef() });
        } catch {
          toast.error("Something went wrong. Please try again.");
        } finally {
          setLoading(false);
        }
      }}
      className="flex flex-col gap-3 w-full"
    >
      {/* Honeypot: off-screen field. Real users never see or fill it; bots that
          auto-fill every input trip it and get flagged server-side. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        className="absolute left-[-9999px] top-[-9999px] h-0 w-0 opacity-0"
      />
      <div className="grid w-full gap-2 sm:grid-cols-[1fr_auto]">
        <input
          id={`${id}-email`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="order-1 h-14 px-4 rounded-xl bg-gradient-to-b from-white to-[oklch(0.92_0.006_255)] text-[color:var(--color-deep-2)] placeholder:text-muted-foreground border border-white/50 shadow-[inset_0_1px_0_oklch(1_0_0/0.85),0_22px_48px_-8px_oklch(0.008_0.01_270/0.85),0_6px_16px_-3px_oklch(0.008_0.01_270/0.7)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-cyan-glow)]"
        />
        {includePhone && (
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional) — text you 1 hour early + priority access"
            className="order-2 h-14 w-full px-4 rounded-xl bg-gradient-to-b from-white to-[oklch(0.92_0.006_255)] text-[color:var(--color-deep-2)] placeholder:text-muted-foreground border border-white/50 shadow-[inset_0_1px_0_oklch(1_0_0/0.85),0_22px_48px_-8px_oklch(0.008_0.01_270/0.85),0_6px_16px_-3px_oklch(0.008_0.01_270/0.7)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-cyan-glow)] sm:order-3 sm:col-span-2"
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="order-3 h-14 px-5 rounded-xl font-semibold text-[color:var(--color-deep-2)] bg-gradient-to-r from-[color:var(--color-cyan-glow)] to-[color:var(--color-cyan)] shadow-[0_10px_30px_-10px_oklch(0.696_0.129_235/0.6)] hover:brightness-105 active:scale-[0.99] transition sm:order-2"
        >
          {loading ? "Saving…" : CTA_LABEL}
        </button>
      </div>
    </form>
  );
}

function Hero() {
  return (
    <header className="relative overflow-hidden text-white">
      <SectionImage
        src={heroBackground}
        alt="Scuba diver exploring a vibrant coral reef"
        priority
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(110deg,oklch(0.13_0.065_287/0.96)_12%,oklch(0.21_0.085_287/0.78)_48%,oklch(0.13_0.065_287/0.92)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_oklch(0.8_0.11_232/0.32),_transparent_34%),radial-gradient(circle_at_bottom_right,_oklch(0.696_0.129_235/0.26),_transparent_30%)]" />

      <div className="relative z-10">
        <LaunchBanner />
      </div>
      <div className="relative z-10 mx-auto grid min-h-[100svh] max-w-6xl gap-10 px-5 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] lg:items-center lg:gap-14">
        <div className="flex flex-col gap-7 lg:py-10">
          <div className="inline-flex self-start items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur border border-white/15">
            <span className="size-1.5 rounded-full bg-[color:var(--color-cyan-glow)] animate-pulse" />
            Launching soon on Kickstarter
          </div>

          <div className="space-y-4">
            <h1
              className="max-w-3xl text-4xl font-extrabold leading-[1.04] sm:text-5xl lg:text-6xl"
              style={{ wordBreak: "keep-all", textWrap: "balance", overflowWrap: "normal" }}
            >
              The world&apos;s{" "}
              <span className="bg-gradient-to-r from-[color:var(--color-cyan-glow)] via-white to-[color:var(--color-cyan)] bg-clip-text text-transparent">
                most affordable
              </span>{" "}
              <span className="whitespace-nowrap">dive computer.</span>
            </h1>

            <p className="max-w-xl text-lg font-bold leading-snug text-white sm:text-2xl">
              Turn the Apple or Galaxy Watch you already own into a{" "}
              <span className="whitespace-nowrap">60 m</span> dive computer.
            </p>

            <p className="max-w-xl text-base text-white/75 sm:text-lg">
              Early bird from <span className="font-semibold text-white">$149</span> on Kickstarter
              &mdash; a fraction of the price of a traditional dive computer.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: "60 m",
                desc: "Rated housing",
                customIcon: null,
                // real App 3.0 Max Depth icon (ic_l_MaxDepth) — water surface + limit line + descent arrow
                icon: (
                  <>
                    <path
                      d="M21 3L20.2265 3.77346C19.5228 4.47724 18.4086 4.55643 17.6123 3.95925L16.3877 3.04075C15.5914 2.44357 14.4772 2.52276 13.7735 3.22654L13.4142 3.58579C12.6332 4.36684 11.3668 4.36683 10.5858 3.58579L10.2265 3.22654C9.52276 2.52276 8.40857 2.44357 7.61233 3.04075L6.38767 3.95925C5.59143 4.55643 4.47724 4.47724 3.77346 3.77346L3 3"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path d="M3 21H21" strokeWidth="1.6" />
                    <path d="M9 15L12 18L15 15" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="M12 7.5V17" strokeWidth="1.6" strokeLinecap="square" />
                  </>
                ),
              },
              {
                label: "Scuba + Freedive",
                desc: "Dual modes",
                // real App 3.0 mode icons (scuba diver + freediver), tinted cyan to match
                customIcon: (
                  <span className="flex size-9 shrink-0 items-center justify-center gap-0.5 rounded-lg bg-[color:var(--color-cyan-glow)]/15 text-[color:var(--color-cyan-glow)]">
                    <AppIcon svg={scubaFigureIcon} className="size-[15px]" />
                    <AppIcon svg={freeFigureIcon} className="size-[15px]" />
                  </span>
                ),
                icon: null,
              },
              {
                label: "$149",
                desc: "50% off · early bird",
                customIcon: null,
                icon: (
                  <>
                    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
                  </>
                ),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-row items-center gap-3 rounded-2xl border border-white/12 bg-white/8 px-4 py-3.5 backdrop-blur-sm sm:flex-col sm:items-start sm:gap-2 sm:px-5 sm:py-4"
              >
                {item.customIcon ?? (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-cyan-glow)]/15 text-[color:var(--color-cyan-glow)]">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {item.icon}
                    </svg>
                  </span>
                )}
                <div className="flex flex-col gap-0.5 sm:contents">
                  <span className="block text-lg font-extrabold leading-tight text-white sm:min-h-[2.9rem]">
                    {item.label}
                  </span>
                  <span className="text-sm font-medium text-white/70">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[color:var(--color-cyan-glow)]/30 bg-[color:var(--color-cyan-glow)]/10 px-4 py-3">
            <span className="text-base text-white/55 line-through">$299</span>
            <span className="text-2xl font-extrabold text-white">$149</span>
            <span className="rounded-full bg-[color:var(--color-cyan-glow)] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-[color:var(--color-deep-2)]">
              50% off
            </span>
            <span className="text-sm font-medium text-white/85">
              early bird at Kickstarter launch
            </span>
          </div>

          <div className="flex max-w-xl items-start gap-2.5 text-sm text-white/85">
            <span className="flex h-5 shrink-0 items-center text-base leading-none">🎁</span>
            <span>
              Then share your link —{" "}
              <span className="font-semibold text-white">you and each friend both get $5 off</span>.
              Invite 30 friends and yours is free.
            </span>
          </div>

          <ReferralWelcome />

          <div className="max-w-xl">
            <EmailForm id="hero" includePhone />
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/65">
            <span>Sign up to hear first and lock in the lowest launch price.</span>
            <span className="h-1 w-1 rounded-full bg-white/35" />
            <span>No spam — one email when we go live.</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">
                Backed by
              </span>
              <span className="inline-flex h-8 items-center rounded-lg bg-white px-2.5 shadow-sm">
                <img src={nvidiaInceptionBadge} alt="NVIDIA Inception" className="h-4 w-auto" />
              </span>
              <span className="inline-flex h-8 items-center rounded-lg bg-white px-2.5 shadow-sm">
                <img src={awsLogo} alt="Amazon Web Services" className="h-5 w-auto" />
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">
                Featured by
              </span>
              <span className="inline-flex h-8 items-center rounded-lg bg-white px-3 shadow-sm">
                <img src={samsungLogo} alt="Samsung" className="h-3.5 w-auto" />
              </span>
            </div>
          </div>
        </div>

        <div className="relative order-first lg:order-none">
          <div className="absolute -right-2 bottom-10 rounded-2xl border border-white/12 bg-white/10 px-4 py-3 text-sm text-white/90 shadow-2xl backdrop-blur md:px-5">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/55">
              The Watch Dive promise
            </div>
            <div className="mt-1 font-semibold">
              A real dive computer feel for a fraction of the price
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/8 p-3 shadow-[0_30px_90px_-35px_oklch(0.8_0.11_232/0.45)] backdrop-blur-sm sm:p-4">
            <SectionImage
              src={heroSideImage}
              alt="Watch Dive underwater hero product shot"
              priority
              className="aspect-[5/6] w-full rounded-[1.5rem] object-cover"
            />

            <div className="absolute inset-x-6 bottom-6 rounded-[1.5rem] border border-white/12 bg-[color:var(--color-deep-2)]/82 p-5 backdrop-blur-xl">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                    Kickstarter promise
                  </div>
                  <div className="mt-2 text-2xl font-bold">Depth. Safety. No-Deco.</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                    From
                  </div>
                  <div className="mt-2 text-3xl font-extrabold text-[color:var(--color-cyan-glow)]">
                    $149
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function ValueSection() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
      <div className="lg:hidden">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          Why Watch Dive
        </p>
        <h2 className="text-3xl font-bold leading-tight sm:text-5xl">
          Why spend $1,000 on a dive computer if your smartwatch is already halfway there?
        </h2>
      </div>
      <div className="mt-8 grid gap-10 lg:mt-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
        <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm">
          <SectionImage
            src={whyImage}
            alt="Watch Dive housings displayed on a boat deck"
            className="aspect-[4/5] w-full object-cover"
          />
          <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/15 bg-[color:var(--color-deep-2)]/82 p-4 text-white backdrop-blur-md">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
              Why divers love it
            </div>
            <div className="mt-2 text-lg font-semibold">
              Premium dive gear feel, without the premium price.
            </div>
          </div>
        </div>

        <div>
          <div className="hidden lg:block">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              Why Watch Dive
            </p>
            <h2 className="text-3xl font-bold leading-tight sm:text-5xl">
              Why spend $1,000 on a dive computer if your smartwatch is already halfway there?
            </h2>
          </div>
          <p className="mt-6 text-lg text-muted-foreground lg:mt-6">
            Watch Dive helps new and recreational divers unlock the core dive-computer experience
            with the watch they already own — at a price that finally makes sense.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "Use what you own",
                copy: "Built around the Apple Watch and Galaxy Watch you already wear — no second device to buy.",
                icon: (
                  <>
                    <circle cx="12" cy="12" r="6" />
                    <polyline points="12 10 12 12 13 13" />
                    <path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05" />
                    <path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05" />
                  </>
                ),
              },
              {
                title: "Premium build",
                copy: "Clear housing, bold on-screen UI, and refined black and white variants.",
                icon: (
                  <>
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                    <path d="m9 12 2 2 4-4" />
                  </>
                ),
              },
              {
                title: "Real dive value",
                copy: "Key scuba metrics without forcing a $1,000 dive-computer purchase.",
                icon: (
                  <>
                    <path d="m12 14 4-4" />
                    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                  </>
                ),
              },
              {
                title: "Shareable dives",
                copy: "Connected app and striking visuals make every dive easy to remember and share.",
                icon: (
                  <>
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
                    <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
                  </>
                ),
              },
            ].map(({ title, copy, icon }) => (
              <div
                key={title}
                className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_28px_-10px_oklch(0.2_0.03_260/0.18)]"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {icon}
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FunctionsSection() {
  const items = [
    {
      t: "Ascent-Rate Alert",
      d: "The safe ascent rate is 9–18 m/min. Watch Dive monitors every meter of your ascent and alerts you before you cross the line — no buttons, no menus.",
      iconSrc: null,
      icon: (
        <>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </>
      ),
    },
    {
      t: "No-Deco / NDL",
      d: "Watch Dive is 60 m waterproof and calculates your NDL in real time. Never guess how much bottom time you have left.",
      // real App 3.0 Dive Time (stopwatch) icon — NDL is a real-time countdown
      iconSrc: diveTimeIcon,
      icon: null,
    },
    {
      t: "Depth, Time & Temperature",
      d: "Real-time depth, elapsed dive time, and water temperature — all logged automatically and synced to your Diveroid App logbook via Bluetooth after every dive.",
      // real App 3.0 water-temperature icon
      iconSrc: temperatureIcon,
      icon: null,
    },
    {
      t: "Scuba + Freediving",
      d: "Watch Dive supports both scuba and freediving — switch modes in seconds. All of it, from $149.",
      // real App 3.0 scuba diver icon
      iconSrc: scubaFigureIcon,
      icon: null,
    },
  ];

  return (
    <section className="bg-[color:var(--color-deep-2)] px-5 py-20 text-white sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--color-cyan-glow)]">
            Built for real recreational diving
          </p>
          <h2 className="text-3xl font-bold leading-tight sm:text-5xl">
            Track depth, dive time, temperature, safety stops, ascent rate, and NDL — in one system.
          </h2>
          <p className="mt-5 text-white/70">
            60&nbsp;m waterproof. Scuba and freediving modes both supported.
          </p>
        </div>

        <div className="mt-12 relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5">
          <video
            src={functionsVideo}
            poster={functionsPoster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Watch Dive functions in action"
            className="aspect-video w-full object-cover"
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((i) => (
            <details
              key={i.t}
              className="group rounded-xl bg-white/5 border border-white/10 p-4 backdrop-blur-sm open:bg-white/8"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 font-semibold">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-cyan-glow)]/15 text-[color:var(--color-cyan-glow)]">
                  {i.iconSrc ? (
                    <AppIcon svg={i.iconSrc} className="size-[18px]" />
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {i.icon}
                    </svg>
                  )}
                </span>
                <span className="flex-1">{i.t}</span>
                <span className="ml-2 text-[color:var(--color-cyan-glow)] text-2xl leading-none transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-white/75">{i.d}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      t: "Place your smartwatch inside Watch Dive",
      d: "Slide your Apple Watch or Galaxy Watch into the waterproof housing.",
      image: step1Image,
      alt: "Hands placing a smartwatch into the Watch Dive housing",
      iconSvg: gearBagIcon,
    },
    {
      n: "02",
      t: "Dive with real-time guidance",
      d: "Depth, dive time, temperature, ascent rate, and safety stops on your wrist.",
      image: step2Image,
      alt: "Freediver wearing Watch Dive at the pool edge",
      iconSvg: scubaFigureIcon,
    },
    {
      n: "03",
      t: "Sync your dive log after surfacing",
      d: "Review profile, logbook, and memories in the connected app.",
      image: syncImage,
      alt: "Diver reviewing dive log in the connected app poolside",
      iconSvg: autoSyncIcon,
    },
  ];
  return (
    <section className="px-5 py-20 sm:py-28 max-w-5xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="text-sm uppercase tracking-[0.2em] text-primary font-semibold mb-4">
          How it works
        </p>
        <h2 className="text-3xl sm:text-5xl font-bold leading-tight">
          Three steps. One dive computer solution.
        </h2>
      </div>
      <div className="grid md:grid-cols-3 gap-5 items-stretch">
        {steps.map((s) => (
          <div
            key={s.n}
            className="flex flex-col rounded-2xl bg-card border border-border p-6 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <AppIcon svg={s.iconSvg} className="size-5" />
              </span>
              <div className="text-sm font-bold text-primary">{s.n}</div>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            <div className="mt-auto pt-5">
              <SectionImage
                src={s.image}
                alt={s.alt}
                className="aspect-[4/3] w-full rounded-xl object-cover"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const APP3_SCREENS = [
  {
    src: app3_1,
    tab: "Auto",
    tabDesc: "Logbook & gallery",
    title: "Auto logbook & gallery",
    desc: "Every dive auto-logged with depth profile, stats, and your photos.",
    iconSvg: logbookIcon,
  },
  {
    src: app3_6,
    tab: "Share",
    tabDesc: "Data-overlay clips",
    title: "Share with dive data",
    desc: "Overlay depth, time, and location right onto your shots.",
    iconSvg: shareIcon,
  },
  {
    src: app3_4,
    tab: "Sites",
    tabDesc: "Discover & review",
    title: "Dive sites near you",
    desc: "Discover spots, live conditions, and top-rated sites nearby.",
    iconSvg: locationPinIcon,
  },
];

function App3Carousel() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(APP3_SCREENS.length - 1, i));
    const child = el.children[idx] as HTMLElement | undefined;
    if (!child) return;
    // Center the target card (matches snap-center), so the active index stays in sync.
    const target = child.offsetLeft - el.offsetLeft - (el.clientWidth - child.clientWidth) / 2;
    el.scrollTo({ left: target, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const viewCenter = el.scrollLeft + el.clientWidth / 2;
    let idx = 0;
    let min = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const child = c as HTMLElement;
      const childCenter = child.offsetLeft - el.offsetLeft + child.clientWidth / 2;
      const d = Math.abs(childCenter - viewCenter);
      if (d < min) {
        min = d;
        idx = i;
      }
    });
    setActive(idx);
  };

  return (
    <div className="mt-10">
      {/* Tabs — synced to the carousel: tap to jump, and they follow the swipe.
          On desktop all three screens show at once, so tabs stay neutral there. */}
      <div className="mx-auto grid max-w-3xl grid-cols-3 gap-3">
        {APP3_SCREENS.map((s, i) => {
          const on = i === active;
          return (
            <button
              key={s.tab}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${s.title}`}
              className={`rounded-2xl border px-4 py-4 text-center backdrop-blur transition shadow-[0_20px_44px_-12px_oklch(0.02_0.02_270/0.9),0_8px_26px_-6px_oklch(0.8_0.11_232/0.55),inset_0_1px_0_oklch(1_0_0/0.12)] sm:border-white/10 sm:bg-white/[0.07] ${
                on
                  ? "border-[color:var(--color-cyan-glow)]/60 bg-[color:var(--color-cyan-glow)]/12"
                  : "border-white/10 bg-white/[0.07]"
              }`}
            >
              <AppIcon
                svg={s.iconSvg}
                className="mx-auto mb-2 size-6 text-[color:var(--color-cyan-glow)]"
              />
              <div className="text-lg font-bold text-[color:var(--color-cyan-glow)]">{s.tab}</div>
              <div className="mt-0.5 text-xs text-white/70">{s.tabDesc}</div>
            </button>
          );
        })}
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="mt-12 flex snap-x snap-mandatory gap-8 overflow-x-auto px-1 pb-2 sm:mx-auto sm:grid sm:max-w-3xl sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {APP3_SCREENS.map((s, i) => (
          <figure
            key={s.title}
            className="flex w-[62%] shrink-0 snap-center flex-col items-center text-center sm:w-full sm:shrink"
          >
            <div className="mb-4 flex flex-col items-center">
              <div className="text-[11px] font-bold tracking-[0.28em] tabular-nums text-[color:var(--color-cyan-glow)]">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="mt-1.5 text-base font-semibold text-white">{s.title}</div>
            </div>
            <div className="w-full overflow-hidden rounded-[1.5rem] border border-white/12 bg-black/30 shadow-[0_34px_66px_-16px_oklch(0.02_0.02_270/0.9),0_18px_46px_-10px_oklch(0.8_0.11_232/0.6)] sm:max-w-[200px]">
              <img
                src={s.src}
                alt={s.title}
                loading="lazy"
                className="aspect-[416/900] w-full object-cover object-top"
              />
            </div>
            <figcaption className="mt-4 flex max-w-[240px] flex-col items-center">
              <span
                className="text-sm leading-relaxed text-white/65"
                style={{ textWrap: "balance" }}
              >
                {s.desc}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Nav: prev / dots / next — mobile only (desktop shows all three) */}
      <div className="mt-6 flex items-center justify-center gap-5 sm:hidden">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          className="flex size-10 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          {APP3_SCREENS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={`Go to ${s.title}`}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-6 bg-[color:var(--color-cyan-glow)]" : "w-1.5 bg-white/30"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next"
          onClick={() => goTo(active + 1)}
          disabled={active === APP3_SCREENS.length - 1}
          className="flex size-10 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function AppEcosystem() {
  return (
    <section className="bg-gradient-to-b from-[color:var(--color-deep)] to-[color:var(--color-deep-2)] text-white px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--color-cyan-glow)]">
            Connected app · Diveroid 3.0
          </p>
          <h2 className="text-3xl font-bold leading-tight sm:text-5xl">
            Your dive, saved automatically.
          </h2>
          <p className="mt-5 text-base text-white/75 sm:text-lg">
            The moment you surface, Watch Dive syncs to the{" "}
            <span className="font-semibold text-white">DIVEROID App 3.0</span> — auto-log every
            dive, share your footage with live dive data, and discover new sites nearby.
          </p>
        </div>

        <App3Carousel />
      </div>
    </section>
  );
}

function Compatibility() {
  return (
    <section className="px-5 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <video
              src={watchdiveClip}
              poster={clipPoster}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="mt-12 max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Compatibility
          </p>
          <h2 className="text-3xl font-bold leading-tight sm:text-5xl">
            Works with Most Leading Smartwatches
          </h2>
          <p className="mt-5 text-muted-foreground">
            Two ways to dive with Watch Dive — depending on the watch you already own.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            {
              mode: "App Only",
              note: "Uses your watch's built-in pressure sensor",
              models: ["Apple Watch Ultra 1", "Apple Watch Ultra 2", "Apple Watch Ultra 3"],
              image: watchScreen,
              alt: "Watch Dive app running on a smartwatch",
            },
            {
              mode: "Housing + App",
              note: "Watch Dive housing adds the dive sensor",
              models: [
                "All other Apple Watch models",
                "All Samsung Galaxy Watch models",
                "Google Pixel Watch",
                "Other Wear OS watches",
              ],
              image: housingImage,
              alt: "Watch Dive waterproof housing",
            },
          ].map(({ mode, note, models, image, alt }) => (
            <div
              key={mode}
              className="flex items-start gap-5 rounded-2xl border border-border bg-card p-5 shadow-[0_10px_28px_-10px_oklch(0.2_0.03_260/0.18)]"
            >
              <div className="flex-1">
                <div className="font-semibold">{mode}</div>
                <p className="mt-1 text-sm text-muted-foreground">{note}</p>
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {models.map((m) => (
                    <li key={m} className="flex items-center gap-2">
                      <span className="size-1 rounded-full bg-primary/70" />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
              <SectionImage
                src={image}
                alt={alt}
                className="size-24 shrink-0 self-center rounded-xl object-cover sm:size-32"
              />
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          More models are being verified — join the waitlist to get the final list at launch.
        </p>
      </div>
    </section>
  );
}

function ActionCameras() {
  return (
    <section className="bg-card/60 border-y border-border px-5 py-14 sm:py-16">
      <div className="mx-auto max-w-5xl text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-primary font-semibold mb-3">
          Works with action cameras
        </p>
        <h3 className="text-2xl sm:text-3xl font-bold leading-tight">
          Pairs with your action camera
        </h3>
        <p className="mt-4 text-muted-foreground">
          Works with GoPro, Insta360, Canon, and more — unified dive log + media in one app. Sync
          your footage with every dive automatically.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {["GoPro", "Insta360", "Canon", "& more"].map((name) => (
            <span
              key={name}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-[0_4px_14px_-4px_oklch(0.2_0.03_260/0.18)]"
            >
              {name}
            </span>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-[2rem] border border-border shadow-sm">
          <video
            src={connectedAppVideo}
            poster={connectedAppPoster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Action camera pairing and auto dive log in the connected app"
            className="aspect-video w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}

function SafetySection() {
  const points = [
    {
      t: "Built & rated for 60 m",
      d: "Sealed housing engineered and pressure‑checked for real depth.",
      iconSvg: maxDepthIcon,
    },
    {
      t: "Validated in real ocean dives",
      d: "Tested in the water by real divers — not just on a bench.",
      iconSvg: scubaFigureIcon,
    },
    {
      t: "Core safety functions",
      d: "No‑decompression limit, ascent‑rate alert, and safety‑stop guidance on your wrist.",
      iconSvg: null,
    },
  ];
  return (
    <section className="bg-card/60 border-y border-border px-5 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Built for real diving
          </p>
          <h2 className="text-3xl font-bold leading-tight sm:text-4xl">
            Serious safety, at an entry‑level price.
          </h2>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {points.map((p) => (
            <div
              key={p.t}
              className="rounded-2xl border border-border bg-card p-5 shadow-[0_10px_28px_-10px_oklch(0.2_0.03_260/0.18)]"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {p.iconSvg ? (
                  <AppIcon svg={p.iconSvg} className="size-5" />
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                )}
              </div>
              <h3 className="mt-4 font-semibold">{p.t}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{p.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Watch Dive is a dive aid, not a replacement for proper training. Always dive within your
          certification and limits, follow standard safety procedures, and keep a backup dive
          computer.
        </p>
      </div>
    </section>
  );
}

function OfferSection() {
  return (
    <section id="offer-form" className="relative overflow-hidden px-5 py-20 text-white sm:py-28">
      <div className="absolute inset-0 bg-[color:var(--color-deep-2)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_oklch(0.696_0.129_235/0.35),_transparent_60%)]" />
      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <SectionImage
          src={kickstarterImage}
          alt="Watch Dive Kickstarter launch banner"
          className="mx-auto mb-8 aspect-video w-full max-w-3xl rounded-[2rem] border border-white/10 object-cover object-top shadow-[0_30px_90px_-35px_oklch(0.8_0.11_232/0.45)]"
        />
        <p className="text-sm uppercase tracking-[0.2em] text-[color:var(--color-cyan-glow)] font-semibold mb-4">
          Kickstarter Early Bird · 50% off
        </p>
        <h2 className="text-3xl sm:text-5xl font-bold leading-tight">
          <span className="text-white/45 line-through">$299</span>{" "}
          <span className="text-[color:var(--color-cyan-glow)]">$149</span> — 50% off.
        </h2>
        <p className="mt-5 text-white/80">
          Sign up to be the <span className="font-semibold text-white">first to know</span> when
          Watch Dive launches — early bird backers lock in the lowest price ever at $149, before it
          goes to $299 at public release.
        </p>
        <div className="mt-6">
          <EmailForm id="offer" includePhone />
        </div>
      </div>
    </section>
  );
}

function Credentials() {
  return (
    <section className="px-5 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Built by a proven team
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {/* NVIDIA — big Inception badge in tinted panel + brand green accent */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-center shadow-sm">
            <div className="h-1.5 w-full" style={{ background: "#76B900" }} />
            <div
              className="flex aspect-video w-full items-center justify-center p-8"
              style={{ background: "rgba(118,185,0,0.08)" }}
            >
              <img
                src={nvidiaInceptionBadge}
                alt="NVIDIA Inception Program member badge"
                loading="lazy"
                className="max-h-full w-auto max-w-[78%]"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <div className="text-lg font-bold">
                  Member of <span style={{ color: "#76B900" }}>NVIDIA</span> Inception
                </div>
              </div>
              <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
                NVIDIA's program for startups building with AI and accelerated computing.
              </p>
            </div>
          </div>

          {/* AWS — big logo in tinted panel + brand orange accent */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-center shadow-sm">
            <div className="h-1.5 w-full" style={{ background: "#FF9900" }} />
            <div
              className="flex aspect-video w-full items-center justify-center p-8"
              style={{ background: "rgba(255,153,0,0.08)" }}
            >
              <img
                src={awsLogo}
                alt="Amazon Web Services logo"
                loading="lazy"
                className="max-h-full w-auto max-w-[72%]"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <div className="text-lg font-bold">
                  Powered by <span style={{ color: "#FF9900" }}>AWS</span>
                </div>
              </div>
              <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
                Our app and dive data run on Amazon Web Services.
              </p>
            </div>
          </div>

          {/* Samsung — real campaign still + brand blue accent */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-center shadow-sm">
            <div className="h-1.5 w-full" style={{ background: "#1428A0" }} />
            <div className="relative aspect-video w-full overflow-hidden">
              <img
                src={samsungFeature}
                alt="DIVEROID diving gear featured in a Samsung campaign"
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  As featured by
                </span>
                <img src={samsungLogo} alt="Samsung" className="mt-1.5 h-[18px] w-auto" />
              </div>
              <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
                Our diving gear appeared in a Samsung smartphone advertisement.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "Is Watch Dive a standalone dive computer?",
      a: "No. Watch Dive turns your compatible smartwatch into a dive computer solution using the housing, sensor, and connected app.",
    },
    {
      q: "How deep can I use it?",
      a: "Watch Dive is rated to 60 m, with a recommended recreational operating depth of 40 m.",
    },
    {
      q: "Does it support safety stop and no-decompression limits?",
      a: "Yes. It supports key recreational dive functions including safety stop, ascent-rate alert, depth, dive time, temperature, and no-decompression guidance.",
    },
    {
      q: "Does it work for freediving?",
      a: "Yes. Watch Dive supports both scuba diving and freediving.",
    },
    {
      q: "When does it launch?",
      a: "Watch Dive is launching soon on Kickstarter. Join the list to get early access.",
    },
  ];
  return (
    <section className="px-5 py-20 sm:py-28 max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-sm uppercase tracking-[0.2em] text-primary font-semibold mb-4">FAQ</p>
        <h2 className="text-3xl sm:text-5xl font-bold leading-tight">
          Good questions, short answers.
        </h2>
      </div>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {faqs.map((f) => (
          <details key={f.q} className="group p-5 sm:p-6">
            <summary className="flex items-center justify-between cursor-pointer list-none font-semibold">
              {f.q}
              <span className="ml-4 text-primary transition-transform group-open:rotate-45 text-2xl leading-none">
                +
              </span>
            </summary>
            <p className="mt-3 text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[color:var(--color-deep-2)] text-white/70 px-5 py-10 text-center text-sm">
      <div className="max-w-3xl mx-auto">
        <div className="font-semibold text-white">Watch Dive</div>
        <p className="mt-2">
          © {new Date().getFullYear()} Watch Dive, a product of OceanWick Inc. Launching soon on
          Kickstarter.
        </p>
        <nav className="mt-4 flex justify-center gap-6 text-white/80">
          <Link to="/terms" className="hover:text-white underline-offset-4 hover:underline">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-white underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
        </nav>
        <p className="mx-auto mt-6 max-w-2xl text-xs text-white/45">
          © {new Date().getFullYear()} NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks
          and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.
        </p>
      </div>
    </footer>
  );
}
