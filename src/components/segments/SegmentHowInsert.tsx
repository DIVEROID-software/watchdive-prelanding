import { useEffect, useRef, useState } from 'react';
import { useLiteMedia } from '@/lib/liteMedia';
import { useCurrentLocale, useFrozenLandingMessages } from '@/lib/i18n/use-current-locale';
import type { Locale } from '@/lib/i18n/locale';
import poster from '@/assets/live/segment-heroes/housing-insert-poster.jpg';
import clip from '@/assets/live/segment-heroes/housing-insert.mp4';

const pauseLabels: Record<Locale, string> = {
  en: 'Pause video', ko: '영상 일시 정지', 'zh-CN': '暂停视频', 'zh-TW': '暫停影片',
  ja: '動画を一時停止', es: 'Pausar vídeo', fr: 'Mettre la vidéo en pause',
  de: 'Video pausieren', 'pt-BR': 'Pausar vídeo',
};

/** Real hands seating a watch and closing the housing. Poster first.
 * Reduced motion and constrained connections keep the still and do not request the clip.
 */
export function SegmentHowInsert({ alt }: { alt: string }) {
  const lite = useLiteMedia();
  const locale = useCurrentLocale();
  const m = useFrozenLandingMessages();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [reduced, setReduced] = useState(true);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduced(motion.matches);
    updateMotion();
    motion.addEventListener('change', updateMotion);
    const element = box.current;
    const updateView = () => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) {
        setInView(false);
        return;
      }
      const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      setInView(visible / rect.height >= 0.2);
    };
    updateView();
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    if (element) observer.observe(element);
    window.addEventListener('scroll', updateView, { passive: true });
    document.addEventListener('scroll', updateView, { passive: true });
    window.addEventListener('resize', updateView);
    return () => {
      motion.removeEventListener('change', updateMotion);
      observer.disconnect();
      window.removeEventListener('scroll', updateView);
      document.removeEventListener('scroll', updateView);
      window.removeEventListener('resize', updateView);
    };
  }, []);

  const visibleVideo = !lite && !reduced && inView;
  const play = visibleVideo && !paused;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.defaultMuted = true;
    element.muted = true;
    if (play) element.play().catch(() => undefined);
    else element.pause();
  }, [play]);

  return <div ref={box} className="wd-segment-how-media">
    {visibleVideo ? <video ref={video} muted loop playsInline autoPlay={!paused} preload="metadata" poster={poster} aria-label={alt} src={clip} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /> : <img src={poster} alt={alt} width={960} height={540} />}
    {visibleVideo && <button type="button" className="wd-segment-motion-toggle" onClick={() => { if (playing) { setPaused(true); video.current?.pause(); } else { setPaused(false); video.current?.play().catch(() => undefined); } }} aria-label={playing ? pauseLabels[locale] : m.media.play} title={playing ? pauseLabels[locale] : m.media.play}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span></button>}
  </div>;
}
