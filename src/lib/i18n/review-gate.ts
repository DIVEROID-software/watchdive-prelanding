/**
 * Translated product claims remain an internal review surface until they have
 * been approved against Product Truth. Fail closed for every value except the
 * exact opt-in string used by a deliberately configured preview build.
 */
export function isI18nReviewEnabled(value: unknown): boolean {
  return value === "true";
}

/**
 * The three new product-detail FAQs have a different approval boundary from
 * localization itself. Keeping a separate exact opt-in prevents enabling
 * locale routes from also publishing compatibility, sensor or warranty claims.
 */
export function isProductClaimsReviewEnabled(value: unknown): boolean {
  return value === "true";
}
