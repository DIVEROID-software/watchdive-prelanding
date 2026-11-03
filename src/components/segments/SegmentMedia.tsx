import { useEffect, useRef, useState } from 'react';
import { useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import type { DiveSegment } from '@/lib/segments/copy';
import { PRESS_LINKS, type MediaCopy } from '@/lib/segments/media-copy';
import step1Small from '@/assets/live/responsive/watchdive-step1-800.webp';
import step1Large from '@/assets/live/responsive/watchdive-step1-1200.webp';
import step2Small from '@/assets/live/responsive/watchdive-step2-800.webp';
import step2Large from '@/assets/live/responsive/watchdive-step2-1200.webp';
import syncSmall from '@/assets/live/responsive/watchdive-sync-800.webp';
import syncLarge from '@/assets/live/responsive/watchdive-sync-1200.webp';
import gearSmall from '@/assets/live/media-refresh-20261103/gear-720.webp';
import gearLarge from '@/assets/live/media-refresh-20261103/gear-1200.webp';
import underwater from '@/assets/live/refresh/underwater-1600.webp';
import logHandSmall from '@/assets/live/media-refresh-20261103/loghand-900.webp';
import logHandLarge from '@/assets/live/media-refresh-20261103/loghand-1400.webp';
import freeLogSmall from '@/assets/live/segment-heroes/freediving-app-logbook-720.webp';
import freeLogLarge from '@/assets/live/segment-heroes/freediving-app-logbook-1448.webp';
import buoySmall from '@/assets/live/media-refresh-20261103/buoy-800.webp';
import buoyLarge from '@/assets/live/media-refresh-20261103/buoy-1400.webp';
import buoyWide from '@/assets/live/media-refresh-20261103/buoy-2200.webp';
import scubaOverheadBright from '@/assets/live/media-refresh-20261103/scuba-pool-overhead-bright-2880.png';
import sealPosterSmall from '@/assets/live/media-refresh-20261103/seal-poster-640.webp';
import sealPoster from '@/assets/live/media-refresh-20261103/seal-poster-960.webp';
import sealVideo from '@/assets/live/media-refresh-20261103/seal.mp4';
import controlsPosterSmall from '@/assets/live/media-refresh-20261103/controls-poster-640.webp';
import controlsPoster from '@/assets/live/media-refresh-20261103/controls-poster-960.webp';
import controlsVideo from '@/assets/live/media-refresh-20261103/controls.mp4';
import logPosterSmall from '@/assets/live/media-refresh-20261103/logbook-poster-640.webp';
import logPoster from '@/assets/live/media-refresh-20261103/logbook-poster-960.webp';
import logVideo from '@/assets/live/media-refresh-20261103/logbook.mp4';

type Shot = {
  small: string;
  large: string;
  width: number;
  height: number;
  sizes: string;
  srcSet?: string;
};

const gearSrcSet = `${gearSmall} 720w, ${gearLarge} 1200w`;
const headingSrcSet = `${step2Small} 800w, ${step2Large} 1200w`;
const buoySrcSet = `${buoySmall} 800w, ${buoyLarge} 1400w`;
const freeLogSrcSet = `${freeLogSmall} 720w, ${freeLogLarge} 1448w`;

const benefitShots: Record<DiveSegment, [Shot, Shot, Shot]> = {
  scuba: [
    { small: gearSmall, large: gearLarge, width: 1200, height: 800, sizes: '(min-width:960px) 30vw, 88vw', srcSet: gearSrcSet },
    { small: underwater, large: underwater, width: 1600, height: 1067, sizes: '(min-width:960px) 30vw, 88vw' },
    { small: step2Small, large: step2Large, width: 1200, height: 807, sizes: '(min-width:960px) 30vw, 88vw', srcSet: headingSrcSet },
  ],
  freediving: [
    { small: gearSmall, large: gearLarge, width: 1200, height: 800, sizes: '(min-width:960px) 30vw, 88vw', srcSet: gearSrcSet },
    { small: buoySmall, large: buoyLarge, width: 1400, height: 934, sizes: '(min-width:960px) 30vw, 88vw', srcSet: buoySrcSet },
    { small: freeLogSmall, large: freeLogLarge, width: 1448, height: 966, sizes: '(min-width:960px) 30vw, 88vw', srcSet: freeLogSrcSet },
  ],
};

/** Real still above the existing benefit sentence. Below the fold, so it waits. */
export function BenefitShot({ segment, index, alt }: { segment: DiveSegment; index: number; alt: string }) {
  const shot = benefitShots[segment][index];
  return <figure className="wd-segment-benefit-shot">
    <img src={shot.large} srcSet={shot.srcSet} sizes={shot.sizes} width={shot.width} height={shot.height} alt={alt} loading="lazy" decoding="async" />
  </figure>;
}

/** Scuba logbook still. The phone screen is filtered to scuba, so freediving does not use it. */
export function LogHandPhoto({ alt }: { alt: string }) {
  return <figure className="wd-segment-log-hand">
    <img src={logHandLarge} srcSet={`${logHandSmall} 900w, ${logHandLarge} 1400w`} sizes="(min-width:960px) 28vw, 72vw" width={1400} height={2100} alt={alt} loading="lazy" decoding="async" />
  </figure>;
}

/** The three existing process photographs. Captions are the approved step titles. */
export function HowPhotoRow() {
  const m = useFrozenLandingMessages();
  const photos = [
    { small: step1Small, large: step1Large, width: 1200, height: 818, alt: m.how.step1Alt, caption: m.how.step1Title },
    { small: step2Small, large: step2Large, width: 1200, height: 807, alt: m.how.step2Alt, caption: m.how.step2Title },
    { small: syncSmall, large: syncLarge, width: 1200, height: 900, alt: m.how.step3Alt, caption: m.how.step3Title },
  ];
  return <ul className="wd-segment-how-photos">
    {photos.map(photo => <li key={photo.caption}><figure>
      <img src={photo.large} srcSet={`${photo.small} 800w, ${photo.large} 1200w`} sizes="(min-width:960px) calc((min(1120px, 100vw - 96px) - 28px) / 3), (max-width:359px) calc(100vw - 32px), min(650px, calc(100vw - 48px))" width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" decoding="async" />
      <figcaption>{photo.caption}</figcaption>
    </figure></li>)}
  </ul>;
}

const wideShots: Record<DiveSegment, Shot> = {
  scuba: {
    small: scubaOverheadBright,
    large: scubaOverheadBright,
    width: 2880,
    height: 1608,
    sizes: '100vw',
  },
  freediving: {
    small: buoyLarge,
    large: buoyWide,
    width: 2200,
    height: 1466,
    sizes: '100vw',
    srcSet: `${buoySmall} 800w, ${buoyLarge} 1400w, ${buoyWide} 2200w`,
  },
};

/** One real photograph, edge to edge. No card frame, so the picture can stay wide. */
export function SegmentGallery({ segment, copy }: { segment: DiveSegment; copy: MediaCopy }) {
  const shot = wideShots[segment];
  const alt = copy.galleryAlt[segment][0];
  return <section id="segment-gallery" className="wd-segment-bleed" aria-labelledby="gallery-title">
    <h2 id="gallery-title" className="wd-segment-sr">{copy.galleryTitle[segment]}</h2>
    <img src={shot.large} srcSet={shot.srcSet} sizes={shot.sizes} width={shot.width} height={shot.height} alt={alt} loading="lazy" decoding="async" />
  </section>;
}

/** Move focus only while this player still owns it.
 * A disconnected control is the one we just replaced. A connected field outside the box wins.
 */
function focusOwned(target: HTMLElement | null, boundary: HTMLElement | null, owned: boolean) {
  if (!owned || !target) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isConnected && active !== document.body && active !== target && boundary && !boundary.contains(active)) return;
  target.focus({ preventScroll: true });
}

