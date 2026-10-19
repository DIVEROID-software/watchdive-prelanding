// Cosmetic, short-lived callback acknowledgement. Never an authentication,
// verification, purchase or conversion authority. Contains no customer data.
export const SOCIAL_ACK_COOKIE = "__Host-wd_social_ack";
export function socialAckCookie(confirmed: boolean): string {
  return `${SOCIAL_ACK_COOKIE}=${confirmed ? "1" : ""}; Path=/; Secure; SameSite=Lax; Max-Age=${confirmed ? 180 : 0}`;
}
export function hasSocialAcknowledgement(auth: string | null, cookies: string): boolean {
  return auth === "confirmed" && cookies.split(";").some((part) => part.trim() === `${SOCIAL_ACK_COOKIE}=1`);
}
