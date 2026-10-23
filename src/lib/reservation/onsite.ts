// Read-only bridge from the signup credential to the existing reservation flow.
// Never verifies an email, sends mail, modifies a lead, or creates a Stripe session.
import type { LeadStore } from "../verification/contracts.ts";
import { conversionBlocked, POLL_HANDLE_TTL_MS } from "../verification/contracts.ts";
import { parseVerificationToken, verifyPollHandle, requireSecret } from "../verification/token.ts";
import { isLocale, type Locale } from "../i18n/locale.ts";
import { issueReservationInvite } from "./invite.ts";
import { readReservationConfig, type EnvSource } from "./config.ts";

export type OnsiteCredential = { kind: "attempt" | "confirmation"; value: string };
export type OnsiteReservationResult =
  | { status: "ready"; href: string }
  | { status: "verification_required" | "unavailable" };

export async function onsiteReservation(input: { credential: OnsiteCredential; locale: Locale }, deps: {
  store: Pick<LeadStore, "findByLeadId">; env: EnvSource; now?: () => number;
}): Promise<OnsiteReservationResult> {
  const config = readReservationConfig(deps.env, { tokenSecret: true, webhookSecret: true, origin: true });
  if (!config.ok) return { status: "unavailable" };
  try {
    const now = (deps.now || Date.now)();
    const secret = requireSecret(deps.env);
    const parsed = input.credential.kind === "confirmation"
      ? parseVerificationToken(input.credential.value, secret, now)
      : verifyPollHandle(input.credential.value, secret, now, POLL_HANDLE_TTL_MS);
    if (!parsed) return { status: "verification_required" };
    // A poll handle must still name its exact current attempt, never the sealed
    // address fallback used ONLY by consent withdrawal. Decoys remain unusable.
    const row = await deps.store.findByLeadId(parsed.leadId);
    if (!row || row.leadId !== parsed.leadId || row.status !== "verified" || !row.emailVerified ||
        row.suspect || row.duplicate || conversionBlocked(row.flags)) {
      return { status: "verification_required" };
    }
    const locale = isLocale(row.signupLocale) ? row.signupLocale
      : ("locale" in parsed && isLocale(parsed.locale)) ? parsed.locale : input.locale;
    const invite = issueReservationInvite({ leadId: row.leadId, email: row.email, emailVerified: true,
      expiresAtMs: now + 24 * 60 * 60 * 1000, secret: config.value.tokenSecret!, nowMs: now });
    return { status: "ready", href: `/reservation?lang=${encodeURIComponent(locale)}#invite=${encodeURIComponent(invite)}` };
  } catch { return { status: "unavailable" }; }
}