/** Poster until an explicit click. Reduced motion lives in segments.css.
 * This playback is requested, so it is not gated, and a denied play() is not a broken file.
 */
function SegmentClip({ poster, posterSmall, video, alt, playLabel, errorLabel, title, body, width, height }: {
  poster: string;
  posterSmall: string;
  video: string;
  alt: string;
  playLabel: string;
  errorLabel: string;
  title: string;
  body: string;
  width: number;
  height: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const owned = useRef(false);
  useEffect(() => {
    if (failed) {
      focusOwned(retryRef.current, box.current, owned.current);
      return;
    }
    if (!open) return;
    const element = videoRef.current;
    if (!element) return;
    // The poster button unmounts on this click. Focus the video only if that
    // button still owned focus. A field the visitor reached first keeps it.
    focusOwned(element, box.current, owned.current);
    const attempt = element.play();
    if (attempt) {
      void attempt.catch(() => {
        // NotAllowedError, AbortError, and other play() rejections are not a
        // broken file. Native controls stay. Load and decode failures use onError.
      });
    }
    const pauseIfHidden = () => { if (document.hidden) element.pause(); };
    const onPlay = (event: Event) => { if (event.target !== element) element.pause(); };
    document.addEventListener('visibilitychange', pauseIfHidden);
    document.addEventListener('play', onPlay, true);
    const node = box.current;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    }, { threshold: 0.15 });
    if (node) observer.observe(node);
    return () => {
      document.removeEventListener('visibilitychange', pauseIfHidden);
      document.removeEventListener('play', onPlay, true);
      observer.disconnect();
      element.pause();
    };
  }, [open, failed]);
  const label = failed ? errorLabel : playLabel;
  return <article className="wd-segment-demo">
    <div ref={box} className="wd-segment-clip" style={{ aspectRatio: `${width} / ${height}` }}>
      {open && !failed ? <video ref={videoRef} tabIndex={0} controls autoPlay muted playsInline preload="none" poster={poster} src={video} width={width} height={height} aria-label={alt} onError={() => { const active = document.activeElement; const boundary = box.current; owned.current = Boolean(active && boundary && (active === videoRef.current || boundary.contains(active))); setFailed(true); }} /> : <button ref={retryRef} type="button" onClick={event => { owned.current = document.activeElement === event.currentTarget; setFailed(false); setOpen(true); }} aria-label={`${label}. ${title}`}>
        <img src={poster} srcSet={`${posterSmall} 640w, ${poster} 960w`} sizes="(min-width:960px) 34vw, 92vw" width={width} height={height} alt={alt} loading="lazy" decoding="async" />
        <span>{label}<span aria-hidden="true"> ▶</span></span>
      </button>}
    </div>
    <h3>{title}</h3>
    <p>{body}</p>
    {failed && <p role="status">{errorLabel}</p>}
  </article>;
}

