import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { HeroPhoto } from "@/components/hero-photo";
import { LaunchNotice } from "@/components/launch-notice";
import { WaitlistProgress } from "@/components/waitlist-progress";
import {
  ChapterFit,
  ChapterPack,
  ChapterSurface,
  ChapterUnderwater,
  STORY_THUMB,
} from "@/components/story/story-chapters";
import { getAttribution } from "@/lib/attribution";
import { conversionCopy } from "@/lib/conversionCopy";
import { loadWaitlistCount } from "@/lib/api/waitlist.functions";
import { readLiteMediaHint } from "@/lib/liteMedia";
import { useCurrentLocale, useFrozenLandingMessages } from "@/lib/i18n/use-current-locale";
import {
  EmailForm,
  FAQ,
  Footer,
  HOLD_EARLY_SUBMIT_JS,
  LaunchBanner,
  OfferSection,
  ReferralWelcome,
  StickyLaunchBanner,
} from "@/routes/index";
import storyCss from "../styles-story.css?url";

/**
 * SAMPLE ONLY — scroll-depth plan "story-v1" (2026-10-10), for owner review on
 * a preview deployment. Not linked from the live page, not in the experiment,
 * noindex. The hero form, offer form, FAQ and footer are the live components.
 */
export const Route = createFileRoute("/story-sample")({
  loader: async () => ({
    waitlistCount: await loadWaitlistCount(),
    liteMedia: readLiteMediaHint(),
  }),
  head: () => ({
    meta: [
      { title: "WatchDive — story sample (preview)" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
    links: [{ rel: "stylesheet", href: storyCss }],
  }),
  component: StorySampleLanding,
});

/**
 * The sample always shows the form-first hero (the plan builds on it) and is
 * always a QA session, so it never joins or skews the live experiment.
 */
const SAMPLE_FORM_FIRST_JS = `window.__wdLandingVariant="form_first";window.__wdLandingQa=true;document.documentElement.dataset.wdLanding="form_first";`;

function StoryHero() {
  const m = useFrozenLandingMessages();
  const copy = conversionCopy[useCurrentLocale()];
  const h1 = m.hero.h1;
  const at = h1.indexOf(m.hero.h1Highlight);
  return (
    <header className="wd-hero-new text-white">
      <script dangerouslySetInnerHTML={{ __html: SAMPLE_FORM_FIRST_JS + HOLD_EARLY_SUBMIT_JS }} />
      <LaunchBanner />
      <div className="wd-hero-layout mx-auto max-w-6xl px-5">
        <div className="wd-hero-heading">
          <h1 className="text-display">
            {at < 0 ? (
              h1
            ) : (
              <>
                {h1.slice(0, at)}
                <span className="text-[#65ceee]">{m.hero.h1Highlight}</span>
                {h1.slice(at + m.hero.h1Highlight.length)}
              </>
            )}
          </h1>
          <p className="wd-hero-sub text-body text-[#F6FAFC]">{m.hero.sub}</p>
          <a href="#compatibility" className="wd-experiment-copy wd-experiment-compatibility">
            {copy.compatibility} <span aria-hidden>↗</span>
          </a>
        </div>
        {/* Desktop keeps the photo beside the form; phones go straight to Ch1. */}
        <div className="wd-hero-media wd-story-hero-media">
          <HeroPhoto />
        </div>
        <div className="wd-hero-signup">
          <div className="wd-hero-price">
            <span className="text-white/65 line-through">{m.hero.wasPrice}</span>
            <span className="text-subhead">{m.hero.nowPrice}</span>
            <div>
              <span className="text-sm font-semibold text-[#65ceee]">{m.hero.offBadge}</span>
              <p className="wd-control-copy text-xs text-white/85">{m.hero.offNote}</p>
            </div>
          </div>
          <EmailForm id="hero" />
          <div className="mt-5">
            <LaunchNotice />
            <WaitlistProgress />
          </div>
          <ReferralWelcome />
          <a href="#compatibility" className="wd-story-compat-link">
            {m.usp.compatLink} <span aria-hidden>↓</span>
          </a>
          <a className="wd-peek" href="#ch1-fit">
            <img src={STORY_THUMB} alt="" width={64} height={64} decoding="async" />
            <span>See your watch go in</span>
            <span aria-hidden className="wd-peek-arrow">
              ↓
            </span>
          </a>
        </div>
      </div>
    </header>
  );
}

/** R: a 4px progress rail and a chapter chip that shows for 1.4s per chapter. */
function ScrollRail() {
  const fill = useRef<HTMLSpanElement>(null);
  const [chip, setChip] = useState<{ label: string; on: boolean }>({ label: "", on: false });
  useEffect(() => {
    let last = "";
    let timer = 0;
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const room = doc.scrollHeight - window.innerHeight;
      const p = room <= 0 ? 1 : Math.min(1, window.scrollY / room);
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      let current = "";
      document.querySelectorAll<HTMLElement>("[data-story-label]").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.35)
          current = el.dataset.storyLabel ?? "";
      });
      if (current && current !== last) {
        last = current;
        setChip({ label: current, on: true });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setChip((c) => ({ ...c, on: false })), 1400);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <div className="wd-rail" aria-hidden>
        <span ref={fill} />
      </div>
      <div className={`wd-chip ${chip.on ? "on" : ""}`} aria-hidden>
        {chip.label}
      </div>
    </>
  );
}

function StorySampleLanding() {
  useEffect(() => {
    getAttribution();
  }, []);

  // Same as the live page: chat stays out of the toolbar until the hero form
  // has scrolled away.
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

  // "Check your model" opens the model list it points at.
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href="#compatibility"]');
      if (!link) return;
      const details = document.getElementById("compatibility");
      if (details instanceof HTMLDetailsElement) details.open = true;
    };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);

  return (
    <>
      <StickyLaunchBanner />
      <ScrollRail />
      <div className="wd-scroll wd-story bg-background text-foreground">
        <StoryHero />
        <ChapterFit />
        <ChapterUnderwater />
        <ChapterSurface />
        <ChapterPack />
        <OfferSection />
        <FAQ />
        <Footer />
      </div>
    </>
  );
}
