import { useEffect, useRef, useState, type ReactNode } from "react";

import { PUBLISHABLE_REVIEWS, BETA_REVIEWS } from "@/data/beta-reviews";
import { betaReviewBody } from "@/data/beta-reviews.loader";
import { ReviewTicker } from "@/components/review-ticker";
import { useLiteMedia } from "@/lib/liteMedia";
import {
  useFrozenLandingMessages,
  useLocalizedBetaReviewBodies,
} from "@/lib/i18n/use-current-locale";

import fitBefore from "../../assets/live/story/e1-before-nowatch.webp";
import fitAfter from "../../assets/live/story/e1-after-watch.webp";
import screenCrop from "../../assets/live/story/e2-screen-crop.webp";
import screenThumb from "../../assets/live/story/e2-screen-ledon.webp";
import deepVertical from "../../assets/live/story/e3-deep-vertical.webp";
import deepWide from "../../assets/live/story/e3-deep-wrist.webp";
import surfaceVideo from "../../assets/live/story/connected-app-notitle.mp4";
import surfacePoster from "../../assets/live/story/connected-app-notitle-poster.jpg";
import boxImage from "../../assets/live/story/e5-box.webp";

/*
 * Story-v1 sample (scroll-depth plan, 2026-10-10). Every heading and body line
 * is an existing catalog sentence; the only new strings are navigation
 * ("01 · Fit", "Next: … ↓", the peek) and honesty captions. English-only
 * sample: new strings are not in the nine-locale catalog yet.
 */

export const STORY_THUMB = fitBefore;

/** Adds `on` once the element is `threshold` visible; immediately without IO. */
function useSeenOnce<T extends HTMLElement>(threshold: number) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function ChapterKicker({ children }: { children: ReactNode }) {
  return <p className="wd-ch-k text-caption uppercase">{children}</p>;
}

function NextTeaser({
  href,
  thumb,
  children,
}: {
  href: string;
  thumb: string;
  children: ReactNode;
}) {
  return (
    <a className="wd-next" href={href}>
      <img src={thumb} alt="" width={52} height={52} loading="lazy" decoding="async" />
      <span>{children}</span>
      <span aria-hidden className="wd-next-arrow">
        ↓
      </span>
    </a>
  );
}

function PullQuote({ id }: { id: number }) {
  const m = useFrozenLandingMessages();
  const bodies = useLocalizedBetaReviewBodies();
  const review = PUBLISHABLE_REVIEWS.find((r) => r.id === id);
  if (!review) return null;
  const country = {
    US: m.reviews.countryUS,
    UK: m.reviews.countryUK,
    KR: m.reviews.countryKR,
    SG: m.reviews.countrySG,
  }[review.country];
  return (
    <figure className="wd-pq">
      <blockquote>{betaReviewBody(review, bodies)}</blockquote>
      <figcaption>
        {"★".repeat(review.rating)} · {review.name} · {review.city}, {country}
      </figcaption>
    </figure>
  );
}

/** E1: the empty housing, then the watch drops in once (and on the toggle). */
function FitReveal() {
  const [ref, seen] = useSeenOnce<HTMLDivElement>(0.6);
  // Server render and no-JS show the fitted frame; the reveal is enhancement.
  const [mode, setMode] = useState<"ssr" | "empty" | "fitted">("ssr");
  useEffect(() => setMode("empty"), []);
  useEffect(() => {
    if (!seen) return;
    const t = window.setTimeout(() => setMode("fitted"), reducedMotion() ? 0 : 250);
    return () => window.clearTimeout(t);
  }, [seen]);
  const fitted = mode !== "empty";
  return (
    <>
      <div
        ref={ref}
        className={`wd-fit ${fitted ? "on" : ""} ${mode === "ssr" ? "ssr" : ""}`}
        data-wd-core="ch1-reveal"
        role="img"
        aria-label="The WatchDive housing, empty and then with a smartwatch fitted"
      >
        <img src={fitBefore} alt="" width={780} height={780} loading="lazy" decoding="async" />
        <img
          className="wd-fit-after"
          src={fitAfter}
          alt=""
          width={780}
          height={780}
          loading="lazy"
          decoding="async"
        />
        <span className="wd-fit-label">{fitted ? "With your watch" : "Empty housing"}</span>
      </div>
      <div className="wd-seg" role="group" aria-label="Compare">
        <button type="button" aria-pressed={!fitted} onClick={() => setMode("empty")}>
          Empty
        </button>
        <button type="button" aria-pressed={fitted} onClick={() => setMode("fitted")}>
          With your watch
        </button>
      </div>
      <p className="wd-cap">Studio render; screen content is illustrative.</p>
    </>
  );
}

