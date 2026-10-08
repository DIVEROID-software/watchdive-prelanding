import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "sonner";

import { track } from "@vercel/analytics";
import {
  grantAttemptMeasurement,
  joinWaitlist,
  withdrawAttemptMeasurement,
  pollVerification,
  getReferralCount,
  loadWaitlistCount,
} from "@/lib/api/waitlist.functions";
import { HeroPhoto } from "@/components/hero-photo";
import { ProductGallery } from "@/components/product-gallery";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LaunchNotice } from "@/components/launch-notice";
import { CookieSettingsLink } from "@/components/cookie-choice-bar";
import {
  expectServerWithdrawal,
  markWithdrawalRecorded,
  MEASUREMENT_CHOICE_EVENT,
  clearWithdrawalRecorded,
  MeasurementAsk,
  measurementAskEligible,
  noteMeasurementSettled,
  withdrawalNeedsRetry,
  type MeasurementChoiceDetail,
} from "@/components/measurement-ask";
import { initGoogleTag } from "@/lib/googleTag";
import { initClarity } from "@/lib/clarity";
import { startPageBehavior } from "@/lib/pageBehavior";
import { ReviewAvatar } from "@/components/review-avatar";
import { ReviewTicker } from "@/components/review-ticker";
import { WaitlistProgress } from "@/components/waitlist-progress";
import { PUBLISHABLE_REVIEWS } from "@/data/beta-reviews";
import { betaReviewBody } from "@/data/beta-reviews.loader";
import { nextPollDelayMs, VERIFY_POLL_MAX_ATTEMPTS } from "@/lib/verifyPolling";
import {
  getMetaCookies,
  hasMetaMeasurementConsent,
  initMetaPixel,
  measurementPermitted,
  newMetaEventId,
  trackMetaCustom,
  trackMetaEmailVerified,
  trackMetaLead,
  trackMetaPhoneLead,
} from "@/lib/metaPixel";
import { getAttribution } from "@/lib/attribution";
import {
  currentLandingVariant,
  getConversionExperiment,
  markConversionMilestone,
  closeExperimentEnrollmentOnSubmit,
} from "@/lib/conversionExperimentClient";
import { conversionCopy } from "@/lib/conversionCopy";
import { signupActionsVisible } from "@/lib/signupVisibility";
import { trackClarity } from "@/lib/clarity";
import {
  trackGoogleFormStart,
  trackGoogleLead,
  trackGooglePhone,
  trackGoogleSubmit,
} from "@/lib/googleTag";
import { landingHead } from "@/lib/i18n/seo";
import { readLiteMediaHint, useLiteMedia } from "@/lib/liteMedia";
import { spamFolderHintFor } from "@/lib/spamFolderHint";
import { privacyPath, termsPath } from "@/lib/i18n/locale";
import {
  useCurrentLocale,
  useFrozenLandingMessages,
  useLocalizedBetaReviewBodies,
} from "@/lib/i18n/use-current-locale";

import whyImage from "../assets/live/refresh/underwater-mobile-1000.webp";
import step1Image from "../assets/live/watchdive-step1.webp";
import step2Image from "../assets/live/refresh/wrist-pool-1000.webp";
import syncImage from "../assets/live/refresh/sync-app-1000.webp";
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
import kickstarterImage from "../assets/live/refresh/poolside-1600.webp";
import nvidiaInceptionBadge from "../assets/live/nvidia-inception.svg";
import awsLogo from "../assets/live/aws-logo.png";
import watchdiveClip from "../assets/live/watchdive-clip.mp4";
import clipPoster from "../assets/live/watchdive-clip-poster.webp";
import watchScreen from "../assets/live/watch-screen.png";
import samsungFeature from "../assets/live/samsung-feature.webp";
import samsungLogo from "../assets/live/samsung-logo.svg";
import wordmarkWhite from "../assets/brand/diveroid-wordmark-white.png";
// Smaller cuts of the same photographs (Lanczos, WebP q86), offered through
// srcset so a phone fetches the width it paints instead of the 1600px master.
import why800 from "../assets/live/refresh/underwater-mobile-640.webp";
import why1200 from "../assets/live/refresh/underwater-1600.webp";
import step1_800 from "../assets/live/responsive/watchdive-step1-800.webp";
import step1_1200 from "../assets/live/responsive/watchdive-step1-1200.webp";
import step2_800 from "../assets/live/refresh/wrist-pool-640.webp";
import sync800 from "../assets/live/refresh/sync-app-640.webp";
import kickstarter800 from "../assets/live/refresh/poolside-640.webp";
import kickstarter1200 from "../assets/live/refresh/poolside-1000.webp";
import samsungFeature800 from "../assets/live/responsive/samsung-feature-800.webp";
import samsungFeature1200 from "../assets/live/responsive/samsung-feature-1200.webp";
import watchScreen400 from "../assets/live/responsive/watch-screen-400.webp";
import watchdiveClip720 from "../assets/live/responsive/watchdive-clip-720.mp4";

const whySrcSet = `${why800} 640w, ${whyImage} 1000w`;
const stepSrcSets = {
  step1: `${step1_800} 800w, ${step1_1200} 1200w, ${step1Image} 1600w`,
  step2: `${step2_800} 640w, ${step2Image} 1000w`,
  sync: `${sync800} 640w, ${syncImage} 1000w`,
};
const kickstarterSrcSet = `${kickstarter800} 640w, ${kickstarter1200} 1000w, ${kickstarterImage} 1600w`;
const samsungFeatureSrcSet = `${samsungFeature800} 800w, ${samsungFeature1200} 1200w, ${samsungFeature} 1600w`;
const watchScreenSrcSet = `${watchScreen400} 400w, ${watchScreen} 1440w`;

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
  // The list figure is part of the server render, so it does not change a
  // second after load (see WaitlistProgress). `liteMedia` is the Save-Data
  // hint, read once here so the server render and hydration agree on it.
  loader: async () => ({
    waitlistCount: await loadWaitlistCount(),
    liteMedia: readLiteMediaHint(),
  }),
  head: () => landingHead("en"),
  component: DesignFrozenLanding,
});

export function DesignFrozenLanding() {
  // The campaign is recorded on arrival rather than at submit. A visitor who
  // lands tagged and then navigates before signing up leaves no query behind,
  // and by the time the form runs the URL that paid for them is gone.
  useEffect(() => {
    getAttribution();
  }, []);

  // Live chat is not a peer of the notify bar. On a phone it stays out of the
  // toolbar until the first form has scrolled away. The document is the
  // scroller — a nested scrollport would pin the small viewport on iOS.
  useEffect(() => {
    const update = () => {
      const form = document.getElementById("hero-email")?.closest("form");
      if (!form) return;
      document.documentElement.dataset.wdChat =
        form.getBoundingClientRect().bottom <= 0 ? "on" : "";
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      delete document.documentElement.dataset.wdChat;
    };
  }, []);

  return (
    <>
      <StickyLaunchBanner />
      <div className="wd-scroll bg-background text-foreground">
        <Hero />
        <ValueSection />
        <HowItWorks />
        <Compatibility />
        <FunctionsSection />
        <AppEcosystem />
        <ActionCameras />
        <SafetySection />
        <ReviewTicker />
        <Credentials />
        <OfferSection />
        <FAQ />
        <Footer />
      </div>
    </>
  );
}

function formatMessage(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([^}]+)\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token,
  );
}

function splitHighlightedCopy(value: string, highlight: string): [string, string, string] {
  const index = value.indexOf(highlight);
  if (index < 0) return [value, "", ""];
  return [value.slice(0, index), highlight, value.slice(index + highlight.length)];
}

function splitTwoHighlights(
  value: string,
  first: string,
  second: string,
): [string, string, string, string, string] {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second, firstIndex + first.length);
  if (firstIndex < 0 || secondIndex < 0) return [value, "", "", "", ""];
  return [
    value.slice(0, firstIndex),
    first,
    value.slice(firstIndex + first.length, secondIndex),
    second,
    value.slice(secondIndex + second.length),
  ];
}

