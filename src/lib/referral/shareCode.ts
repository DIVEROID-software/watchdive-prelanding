// Memorable Buddy Invite share codes. The invite link stays the primary way a
// friend is attributed; a share code is the thing a diver can say on a boat
// or type into an Instagram caption. Attribution still stores the owner's
// 8-character ref code. This module is pure: no Notion, no secrets.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { checkNickname } from "./nickname.ts";
import { SHARE_CODE_MAX, SHARE_CODE_MIN } from "./program.ts";

/**
 * Auto codes avoid 0/O and 1/I/L so a code read aloud does not collide with
 * itself. 31 symbols. Custom codes may use the full A–Z0–9 alphabet.
 */
export const SHARE_CODE_AUTO_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Six characters: never the same length as an 8-character ref code. */
export const SHARE_CODE_AUTO_LENGTH = 6;

export type ShareCodeRejectReason =
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "contact_info"
  | "link"
  | "reserved"
  | "profanity"
  | "taken"
  | "locked"
  | "already_claimed";

export type ShareCodeCheck =
  | { ok: true; value: string }
  | { ok: false; reason: ShareCodeRejectReason };

/**
 * Obvious slurs and a short set of non-English ones, matched as substrings of
 * the confusable fold. Short ambiguous tokens are left out on purpose: "ass"
 * is inside CLASS, "dick" inside PREDICTION, "hell" inside SHELL, "cock"
 * inside PEACOCK, "anal" inside CANAL. "puta" still rejects DISPUTA.
 */
const PROFANITY = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "nigger",
  "nigga",
  "faggot",
  "whore",
  "slut",
  "puta",
  "mierda",
  "joder",
  "cabron",
  "maricon",
  "putain",
  "merde",
  "salope",
  "connard",
  "scheisse",
  "fotze",
  "hurensohn",
  "kuso",
  "chikusho",
  "caonima",
  "shabi",
  "tamade",
  "porra",
  "caralho",
  "buceta",
  "ssibal",
  "shibal",
  "sibal",
  "ssipal",
  "sipal",
  "byeongsin",
];

const FOLD_DIGIT: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

function profanityFolds(code: string): string[] {
  const base = [...code.toLowerCase()].map((ch) => FOLD_DIGIT[ch] ?? ch).join("");
  return [base.replace(/1/g, "i"), base.replace(/1/g, "l")];
}

function hasProfanity(code: string): boolean {
  const folds = profanityFolds(code);
  return PROFANITY.some((word) => folds.some((fold) => fold.includes(word)));
}

/** A–Z0–9 of the right length, or undefined. Does not apply safety rules. */
export function canonicalShareCode(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(value)) return undefined;
  const length = [...value].length;
  return length >= SHARE_CODE_MIN && length <= SHARE_CODE_MAX ? value : undefined;
}

/** Claim check. Length and alphabet first, then the nickname safety rules, then profanity. */
export function checkShareCode(raw: string): ShareCodeCheck {
  const input = typeof raw === "string" ? raw : "";
  const value = input.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9]*$/.test(value)) return { ok: false, reason: "invalid_chars" };
  const length = [...value].length;
  if (length < SHARE_CODE_MIN) return { ok: false, reason: "too_short" };
  if (length > SHARE_CODE_MAX) return { ok: false, reason: "too_long" };
  // Nicknames are 2–16 and allow separators. A share code is already inside
  // that length and is only A–Z0–9, so a length or alphabet failure here would
  // be a bug in the checks above. Reserved, contact and link still apply.
  const nick = checkNickname(value);
  if (!nick.ok && nick.reason !== "too_short" && nick.reason !== "too_long") {
    return { ok: false, reason: nick.reason };
  }
  if (hasProfanity(value)) return { ok: false, reason: "profanity" };
  return { ok: true, value };
}