export function ChapterFit() {
  const m = useFrozenLandingMessages();
  return (
    <section id="ch1-fit" className="wd-ch wd-ch-light" data-story-label="01 · Fit">
      <div className="wd-ch-wrap">
        <ChapterKicker>01 · Fit</ChapterKicker>
        <h2>{m.how.step1Title}</h2>
        <p className="wd-ch-lead">{m.how.step1Body}</p>
        <FitReveal />
        <p className="wd-compat-chip">
          <span aria-hidden>✓ </span>
          {m.usp.compatBody}
        </p>
        <details id="compatibility" className="wd-more">
          <summary>{m.faq.q6}</summary>
          <div>
            <p>{m.faq.a6}</p>
            <p>{m.compat.footnote}</p>
          </div>
        </details>
        <PullQuote id={88} />
        <NextTeaser href="#ch2-underwater" thumb={screenThumb}>
          Next: what you see underwater
        </NextTeaser>
      </div>
    </section>
  );
}

const PINS = [
  { n: 1, left: "33%", top: "32%" },
  { n: 2, left: "56%", top: "36%" },
  { n: 3, left: "58%", top: "24%" },
  { n: 4, left: "34%", top: "76%" },
];

export function ChapterUnderwater() {
  const m = useFrozenLandingMessages();
  const [ref, seen] = useSeenOnce<HTMLDivElement>(0.5);
  // "A prompt for the safety stop." leads; "An alert if you come up too fast." joins the rest.
  const [safetyPrompt, ascent] = m.functions.item3Body.split(/(?<=\.)\s/);
  return (
    <>
      <section id="ch2-underwater" className="wd-ch wd-ch-dark" data-story-label="02 · Underwater">
        <div className="wd-ch-wrap">
          <ChapterKicker>02 · Underwater</ChapterKicker>
          <h2>{m.functions.h2}</h2>
          <p className="wd-ch-lead">
            {m.functions.item1Body} {safetyPrompt}
          </p>
          <div ref={ref} className={`wd-hs ${seen ? "on" : ""}`} data-wd-core="ch2-screen">
            <img
              src={screenCrop}
              alt="WatchDive dive screen on a smartwatch in the housing: depth, dive time, water temperature and safety stop"
              width={780}
              height={821}
              loading="lazy"
              decoding="async"
            />
            {PINS.map((p) => (
              <span key={p.n} className="wd-pin" aria-hidden style={{ left: p.left, top: p.top }}>
                {p.n}
              </span>
            ))}
          </div>
          <ol className="wd-legend">
            <li>
              <b aria-hidden>1</b>Depth
            </li>
            <li>
              <b aria-hidden>2</b>Dive time
            </li>
            <li>
              <b aria-hidden>3</b>Water temperature
            </li>
            <li>
              <b aria-hidden>4</b>Safety stop
            </li>
          </ol>
          <p className="wd-also">
            <strong>{m.functions.item2Title}</strong> {m.functions.item2Body} {ascent}{" "}
            <strong>{m.functions.item4Title}</strong> {m.functions.item4Body}
          </p>
          <p className="wd-cap">Studio render; screen content is illustrative.</p>
        </div>
      </section>
      <section className="wd-cine" data-wd-core="ch2-tested" aria-labelledby="ch2-tested-h">
        <figure>
          <picture>
            <source media="(min-width: 900px)" srcSet={deepWide} />
            <img
              src={deepVertical}
              alt="A diver checks WatchDive on the wrist in a deep training pool, another diver behind"
              width={780}
              height={1169}
              loading="lazy"
              decoding="async"
            />
          </picture>
          <figcaption className="wd-cine-credit">Pictured: training pool.</figcaption>
        </figure>
        <div className="wd-cine-body">
          <h2 id="ch2-tested-h">{m.safety.h2}</h2>
          <ul>
            <li>{m.usp.wristBody.split(/(?<=\.)\s/)[0]}</li>
            <li>{m.safety.point2Title}</li>
            <li>{m.safety.point3Title}</li>
          </ul>
        </div>
      </section>
      <div className="wd-ch wd-ch-abyss wd-ch-tail">
        <div className="wd-ch-wrap">
          <p className="wd-disc">{m.safety.disclaimer}</p>
          <PullQuote id={120} />
          <NextTeaser href="#ch3-surface" thumb={surfacePoster}>
            Next: what happens when you surface
          </NextTeaser>
        </div>
      </div>
    </>
  );
}

