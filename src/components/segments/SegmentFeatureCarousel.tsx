import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, WheelEvent } from 'react';
import step2Small from '@/assets/live/responsive/watchdive-step2-800.webp';
import step2Large from '@/assets/live/responsive/watchdive-step2-1200.webp';
import underwater from '@/assets/live/refresh/underwater-1600.webp';
import logHandSmall from '@/assets/live/media-refresh-20261103/loghand-900.webp';
import logHandLarge from '@/assets/live/media-refresh-20261103/loghand-1400.webp';
import buoySmall from '@/assets/live/media-refresh-20261103/buoy-800.webp';
import buoyLarge from '@/assets/live/media-refresh-20261103/buoy-1400.webp';
import freeLogSmall from '@/assets/live/segment-heroes/freediving-app-logbook-720.webp';
import freeLogLarge from '@/assets/live/segment-heroes/freediving-app-logbook-1448.webp';
import gearSmall from '@/assets/live/media-refresh-20261103/gear-720.webp';
import gearLarge from '@/assets/live/media-refresh-20261103/gear-1200.webp';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import type { DiveSegment } from '@/lib/segments/copy';
import { featureCarouselCopy, formatFeaturePosition } from '@/lib/segments/feature-carousel-copy';
import {
  carouselScrollBehavior,
  featureSlideAlt,
  featureSlidePlan,
  measureStride,
  reduceCarousel,
  scrollEventIndex,
  scrollTarget,
  resizeAlignment,
  endpointState,
  type FeatureScrollLock,
} from '@/lib/segments/feature-carousel';
import type { FeatureSlideFrame } from '@/lib/segments/feature-carousel';
import { mediaCopy } from '@/lib/segments/media-copy';

const SIZES = '(min-width:960px) 1000px, calc(100vw - 48px)';

const PHOTOS: Record<FeatureSlideFrame['image'], { src: string; srcSet?: string; width: number; height: number }> = {
  step2: { src: step2Large, srcSet: `${step2Small} 800w, ${step2Large} 1200w`, width: 1200, height: 807 },
  underwater: { src: underwater, width: 1600, height: 1067 },
  loghand: { src: logHandLarge, srcSet: `${logHandSmall} 900w, ${logHandLarge} 1400w`, width: 1400, height: 2100 },
  buoy: { src: buoyLarge, srcSet: `${buoySmall} 800w, ${buoyLarge} 1400w`, width: 1400, height: 934 },
  'free-log': { src: freeLogLarge, srcSet: `${freeLogSmall} 720w, ${freeLogLarge} 1448w`, width: 1448, height: 966 },
  gear: { src: gearLarge, srcSet: `${gearSmall} 720w, ${gearLarge} 1200w`, width: 1200, height: 800 },
};

function readStride(el: HTMLElement): number {
  const slide = el.querySelector<HTMLElement>('[data-feature-slide]');
  if (!slide) return 0;
  const gap = Number.parseFloat(getComputedStyle(el).columnGap);
  return measureStride(slide.getBoundingClientRect().width, gap);
}

