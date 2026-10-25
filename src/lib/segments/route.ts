import { loadReferralPriceClaim } from '../i18n/price-claim-loader';
import { readLiteMediaHint } from '../liteMedia';
import { landingHead } from '../i18n/seo';
import { localizePath, SUPPORTED_LOCALES, type Locale } from '../i18n/locale';
import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from '../i18n/frozen-landing-en';
import { landingStructuredData, structuredDataScript } from '../i18n/structuredData';
import { absoluteWatchDivePath } from '../i18n/publicOrigin';
import { segmentCopy, type DiveSegment } from './copy';
import poolPhoto from '@/assets/live/super-resolution-20261018/from-master/underwater-wide-1600.webp';

export async function loadSegmentLanding(locale: Locale) {
  return { liteMedia: readLiteMediaHint(), ...await loadReferralPriceClaim(locale) };
}

export function segmentHead(locale: Locale, segment: DiveSegment, messages: FrozenLandingMessages = EN_FROZEN_LANDING_MESSAGES) {
  const copy = segmentCopy(locale, segment);
  const title = `WatchDive · ${copy.modes[segment]}`;
  const adapted = { ...messages, faq: { ...messages.faq, a1: copy.intro, a2: copy.depthAnswer }, meta: { ...messages.meta, title, description: copy.intro, ogTitle: title, ogDescription: copy.intro, twitterTitle: title, twitterDescription: copy.intro } };
  const head = landingHead(locale, adapted);
  const path = (lang: Locale) => localizePath(`/${segment}`, lang);
  const canonical = absoluteWatchDivePath(path(locale));
  const socialImage = absoluteWatchDivePath(poolPhoto);
  return {
    ...head,
    meta: head.meta.map(meta => 'property' in meta && meta.property === 'og:url' ? { ...meta, content: canonical } : ('property' in meta && meta.property === 'og:image') || ('name' in meta && meta.name === 'twitter:image') ? { ...meta, content: socialImage } : 'property' in meta && meta.property === 'og:image:height' ? { ...meta, content: '1067' } : meta),
    links: [{ rel: 'canonical', href: canonical }, ...SUPPORTED_LOCALES.map(lang => ({ rel: 'alternate', hrefLang: lang, href: absoluteWatchDivePath(path(lang)) })), { rel: 'alternate', hrefLang: 'x-default', href: absoluteWatchDivePath(path('en')) }],
    scripts: [structuredDataScript(landingStructuredData(locale, adapted, canonical, socialImage))],
  };
}
