// Server-only bridge from signup credentials to the shared Stripe checkout.
// Payment never changes verification state or sends mail.
import type { LeadStore } from "../verification/contracts.ts";
import { conversionBlocked, POLL_HANDLE_TTL_MS } from "../verification/contracts.ts";
import { parseVerificationToken, verifyPollHandle, requireSecret } from "../verification/token.ts";
import type { Locale } from "../i18n/locale.ts";
import { issueReservationInvite } from "./invite.ts";
import { verifyPendingReservationToken } from "./pending.ts";
import { reservationCanonicalEmail } from "./emailIdentity.ts";
import { readReservationConfig, type EnvSource } from "./config.ts";
import { startAuthorizedReservationCheckout } from "./checkout.ts";
import type { StripeApi } from "./stripeApi.ts";

export type OnsiteCredential = { kind: "pending" | "attempt" | "confirmation"; value: string };
export type OnsiteReservationResult =
  | { status: "ready"; href: string; statusToken: string }
  | { status: "already_paid" | "verification_required" | "unavailable" };

export async function onsiteReservation(
  input: { credential: OnsiteCredential; locale: Locale },
  deps: {
    store: Pick<LeadStore, "findByLeadId">;
    env: EnvSource;
    stripe: StripeApi;
    now?: () => number;
  },
): Promise<OnsiteReservationResult> {
  const config = readReservationConfig(deps.env, {
    tokenSecret: true,
    webhookSecret: true,
    origin: true,
  });
  if (!config.ok) return { status: "unavailable" };
  try {
    const now = (deps.now || Date.now)();
    const pending =
      input.credential.kind === "pending"
        ? verifyPendingReservationToken(input.credential.value, config.value.tokenSecret!, now)
        : undefined;
    const parsed =
      input.credential.kind === "pending"
        ? pending
        : input.credential.kind === "confirmation"
          ? parseVerificationToken(input.credential.value, requireSecret(deps.env), now)
          : verifyPollHandle(
              input.credential.value,
              requireSecret(deps.env),
              now,
              POLL_HANDLE_TTL_MS,
            );
    if (!parsed) return { status: "verification_required" };
    const row = await deps.store.findByLeadId(parsed.leadId);
    if (
      !row ||
      row.leadId !== parsed.leadId ||
      row.suspect ||
      row.duplicate ||
      conversionBlocked(row.flags) ||
      (pending
        ? (row.status !== "pending" && row.status !== "verified") ||
          row.pageId !== pending.pageId ||
          reservationCanonicalEmail(row.email) !== pending.email
        : row.status !== "verified" || !row.emailVerified)
    )
      return { status: "verification_required" };
    const decision = await startAuthorizedReservationCheckout({
      identity: {
        leadId: row.leadId,
        pageId: row.pageId,
        email: reservationCanonicalEmail(row.email),
      },
      config: config.value,
      stripe: deps.stripe,
      nowMs: now,
    });
    if (decision.kind === "blocked" && decision.error === "already_paid")
      return { status: "already_paid" };
    if (decision.kind !== "url") return { status: "unavailable" };
    const statusToken = pending
      ? input.credential.value
      : issueReservationInvite({
          leadId: row.leadId,
          email: row.email,
          emailVerified: true,
          expiresAtMs: now + 24 * 60 * 60 * 1000,
          secret: config.value.tokenSecret!,
          nowMs: now,
        });
    return { status: "ready", href: decision.url, statusToken };
  } catch {
    return { status: "unavailable" };
  }
}