/** E4: plays only while half on screen; poster + controls when it may not. */
function SurfaceVideo({ ariaLabel }: { ariaLabel: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const lite = useLiteMedia();
  const [controls, setControls] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (lite || reducedMotion() || typeof IntersectionObserver === "undefined") {
      setControls(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) video.play().catch(() => setControls(true));
        else video.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(video);
    return () => io.disconnect();
  }, [lite]);
  return (
    <div className="wd-vid" data-wd-core="ch3-video">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={surfacePoster}
        controls={controls}
        aria-label={ariaLabel}
        width={800}
        height={378}
      >
        <source src={surfaceVideo} type="video/mp4" />
      </video>
    </div>
  );
}

export function ChapterSurface() {
  const m = useFrozenLandingMessages();
  return (
    <section id="ch3-surface" className="wd-ch wd-ch-mid" data-story-label="03 · Surface">
      <div className="wd-ch-wrap">
        <ChapterKicker>03 · Surface</ChapterKicker>
        <h2>{m.app.h2}</h2>
        <p className="wd-ch-lead">{m.value.card4Copy}</p>
        <SurfaceVideo ariaLabel={m.cameras.videoAria} />
        <ol className="wd-flow" aria-label="Dive, surface, logbook">
          <li>Dive</li>
          <li>Surface</li>
          <li>Logbook</li>
        </ol>
        <dl className="wd-claims">
          <dt>{m.app.screen2Title}</dt>
          <dd>{m.app.screen2Body}</dd>
          <dt>{m.app.screen3Title}</dt>
          <dd>{m.app.screen3Body}</dd>
          <dt>{m.cameras.h3}</dt>
          <dd>{m.cameras.lead}</dd>
        </dl>
        <NextTeaser href="#ch4-pack-root" thumb={boxImage}>
          Next: what you pack
        </NextTeaser>
      </div>
    </section>
  );
}

export function ChapterPack() {
  const m = useFrozenLandingMessages();
  const [reviewsOpen, setReviewsOpen] = useState(false);
  useEffect(() => {
    // Hero/other links to #beta-reviews open the carousel in place.
    const open = () => {
      if (location.hash === "#beta-reviews") setReviewsOpen(true);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return (
    <section id="ch4-pack-root" className="wd-ch wd-ch-light" data-story-label="04 · Pack">
      <div className="wd-ch-wrap">
        <ChapterKicker>04 · Pack</ChapterKicker>
        <h2>{m.value.card2Title}</h2>
        <p className="wd-ch-lead">{m.value.card2Copy}</p>
        <div className="wd-box" data-wd-core="ch4-pack">
          <figure>
            <img
              src={boxImage}
              alt="WatchDive box opened, showing the white housing"
              width={780}
              height={975}
              loading="lazy"
              decoding="async"
            />
            <figcaption className="wd-cap">
              White colorway shown. Packaging and contents may change before launch.
            </figcaption>
          </figure>
          <PullQuote id={72} />
        </div>
        <p className="wd-notice">
          {m.reviews.sub}{" "}
          {m.reviews.disclosure
            .replace("{published}", String(PUBLISHABLE_REVIEWS.length))
            .replace("{total}", String(BETA_REVIEWS.length))}
        </p>
        <details
          className="wd-more wd-reviews"
          open={reviewsOpen}
          onToggle={(e) => setReviewsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            {m.heroProof.readAll
              .replace("{count}", String(PUBLISHABLE_REVIEWS.length))
              .replace(" ↓", "")}
          </summary>
          {reviewsOpen && <ReviewTicker />}
        </details>
        <ul className="wd-logos" aria-label={m.creds.heading}>
          <li>{m.creds.nvidiaTitle}</li>
          <li>{m.creds.awsTitle}</li>
          <li>{m.creds.samsungFeatured}</li>
        </ul>
      </div>
    </section>
  );
}
