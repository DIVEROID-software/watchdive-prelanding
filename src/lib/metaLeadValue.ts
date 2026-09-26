// The value Meta records for one submit-time `Lead` (2026-09-26).
//
// Events Manager flags a Lead without `value`/`currency` as incomplete, and
// value-aware delivery needs a number to work with. There is no revenue at
// signup, so this is a deliberately conservative placeholder: one unit per
// lead, in USD (the campaign's market and the page's pricing currency). Change
// it here and both legs — the browser pixel and the Conversions API — move
// together, so the deduplicated pair can never disagree.
//
// Kept dependency-free so the browser bundle, the server and `npm test` can all
// import it directly.
export const META_LEAD_VALUE = 1.0;
export const META_LEAD_CURRENCY = "USD";
