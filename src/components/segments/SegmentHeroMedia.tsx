import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiteMedia } from '@/lib/liteMedia';
import { useCurrentLocale, useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import type { Locale } from '@/lib/i18n/locale';
import type { DiveSegment } from '@/lib/segments/copy';
import freeSmall from '@/assets/live/segment-heroes/freediving-640.webp';
import freePoster from '@/assets/live/segment-heroes/freediving-1280.webp';
import freeLoop from '@/assets/live/segment-heroes/freediving-underwater.mp4';
import scubaSmall from '@/assets/live/segment-heroes/scuba-640.webp';
import scubaPoster from '@/assets/live/segment-heroes/scuba-1280.webp';
import scubaLoop from '@/assets/live/segment-heroes/scuba-underwater-steady.mp4';

const pauseLabels: Record<Locale, string> = {
  en: 'Pause video', ko: '영상 일시 정지', 'zh-CN': '暂停视频', 'zh-TW': '暫停影片',
  ja: '動画を一時停止', es: 'Pausar vídeo', fr: 'Mettre la vidéo en pause',
  de: 'Video pausieren', 'pt-BR': 'Pausar vídeo',
};

/** Real footage, silent and short. The poster renders first without waiting for JS.
 * No video request before hydration or on constrained connections/reduced motion.
 * Explicit play remains available. Pausing, scrolling away and hiding the tab stop motion.
 */
export function SegmentHeroMedia({ segment, caption }: { segment: DiveSegment; caption: string }) {
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const lite = useLiteMedia();
  const figure = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    if (element) {
      // Set the DOM defaults before native autoplay is evaluated, including WebKit.
      element.defaultMuted = true;
      element.muted = true;
      element.setAttribute('muted', '');
      element.setAttribute('webkit-playsinline', '');
    }
  }, []);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
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
  const allowed = ready && !failed && ((!lite && !reducedMotion) || requested);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { setReducedMotion(motion.matches); setRequested(false); };
    const updateVisibility = () => setTabVisible(!document.hidden);
    updateMotion(); updateVisibility(); setReady(true);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    if (figure.current) observer.observe(figure.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!allowed) { setPlaying(false); setHasFrame(false); return; }
    if (!element) return;
    if (inView && tabVisible && !paused) {
      element.play().catch(() => { if (element.paused) setPlaying(false); });
    } else element.pause();
  }, [allowed, inView, tabVisible, paused]);

  function toggle() {
    if (playing) { setPaused(true); video.current?.pause(); }
    else {
      setRequested(true); setPaused(false);
      // Keep an explicit play in the gesture for browsers that require it.
      video.current?.play().catch(() => setPlaying(false));
    }
  }

  return <figure ref={figure} className="wd-segment-hero-media">
    <img src={lite ? small : poster} srcSet={lite ? undefined : `${small} 640w, ${poster} 1280w`} sizes="(min-width: 960px) 50vw, 100vw" width="1280" height="960" alt={caption} fetchPriority="high" loading="eager" />
    {allowed && <video ref={attachVideo} className={hasFrame ? 'has-frame' : ''} muted loop playsInline autoPlay={inView && tabVisible && !paused} preload="none" poster={poster} src={isFree ? freeLoop : scubaLoop} aria-hidden="true" tabIndex={-1}
      onCanPlay={() => {
        const element = video.current;
        if (element && inView && tabVisible && !paused) element.play().catch(() => { if (element.paused) setPlaying(false); });
      }} onPlaying={() => { setPlaying(true); setHasFrame(true); }} onPause={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} />}
    <figcaption>{caption}</figcaption>
    {!failed && <button className="wd-segment-motion-toggle" type="button" onClick={toggle} aria-label={playing ? pauseLabels[locale] : m.media.play} title={playing ? pauseLabels[locale] : m.media.play}>
      {playing ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" strokeWidth="3" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" fill="currentColor" /></svg>}
    </button>}
  </figure>;
}