/** Large stills with a short feature list. The visitor moves them. Nothing plays on its own. */
export function SegmentFeatureCarousel({ segment }: { segment: DiveSegment }) {
  const locale = useCurrentLocale();
  const copy = featureCarouselCopy(locale);
  const media = mediaCopy(locale);
  const slides = featureSlidePlan(segment, copy.slides[segment]).map(({ frame, slide }) => ({
    ...frame,
    title: slide.title,
    lines: slide.lines,
    alt: featureSlideAlt(segment, frame.id, media),
    photo: PHOTOS[frame.image],
  }));
  const scroller = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const lockRef = useRef<FeatureScrollLock>(null);
  const reducedRef = useRef(true);
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const ends = endpointState(index, count);
  const position = formatFeaturePosition(copy.position, index + 1, count);
  const spoken = slides[index] ? `${slides[index].title}. ${position}` : position;

  function publish(next: number, via: 'keyboard' | 'pointer') {
    const moved = reduceCarousel(indexRef.current, count, { type: 'jump', index: next });
    indexRef.current = moved.index;
    setIndex(moved.index);
    const el = scroller.current;
    if (!el) return;
    const stride = readStride(el);
    if (!(stride > 0)) return;
    const target = scrollTarget(moved.index, stride, count);
    lockRef.current = { target };
    el.scrollTo({ left: target, behavior: carouselScrollBehavior({ reducedMotion: reducedRef.current, via }) });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moved = reduceCarousel(indexRef.current, count, {
      type: 'key',
      key: event.key,
      modified: event.altKey || event.metaKey || event.ctrlKey || event.shiftKey,
    });
    if (!moved.handled) return;
    event.preventDefault();
    publish(moved.index, 'keyboard');
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) lockRef.current = null;
  }

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedRef.current = motion.matches; };
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    indexRef.current = 0;
    lockRef.current = null;
    setIndex(0);
    scroller.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [segment, locale]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const sync = () => {
      const synced = scrollEventIndex({
        scrollLeft: el.scrollLeft,
        stride: readStride(el),
        count,
        lock: lockRef.current,
        current: indexRef.current,
      });
      lockRef.current = synced.lock;
      if (synced.index === indexRef.current) return;
      indexRef.current = synced.index;
      setIndex(synced.index);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => sync());
    };
    // Keep the selected slide after a resize. Manual scrolling updates the index first.
    const onResize = () => {
      const aligned = resizeAlignment(el.scrollLeft, indexRef.current, readStride(el), count);
      if (!aligned.needsScroll) {
        lockRef.current = null;
        return;
      }
      lockRef.current = { target: aligned.target };
      el.scrollTo({ left: aligned.target, behavior: 'auto' });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onScroll);
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScroll);
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, [count, segment, locale]);

  return <section id="segment-features" className="wd-feature wd-segment-shell" aria-roledescription={copy.carouselLabel} aria-labelledby="features-title" data-feature-segment={segment} data-feature-index={index} data-feature-count={count}>
    <h2 id="features-title">{copy.heading[segment]}</h2>
    <div
      ref={scroller}
      id="segment-feature-track"
      className="wd-feature-track"
      tabIndex={0}
      role="group"
      aria-label={copy.trackLabel}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      onKeyDown={onKeyDown}
      onPointerDown={() => { lockRef.current = null; }}
      onWheel={onWheel}
    >
      {slides.map((slide, slideIndex) => <article key={slide.id} className="wd-feature-slide" data-feature-slide="" data-copy-side={slide.side} data-copy-layout={slide.layout} aria-roledescription={copy.slideLabel} aria-label={`${slide.title}. ${formatFeaturePosition(copy.position, slideIndex + 1, count)}`} aria-current={slideIndex === index ? 'true' : undefined}>
        <img src={slide.photo.src} srcSet={slide.photo.srcSet} sizes={SIZES} width={slide.photo.width} height={slide.photo.height} alt={slide.alt} loading="lazy" decoding="async" style={{ objectPosition: slide.focus }} />
        <div className="wd-feature-copy">
          <h3>{slide.title}</h3>
          <ul>
            {slide.lines.map(line => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </article>)}
    </div>
    <div className="wd-feature-nav">
      <p className="wd-feature-count" aria-hidden="true">{position}</p>
      <button type="button" disabled={ends.prevDisabled} aria-controls="segment-feature-track" aria-label={copy.previous} onClick={() => publish(reduceCarousel(indexRef.current, count, { type: 'step', delta: -1 }).index, 'pointer')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
      </button>
      <button type="button" disabled={ends.nextDisabled} aria-controls="segment-feature-track" aria-label={copy.next} onClick={() => publish(reduceCarousel(indexRef.current, count, { type: 'step', delta: 1 }).index, 'pointer')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
      </button>
    </div>
    <p className="wd-segment-sr" aria-live="polite" aria-atomic="true">{spoken}</p>
  </section>;
}