export function SegmentDemos({ segment, copy, playLabel }: { segment: DiveSegment; copy: MediaCopy; playLabel: string }) {
  const clips = [
    { key: 'seal', poster: sealPoster, posterSmall: sealPosterSmall, video: sealVideo, width: 960, height: 464, ...copy.seal },
    ...(segment === 'scuba' ? [
      { key: 'controls', poster: controlsPoster, posterSmall: controlsPosterSmall, video: controlsVideo, width: 960, height: 454, ...copy.controls },
      { key: 'logbook', poster: logPoster, posterSmall: logPosterSmall, video: logVideo, width: 960, height: 454, ...copy.logClip },
    ] : []),
  ];
  return <section id="segment-demos" className="wd-segment-demos wd-segment-shell" aria-labelledby="demos-title" data-segment-demos={segment}>
    <h2 id="demos-title">{copy.demoTitle}</h2>
    <div className="wd-segment-demo-list" data-count={clips.length}>
      {clips.map(clip => <SegmentClip key={clip.key} poster={clip.poster} posterSmall={clip.posterSmall} video={clip.video} alt={clip.alt} playLabel={playLabel} errorLabel={copy.clipError} title={clip.title} body={clip.body} width={clip.width} height={clip.height} />)}
    </div>
  </section>;
}

/** Factual coverage only. The two URLs were opened by root on 2026-11-03. */
export function SegmentPress({ copy }: { copy: MediaCopy }) {
  const dates = [copy.pressScubaDate, copy.pressXrayDate];
  return <section id="segment-press" className="wd-segment-press wd-segment-shell" aria-labelledby="press-title">
    <h2 id="press-title">{copy.pressTitle}</h2>
    <ul>
      {PRESS_LINKS.map((link, index) => <li key={link.href}>
        <a href={link.href} target="_blank" rel="noopener noreferrer">{link.publisher}<span>{dates[index]}</span></a>
      </li>)}
    </ul>
  </section>;
}
