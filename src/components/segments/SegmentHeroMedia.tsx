import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiteMedia } from '@/lib/liteMedia';
import { useCurrentLocale, useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import type { Locale } from '@/lib/i18n/locale';
import type { DiveSegment } from '@/lib/segments/copy';
import { HERO_AUTOPLAY_MEDIA, heroVideoAllowed, heroVideoShouldPlay } from './heroVideoPolicy';
import freeSmall from '@/assets/live/segment-heroes/freediving-640.webp';
import freePoster from '@/assets/live/segment-heroes/freediving-1280.webp';
import freeLoop from '@/assets/live/segment-heroes/freediving-underwater.mp4';
import scubaSmall from '@/assets/live/segment-heroes/scuba-640.webp';
import scubaPoster from '@/assets/live/segment-heroes/scuba-1280.webp';
import scubaLoop from '@/assets/live/segment-heroes/scuba-underwater-steady.mp4';

const pauseLabels: Record<Locale, string> = {
  en: 'Pause video', ko: '영상 일시 정지', 'zh-CN': '暂停视频', 'zh-TW': '暫停影片',
  ja: '動画を一時停止', es: 'Pausar vídeo', fr: 'Mettre la vidéo en pause',
  de: 'Video pausieren', 'pt-BR': 'Pausar vídeo', nl: 'Video pauzeren',
};

/** Real footage, silent and short. The poster renders first without waiting for JS.
 * The file mounts for automatic play only at 960px and up, and only when the
 * connection is unconstrained and motion is allowed. Narrow screens keep the
 * poster until the play control. Explicit play works at every width, including
 * constrained connections and reduced motion. Pausing, leaving the viewport,
 * hiding the tab, or narrowing the window without an explicit play stops it.
 */
export function SegmentHeroMedia({ segment, caption }: { segment: DiveSegment; caption: string }) {
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const lite = useLiteMedia();
  const figure = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const playOnAttach = useRef(false);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (!element) return;
    // Set the DOM defaults before native autoplay is evaluated, including WebKit.
    element.defaultMuted = true;
    element.muted = true;
    element.setAttribute('muted', '');
    element.setAttribute('webkit-playsinline', '');
    // The play control can mount this element. Call play during that commit so
    // the visitor's gesture still covers browsers that require one.
    if (playOnAttach.current) {
      playOnAttach.current = false;
      element.play().catch(() => { if (element.paused) setPlaying(false); });
    }
  }, []);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [wide, setWide] = useState(false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [requested, setRequested] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  const isFree = segment === 'freediving';
  const poster = isFree ? freePoster : scubaPoster;
  const small = isFree ? freeSmall : scubaSmall;
  const gate = { ready, failed, lite, reducedMotion, wide, requested };
  const allowed = heroVideoAllowed(gate);
  const shouldPlay = heroVideoShouldPlay({ ...gate, inView, tabVisible, paused });

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wideQuery = window.matchMedia(HERO_AUTOPLAY_MEDIA);
    const updateMotion = () => { setReducedMotion(motion.matches); setRequested(false); };
    const updateWide = () => setWide(wideQuery.matches);
    const updateVisibility = () => setTabVisible(!document.hidden);
    updateMotion(); updateWide(); updateVisibility(); setReady(true);
    motion.addEventListener('change', updateMotion);
    wideQuery.addEventListener('change', updateWide);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    if (figure.current) observer.observe(figure.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', updateMotion);
      wideQuery.removeEventListener('change', updateWide);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!allowed) { setPlaying(false); setHasFrame(false); return; }
    if (!element) return;
    if (shouldPlay) {
      element.play().catch(() => { if (element.paused) setPlaying(false); });
    } else element.pause();
  }, [allowed, shouldPlay]);

  function toggle() {
    if (playing) { setPaused(true); video.current?.pause(); }
    else {
      setRequested(true); setPaused(false);
      playOnAttach.current = !video.current;
      // Keep an explicit play in the gesture when the element is already mounted.
      video.current?.play().catch(() => setPlaying(false));
    }
  }

  return <figure ref={figure} className="wd-segment-hero-media">
    <img src={lite ? small : poster} srcSet={lite ? undefined : `${small} 640w, ${poster} 1280w`} sizes="(min-width: 960px) 50vw, 100vw" width="1280" height="960" alt={caption} fetchPriority="high" loading="eager" />
    {allowed && <video ref={attachVideo} className={hasFrame ? 'has-frame' : ''} muted loop playsInline autoPlay={shouldPlay} preload="none" poster={poster} src={isFree ? freeLoop : scubaLoop} aria-hidden="true" tabIndex={-1}
      onCanPlay={() => {
        const element = video.current;
        if (element && shouldPlay) element.play().catch(() => { if (element.paused) setPlaying(false); });
      }} onPlaying={() => { setPlaying(true); setHasFrame(true); }} onPause={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} />}
    <figcaption>{caption}</figcaption>
    {!failed && <button className="wd-segment-motion-toggle" type="button" onClick={toggle} aria-label={playing ? pauseLabels[locale] : m.media.play} title={playing ? pauseLabels[locale] : m.media.play}>
      {playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="3" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor" /></svg>}
    </button>}
  </figure>;
}
