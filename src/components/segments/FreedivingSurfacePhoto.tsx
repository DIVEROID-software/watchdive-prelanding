import type { Locale } from '@/lib/i18n/locale';
import small from '@/assets/live/segment-heroes/freediving-surface-800.webp';
import large from '@/assets/live/segment-heroes/freediving-surface-1600.webp';

const descriptions: Record<Locale, string> = {
  ko: '수면에서 손목의 WatchDive를 확인하는 프리다이버들',
  en: 'Freedivers checking WatchDive on their wrists at the surface',
  'zh-CN': '自由潜水员在水面查看手腕上的 WatchDive',
  'zh-TW': '自由潛水員在水面查看手腕上的 WatchDive',
  ja: '水面で手首のWatchDiveを確認するフリーダイバー',
  es: 'Apneístas consultando el WatchDive en sus muñecas en la superficie',
  fr: 'Des apnéistes consultent leur WatchDive au poignet à la surface',
  de: 'Freitaucher prüfen ihre WatchDive am Handgelenk an der Oberfläche',
  'pt-BR': 'Mergulhadores de apneia conferem o WatchDive no pulso na superfície',
};

/** Owner-selected real photo; the hero remains the underwater video. */
export function FreedivingSurfacePhoto({ locale }: { locale: Locale }) {
  return <figure className="wd-segment-surface-photo wd-segment-shell">
    <img src={large} srcSet={`${small} 800w, ${large} 1600w`} sizes="(min-width:1200px) 1120px, 100vw" width={1600} height={1067} alt={descriptions[locale]} loading="lazy" decoding="async" />
  </figure>;
}
