/**
 * Translated product claims remain an internal review surface until they have
 * been approved against Product Truth. Fail closed for every value except the
 * exact opt-in string used by a deliberately configured preview build.
 */
export function isI18nReviewEnabled(value: unknown): boolean {
  return value === "true";
}
