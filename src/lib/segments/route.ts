import { loadReferralPriceClaim } from '../i18n/price-claim-loader';
import { readLiteMediaHint } from '../liteMedia';
import { landingHead } from '../i18n/seo';
import { localizePath, SUPPORTED_LOCALES, type Locale } from '../i18n/locale';
import { EN_FROZEN_LANDING_MESSAGES, type FrozenLandingMessages } from '../i18n/frozen-landing-en';
import { landingStructuredData, structuredDataScript } from '../i18n/structuredData';
import { absoluteWatchDivePath } from '../i18n/publicOrigin';
import { segmentCopy, type DiveSegment } from './copy';
import freedivingPoster from '@/assets/live/segment-heroes/freediving-1280.webp';
import scubaPoster from '@/assets/live/segment-heroes/scuba-1280.webp';

export async function loadSegmentLanding(locale: Locale) {
  return { liteMedia: readLiteMediaHint(), ...await loadReferralPriceClaim(locale) };
}

export function segmentHead(locale: Locale, segment: DiveSegment, messages: FrozenLandingMessages = EN_FROZEN_LANDING_MESSAGES) {
  const copy = segmentCopy(locale, segment);
  const brand = locale === 'ko' ? '워치다이브 (WatchDive)' : 'WatchDive';
  const title = `${brand} · ${copy.modes[segment]}`;
  const description = `${brand}: ${copy.intro}`;
  const adapted = { ...messages, faq: { ...messages.faq, a1: copy.intro, a2: copy.depthAnswer }, meta: { ...messages.meta, title, description, ogTitle: title, ogDescription: description, twitterTitle: title, twitterDescription: description } };
  const head = landingHead(locale, adapted);
  const path = (lang: Locale) => localizePath(`/${segment}`, lang);
  const canonical = absoluteWatchDivePath(path(locale));
  const socialImage = absoluteWatchDivePath(segment === 'freediving' ? freedivingPoster : scubaPoster);
  return {
    ...head,
    meta: head.meta.map(meta => {
      if ('property' in meta && meta.property === 'og:url') return { ...meta, content: canonical };
      if (('property' in meta && meta.property === 'og:image') || ('name' in meta && meta.name === 'twitter:image')) return { ...meta, content: socialImage };
      if ('property' in meta && meta.property === 'og:image:width') return { ...meta, content: '1280' };
      if ('property' in meta && meta.property === 'og:image:height') return { ...meta, content: '960' };
      return meta;
    }),
    links: [{ rel: 'canonical', href: canonical }, ...SUPPORTED_LOCALES.map(lang => ({ rel: 'alternate', hrefLang: lang, href: absoluteWatchDivePath(path(lang)) })), { rel: 'alternate', hrefLang: 'x-default', href: absoluteWatchDivePath(path('en')) }],
    scripts: [structuredDataScript(landingStructuredData(locale, adapted, canonical, socialImage))],
  };
}
