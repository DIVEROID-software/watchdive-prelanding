// Signup-landing segment for reservation mail. A pure function of the stored
// landing path. Country, phone, browser language, and interests are not inputs.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { LOCALE_PATH_SEGMENTS } from "../i18n/locale.ts";

export const RESERVATION_EMAIL_SEGMENTS = ["general", "scuba", "freediving"] as const;
export type ReservationEmailSegment = (typeof RESERVATION_EMAIL_SEGMENTS)[number];

const LOCALE_PREFIXES = new Set<string>(Object.values(LOCALE_PATH_SEGMENTS));

export function isReservationEmailSegment(value: unknown): value is ReservationEmailSegment {
  return value === "general" || value === "scuba" || value === "freediving";
}

/**
 * Strict page match. Only an app-local path whose page is exactly `/scuba`
 * or `/freediving`, with an optional supported locale prefix (`/ko/scuba`,
 * unprefixed English `/scuba`, or `/en/scuba`). Query and hash are ignored
 * and cannot choose a segment. One trailing slash is the same page.
 * A single percent-decoding of the path is allowed; an encoded slash is not
 * a separator. Anything else, including a missing path, is `general`.
 */
export function resolveReservationEmailSegment(landingPath?: string | null): ReservationEmailSegment {
  if (typeof landingPath !== "string") return "general";
  const trimmed = landingPath.trim();
  if (!trimmed || isExternal(trimmed)) return "general";

  const hashAt = trimmed.indexOf("#");
  const beforeHash = hashAt === -1 ? trimmed : trimmed.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  if (!path.startsWith("/") || isExternal(path)) return "general";
  if (/%2f|%5c|%00/i.test(path)) return "general";

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "general";
  }
  if (decoded.includes("%") || isExternal(decoded)) return "general";
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || /\s/.test(decoded)) return "general";

  const normalized = decoded.length > 1 ? decoded.replace(/\/+$/, "").toLowerCase() : decoded.toLowerCase();
  const parts = normalized.split("/");
  if (parts[0] !== "") return "general";
  const segments = parts.slice(1);
  if (segments.length === 0 || segments.some((part) => part === "" || part === "." || part === "..")) {
    return "general";
  }
  if (segments.length === 1) return pageSegment(segments[0]);
  if (segments.length === 2 && LOCALE_PREFIXES.has(segments[0])) return pageSegment(segments[1]);
  return "general";
}

function pageSegment(value: string): ReservationEmailSegment {
  return value === "scuba" || value === "freediving" ? value : "general";
}

function isExternal(value: string): boolean {
  return value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value);
}