function LaunchBanner() {
  const m = useFrozenLandingMessages();
  return (
    <div className="wd-top-bar relative z-20 border-b border-white/10 text-white">
      <div className="wd-top mx-auto max-w-6xl">
        <img src={wordmarkWhite} alt="DIVEROID" className="wd-top-mark shrink-0" />
        <p className="wd-top-line text-caption uppercase">
          <span className="wd-top-kicker text-[#36A9E1]">{m.banner.kicker}</span>
          <span className="wd-top-dot text-white/40" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span className="text-[#F6FAFC]">{m.banner.offer}</span>
        </p>
        <div className="wd-top-actions">
          <a
            href="#offer-form"
            className="wd-top-join min-h-11 min-w-11 items-center justify-center rounded-full border border-white/45 bg-[#3D2683] px-4 text-caption text-[#F6FAFC] hover:brightness-110"
          >
            {m.banner.joinCta}
          </a>
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}

/**
 * `sizes` must be at least the CSS width the image paints at each breakpoint;
 * the browser then picks the smallest srcset cut that covers it at the device
 * pixel ratio. `fetchPriority` is "high" only for what is on the first screen.
 * On a data-saving or 3g-or-slower connection only the first (smallest) cut is
 * offered; these photos are lazy, so the swap lands before they are fetched.
 */
function SectionImage({
  src,
  alt,
  className = "",
  priority = false,
  srcSet,
  sizes,
  fetchPriority,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  srcSet?: string;
  sizes?: string;
  fetchPriority?: "high" | "low" | "auto";
}) {
  const lite = useLiteMedia();
  return (
    <img
      src={src}
      srcSet={lite && srcSet ? srcSet.split(",")[0] : srcSet}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={fetchPriority}
      decoding={priority ? undefined : "async"}
      className={className}
    />
  );
}

/**
 * A looping, muted product clip that costs nothing until it is near the screen.
 *
 * With `autoPlay` every phone fetched all three clips (about 3.5 MB) during the
 * first paint, ahead of the form, even though they sit thousands of pixels
 * down. Now the poster arrives at lazy-image distance and the clip only loads
 * and plays while it is on screen, so the frame a visitor sees is unchanged.
 * `mobileSrc`, when given, is a 720p cut of the same clip for narrow screens.
 * On a data-saving or 3g-or-slower connection nothing plays or downloads on
 * its own: the poster stays, with a play button, and the clip loads on a tap.
 * The parent must be positioned (the button covers the frame).
 */
function LazyVideo({
  src,
  mobileSrc,
  poster,
  className,
  ariaLabel,
}: {
  src: string;
  mobileSrc?: string;
  poster: string;
  className: string;
  ariaLabel?: string;
}) {
  const m = useFrozenLandingMessages();
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const lite = useLiteMedia();
  const [tapped, setTapped] = useState(false);
  const autoplay = !lite;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const play = () => {
      if (!autoplay) return;
      video.play().catch(() => {
        // Low-power or data-saver modes refuse muted autoplay; the poster stays,
        // exactly as it did with the autoplay attribute.
      });
    };
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      play();
      return;
    }
    const posterObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        posterObserver.disconnect();
      },
      { rootMargin: "1250px 0px" },
    );
    const playObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) play();
        else video.pause();
      },
      { rootMargin: "200px 0px" },
    );
    posterObserver.observe(video);
    playObserver.observe(video);
    return () => {
      posterObserver.disconnect();
      playObserver.disconnect();
    };
  }, [autoplay]);

  return (
    <>
      <video
        ref={ref}
        poster={near ? poster : undefined}
        muted
        loop
        playsInline
        preload="none"
        controls={lite && tapped}
        aria-label={ariaLabel}
        className={className}
      >
        {mobileSrc && <source src={src} media="(min-width: 768px)" />}
        <source src={mobileSrc ?? src} />
      </video>
      {lite && !tapped && (
        <button
          type="button"
          onClick={() => {
            setTapped(true);
            ref.current?.play().catch(() => {});
          }}
          className="wd-play"
        >
          <span aria-hidden>▶</span>
          <span className="sr-only">{m.media.play}</span>
        </button>
      )}
    </>
  );
}

/**
 * The persistent CTA.
 *
 * It is `fixed` and nearly full-width on a 360px phone, so left alone it covers
 * the very form it points at, sits over the footer, and on Android rides above
 * the keyboard onto the email field. It hides whenever a signup form is on
 * screen or focused — at that point it is pure obstruction.
 */
function StickyLaunchBanner() {
  const m = useFrozenLandingMessages();
  const copy = conversionCopy[useCurrentLocale()];
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement && !!focused.closest("form, #dc-win");
      const keyboardOpen = !!viewport && viewport.height < window.innerHeight * 0.75;
      const forms = [...document.querySelectorAll("form[data-wd-signup]")];
      const height = viewport?.height ?? window.innerHeight;
      const improved = currentLandingVariant() === "form_first";
      const actionable = forms.some((form) => {
        if (!improved) {
          const r = form.getBoundingClientRect();
          return r.top < height && r.bottom > 0;
        }
        return signupActionsVisible(form);
      });
      const hide = actionable || editing || keyboardOpen;
      setHidden(hide);
      document.documentElement.dataset.wdForm = hide ? "active" : "";
    };
    const observer = new MutationObserver(update);
    observer.observe(document.querySelector(".wd-scroll") ?? document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const afterChoice = () => requestAnimationFrame(update);
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, afterChoice);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    viewport?.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener(MEASUREMENT_CHOICE_EVENT, afterChoice);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      viewport?.removeEventListener("resize", update);
      delete document.documentElement.dataset.wdForm;
    };
  }, []);

  // Portal onto body once mounted so the bar is not trapped in a
  // pointer-events-none ancestor, and so it stays the last offer link.
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalRoot(document.body), []);

  if (hidden) return null;

  const bar = (
    <a
      href="#offer-form"
      onClick={(event) => {
        if (currentLandingVariant() !== "form_first") return;
        const inputs = [
          ...document.querySelectorAll<HTMLInputElement>(
            'form[data-wd-signup] input[type="email"]',
          ),
        ];
        const nearest = inputs.sort(
          (a, b) =>
            Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top),
        )[0];
        if (!nearest) return;
        event.preventDefault();
        nearest.scrollIntoView({ block: "center", behavior: "auto" });
        nearest.focus({ preventScroll: true });
      }}
      className="wd-notify fixed inset-x-0 bottom-0 z-40 flex h-[var(--wd-bar-space)] items-center justify-center gap-3 border-t border-white/15 bg-[#201748] px-4 pb-[env(safe-area-inset-bottom)] text-[#F6FAFC] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-11 sm:w-auto sm:rounded-full sm:border sm:px-4 sm:pb-0"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#3D2683]">
        ↓
      </span>
      <span className="min-w-0 text-body font-medium leading-tight">
        <span className="wd-control-copy">{m.cta.label}</span>
        <span className="wd-experiment-copy">{copy.cta}</span>
      </span>
    </a>
  );
  return portalRoot ? createPortal(bar, portalRoot) : bar;
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
  const m = useFrozenLandingMessages();
  const [ref, setRef] = useState<string | undefined>(undefined);
  const [before, highlight, after] = splitHighlightedCopy(
    m.referral.welcome,
    m.referral.welcomeHighlight,
  );
  useEffect(() => setRef(getRef()), []);
  if (!ref) return null;
  return (
    <div className="mb-5 inline-flex max-w-xl items-center gap-2 self-start rounded-xl border border-[color:var(--color-cyan-glow)]/30 bg-[color:var(--color-cyan-glow)]/10 px-4 py-2.5 text-sm text-white/90">
      <span className="text-base">🎉</span>
      <span>
        {before}
        <span className="font-semibold text-white">{highlight}</span>
        {after}
      </span>
    </div>
  );
}

