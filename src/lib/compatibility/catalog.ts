/** Snapshot of the existing launch catalog, not manufacturer specifications.
 * Source: src/lib/i18n/frozen-landing-messages.ts compat, reviewed 2026-10-26.
 * Case sizes are NOT documented there. Never infer universal 38–49mm support.
 */
export const COMPATIBILITY_CATALOG_VERSION = "landing-20261026";
export type CompatibilityResult = "listed-housing" | "planned-app-only" | "unconfirmed";
const housing = [
  "Galaxy Watch4",
  "Galaxy Watch4 Classic",
  "Galaxy Watch5",
  "Galaxy Watch5 Pro",
  "Galaxy Watch6",
  "Galaxy Watch6 Classic",
  "Galaxy Watch FE",
  "Galaxy Watch7",
  "Galaxy Watch Ultra",
  "Galaxy Watch8",
  "Galaxy Watch8 Classic",
  "Galaxy Watch9",
];
const planned = [
  "Apple Watch Ultra",
  "Apple Watch Ultra 2",
  "Apple Watch Ultra 3",
  "Galaxy Watch Ultra2",
];
export type CatalogModel = { id: string; name: string; result: CompatibilityResult };
export const COMPATIBILITY_MODELS: readonly CatalogModel[] = [
  ...housing.map((name) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    result: "listed-housing" as const,
  })),
  ...planned.map((name) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    result: "planned-app-only" as const,
  })),
  // Existing catalog explicitly lists all other Apple Watch models. Preserve that
  // family-level support claim, with its named Ultra exclusions, without inventing sizes.
  {
    id: "apple-watch-non-ultra",
    name: "Apple Watch (except Ultra, Ultra 2 and Ultra 3)",
    result: "listed-housing",
  },
  { id: "not-listed", name: "", result: "unconfirmed" },
];
export function findCompatibilityModel(id: unknown): CatalogModel | undefined {
  return typeof id === "string" ? COMPATIBILITY_MODELS.find((model) => model.id === id) : undefined;
}
