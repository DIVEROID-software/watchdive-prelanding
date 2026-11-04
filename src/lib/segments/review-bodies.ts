import { loadLocalizedBetaReviewBodies, type LocalizedBetaReviewBodies } from '../../data/beta-reviews.loader.ts';
import type { Locale } from '../i18n/locale.ts';

/** The route language only. English stays on the source impressions. */
export async function loadSegmentReviewBodies(locale: Locale): Promise<LocalizedBetaReviewBodies | undefined> {
  try {
    return await loadLocalizedBetaReviewBodies(locale);
  } catch (error) {
    console.error(`Unable to load ${locale} beta-review translations`, error);
    return undefined;
  }
}