function ReferralSuccess({ refCode }: { refCode: string }) {
  const m = useFrozenLandingMessages();
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const joinedTemplate = count === 1 ? m.referral.joinedOne : m.referral.joinedOther;
  const [joinedBefore, , joinedAfter] = splitHighlightedCopy(joinedTemplate, "{count}");
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

  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur p-5 text-white">
      <div className="text-base font-semibold">{m.referral.successTitle}</div>
      <p className="mt-1 text-sm text-white/80">{m.referral.successBody}</p>

      {shareUrl && (
        <div className="mt-4 rounded-xl border border-white/15 bg-[color:var(--color-deep-2)]/50 p-4">
          <div className="text-sm font-semibold text-[color:var(--color-cyan-glow)]">
            {m.referral.buddyTitle}
          </div>
          <p className="mt-1 text-xs text-white/70">{m.referral.buddyBody}</p>

          {count !== null && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/85">
                  {joinedBefore}
                  <span className="font-semibold text-[color:var(--color-cyan-glow)]">{count}</span>
                  {joinedAfter}
                </span>
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
                      title: "WatchDive",
                      text: m.referral.shareText,
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
              className="inline-flex h-11 min-h-11 items-center justify-center rounded-lg border border-white/45 bg-[#3D2683] px-4 text-sm font-semibold text-[#F6FAFC] hover:brightness-110"
            >
              {copied ? m.referral.copied : m.referral.shareButton}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Shown from submit until the mailed link is confirmed. The copy is conditional
// because several accepted paths send nothing at all, and the page must not
// claim a delivery it cannot know about.
// The confirmation click is where a double opt-in funnel leaks. Sending people
// straight to a pre-filtered inbox search is the cheapest known fix, so the
// handful of providers that cover most consumer mail get a direct link.
type WebmailLabel = "openGmail" | "openOutlook" | "openYahoo" | "openNaver" | "openDaum";

const WEBMAIL: { match: RegExp; label: WebmailLabel; url: string }[] = [
  {
    match: /@(gmail|googlemail)\.com$/i,
    label: "openGmail",
    url: "https://mail.google.com/mail/u/0/#search/watch+dive",
  },
  {
    match: /@(outlook|hotmail|live|msn)\./i,
    label: "openOutlook",
    url: "https://outlook.live.com/mail/0/inbox",
  },
  { match: /@yahoo\./i, label: "openYahoo", url: "https://mail.yahoo.com/" },
  { match: /@naver\.com$/i, label: "openNaver", url: "https://mail.naver.com/" },
  { match: /@(daum|hanmail)\.net$/i, label: "openDaum", url: "https://mail.daum.net/" },
];

function webmailFor(email: string) {
  return WEBMAIL.find((provider) => provider.match.test(email.trim()));
}

/**
 * Facebook and Instagram open links inside their own webview, which carries no
 * Google or Microsoft session — so a "Open Gmail" button there lands on a login
 * wall at the most fragile step in the funnel. 87% of this page's traffic comes
 * from exactly those apps, so the link is replaced with instructions rather
 * than offered and broken.
 */
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|KAKAOTALK|NAVER\(inapp/i.test(navigator.userAgent);
}

function CheckInboxCard({
  message,
  email,
  onResend,
  onStartOver,
  resending,
  onAllowMeasurement,
  onDeclineMeasurement,
}: {
  message: string;
  email: string;
  onResend: () => void;
  onStartOver: () => void;
  resending: boolean;
  /** Present when this browser may still be asked about measurement. */
  onAllowMeasurement?: () => boolean | void | Promise<boolean | void>;
  onDeclineMeasurement?: () => boolean | void | Promise<boolean | void>;
}) {
  const m = useFrozenLandingMessages();
  const cardRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(60);
  // Restart after every resend, not only the first submission. Use wall time
  // so a backgrounded Instagram tab cannot leave a stale countdown behind.
  useEffect(() => {
    const deadline = Date.now() + 60_000;
    setRemaining(60);
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resending]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const webmail = webmailFor(email);
  const spamHint = spamFolderHintFor(email);
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isInAppBrowser()), []);

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="region"
      aria-label={m.inbox.title}
      className="wd-inbox-card"
    >
      <p className="wd-inbox-step">{m.inbox.stepLabel}</p>
      <h2 className="text-2xl font-semibold leading-tight">{m.inbox.title}</h2>
      <p role="status" className="mt-3 text-sm leading-relaxed">
        {m.inbox.requirement}
      </p>
      <p className="wd-inbox-address" data-clarity-mask="true">
        <bdi>{email.trim()}</bdi>
      </p>
      <ol className="wd-inbox-actions">
        <li>
          <span aria-hidden>1</span>
          <div>
            <strong>{m.inbox.action1}</strong>
            <p>{m.inbox.noteSubject}</p>
          </div>
        </li>
        <li>
          <span aria-hidden>2</span>
          <div>
            <strong>{m.inbox.action2}</strong>
            <p className="font-semibold">{m.inbox.noteButton}</p>
          </div>
        </li>
      </ol>
      {spamHint && <p className="wd-provider-hint">{m.inbox[spamHint]}</p>}
      {inApp && <p className="wd-inapp-hint">{m.inbox.inAppHint}</p>}
      {webmail && !inApp && (
        <a href={webmail.url} target="_blank" rel="noopener noreferrer" className="wd-open-mail">
          {m.inbox[webmail.label]} <span aria-hidden>↗</span>
        </a>
      )}
      <p className="mt-4 text-sm leading-relaxed text-white/85">{m.inbox.help}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={onResend}
          disabled={remaining > 0 || resending}
          className="wd-resend"
        >
          {resending
            ? m.inbox.resendBusy
            : remaining > 0
              ? formatMessage(m.inbox.countdown, { seconds: remaining })
              : m.inbox.resendIdle}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="min-h-11 text-sm text-white underline underline-offset-4"
        >
          {m.inbox.wrongAddress}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/65">{message}</p>
      {onAllowMeasurement && (
        <MeasurementAsk onAllow={onAllowMeasurement} onDecline={onDeclineMeasurement} />
      )}
    </div>
  );
}

// The two placements the server accepts as a Source. Keeping the union here
// means a new placement is a type error rather than a rejected submit.
type FormPlacement = "hero" | "offer";

function EmailForm({ id, includePhone = false }: { id: FormPlacement; includePhone?: boolean }) {
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const copy = conversionCopy[locale];
  const [pending, setPending] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [refCode, setRefCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [hp, setHp] = useState(""); // honeypot — real users never fill this
  const [loading, setLoading] = useState(false);
  const formStartSent = useRef(false); // FormStart once per form instance
  // Decided once, when the inbox card appears: asking is for browsers that
  // have not answered yet in a country where measurement is opt-in.
  const [askMeasurement, setAskMeasurement] = useState(false);
  // A ring that expands once, the first time the form is actually on screen.
  // It points at the next action after an anchor jump; it never repeats, so it
  // guides rather than nags.
  const formRef = useRef<HTMLFormElement>(null);
  const [ring, setRing] = useState(false);
  const ringShown = useRef(false);

  useEffect(() => {
    const check = () => {
      const form = formRef.current;
      if (form && signupActionsVisible(form)) markConversionMilestone("formVisible");
    };
    const observer = new ResizeObserver(check);
    if (formRef.current) observer.observe(formRef.current);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    window.addEventListener("watchdive:experiment-ready", check);
    const afterChoice = () => requestAnimationFrame(check);
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, afterChoice);
    window.visualViewport?.addEventListener("resize", check);
    check();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      window.removeEventListener("watchdive:experiment-ready", check);
      window.removeEventListener(MEASUREMENT_CHOICE_EVENT, afterChoice);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, [pending]);

  useEffect(() => {
    const element = formRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (ringShown.current) return;
        if (!entries.some((entry) => entry.intersectionRatio >= 0.55)) return;
        ringShown.current = true;
        observer.disconnect();
        setRing(true);
        window.setTimeout(() => setRing(false), 700);
      },
      { threshold: [0.55] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // On a slow phone the server-rendered form is on screen seconds before the
  // script that runs it. Left alone, a submit in that window reloads the page
  // and drops the address. HOLD_EARLY_SUBMIT_JS (inline in <Hero>) holds that
  // submit and marks the form `data-wd-queued`. When React takes over, keep
  // what was typed, mark the form ready, and send the held submit once.
  // `ready` is a prop, not a DOM write, so the form that returns after "Wrong
  // address?" is ready too.
  const [ready, setReady] = useState(false);
  const [queued, setQueued] = useState(false);
  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const typedEmail = form.querySelector<HTMLInputElement>(`#${id}-email`)?.value ?? "";
    if (typedEmail) setEmail(typedEmail);
    const typedPhone = form.querySelector<HTMLInputElement>('input[type="tel"]')?.value ?? "";
    if (typedPhone) setPhone(typedPhone);
    setReady(true);
    if (form.hasAttribute("data-wd-queued")) {
      form.removeAttribute("data-wd-queued");
      setQueued(true);
    }
  }, [id]);
  useEffect(() => {
    if (!queued) return;
    setQueued(false);
    formRef.current?.requestSubmit();
  }, [queued]);

  // Waits for the confirmation, which may never arrive in this tab — the link
  // can be opened on another device entirely. So the wait is deliberately
  // cheap: twelve polls on a jittered backoff over about five minutes, paused
  // whenever the tab is hidden, and never more than one request in flight. The
  // lead is confirmed server-side either way; this only drives the live
  // hand-off and the `EmailVerified` pixel leg. The submit `Lead` fires here
  // only when this browser already allows measurement. A later Allow sends it
  // from the server, under the server's own id.
  useEffect(() => {
    if (!handle || verified) return;

    let alive = true;
    let attempts = 0;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      alive = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };

    const schedule = () => {
      if (!alive || timer || attempts >= VERIFY_POLL_MAX_ATTEMPTS) return;
      // A backgrounded tab is not watching, so it should not be polling. The
      // visibility listener starts the schedule again when it comes back.
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(poll, nextPollDelayMs(attempts + 1));
    };

    const poll = async () => {
      timer = undefined;
      if (!alive || inFlight) return;
      if (document.visibilityState === "hidden") return;
      if (attempts >= VERIFY_POLL_MAX_ATTEMPTS) return;

      inFlight = true;
      attempts += 1;
      try {
        const res = await pollVerification({ data: { handle } });
        if (!alive) return;
        if (res.status === "verified") {
          setRefCode(res.refCode ?? "");
          setVerified(true);
          track("waitlist_verified", { source: id });
          if (res.browserLead && measurementPermitted()) {
            trackMetaEmailVerified(res.browserLead.eventId, res.browserLead.source);
            trackGoogleLead(res.browserLead.eventId, res.browserLead.source);
            trackClarity("generate_lead", res.browserLead.source);
            if (res.browserLead.hasPhone) {
              trackMetaPhoneLead(`${res.browserLead.eventId}:phone`, res.browserLead.source);
              trackGooglePhone(`${res.browserLead.eventId}:phone`, res.browserLead.source);
            }
          }
          stop();
          return;
        }
        // An expired handle will not become valid again; only pending is worth
        // another look.
        if (res.status !== "pending") {
          stop();
          return;
        }
      } catch {
        // A dropped poll is not a failed signup. It still counts against the
        // budget, so a server that is down cannot be retried indefinitely.
      } finally {
        inFlight = false;
      }
      schedule();
    };

    function onVisibilityChange() {
      if (document.visibilityState === "visible") schedule();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule();
    return stop;
  }, [handle, verified, id]);

  // The banner can also be answered while this signup is pending. Its answer
  // applies to this signup just like the inbox card's.
  useEffect(() => {
    if (!handle) return;
    const onChoice = (event: Event) => {
      const detail = (event as CustomEvent<MeasurementChoiceDetail>).detail;
      if (!detail || detail.origin !== "banner") return;
      if (detail.choice === "granted") {
        if (!measurementPermitted()) return;
        void allowMeasurementAfterSubmit().then((recorded) => {
          noteMeasurementSettled({ choice: "granted", recorded });
        });
      } else {
        expectServerWithdrawal();
        void declineMeasurementAfterSubmit().then((recorded) => {
          noteMeasurementSettled({ choice: "denied", recorded });
        });
      }
    };
    window.addEventListener(MEASUREMENT_CHOICE_EVENT, onChoice);
    return () => window.removeEventListener(MEASUREMENT_CHOICE_EVENT, onChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  if (verified) {
    return <ReferralSuccess refCode={refCode} />;
  }

  // The server treats a repeat submit of the same address as a resend, under
  // its own cooldown and send ceiling. Reusing that path means the button
  // cannot invent a second code path to keep correct.
  // `submitEventId` is passed only by the first submit, never by a resend: the
  // server mirrors the browser's optimisation event under that id, and one
  // person asking for their mail again is not a second application.
  const submit = async (submitEventId?: string) => {
    const res = await joinWaitlist({
      data: {
        email: email.trim().toLowerCase(),
        // A number is only ever sent with its own explicit consent.
        phone: phone.trim() && smsConsent ? phone.trim() : undefined,
        source: id,
        referredBy: getRef(),
        // First touch, not this click: the URL here is whatever the visitor
        // last navigated to, which for a scrolled page is nothing at all.
        attribution: getAttribution(),
        honeypot: hp,
        measurementConsent: hasMetaMeasurementConsent(),
        experiment: getConversionExperiment(),
        locale,
        ...(submitEventId ? { submitEventId } : {}),
        ...getMetaCookies(),
      },
    });
    if (res.status === "closed") {
      setClosed(res.message);
      return res;
    }
    clearWithdrawalRecorded();
    setHandle(res.handle);
    setPending(res.message);
    return res;
  };

  // Allowed after the submit (inbox card, or the banner while the inbox card
  // is up): start the tags this browser now permits and record the grant.
  // The attempt answer is always `{ ok: true }`, so it cannot carry the Lead.
  // The server sends that Lead. This calls the grant a few times so a write
  // whose confirming read failed gets another chance at the same server id,
  // then polls once for the EmailVerified pixel if the link was already opened.
  async function allowMeasurementAfterSubmit(): Promise<boolean> {
    if (!measurementPermitted()) return false;
    initMetaPixel();
    initGoogleTag();
    initClarity();
    startPageBehavior();
    if (!handle) return false;
    const attribution = getAttribution();
    const cookies = getMetaCookies();
    const fbc =
      cookies.fbc ||
      (attribution.fbclid && attribution.capturedAt
        ? `fb.1.${attribution.capturedAt}.${attribution.fbclid}`
        : undefined);
    let accepted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await grantAttemptMeasurement({
          data: {
            handle,
            ...(cookies.fbp ? { fbp: cookies.fbp } : {}),
            ...(fbc ? { fbc } : {}),
          },
        });
        accepted = true;
      } catch {
        // A thrown grant is not `{ ok: true }`. Keep the remaining tries.
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (!accepted || !measurementPermitted()) return false;
    try {
      const polled = await pollVerification({ data: { handle } });
      if (polled.browserLead && measurementPermitted()) {
        trackMetaEmailVerified(polled.browserLead.eventId, polled.browserLead.source);
        trackGoogleLead(polled.browserLead.eventId, polled.browserLead.source);
        if (polled.browserLead.hasPhone) {
          trackMetaPhoneLead(`${polled.browserLead.eventId}:phone`, polled.browserLead.source);
          trackGooglePhone(`${polled.browserLead.eventId}:phone`, polled.browserLead.source);
        }
      }
    } catch {
      // The grant calls already landed. The poll effect retries EmailVerified.
    }
    return true;
  }

  // Refused after the submit: recorded on the signup, so a confirmation opened
  // anywhere later sends nothing. `nextHandle` is the handle a resend just
  // returned; the React state still holds the previous attempt until paint.
  async function declineMeasurementAfterSubmit(nextHandle?: string): Promise<boolean> {
    const current = nextHandle || handle;
    if (!current) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await withdrawAttemptMeasurement({ data: { handle: current } });
        if (res.recorded) {
          markWithdrawalRecorded();
          return true;
        }
      } catch {
        // A dropped call is not a recorded refusal.
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    return false;
  }

  if (closed) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl bg-white/10 p-5 text-white backdrop-blur"
      >
        <div className="text-base font-semibold">{m.closed.title}</div>
        <p className="mt-1 text-sm text-white/80">{closed}</p>
      </div>
    );
  }

  if (pending) {
    return (
      <CheckInboxCard
        message={pending}
        email={email}
        resending={loading}
        onResend={async () => {
          if (loading) return;
          setLoading(true);
          try {
            const res = await submit();
            if (res?.status === "pending" && res.handle && withdrawalNeedsRetry()) {
              await declineMeasurementAfterSubmit(res.handle);
            }
            toast.success(m.toasts.resent);
          } catch {
            toast.error(m.toasts.error);
          } finally {
            setLoading(false);
          }
        }}
        onAllowMeasurement={askMeasurement ? allowMeasurementAfterSubmit : undefined}
        onDeclineMeasurement={askMeasurement ? declineMeasurementAfterSubmit : undefined}
        onStartOver={() => {
          // A typo is otherwise unrecoverable without a page reload.
          setPending(null);
          setHandle("");
          requestAnimationFrame(() => document.getElementById(`${id}-email`)?.focus());
        }}
      />
    );
  }

  return (
    <form
      ref={formRef}
      data-wd-signup=""
      data-wd-ready={ready ? "" : undefined}
      onSubmit={async (e) => {
        e.preventDefault();
        if (loading) return;
        closeExperimentEnrollmentOnSubmit();
        markConversionMilestone("submitAttempted");
        setLoading(true);
        try {
          // Captured here, in the browser that actually chose it, and carried
          // signed from now on: the browser that opens the confirmation link
          // must not be able to widen it.
          const submitEventId = newMetaEventId();
          const res = await submit(submitEventId);
          setAskMeasurement(
            res.status === "pending" &&
              !hp.trim() &&
              (measurementAskEligible() || withdrawalNeedsRetry()),
          );
          // 퍼널 앞단 신호 — 가입 확정이 아니라 확인 메일 요청 시점 측정.
          track("waitlist_pending", { source: id, referred: !!getRef() });
          trackMetaCustom("SignupPending", { source: id });
          // `Lead` fires here, at the accepted submit (2026-09-26): one
          // confirmation a week is too little for delivery to optimise on. The
          // server sent the Conversions API leg under the same event id, so
          // Meta counts one Lead. A tripped honeypot is knowable right here,
          // and a bot is not something to optimise for.
          if (res.status === "pending" && !hp.trim() && measurementPermitted()) {
            trackMetaLead(submitEventId, id);
            trackGoogleSubmit(submitEventId, id);
            trackClarity("sign_up", id);
          }
        } catch {
          toast.error(m.toasts.error);
        } finally {
          setLoading(false);
        }
      }}
      className="relative flex flex-col gap-3 w-full"
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
      {ring && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1.5 rounded-2xl border-2 border-[color:var(--color-cyan-glow)] motion-safe:animate-[wd-focus-ring_650ms_cubic-bezier(0.2,0.8,0.2,1)_forwards] motion-reduce:hidden"
        />
      )}

      <p className="wd-experiment-copy wd-experiment-benefit">{copy.benefit}</p>
      <p
        id={`${id}-confirm-note`}
        className="wd-control-copy text-sm leading-relaxed text-white/90"
      >
        {m.form.confirmRequired}
      </p>
      <div className="grid w-full min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-label={m.form.step1}
          aria-describedby={`${id}-confirm-note ${id}-experiment-note`}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => {
            markConversionMilestone("formFocused");
            if (!formStartSent.current) {
              formStartSent.current = true;
              trackMetaCustom("FormStart", { source: id });
              trackGoogleFormStart(id);
              trackClarity("form_start", id);
            }
          }}
          placeholder={m.form.emailPlaceholder}
          className="order-1 h-14 w-full min-w-0 px-4 rounded-xl bg-gradient-to-b from-white to-[oklch(0.92_0.006_255)] text-[color:var(--color-deep-2)] placeholder:text-muted-foreground border border-white/50 shadow-[inset_0_1px_0_oklch(1_0_0/0.85),0_22px_48px_-8px_oklch(0.008_0.01_270/0.85),0_6px_16px_-3px_oklch(0.008_0.01_270/0.7)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-cyan-glow)]"
        />
        {includePhone && (
          <input
            type="tel"
            autoComplete="tel"
            aria-label={m.form.phonePlaceholder}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={m.form.phonePlaceholder}
            className="order-2 h-14 w-full min-w-0 px-4 rounded-xl bg-gradient-to-b from-white to-[oklch(0.92_0.006_255)] text-[color:var(--color-deep-2)] placeholder:text-muted-foreground border border-white/50 shadow-[inset_0_1px_0_oklch(1_0_0/0.85),0_22px_48px_-8px_oklch(0.008_0.01_270/0.85),0_6px_16px_-3px_oklch(0.008_0.01_270/0.7)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-cyan-glow)] sm:order-3 sm:col-span-2"
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="wd-submit order-3 inline-flex min-h-14 items-center justify-center rounded-xl border border-white/45 bg-[#3D2683] px-5 py-3 font-semibold text-[#F6FAFC] hover:brightness-110 active:scale-[0.99] transition sm:order-2"
        >
          {loading ? (
            m.form.saving
          ) : (
            <>
              <span className="wd-control-copy">{m.cta.label}</span>
              <span className="wd-experiment-copy">{copy.cta}</span>
            </>
          )}
        </button>
      </div>

      <div id={`${id}-experiment-note`} className="wd-experiment-copy wd-experiment-note">
        <p className="font-semibold">{copy.reassurance}</p>
        <p>{copy.confirmation}</p>
        <p className="wd-experiment-terms">{copy.terms}</p>
      </div>

      {/* Never pre-ticked, and separate from the email signup: WD-SMS-CONSENT-V1. */}
      {includePhone && phone.trim() && (
        <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-white/70">
          <input
            type="checkbox"
            checked={smsConsent}
            onChange={(event) => setSmsConsent(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[color:var(--color-cyan-glow)]"
          />
          <span>{m.form.smsConsent}</span>
        </label>
      )}

      <p role="status" className="wd-queued-note">
        {m.form.queued}
      </p>
      <p className="wd-control-copy wd-signup-steps text-xs text-white/80">
        <span>
          <b>1</b> {m.form.step1}
        </span>
        <span aria-hidden>→</span>
        <span>
          <b>2</b> {m.form.step2}
        </span>
      </p>
    </form>
  );
}

// One published review supports the first signup; the full review set stays below.
function HeroProof() {
  const m = useFrozenLandingMessages();
  const reviewBodies = useLocalizedBetaReviewBodies();
  const picks = PUBLISHABLE_REVIEWS.slice(1, 2);
  return (
    <div className="max-w-xl">
      <div className="flex flex-col gap-5">
        {picks.map((review) => (
          <figure
            key={review.id}
            className="border-t border-white/15 pt-4 first:border-t-0 first:pt-0"
          >
            <span className="text-caption text-[#36A9E1]">{"★".repeat(review.rating)}</span>
            <blockquote className="mt-1.5 text-body leading-relaxed text-[#F6FAFC]">
              {betaReviewBody(review, reviewBodies)}
            </blockquote>
            <figcaption className="mt-2 flex items-center gap-1.5 text-caption text-[#F6FAFC]">
              <ReviewAvatar review={review} px={20} />
              <span className="min-w-0">
                {review.name} · {review.city}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <a
        href="#beta-reviews"
        className="mt-2.5 inline-flex min-h-11 items-center text-caption text-[#F6FAFC] underline underline-offset-2"
      >
        {formatMessage(m.heroProof.readAll, { count: PUBLISHABLE_REVIEWS.length })}
      </a>
    </div>
  );
}

/**
 * Holds a signup submitted before the bundle hydrates (see EmailForm). Capture
 * phase on the document, registered while the HTML is still parsing, so it
 * runs before React's own listener on the same node. Until a form carries
 * `data-wd-ready` it stops the native reload and marks the form queued; after
 * that it does nothing.
 */
const HOLD_EARLY_SUBMIT_JS = `document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.hasAttribute||!f.hasAttribute("data-wd-signup")||f.hasAttribute("data-wd-ready"))return;e.preventDefault();e.stopImmediatePropagation();f.setAttribute("data-wd-queued","")},true);`;

/**
 * The first screen answers what this is before anything loads: the headline
 * names the outcome (your smartwatch becomes a dive computer), the sub-line
 * says how, the photo shows it on a wrist in water, then the price and the
 * form. Text and form are server-rendered; the photo has an instant preview.
 */
function Hero() {
  const m = useFrozenLandingMessages();
  const copy = conversionCopy[useCurrentLocale()];
  const [before, highlight, after] = splitHighlightedCopy(m.hero.h1, m.hero.h1Highlight);
  return (
    <header className="wd-hero-new text-white">
      <script dangerouslySetInnerHTML={{ __html: HOLD_EARLY_SUBMIT_JS }} />
      <LaunchBanner />
      <div className="wd-hero-layout mx-auto max-w-6xl px-5">
        <div className="wd-hero-heading">
          <h1 className="text-display">
            {before}
            <span className="text-[#65ceee]">{highlight}</span>
            {after}
          </h1>
          <p className="wd-hero-sub text-body text-[#F6FAFC]">{m.hero.sub}</p>
          <a href="#compatibility" className="wd-experiment-copy wd-experiment-compatibility">
            {copy.compatibility} <span aria-hidden>↗</span>
          </a>
        </div>
        <div className="wd-hero-media">
          <HeroPhoto />
        </div>
        <div className="wd-hero-signup">
          <div className="wd-hero-price">
            <span className="text-white/65 line-through">{m.hero.wasPrice}</span>
            <span className="text-subhead">{m.hero.nowPrice}</span>
            <div>
              <span className="text-sm font-semibold text-[#65ceee]">{m.hero.offBadge}</span>
              <p className="text-xs text-white/85">{m.hero.offNote}</p>
            </div>
          </div>
          <EmailForm id="hero" />
          <div className="mt-5">
            <LaunchNotice />
            <WaitlistProgress />
          </div>
          <ReferralWelcome />
        </div>
        <div className="wd-hero-proof">
          <UspStrip />
          <HeroProof />
        </div>
      </div>
    </header>
  );
}

/**
 * Three reasons, in the order a diver's doubts arrive: will it work with my
 * watch (most assume they need an Ultra), what does it cost, what does it do.
 * Only claims already made further down the page; the model list is linked.
 */
function UspStrip() {
  const m = useFrozenLandingMessages();
  return (
    <ul className="wd-usp" aria-label={m.usp.label}>
      <li>
        <span className="wd-usp-icon">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="6" />
            <polyline points="12 10 12 12 13 13" />
            <path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05" />
            <path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05" />
          </svg>
        </span>
        <div>
          <p className="wd-usp-title">{m.usp.compatTitle}</p>
          <p className="wd-usp-body">{m.usp.compatBody}</p>
          <a href="#compatibility" className="wd-usp-link">
            {m.usp.compatLink} <span aria-hidden>↓</span>
          </a>
        </div>
      </li>
      <li>
        <span className="wd-usp-icon">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z" />
            <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
          </svg>
        </span>
        <div>
          <p className="wd-usp-title">
            {formatMessage(m.usp.priceTitle, { price: m.hero.nowPrice })}
          </p>
          <p className="wd-usp-body">{formatMessage(m.usp.priceBody, { was: m.hero.wasPrice })}</p>
        </div>
      </li>
      <li>
        <span className="wd-usp-icon">
          <AppIcon svg={maxDepthIcon} className="size-[22px]" />
        </span>
        <div>
          <p className="wd-usp-title">{m.usp.wristTitle}</p>
          <p className="wd-usp-body">{m.usp.wristBody}</p>
        </div>
      </li>
    </ul>
  );
}

function ValueSection() {
  const m = useFrozenLandingMessages();
  return (
    <section>
      <div aria-hidden className="h-10 bg-gradient-to-b from-[#07131c] to-background sm:h-20" />
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-2 sm:pb-28">
        <div className="lg:hidden">
          <p className="mb-4 text-caption uppercase text-primary">{m.value.kicker}</p>
          <h2 className="text-title">{m.value.h2}</h2>
        </div>
        <div className="mt-8 grid gap-10 lg:mt-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm">
            <picture>
              <source media="(min-width: 1024px)" srcSet={why1200} />
              <SectionImage
                src={whyImage}
                srcSet={whySrcSet}
                sizes="(min-width: 1024px) 520px, calc(100vw - 40px)"
                alt={m.value.imageAlt}
                className="aspect-[4/5] w-full object-cover lg:aspect-square"
              />
            </picture>
            <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/15 bg-[color:var(--color-deep-2)]/82 p-4 text-white backdrop-blur-md">
              <div className="text-caption uppercase text-[#F6FAFC]">{m.value.overlayKicker}</div>
              <div className="mt-2 text-lead">{m.value.overlayText}</div>
            </div>
          </div>

          <div>
            <div className="hidden lg:block">
              <p className="mb-4 text-caption uppercase text-primary">{m.value.kicker}</p>
              <h2 className="text-title">{m.value.h2}</h2>
            </div>
            <p className="mt-6 text-body text-muted-foreground">{m.value.lead}</p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: m.value.card1Title,
                  copy: m.value.card1Copy,
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
                  title: m.value.card2Title,
                  copy: m.value.card2Copy,
                  icon: (
                    <>
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                      <path d="m9 12 2 2 4-4" />
                    </>
                  ),
                },
                {
                  title: m.value.card3Title,
                  copy: m.value.card3Copy,
                  icon: (
                    <>
                      <path d="m12 14 4-4" />
                      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                    </>
                  ),
                },
                {
                  title: m.value.card4Title,
                  copy: m.value.card4Copy,
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
                  <h3 className="mt-4 text-lead">{title}</h3>
                  <p className="mt-1.5 text-body text-muted-foreground">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FunctionsSection() {
  const m = useFrozenLandingMessages();
  const items = [
    {
      t: m.functions.item1Title,
      d: m.functions.item1Body,
      iconSrc: null,
      icon: (
        <>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </>
      ),
    },
    {
      t: m.functions.item2Title,
      d: m.functions.item2Body,
      // real App 3.0 Dive Time (stopwatch) icon — NDL is a real-time countdown
      iconSrc: diveTimeIcon,
      icon: null,
    },
    {
      t: m.functions.item3Title,
      d: m.functions.item3Body,
      // real App 3.0 water-temperature icon
      iconSrc: temperatureIcon,
      icon: null,
    },
    {
      t: m.functions.item4Title,
      d: m.functions.item4Body,
      // real App 3.0 scuba diver icon
      iconSrc: scubaFigureIcon,
      icon: null,
    },
  ];

  return (
    <section className="wd-section bg-[color:var(--color-deep-2)] text-white">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="mb-4 text-caption uppercase text-[#36A9E1]">{m.functions.kicker}</p>
          <h2 className="text-title">{m.functions.h2}</h2>
          <p className="mt-5 text-body text-[#F6FAFC]">{m.functions.sub}</p>
        </div>

        <div className="mt-12 relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/5">
          <LazyVideo
            src={functionsVideo}
            poster={functionsPoster}
            ariaLabel={m.functions.videoAria}
            className="aspect-video w-full object-cover"
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((i) => (
            <details
              key={i.t}
              className="group rounded-xl bg-white/5 border border-white/10 p-4 backdrop-blur-sm open:bg-white/8"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 font-semibold">
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
              <p className="mt-3 text-body text-[#F6FAFC]">{i.d}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const m = useFrozenLandingMessages();
  const steps = [
    {
      n: "01",
      t: m.how.step1Title,
      d: m.how.step1Body,
      image: step1Image,
      srcSet: stepSrcSets.step1,
      alt: m.how.step1Alt,
      iconSvg: gearBagIcon,
    },
    {
      n: "02",
      t: m.how.step2Title,
      d: m.how.step2Body,
      image: step2Image,
      srcSet: stepSrcSets.step2,
      alt: m.how.step2Alt,
      iconSvg: scubaFigureIcon,
    },
    {
      n: "03",
      t: m.how.step3Title,
      d: m.how.step3Body,
      image: syncImage,
      srcSet: stepSrcSets.sync,
      alt: m.how.step3Alt,
      iconSvg: autoSyncIcon,
    },
  ];
  return (
    <section className="wd-section mx-auto max-w-5xl">
      <div className="text-center max-w-2xl mx-auto mb-14">
        <p className="text-caption uppercase text-primary mb-4">{m.how.kicker}</p>
        <h2 className="text-title">{m.how.h2}</h2>
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
              <div className="text-caption text-primary">{s.n}</div>
            </div>
            <h3 className="mt-3 text-lead">{s.t}</h3>
            <p className="mt-2 text-body text-muted-foreground">{s.d}</p>
            <div className="mt-auto pt-5">
              {/* The aspect-ratio reserves space while below-fold photographs load lazily. */}
              <SectionImage
                src={s.image}
                srcSet={s.srcSet}
                sizes="(min-width: 768px) 340px, calc(112vw - 98px)"
                alt={s.alt}
                className="block aspect-[4/3] w-full rounded-xl object-cover"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function App3Carousel() {
  const m = useFrozenLandingMessages();
  const APP3_SCREENS = [
    {
      src: app3_1,
      tab: m.app.tab1,
      tabDesc: m.app.tab1Desc,
      title: m.app.screen1Title,
      desc: m.app.screen1Body,
      iconSvg: logbookIcon,
    },
    {
      src: app3_6,
      tab: m.app.tab2,
      tabDesc: m.app.tab2Desc,
      title: m.app.screen2Title,
      desc: m.app.screen2Body,
      iconSvg: shareIcon,
    },
    {
      src: app3_4,
      tab: m.app.tab3,
      tabDesc: m.app.tab3Desc,
      title: m.app.screen3Title,
      desc: m.app.screen3Body,
      iconSvg: locationPinIcon,
    },
  ];
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
      <div className="wd-app-tabs mx-auto grid max-w-3xl grid-cols-3 gap-3">
        {APP3_SCREENS.map((s, i) => {
          const on = i === active;
          return (
            <button
              key={s.tab}
              type="button"
              onClick={() => goTo(i)}
              aria-label={formatMessage(m.app.showAria, { title: s.title })}
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
              <div className="text-lead text-[#36A9E1]">{s.tab}</div>
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
              <div className="text-caption tabular-nums text-[#36A9E1]">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="mt-1.5 text-lead text-white">{s.title}</div>
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
          aria-label={m.app.prevAria}
          onClick={() => goTo(active - 1)}
          disabled={active === 0}
          className="flex size-11 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          {APP3_SCREENS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              aria-label={formatMessage(m.app.gotoAria, { title: s.title })}
              onClick={() => goTo(i)}
              className="flex min-h-11 min-w-11 items-center justify-center"
            >
              <span
                className={`h-1.5 rounded-full ${
                  i === active ? "w-6 bg-[color:var(--color-cyan-glow)]" : "w-1.5 bg-white/70"
                }`}
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={m.app.nextAria}
          onClick={() => goTo(active + 1)}
          disabled={active === APP3_SCREENS.length - 1}
          className="flex size-11 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:bg-white/10 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function AppEcosystem() {
  const m = useFrozenLandingMessages();
  const [leadBefore, leadHighlight, leadAfter] = splitHighlightedCopy(
    m.app.lead,
    m.app.leadHighlight,
  );
  return (
    <section className="wd-section bg-gradient-to-b from-[color:var(--color-deep)] to-[color:var(--color-deep-2)] text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-caption uppercase text-[#36A9E1]">{m.app.kicker}</p>
          <h2 className="text-title">{m.app.h2}</h2>
          <p className="mt-5 text-body text-[#F6FAFC]">
            {leadBefore}
            <span className="font-semibold text-white">{leadHighlight}</span>
            {leadAfter}
          </p>
        </div>

        <App3Carousel />
      </div>
    </section>
  );
}

function Compatibility() {
  const m = useFrozenLandingMessages();
  return (
    <section id="compatibility" className="wd-section">
      <div className="mx-auto max-w-6xl">
        <div className="overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <LazyVideo
              src={watchdiveClip}
              mobileSrc={watchdiveClip720}
              poster={clipPoster}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="mt-12 max-w-3xl">
          <p className="mb-4 text-caption uppercase text-primary">{m.compat.kicker}</p>
          <h2 className="text-title">{m.compat.h2}</h2>
          <p className="mt-5 text-body text-muted-foreground">{m.compat.lead}</p>
        </div>

        {/* The housing is the path almost everyone arriving here is on: a depth
            sensor is rare, and a visitor whose watch has none is the person this
            section has to answer first. Sizing the two cards equally sent the
            opposite message — that the Ultra route was the main one.
            The whole housing is shown, contained: the old square crop cut its
            edge, and beside the text it squeezed the model list to half a
            phone. It stacks above the text until there is room beside it. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-5">
          <div className="wd-launch-card min-w-0 rounded-2xl border-2 border-primary/35 bg-card p-6 shadow-[0_16px_40px_-12px_oklch(0.2_0.03_260/0.28)] sm:col-span-3">
            <div className="wd-launch-media">
              <ProductGallery sizes="(min-width: 1024px) 260px, (min-width: 640px) 600px, calc(100vw - 92px)" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="inline-flex min-h-11 max-w-full items-center rounded-full bg-primary/10 px-3 text-caption uppercase text-primary hyphens-auto [overflow-wrap:anywhere]">
                {m.compat.housingBadge}
              </span>
              <div className="mt-3 text-lead">{m.compat.housingTitle}</div>
              <p className="mt-1 font-semibold text-foreground">{m.compat.housingLead}</p>
              <p className="mt-1.5 text-body text-muted-foreground">{m.compat.housingBody}</p>
              <ul className="mt-4 space-y-1.5 text-body text-foreground/80">
                {[
                  m.compat.housingModel1,
                  m.compat.housingModel2,
                  m.compat.housingModel3,
                  m.compat.housingModel4,
                ].map((model) => (
                  <li key={model} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    {model}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* App Only is not available yet. Keep this card visually secondary
              and non-interactive so it cannot be mistaken for a purchase path. */}
          <div className="flex items-start gap-4 min-w-0 rounded-2xl border border-dashed border-border/50 bg-muted/20 p-5 sm:col-span-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-muted-foreground/80">{m.compat.appOnlyTitle}</div>
              <p className="mt-1 text-sm text-muted-foreground/75">{m.compat.appOnlyBody}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground/70">
                {[m.compat.appOnlyModel1, m.compat.appOnlyModel2, m.compat.appOnlyModel3].map(
                  (model) => (
                    <li key={model} className="flex items-center gap-2">
                      <span className="size-1 rounded-full bg-muted-foreground/35" />
                      {model}
                    </li>
                  ),
                )}
              </ul>
            </div>
            <SectionImage
              src={watchScreen}
              srcSet={watchScreenSrcSet}
              sizes="(min-width: 640px) 96px, 80px"
              alt={m.compat.watchScreenAlt}
              className="size-20 shrink-0 self-center rounded-xl object-cover grayscale opacity-50 sm:size-24"
            />
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{m.compat.footnote}</p>
      </div>
    </section>
  );
}

function ActionCameras() {
  const m = useFrozenLandingMessages();
  return (
    <section className="wd-section border-y border-border bg-card/60">
      <div className="mx-auto max-w-5xl text-center">
        <p className="text-caption uppercase text-primary mb-4">{m.cameras.kicker}</p>
        <h3 className="text-heading">{m.cameras.h3}</h3>
        <p className="mt-4 text-body text-muted-foreground">{m.cameras.lead}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {["GoPro", "Insta360", "Canon", m.cameras.chipMore].map((name) => (
            <span
              key={name}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-[0_4px_14px_-4px_oklch(0.2_0.03_260/0.18)]"
            >
              {name}
            </span>
          ))}
        </div>
        <div className="relative mx-auto mt-10 max-w-3xl overflow-hidden rounded-[2rem] border border-border shadow-sm">
          <LazyVideo
            src={connectedAppVideo}
            poster={connectedAppPoster}
            ariaLabel={m.cameras.videoAria}
            className="aspect-video w-full object-cover"
          />
        </div>
      </div>
    </section>
  );
}

function SafetySection() {
  const m = useFrozenLandingMessages();
  const points = [
    {
      t: m.safety.point1Title,
      d: m.safety.point1Body,
      iconSvg: maxDepthIcon,
    },
    {
      t: m.safety.point2Title,
      d: m.safety.point2Body,
      iconSvg: scubaFigureIcon,
    },
    {
      t: m.safety.point3Title,
      d: m.safety.point3Body,
      iconSvg: null,
    },
  ];
  return (
    <section className="wd-section border-y border-border bg-card/60">
      <div className="mx-auto max-w-5xl">
        <div className="max-w-3xl">
          <p className="mb-4 text-caption uppercase text-primary">{m.safety.kicker}</p>
          <h2 className="text-title">{m.safety.h2}</h2>
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
              <h3 className="mt-4 text-lead">{p.t}</h3>
              <p className="mt-1.5 text-body text-muted-foreground">{p.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">{m.safety.disclaimer}</p>
      </div>
    </section>
  );
}

function OfferSection() {
  const m = useFrozenLandingMessages();
  const [headlineBefore, headlineStrike, headlineMiddle, headlineNew, headlineAfter] =
    splitTwoHighlights(m.offer.headline, m.offer.headlineStrike, m.offer.headlineNew);
  const [leadBefore, leadHighlight, leadAfter] = splitHighlightedCopy(
    m.offer.lead,
    m.offer.leadHighlight,
  );
  return (
    <section id="offer-form" className="wd-section relative overflow-hidden text-white">
      <div className="absolute inset-0 bg-[color:var(--color-deep-2)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_oklch(0.696_0.129_235/0.35),_transparent_60%)]" />
      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <SectionImage
          src={kickstarterImage}
          srcSet={kickstarterSrcSet}
          sizes="(min-width: 808px) 770px, calc(100vw - 36px)"
          alt={m.offer.imageAlt}
          className="mx-auto mb-8 aspect-video w-full max-w-3xl rounded-[2rem] border border-white/10 object-cover object-top shadow-[0_30px_90px_-35px_oklch(0.8_0.11_232/0.45)]"
        />
        <p className="text-caption uppercase text-[#36A9E1] mb-4">{m.offer.kicker}</p>
        <h2 className="text-title">
          {headlineBefore}
          <span className="text-white/45 line-through">{headlineStrike}</span>
          {headlineMiddle}
          <span className="text-[color:var(--color-cyan-glow)]">{headlineNew}</span>
          {headlineAfter}
        </h2>
        <p className="mt-5 text-body text-[#F6FAFC]">
          {leadBefore}
          <span className="font-semibold text-white">{leadHighlight}</span>
          {leadAfter}
        </p>
        <div className="mt-7 rounded-2xl border border-white/12 bg-white/[0.06] p-5 text-left backdrop-blur">
          <LaunchNotice />
          <div className="my-5 h-px bg-white/10" />
          <WaitlistProgress />
        </div>

        <div className="mt-6">
          <EmailForm id="offer" includePhone />
        </div>
      </div>
    </section>
  );
}

function Credentials() {
  const m = useFrozenLandingMessages();
  const [nvidiaBefore, , nvidiaAfter] = splitHighlightedCopy(m.creds.nvidiaTitle, "NVIDIA");
  const [awsBefore, , awsAfter] = splitHighlightedCopy(m.creds.awsTitle, "AWS");
  return (
    <section className="wd-section">
      <div className="mx-auto max-w-5xl">
        <p className="text-center text-caption uppercase text-muted-foreground">
          {m.creds.heading}
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
                alt={m.creds.nvidiaAlt}
                loading="lazy"
                className="max-h-full w-auto max-w-[78%]"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <div className="text-lead">
                  {nvidiaBefore}
                  <span style={{ color: "#76B900" }}>NVIDIA</span>
                  {nvidiaAfter}
                </div>
              </div>
              <p className="mt-3.5 text-body leading-relaxed text-muted-foreground">
                {m.creds.nvidiaBody}
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
                alt={m.creds.awsAlt}
                loading="lazy"
                className="max-h-full w-auto max-w-[72%]"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <div className="text-lead">
                  {awsBefore}
                  <span style={{ color: "#FF9900" }}>AWS</span>
                  {awsAfter}
                </div>
              </div>
              <p className="mt-3.5 text-body leading-relaxed text-muted-foreground">
                {m.creds.awsBody}
              </p>
            </div>
          </div>

          {/* Samsung — real campaign still + brand blue accent */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-center shadow-sm">
            <div className="h-1.5 w-full" style={{ background: "#1428A0" }} />
            <div className="relative aspect-video w-full overflow-hidden">
              <img
                src={samsungFeature}
                srcSet={samsungFeatureSrcSet}
                sizes="(min-width: 768px) 380px, calc(100vw - 40px)"
                alt={m.creds.samsungAlt}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-7 pb-7 pt-6">
              <div className="flex min-h-[3.25rem] flex-col items-center justify-end">
                <span className="text-caption uppercase text-muted-foreground">
                  {m.creds.samsungFeatured}
                </span>
                <img
                  src={samsungLogo}
                  alt={m.creds.samsungLogoAlt}
                  className="mt-1.5 h-[18px] w-auto"
                />
              </div>
              <p className="mt-3.5 text-body leading-relaxed text-muted-foreground">
                {m.creds.samsungBody}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const m = useFrozenLandingMessages();
  const productFaqs = [
    { q: m.faq.q6, a: m.faq.a6 },
    { q: m.faq.q7, a: m.faq.a7 },
    { q: m.faq.q8, a: m.faq.a8 },
  ];
  const faqs = [
    {
      q: m.faq.q1,
      a: m.faq.a1,
    },
    {
      q: m.faq.q2,
      a: m.faq.a2,
    },
    {
      q: m.faq.q3,
      a: m.faq.a3,
    },
    {
      q: m.faq.q4,
      a: m.faq.a4,
    },
    {
      q: m.faq.q5,
      a: m.faq.a5,
    },
    ...productFaqs,
  ];
  return (
    <section className="wd-section mx-auto max-w-3xl">
      <div className="text-center mb-10">
        <p className="text-caption uppercase text-primary mb-4">{m.faq.kicker}</p>
        <h2 className="text-title">{m.faq.h2}</h2>
      </div>
      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {faqs.map((f) => (
          <details key={f.q} className="group p-5 sm:p-6">
            <summary className="flex min-h-11 items-center justify-between cursor-pointer list-none font-semibold">
              {f.q}
              <span className="ml-4 text-primary transition-transform group-open:rotate-45 text-2xl leading-none">
                +
              </span>
            </summary>
            <p className="mt-3 text-body text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const year = new Date().getFullYear();
  return (
    <footer className="wd-section bg-[color:var(--color-deep-2)] text-center text-body text-[#F6FAFC]">
      <div className="max-w-3xl mx-auto">
        <img src={wordmarkWhite} alt="DIVEROID" className="mx-auto h-5 w-auto" />
        <div className="mt-6 font-medium text-white">{m.footer.brand}</div>
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[#F6FAFC]">
          <Link
            to={termsPath(locale)}
            className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline"
          >
            {m.footer.terms}
          </Link>
          <Link
            to={privacyPath(locale)}
            className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline"
          >
            {m.footer.privacy}
          </Link>
          <CookieSettingsLink className="inline-flex min-h-11 items-center px-3 underline-offset-4 hover:underline" />
        </nav>
        <p className="mx-auto mt-6 max-w-2xl text-xs text-[#F6FAFC]">
          {formatMessage(m.footer.nvidiaTrademark, { year })}
        </p>
      </div>
    </footer>
  );
}