/** Whether this row may still replace its code. Same-code no-op is the caller's job. */
export function claimDecision(row: {
  shareCodeLocked?: boolean;
  shareCodeCustom?: boolean;
}): "ok" | "locked" | "already_claimed" {
  if (row.shareCodeLocked) return "locked";
  if (row.shareCodeCustom) return "already_claimed";
  return "ok";
}

function cryptoIndex(max: number): number {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("crypto.getRandomValues is not available");
  }
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let value = 256;
  while (value >= limit) {
    cryptoObj.getRandomValues(buf);
    value = buf[0] ?? 256;
  }
  return value % max;
}

/** Unambiguous 6-character code. `randomInt(max)` returns an integer in `[0, max)`. */
export function generateShareCode(randomInt: (max: number) => number = cryptoIndex): string {
  const alphabet = SHARE_CODE_AUTO_ALPHABET;
  let out = "";
  for (let i = 0; i < SHARE_CODE_AUTO_LENGTH; i += 1) {
    const index = randomInt(alphabet.length);
    if (!Number.isInteger(index) || index < 0 || index >= alphabet.length) {
      throw new Error("share code random source returned an index outside the alphabet");
    }
    out += alphabet[index];
  }
  return out;
}

/** The 8-character ref code a share link already understands. Anything else is dropped. */
export function sanitizeRefCode(raw: string | undefined | null): string | undefined {
  const code = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  return /^[a-z0-9]{8}$/.test(code) ? code : undefined;
}

export function withRef(home: string, ref: string | undefined): string {
  return ref ? `${home}?ref=${ref}` : home;
}

/** Today's redirect: an 8-character code keeps `?ref=`, anything else is the plain home. */
export function legacyShareLocation(home: string, raw: string | undefined | null): string {
  return withRef(home, sanitizeRefCode(raw));
}

/**
 * Where `/r/<raw>` sends the visitor. While the program is off, lookups are
 * ignored and the answer is exactly `legacyShareLocation`. While it is on, an
 * existing ref-code row wins over a share code of the same text (links keep
 * working). A share code resolves to its owner's 8-character ref code. An
 * unknown 8-character value still keeps `?ref=` so a link works even when the
 * lookup cannot run.
 */
export function decideShareLinkTarget(input: {
  home: string;
  raw: string | undefined | null;
  enabled: boolean;
  refOwnerFound: boolean;
  shareOwnerRef?: string | undefined;
}): string {
  if (!input.enabled) return legacyShareLocation(input.home, input.raw);
  const ref = sanitizeRefCode(input.raw);
  if (ref && input.refOwnerFound) return withRef(input.home, ref);
  const owner =
    input.shareOwnerRef && /^[a-z0-9]{8}$/.test(input.shareOwnerRef)
      ? input.shareOwnerRef
      : undefined;
  if (owner) return withRef(input.home, owner);
  return legacyShareLocation(input.home, input.raw);
}

/**
 * What a signup stores. The link always wins. A typed code is used only when
 * the program is on, there is no link, and the lookup returned an 8-character
 * ref code. An unknown, invalid or rate-limited code does not block the
 * signup: `note` is "ignored" and nothing is stored in Referred by.
 * While the program is off, `typed` and `resolvedRef` are ignored and `note`
 * is null, so the payload matches a signup that never had the field.
 */
export function decideAttribution(input: {
  enabled: boolean;
  linkRef?: string;
  typed?: string;
  resolvedRef?: string;
}): { referredBy?: string; note: "ignored" | null } {
  const link =
    input.linkRef && /^[a-z0-9]{8}$/.test(input.linkRef) ? input.linkRef : undefined;
  if (!input.enabled) return { ...(link ? { referredBy: link } : {}), note: null };
  if (link) return { referredBy: link, note: null };
  const typed = (input.typed ?? "").trim();
  if (!typed) return { note: null };
  const resolved =
    input.resolvedRef && /^[a-z0-9]{8}$/.test(input.resolvedRef)
      ? input.resolvedRef
      : undefined;
  if (resolved) return { referredBy: resolved, note: null };
  return { note: "ignored" };
}
