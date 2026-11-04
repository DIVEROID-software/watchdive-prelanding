import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from 'react';
import underwater640 from '@/assets/live/refresh/underwater-640.webp';
import underwater1000 from '@/assets/live/refresh/underwater-1000.webp';
import underwater1600 from '@/assets/live/refresh/underwater-1600.webp';
import buoy800 from '@/assets/live/media-refresh-20261103/buoy-800.webp';
import buoy1400 from '@/assets/live/media-refresh-20261103/buoy-1400.webp';
import wrist640 from '@/assets/live/refresh/wrist-pool-640.webp';
import wrist1000 from '@/assets/live/refresh/wrist-pool-1000.webp';
import modes800 from '@/assets/live/media-refresh-20261103/modes-bcd-800.webp';
import modes1376 from '@/assets/live/media-refresh-20261103/modes-bcd-1376.webp';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import type { DiveSegment } from '@/lib/segments/copy';
import { featureCarouselCopy, featureLineText, formatFeaturePosition } from '@/lib/segments/feature-carousel-copy';
import type { FeatureCarouselCopy, FeatureSlideCopy } from '@/lib/segments/feature-carousel-copy';
import {
  FEATURE_MOVE_MS,
  autoplayEligible,
  boundScrollTarget,
  carouselClickVia,
  cloneScrollTarget,
  featureSlideAlt,
  endpointState,
  featureSlidePlan,
  holdAfterFocus,
  idleScheduler,
  initialFeatureHold,
  measureStride,
  planCarouselMove,
  reduceCarousel,
  reduceFeatureHold,
  resizeAlignment,
  scrollEventIndex,
  syncDwell,
  takeDwell,
  tweenScrollLeft,
  type FeatureHold,
  type FeatureMoveVia,
  type FeatureScrollLock,
  type FeatureSlideFrame,
} from '@/lib/segments/feature-carousel';
import { FeatureGlyph } from '@/components/segments/feature-glyphs';

const SIZES = '(min-width:960px) 1000px, calc(100vw - 48px)';

const PHOTOS: Record<FeatureSlideFrame['image'], { src: string; srcSet: string; width: number; height: number }> = {
  underwater: {
    src: underwater1600,
    srcSet: `${underwater640} 640w, ${underwater1000} 1000w, ${underwater1600} 1600w`,
    width: 1600,
    height: 1067,
  },
  buoy: { src: buoy1400, srcSet: `${buoy800} 800w, ${buoy1400} 1400w`, width: 1400, height: 934 },
  'wrist-pool': { src: wrist1000, srcSet: `${wrist640} 640w, ${wrist1000} 1000w`, width: 1000, height: 667 },
  modes: { src: modes1376, srcSet: `${modes800} 800w, ${modes1376} 1376w`, width: 1376, height: 673 },
};

type SlideView = FeatureSlideFrame & FeatureSlideCopy & { alt: string; photo: (typeof PHOTOS)[FeatureSlideFrame['image']] };

function readMaxScroll(el: HTMLElement): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

function readStride(el: HTMLElement): number {
  const slide = el.querySelector<HTMLElement>('[data-feature-slide]');
  if (!slide) return 0;
  const styles = getComputedStyle(el);
  const parsed = Number.parseFloat(styles.columnGap);
  const gap = Number.isFinite(parsed) ? parsed : Number.parseFloat(styles.gap);
  return measureStride(slide.getBoundingClientRect().width, gap);
}

function isRotationTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-feature-rotation]'));
}

