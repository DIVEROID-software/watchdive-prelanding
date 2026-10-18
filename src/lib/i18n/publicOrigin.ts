export const WATCHDIVE_PUBLIC_ORIGIN = "https://watchdive.diveroid.com";

export function absoluteWatchDivePath(pathname: string): string {
  return new URL(pathname, WATCHDIVE_PUBLIC_ORIGIN).toString();
}
