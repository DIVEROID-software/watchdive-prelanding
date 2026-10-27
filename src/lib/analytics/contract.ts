// Shared, bounded browser context. No email, URL, token or click identifier.
export function validGoogleClientId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,20}\.\d{1,20}$/.test(value);
}