/** Four still cards. Automatic advance waits six seconds, then moves one card forward. */
export function SegmentFeatureCarousel({ segment }: { segment: DiveSegment }) {
  const locale = useCurrentLocale();
  const copy = featureCarouselCopy(locale);
  const slides: SlideView[] = featureSlidePlan(segment, copy.slides[segment]).map(({ frame, slide }) => ({
    ...frame,
    ...slide,
    alt: featureSlideAlt(frame.id, copy.alt),
    photo: PHOTOS[frame.image],
  }));
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [hold, setHold] = useState<FeatureHold>('reduced-default');
  const [live, setLive] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const indexRef = useRef(0);
  const holdRef = useRef<FeatureHold>('reduced-default');
  const schedulerRef = useRef(idleScheduler());
  const lockRef = useRef<FeatureScrollLock>(null);
  const reducedRef = useRef(true);
  const fineRef = useRef(false);
  const visibleRef = useRef(false);
  const hiddenRef = useRef(false);
  const hoverRef = useRef(false);
  const draggingRef = useRef(false);
  const blockingRef = useRef(false);
  const quietRef = useRef(0);
  const tweeningRef = useRef(false);
  const wrapLockRef = useRef(false);
  const moveGen = useRef(0);
  const tweenRef = useRef(0);
  const timerRef = useRef(0);
  const mountedRef = useRef(true);
  const copyRef = useRef(copy);
  const slidesRef = useRef(slides);
  copyRef.current = copy;
  slidesRef.current = slides;

  function setHoldBoth(next: FeatureHold) {
    holdRef.current = next;
    setHold(next);
  }

  function gate() {
    return {
      hold: holdRef.current,
      visible: visibleRef.current,
      documentHidden: hiddenRef.current,
      reducedMotion: reducedRef.current,
      fineHover: hoverRef.current,
      dragging: draggingRef.current,
      blockingFocus: blockingRef.current,
    };
  }

  function clearTimer() {
    window.clearTimeout(timerRef.current);
    timerRef.current = 0;
  }

  function clearMotionStyles(el: HTMLElement | null) {
    if (!el) return;
    el.style.scrollSnapType = '';
    el.style.willChange = '';
  }

  function quietScroll(el: HTMLElement, left: number) {
    quietRef.current += 1;
    el.scrollLeft = left;
    quietRef.current -= 1;
  }

  function labelFor(next: number): string {
    const currentSlides = slidesRef.current;
    const currentCopy = copyRef.current;
    const slide = currentSlides[next];
    const position = formatFeaturePosition(currentCopy.position, next + 1, currentSlides.length);
    return slide ? `${slide.title}. ${position}` : position;
  }

  function readPosition(el: HTMLElement, lock: FeatureScrollLock) {
    return scrollEventIndex({
      scrollLeft: el.scrollLeft,
      stride: readStride(el),
      count: slidesRef.current.length,
      lock,
      current: indexRef.current,
      maxScroll: readMaxScroll(el),
    });
  }

  function arm() {
    if (!mountedRef.current) return;
    const synced = syncDwell(schedulerRef.current, autoplayEligible(gate()), performance.now());
    schedulerRef.current = synced.scheduler;
    clearTimer();
    if (synced.scheduleIn === null || synced.scheduler.armedGeneration === null) return;
    const generation = synced.scheduler.armedGeneration;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      if (!mountedRef.current) return;
      const taken = takeDwell(schedulerRef.current, generation, autoplayEligible(gate()), indexRef.current, slidesRef.current.length);
      schedulerRef.current = taken.scheduler;
      if (!taken.advanced) {
        arm();
        return;
      }
      moveTo(taken.index, 'auto', false);
    }, synced.scheduleIn);
  }

  function snapTo(next: number) {
    const el = scroller.current;
    if (!el) return;
    const stride = readStride(el);
    if (!(stride > 0)) return;
    const target = boundScrollTarget(next, stride, slidesRef.current.length, readMaxScroll(el));
    if (Math.abs(el.scrollLeft - target) <= 2) return;
    quietScroll(el, target);
  }

  function stopMotion(snap: boolean) {
    moveGen.current += 1;
    tweeningRef.current = false;
    window.cancelAnimationFrame(tweenRef.current);
    tweenRef.current = 0;
    clearMotionStyles(scroller.current);
    lockRef.current = null;
    if (snap) snapTo(indexRef.current);
    arm();
  }

  function commitWrap(announce: boolean) {
    if (wrapLockRef.current) return;
    wrapLockRef.current = true;
    moveGen.current += 1;
    tweeningRef.current = false;
    window.cancelAnimationFrame(tweenRef.current);
    tweenRef.current = 0;
    const el = scroller.current;
    clearMotionStyles(el);
    indexRef.current = 0;
    setIndex(0);
    if (el) {
      el.style.scrollSnapType = 'none';
      quietScroll(el, 0);
      el.style.scrollSnapType = '';
    }
    lockRef.current = null;
    if (announce) {
      setHoldBoth(reduceFeatureHold(holdRef.current, { type: 'manual' }));
      setLive(labelFor(0));
    }
    wrapLockRef.current = false;
    arm();
  }

  function moveTo(next: number, via: FeatureMoveVia, manual: boolean) {
    const total = slidesRef.current.length;
    const plan = planCarouselMove({
      from: indexRef.current,
      to: next,
      count: total,
      via,
      reducedMotion: reducedRef.current,
    });
    const generation = ++moveGen.current;
    tweeningRef.current = false;
    window.cancelAnimationFrame(tweenRef.current);
    tweenRef.current = 0;
    clearMotionStyles(scroller.current);
    schedulerRef.current = syncDwell(schedulerRef.current, false, performance.now()).scheduler;
    clearTimer();
    if (manual) {
      setHoldBoth(reduceFeatureHold(holdRef.current, { type: 'manual' }));
      setLive(labelFor(plan.index));
    }
    indexRef.current = plan.index;
    setIndex(plan.index);
    const el = scroller.current;
    if (!el) {
      arm();
      return;
    }
    const stride = readStride(el);
    const maxScroll = readMaxScroll(el);
    if (!(stride > 0)) {
      arm();
      return;
    }
    const target = plan.kind === 'wrap-forward' ? cloneScrollTarget(stride, total, maxScroll) : boundScrollTarget(plan.index, stride, total, maxScroll);
    const finish = () => {
      if (generation !== moveGen.current || !mountedRef.current) return;
      tweeningRef.current = false;
      lockRef.current = null;
      if (plan.kind === 'wrap-forward') {
        el.style.scrollSnapType = 'none';
        quietScroll(el, 0);
      }
      clearMotionStyles(el);
      arm();
    };
    if (plan.behavior === 'auto' || Math.abs(el.scrollLeft - target) <= 2) {
      if (plan.kind === 'wrap-forward') {
        el.style.scrollSnapType = 'none';
        quietScroll(el, 0);
      } else {
        quietScroll(el, target);
      }
      finish();
      return;
    }
    const start = el.scrollLeft;
    tweeningRef.current = true;
    lockRef.current = { target };
    el.style.scrollSnapType = 'none';
    el.style.willChange = 'scroll-position';
    const started = performance.now();
    const step = (now: number) => {
      if (generation !== moveGen.current || !mountedRef.current) return;
      const amount = Math.min(1, (now - started) / FEATURE_MOVE_MS);
      el.scrollLeft = tweenScrollLeft(start, target, amount);
      if (amount < 1) {
        tweenRef.current = window.requestAnimationFrame(step);
        return;
      }
      tweenRef.current = 0;
      finish();
    };
    tweenRef.current = window.requestAnimationFrame(step);
  }

  function onScroll() {
    if (quietRef.current > 0 || tweeningRef.current || wrapLockRef.current) return;
    const el = scroller.current;
    if (!el) return;
    const synced = readPosition(el, lockRef.current);
    lockRef.current = synced.lock;
    if (synced.lock) return;
    if (synced.atClone) {
      commitWrap(true);
      return;
    }
    if (synced.index === indexRef.current) return;
    indexRef.current = synced.index;
    setIndex(synced.index);
    setHoldBoth(reduceFeatureHold(holdRef.current, { type: 'manual' }));
    setLive(labelFor(synced.index));
    arm();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moved = reduceCarousel(indexRef.current, slidesRef.current.length, {
      type: 'key',
      key: event.key,
      modified: event.altKey || event.metaKey || event.ctrlKey || event.shiftKey,
    });
    if (!moved.handled) return;
    event.preventDefault();
    moveTo(moved.index, 'keyboard', true);
  }

  function onStep(event: MouseEvent<HTMLButtonElement>, delta: number) {
    const moved = reduceCarousel(indexRef.current, slidesRef.current.length, { type: 'step', delta });
    moveTo(moved.index, carouselClickVia(event.detail), true);
  }

  function onToggle() {
    const playing = holdRef.current === 'none';
    blockingRef.current = false;
    setHoldBoth(reduceFeatureHold(holdRef.current, { type: playing ? 'pause' : 'play' }));
    if (playing) stopMotion(true);
    else arm();
  }

  function onPointerDown() {
    moveGen.current += 1;
    tweeningRef.current = false;
    window.cancelAnimationFrame(tweenRef.current);
    tweenRef.current = 0;
    const el = scroller.current;
    clearMotionStyles(el);
    lockRef.current = null;
    if (el) {
      const synced = readPosition(el, null);
      if (!synced.atClone && synced.index !== indexRef.current) {
        indexRef.current = synced.index;
        setIndex(synced.index);
      }
    }
    draggingRef.current = true;
    arm();
  }

  function settleDrag() {
    if (!draggingRef.current && !scroller.current) return;
    draggingRef.current = false;
    const el = scroller.current;
    if (!el) {
      arm();
      return;
    }
    const synced = readPosition(el, null);
    if (synced.atClone) {
      commitWrap(true);
      return;
    }
    if (synced.index !== indexRef.current) {
      indexRef.current = synced.index;
      setIndex(synced.index);
      setHoldBoth(reduceFeatureHold(holdRef.current, { type: 'manual' }));
      setLive(labelFor(synced.index));
    }
    arm();
  }

  function onFocusIn(event: FocusEvent<HTMLElement>) {
    if (isRotationTarget(event.target)) {
      blockingRef.current = false;
      arm();
      return;
    }
    blockingRef.current = true;
    setHoldBoth(holdAfterFocus(holdRef.current, false));
    stopMotion(true);
  }

  function onFocusOut(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    blockingRef.current = false;
    arm();
  }

  function onPointerEnter(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse' || !fineRef.current || hoverRef.current) return;
    hoverRef.current = true;
    stopMotion(true);
  }

  function onPointerLeave(event: PointerEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (!hoverRef.current) return;
    hoverRef.current = false;
    arm();
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    moveGen.current += 1;
    tweeningRef.current = false;
    window.cancelAnimationFrame(tweenRef.current);
    tweenRef.current = 0;
    clearMotionStyles(scroller.current);
    lockRef.current = null;
    arm();
  }

  useEffect(() => {
    mountedRef.current = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const section = sectionRef.current;
    const el = scroller.current;
    reducedRef.current = motion.matches;
    fineRef.current = fine.matches;
    hiddenRef.current = document.hidden;
    hoverRef.current = false;
    draggingRef.current = false;
    blockingRef.current = false;
    visibleRef.current = false;
    tweeningRef.current = false;
    indexRef.current = 0;
    lockRef.current = null;
    schedulerRef.current = idleScheduler();
    setIndex(0);
    setLive('');
    setHoldBoth(initialFeatureHold(motion.matches));
    if (el) quietScroll(el, 0);

    const onMotion = () => {
      reducedRef.current = motion.matches;
      setHoldBoth(reduceFeatureHold(holdRef.current, { type: motion.matches ? 'reduced-on' : 'reduced-off' }));
      if (motion.matches) stopMotion(true);
      else arm();
    };
    const onFine = () => {
      fineRef.current = fine.matches;
      if (!fine.matches && hoverRef.current) {
        hoverRef.current = false;
        arm();
      }
    };
    const onHidden = () => {
      hiddenRef.current = document.hidden;
      if (document.hidden) stopMotion(true);
      else arm();
    };
    const onResize = () => {
      moveGen.current += 1;
      tweeningRef.current = false;
      window.cancelAnimationFrame(tweenRef.current);
      tweenRef.current = 0;
      const track = scroller.current;
      clearMotionStyles(track);
      lockRef.current = null;
      if (track) {
        const aligned = resizeAlignment(track.scrollLeft, indexRef.current, readStride(track), slidesRef.current.length, readMaxScroll(track));
        if (aligned.needsScroll) quietScroll(track, aligned.target);
      }
      arm();
    };
    const endDrag = () => {
      if (!draggingRef.current) return;
      settleDrag();
    };
    motion.addEventListener('change', onMotion);
    fine.addEventListener('change', onFine);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    el?.addEventListener('scroll', onScroll, { passive: true });
    el?.addEventListener('scrollend', onScroll);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    if (el) resizeObserver?.observe(el);
    const intersection = typeof IntersectionObserver === 'undefined' || !section
      ? null
      : new IntersectionObserver((entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        visibleRef.current = visible;
        if (!visible) stopMotion(true);
        else arm();
      });
    if (section && intersection) intersection.observe(section);
    else visibleRef.current = true;
    arm();
    return () => {
      mountedRef.current = false;
      moveGen.current += 1;
      clearTimer();
      window.cancelAnimationFrame(tweenRef.current);
      tweenRef.current = 0;
      clearMotionStyles(el);
      motion.removeEventListener('change', onMotion);
      fine.removeEventListener('change', onFine);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      el?.removeEventListener('scroll', onScroll);
      el?.removeEventListener('scrollend', onScroll);
      resizeObserver?.disconnect();
      intersection?.disconnect();
    };
    // The listeners call the latest closures through this effect's setup. Segment and locale restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, locale]);

  const ends = endpointState(index, count);
  const position = formatFeaturePosition(copy.position, index + 1, count);
  const playing = hold === 'none';
  const loop = slides[0];

  return <section
    ref={sectionRef}
    id="segment-features"
    className="wd-feature wd-segment-shell"
    aria-roledescription={copy.carouselLabel}
    aria-labelledby="features-title"
    data-feature-segment={segment}
    data-feature-index={index}
    data-feature-count={count}
    data-feature-hold={hold}
    onFocusCapture={onFocusIn}
    onBlurCapture={onFocusOut}
    onPointerEnter={onPointerEnter}
    onPointerLeave={onPointerLeave}
  >
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
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      {slides.map((slide, slideIndex) => <FeatureCard key={slide.id} slide={slide} copy={copy} segment={segment} index={slideIndex} count={count} current={slideIndex === index} clone={false} />)}
      {loop ? <FeatureCard key={`${loop.id}-loop`} slide={loop} copy={copy} segment={segment} index={0} count={count} current={false} clone /> : null}
      <div className="wd-feature-spacer" aria-hidden="true" />
    </div>
    <div className="wd-feature-nav">
      <p className="wd-feature-count" aria-hidden="true">{position}</p>
      <button type="button" disabled={ends.prevDisabled} aria-controls="segment-feature-track" aria-label={copy.previous} onClick={(event) => onStep(event, -1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
      </button>
      <button type="button" disabled={ends.nextDisabled} aria-controls="segment-feature-track" aria-label={copy.next} onClick={(event) => onStep(event, 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
      </button>
      <button type="button" data-feature-rotation="" aria-controls="segment-feature-track" aria-pressed={playing} aria-label={playing ? copy.pause : copy.play} onClick={onToggle}>
        {playing
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5v11l10-5.5-10-5.5Z" fill="currentColor" stroke="none" /></svg>}
      </button>
    </div>
    <p className="wd-segment-sr" aria-live="polite" aria-atomic="true">{live}</p>
  </section>;
}

function FeatureCard({
  slide,
  copy,
  segment,
  index,
  count,
  current,
  clone,
}: {
  slide: SlideView;
  copy: FeatureCarouselCopy;
  segment: DiveSegment;
  index: number;
  count: number;
  current: boolean;
  clone: boolean;
}) {
  const position = formatFeaturePosition(copy.position, index + 1, count);
  return <article
    className="wd-feature-slide"
    data-feature-slide={clone ? undefined : ''}
    data-feature-clone={clone ? '' : undefined}
    data-feature-image={slide.image}
    data-copy-side={slide.side}
    aria-roledescription={clone ? undefined : copy.slideLabel}
    aria-label={clone ? undefined : `${slide.title}. ${position}`}
    aria-current={current ? 'true' : undefined}
    aria-hidden={clone ? true : undefined}
    inert={clone ? true : undefined}
  >
    <img
      src={slide.photo.src}
      srcSet={slide.photo.srcSet}
      sizes={SIZES}
      width={slide.photo.width}
      height={slide.photo.height}
      alt={clone ? '' : slide.alt}
      loading="lazy"
      decoding="async"
      style={{ objectPosition: slide.focus }}
    />
    <div className="wd-feature-copy">
      <h3>{slide.title}</h3>
      <ul>
        {slide.lines.map((line) => <li key={line.icon}>
          <FeatureGlyph name={line.icon} />
          <span>{featureLineText(line, segment, copy.scopeLabel)}</span>
        </li>)}
      </ul>
    </div>
  </article>;
}
