import type { Locale } from "@/lib/i18n/locale";
import { PUBLISHABLE_REVIEWS, type BetaReview } from "./beta-reviews.ts";

export type LocalizedBetaReviewBodies = Readonly<Partial<Record<number, string>>>;

const PUBLISHABLE_REVIEW_IDS = new Set(PUBLISHABLE_REVIEWS.map(({ id }) => id));

function validateLocalizedBodies(
  locale: Exclude<Locale, "en">,
  bodies: LocalizedBetaReviewBodies,
): LocalizedBetaReviewBodies {
  const ids = Object.keys(bodies).map(Number);
  if (
    ids.length !== PUBLISHABLE_REVIEW_IDS.size ||
    ids.some((id) => !PUBLISHABLE_REVIEW_IDS.has(id)) ||
    PUBLISHABLE_REVIEWS.some(({ id }) => !bodies[id]?.trim())
  ) {
    throw new Error(`Incomplete localized beta-review set for ${locale}`);
  }
  return bodies;
}

/** Use a translation only when it contains readable text. */
export function betaReviewBody(
  review: Pick<BetaReview, "id" | "en">,
  bodies?: LocalizedBetaReviewBodies,
): string {
  return bodies?.[review.id]?.trim() || review.en;
}

/**
 * Load only the review language requested by the current route.
 *
 * The English rendering remains in `beta-reviews.ts`. Keeping every other
 * locale behind its own import boundary prevents one translated page from
 * downloading the complete nine-language testimonial set.
 */
export async function loadLocalizedBetaReviewBodies(
  locale: Locale,
): Promise<LocalizedBetaReviewBodies | undefined> {
  switch (locale) {
    case "en":
      return undefined;
    case "ko":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.ko.ts")).BETA_REVIEWS_KO,
      );
    case "zh-CN":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.zh-CN.ts")).BETA_REVIEWS_ZH_CN,
      );
    case "zh-TW":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.zh-TW.ts")).BETA_REVIEWS_ZH_TW,
      );
    case "ja":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.ja.ts")).BETA_REVIEWS_JA,
      );
    case "es":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.es.ts")).BETA_REVIEWS_ES,
      );
    case "fr":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.fr.ts")).BETA_REVIEWS_FR,
      );
    case "de":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.de.ts")).BETA_REVIEWS_DE,
      );
    case "pt-BR":
      return validateLocalizedBodies(
        locale,
        (await import("./beta-reviews.pt-BR.ts")).BETA_REVIEWS_PT_BR,
      );
  }
}
