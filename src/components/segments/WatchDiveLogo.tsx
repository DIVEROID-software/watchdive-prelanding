import logoInk from '@/assets/brand/watchdive-wordmark-ink.svg';
import logoWhite from '@/assets/brand/watchdive-wordmark-white.svg';

/** Light lockup on the scuba surface, ink lockup on the freediving surface. */
export function WatchDiveLogo({ tone }: { tone: 'on-dark' | 'on-light' }) {
  const src = tone === 'on-dark' ? logoWhite : logoInk;
  return <img className={`wd-watchdive-logo wd-watchdive-logo-${tone}`} src={src} alt="WatchDive" width={160} height={24} />;
}
