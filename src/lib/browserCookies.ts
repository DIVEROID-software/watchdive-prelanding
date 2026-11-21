/** Some embedded browsers throw on cookie access, even on a first-party page. */
export function readBrowserCookies(): string {
  try {
    return typeof document === "undefined" ? "" : document.cookie || "";
  } catch {
    return "";
  }
}

export function writeBrowserCookie(value: string): boolean {
  try {
    if (typeof document === "undefined") return false;
    document.cookie = value;
    return true;
  } catch {
    return false;
  }
}
