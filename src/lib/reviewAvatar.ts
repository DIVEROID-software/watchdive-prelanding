// The small circle beside a reviewer's name.
//
// A tester who sent us a photo gets their photo. Everyone else gets their
// initials on a colour derived from their own name — the pattern Google
// Reviews and Trustpilot use, which nobody reads as a claim about a face. The
// alternative, a generic silhouette, makes 103 different people look like one
// anonymous person.
//
// Nothing here invents a likeness. `avatarSrc` is the only way a face reaches
// the page, and it returns a path or nothing.
//
// Kept free of path-alias imports and of React so `npm test` can load it
// directly.

/** Where a reviewer photo lives, relative to `public/`. */
export const AVATAR_DIR = "/reviewers";

/**
 * Photos are served at this many CSS pixels and stored at twice that, so a
 * retina screen has real detail to draw and nothing larger is ever downloaded.
 */
export const AVATAR_PX = 28;
export const AVATAR_SOURCE_PX = AVATAR_PX * 2;

/**
 * The file a review's photo must be at, or undefined when there is none.
 *
 * Keyed on the review id rather than the name: two testers can share a name,
 * and a filename built from a name is a filename that changes when we fix a
 * spelling. A wrong face under a real person's name is the worst outcome this
 * feature has, so the join is on the one field that is unique and stable.
 */
export function avatarSrc(review: { id: number; hasPhoto?: true }): string | undefined {
  return review.hasPhoto ? `${AVATAR_DIR}/${review.id}.webp` : undefined;
}

/**
 * One or two letters, from the first and last word of a name.
 *
 * Split on whitespace only, so "Jun-ho Jeong" reads JJ rather than JH — the
 * hyphenated syllables are one given name, not two words.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = firstLetter(words[0]);
  const last = words.length > 1 ? firstLetter(words[words.length - 1]) : "";
  return first + last || "?";
}

function firstLetter(word: string): string {
  // Indexed by code point, not by unit, so a name outside the BMP is not
  // cut in half.
  return ([...word][0] ?? "").toLocaleUpperCase("en-GB");
}

/**
 * Muted marine tones. Saturated enough to tell two adjacent cards apart, dark
 * enough that a lane of them does not compete with the one cyan accent the
 * section already spends attention on.
 */
export const AVATAR_TONES = [
  "#0f4c5c",
  "#1b3a6b",
  "#2f5d62",
  "#3d4a7a",
  "#155e63",
  "#4a3f6b",
] as const;

/**
 * A stable colour for a name.
 *
 * Deterministic on purpose: the ticker duplicates every lane, so the same
 * person appears twice on screen at once and the two copies have to match.
 */
export function avatarTone(name: string): string {
  // djb2. Not a security hash — it only has to spread short names evenly.
  let hash = 5381;
  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash << 5) + hash + name.charCodeAt(index)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
