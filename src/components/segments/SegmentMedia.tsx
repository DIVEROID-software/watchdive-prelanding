import type { CSSProperties } from 'react';
import { useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import type { DiveSegment } from '@/lib/segments/copy';
import type { MediaCopy } from '@/lib/segments/media-copy';
import { PRESS_LOGOS } from '@/lib/segments/press-logos';
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
import controlsPosterSmall from '@/assets/live/media-refresh-20261103/controls-poster-640.webp';
import controlsPoster from '@/assets/live/media-refresh-20261103/controls-poster-960.webp';
import logPosterSmall from '@/assets/live/media-refresh-20261103/logbook-poster-640.webp';
import logPoster from '@/assets/live/media-refresh-20261103/logbook-poster-960.webp';

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

/** Photographs of the seal check, the housing controls, and the scuba log. */
export function SegmentDemos({ segment, copy }: { segment: DiveSegment; copy: MediaCopy }) {
  const stills = [
    { key: 'seal', poster: sealPoster, posterSmall: sealPosterSmall, width: 960, height: 464, ...copy.seal },
    ...(segment === 'scuba' ? [
      { key: 'controls', poster: controlsPoster, posterSmall: controlsPosterSmall, width: 960, height: 454, ...copy.controls },
      { key: 'logbook', poster: logPoster, posterSmall: logPosterSmall, width: 960, height: 454, ...copy.logClip },
    ] : []),
  ];
  // Three columns share the 1120 shell and two 18px gaps. One freediving still stops at 720.
  const sizes = stills.length === 1
    ? '(min-width:960px) 720px, (max-width:359px) calc(100vw - 32px), min(650px, calc(100vw - 48px))'
    : '(min-width:960px) calc((min(1120px, 100vw - 96px) - 36px) / 3), (max-width:359px) calc(100vw - 32px), min(650px, calc(100vw - 48px))';
  return <section id="segment-demos" className="wd-segment-demos wd-segment-shell" aria-labelledby="demos-title" data-segment-demos={segment}>
    <h2 id="demos-title">{copy.demoTitle}</h2>
    <div className="wd-segment-demo-list" data-count={stills.length}>
      {stills.map(still => <figure key={still.key} className="wd-segment-demo">
        <img src={still.poster} srcSet={`${still.posterSmall} 640w, ${still.poster} 960w`} sizes={sizes} width={still.width} height={still.height} alt={still.alt} loading="lazy" decoding="async" />
        <figcaption>
          <h3>{still.title}</h3>
          <p>{still.body}</p>
        </figcaption>
      </figure>)}
    </div>
  </section>;
}

/** Publisher mastheads for current WatchDive coverage. Not a review count. */
export function SegmentPress({ copy }: { copy: MediaCopy }) {
  const rows = [PRESS_LOGOS.slice(0, 4), PRESS_LOGOS.slice(4)];
  return <section id="segment-press" className="wd-segment-press wd-segment-shell" aria-labelledby="press-title">
    <h2 id="press-title">{copy.pressTitle}</h2>
    {rows.map(row => <ul key={row[0].id} className="wd-press-row" style={{ '--press-cols': row.map(logo => `${logo.width / logo.height}fr`).join(' ') } as CSSProperties}>
      {row.map(logo => <li key={logo.id} data-wide={logo.wide ? 'true' : undefined}>
        <a href={logo.href} target="_blank" rel="noopener noreferrer" data-ground={logo.ground}>
          <img src={logo.src} alt={logo.name} width={logo.width} height={logo.height} decoding="async" />
        </a>
      </li>)}
    </ul>)}
  </section>;
}
