// Resolves a checked provider identity onto one waitlist row.
//
// Already-verified rows keep Verified at, Lead ID, signup method, and payment
// fields. A pending row may be verified once. Notion has no compare-and-set:
// two creates that each see only themselves can both verify. That residual is
// documented for root. The process-local jti check is not a cross-instance lock.

import { canonicalEmail, isDisposableEmail } from "../api/abuse.ts";
import { observeSignupCountry } from "../attribution.ts";
import { persistableExperimentContext } from "../conversionExperimentContract.ts";
import { homePath, isLocale, parseLocalePath, type Locale } from "../i18n/locale.ts";
import {
  MEASUREMENT_CONSENT_GRANTED,
  MEASUREMENT_CONSENT_WITHHELD,
  VERIFICATION_TTL_MS,
  type LeadRecord,
  type LeadStore,
} from "../verification/contracts.ts";
import {
  completeSocialVerification,
  requestVerificationService,
  sendSocialVerificationMail,
  type ServiceDependencies,
} from "../verification/service.ts";
import { newLeadId } from "../verification/token.ts";
import { SocialAuthSchemaError } from "../verification/notionLead.ts";
import { classifyProviderClaims, isDocumentedRelayDomain, validSubject, type ProviderClaims } from "./claims.ts";
import type { SocialProvider } from "./config.ts";
import type { SocialState } from "./state.ts";

export type SocialFinish = "confirmed" | "check-email" | "pending" | "error";

function alreadyVerified(row: LeadRecord): boolean {
  return row.emailVerified || row.status === "verified" || Boolean(row.verifiedAt);
}

function subjectOf(row: LeadRecord, provider: SocialProvider): string | undefined {
  return provider === "google" ? row.googleSubject : row.appleSubject;
}

function lookupCanonical(email: string, relay: boolean): string {
  if (relay || isDocumentedRelayDomain(email)) return email;
  return canonicalEmail(email);
}

function createdMs(row: LeadRecord): number {
  const ms = row.signedUpAt ? Date.parse(row.signedUpAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function earlier(left: LeadRecord, right: LeadRecord): LeadRecord {
  const delta = createdMs(left) - createdMs(right);
  if (delta !== 0) return delta < 0 ? left : right;
  return left.pageId < right.pageId ? left : right;
}

export function signupLandingPath(locale: Locale, captured: string | undefined): string {
  if (!captured || !captured.startsWith("/") || captured.startsWith("//") || captured.includes("?")) {
    return homePath(locale);
  }
  try {
    const parsed = parseLocalePath(captured);
    if (parsed.locale === locale) return captured;
  } catch {
    return homePath(locale);
  }
  return homePath(locale);
}

function mintRefCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return Buffer.from(bytes)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 8);
}

function measurementState(bound: SocialState, gpc: boolean): string {
  return bound.measurementConsent && !gpc ? MEASUREMENT_CONSENT_GRANTED : MEASUREMENT_CONSENT_WITHHELD;
}

async function listSubject(
  store: LeadStore,
  provider: SocialProvider,
  sub: string,
): Promise<LeadRecord[] | undefined> {
  if (!store.listByProviderSubject) return undefined;
  try {
    return await store.listByProviderSubject(provider, sub);
  } catch (error) {
    if (error instanceof SocialAuthSchemaError) throw error;
    return undefined;
  }
}

export async function completeSocialIdentity(input: {
  provider: SocialProvider;
  claims: ProviderClaims;
  bound: SocialState;
  dependencies: ServiceDependencies;
  now: Date;
  relayReady: boolean;
  /** Disposable, headless, or network-blocked. Nothing is written. */
  blocked: boolean;
}): Promise<SocialFinish> {
  if (input.blocked) return "error";
  if (input.bound.provider !== input.provider) return "error";
  const store = input.dependencies.store;
  if (!store.listByProviderSubject || !store.attachProviderSubject || !store.markDuplicate) {
    return "error";
  }

  const sub = validSubject(input.claims.sub);
  if (!sub) return "error";

  try {
    const classified = classifyProviderClaims(input.provider, input.claims);
    if (!classified.ok) {
      if (classified.reason !== "no-email" || input.provider !== "apple") return "error";
      const peers = await listSubject(store, "apple", sub);
      if (!peers) return "error";
      const row = peers.filter((peer) => !peer.duplicate && peer.status !== "unsubscribed").sort((a, b) => createdMs(a) - createdMs(b))[0];
      if (!row) return "error";
      return alreadyVerified(row) ? "confirmed" : "error";
    }

    const identity = classified.identity;
    if (!identity.email || identity.sub !== sub) return "error";
    if (isDisposableEmail(identity.email)) return "error";

    const authoritative = identity.authoritative && !(identity.relay && !input.relayReady);
    const canonical = lookupCanonical(identity.email, identity.relay);
    const peers = await listSubject(store, identity.provider, identity.sub);
    if (!peers) return "error";
    // An unsubscribed subject must not be recreated under a new email.
    if (peers.some((peer) => peer.status === "unsubscribed")) return "error";
    const bySubject = peers.find((peer) => !peer.duplicate || alreadyVerified(peer));
    const byEmail = await store.findByEmail(canonical, identity.email);
    if (byEmail?.status === "unsubscribed") return "error";
    const emailUsable =
      byEmail && (!byEmail.duplicate || alreadyVerified(byEmail)) ? byEmail : undefined;
    const existing = bySubject ?? emailUsable;
    const externalGoogle = identity.provenance === "google:external-email";

    if (existing) {
      const current = subjectOf(existing, identity.provider);
      if (current && current !== identity.sub) return "error";
      if (alreadyVerified(existing)) {
        // A non-authoritative Google email does not prove this account owns
        // the existing verified address, so the subject stays unbound.
        if (!current && !externalGoogle) {
          const attached = await store.attachProviderSubject(
            existing.pageId,
            identity.provider,
            identity.sub,
            identity.provenance,
          );
          if (attached === "conflict") return "error";
        }
        return "confirmed";
      }
      if (externalGoogle) {
        const mailed = await sendSocialVerificationMail(
          existing,
          input.dependencies,
          input.now,
          input.bound.locale,
        );
        return mailed === "sent" ? "check-email" : "error";
      }
      if (!current) {
        const attached = await store.attachProviderSubject(
          existing.pageId,
          identity.provider,
          identity.sub,
          identity.provenance,
        );
        if (attached === "conflict") return "error";
      }
      if (!authoritative) return "pending";
      const fresh = await store.reread(existing.pageId);
      if (!fresh || fresh.duplicate || fresh.status === "unsubscribed") return "error";
      if (alreadyVerified(fresh)) return "confirmed";
      const outcome = await completeSocialVerification(
        fresh,
        input.dependencies,
        conversionContext(input.bound),
        input.now,
      );
      return outcome === "verified" || outcome === "already" ? "confirmed" : "error";
    }

    if (identity.provenance === "google:external-email") {
      await requestVerificationService(
        {
          email: identity.email,
          canonical,
          source: input.bound.source,
          ...(input.bound.referredBy ? { referredBy: input.bound.referredBy } : {}),
          flags: [],
          suspect: false,
          attribution: leadAttribution(input.bound),
          signupCountryProbe: input.bound.country,
          measurementConsent: input.bound.measurementConsent && !input.dependencies.gpc,
          ...(input.bound.measurementConsent && !input.dependencies.gpc && input.bound.fbc
            ? { metaFbc: input.bound.fbc }
            : {}),
          ...(input.bound.measurementConsent && !input.dependencies.gpc && input.bound.fbp
            ? { metaFbp: input.bound.fbp }
            : {}),
          locale: input.bound.locale,
          networkSendBlocked: false,
          ...(input.bound.experiment ? { experiment: input.bound.experiment } : {}),
          signupMethod: "google",
          googleSubject: identity.sub,
          authVerificationProvenance: identity.provenance,
          signupLocale: input.bound.locale,
          requireProviderSubject: true,
        },
        input.dependencies,
      );
      return "check-email";
    }

    const created = await store.createPending({
      email: identity.email,
      canonical,
      source: input.bound.source,
      refCode: mintRefCode(),
      ...(input.bound.referredBy ? { referredBy: input.bound.referredBy } : {}),
      flags: [],
      suspect: false,
      signedUpAt: input.now.toISOString(),
      leadId: (input.dependencies.leadId ?? newLeadId)(),
      expiresAt: new Date(input.now.getTime() + VERIFICATION_TTL_MS).toISOString(),
      attribution: leadAttribution(input.bound),
      signupCountry: observeSignupCountry({
        trustedVercel: input.bound.country.trustedVercel,
        header: input.bound.country.header,
        observedAt: input.now,
      }),
      measurementState: measurementState(input.bound, Boolean(input.dependencies.gpc)),
      ...(input.bound.measurementConsent && !input.dependencies.gpc && input.bound.fbc
        ? { metaFbc: input.bound.fbc }
        : {}),
      ...experimentFor(input.bound, Boolean(input.dependencies.gpc)),
      signupMethod: identity.provider,
      ...(identity.provider === "google"
        ? { googleSubject: identity.sub }
        : { appleSubject: identity.sub }),
      authVerificationProvenance: identity.provenance,
      signupLocale: input.bound.locale,
      requireProviderSubject: true,
    });
    return settleCreated(created, identity.provider, identity.sub, authoritative, input);
  } catch (error) {
    if (error instanceof SocialAuthSchemaError) return "error";
    return "error";
  }
}

function conversionContext(bound: SocialState): { fbp?: string; fbc?: string } {
  if (!bound.measurementConsent) return {};
  return {
    ...(bound.fbp ? { fbp: bound.fbp } : {}),
    ...(bound.fbc ? { fbc: bound.fbc } : {}),
  };
}

function leadAttribution(bound: SocialState) {
  const landingPath = signupLandingPath(
    bound.locale,
    bound.attribution.landingPath,
  );
  const fbclid =
    bound.attribution.fbclid && process.env.NOTION_FBCLID_PROPERTY?.trim()
      ? bound.attribution.fbclid
      : undefined;
  return {
    ...bound.attribution,
    landingPath,
    ...(fbclid ? { fbclid } : { fbclid: undefined }),
  };
}

function experimentFor(bound: SocialState, gpc: boolean) {
  const experiment = persistableExperimentContext(bound.experiment, {
    measurementConsent: bound.measurementConsent && !gpc,
    suspect: false,
    blocked: false,
  });
  return experiment ? { experiment } : {};
}

async function settleCreated(
  created: LeadRecord,
  provider: SocialProvider,
  sub: string,
  verify: boolean,
  input: {
    dependencies: ServiceDependencies;
    now: Date;
    bound: SocialState;
  },
): Promise<SocialFinish> {
  const store = input.dependencies.store;
  const peers = await listSubject(store, provider, sub);
  if (!peers) {
    await store.markDuplicate?.(created.pageId).catch(() => undefined);
    return "error";
  }
  const live = peers.filter((peer) => !peer.duplicate && peer.status !== "unsubscribed");
  const verifiedOther = live.find((peer) => peer.pageId !== created.pageId && alreadyVerified(peer));
  if (verifiedOther) {
    await store.markDuplicate?.(created.pageId);
    return "confirmed";
  }
  const winner = live.reduce<LeadRecord | undefined>(
    (best, peer) => (best ? earlier(best, peer) : peer),
    undefined,
  );
  if (!winner || winner.pageId !== created.pageId) {
    await store.markDuplicate?.(created.pageId);
    return "error";
  }
  if (!verify) return "pending";
  const fresh = await store.reread(created.pageId);
  if (!fresh || fresh.duplicate || fresh.status === "unsubscribed") return "error";
  if (alreadyVerified(fresh)) return "confirmed";
  const again = await listSubject(store, provider, sub);
  if (!again) return "error";
  const still = again.filter((peer) => !peer.duplicate && peer.status !== "unsubscribed");
  if (still.some((peer) => peer.pageId !== fresh.pageId && alreadyVerified(peer))) {
    await store.markDuplicate?.(fresh.pageId);
    return "confirmed";
  }
  const stillWinner = still.reduce<LeadRecord | undefined>(
    (best, peer) => (best ? earlier(best, peer) : peer),
    undefined,
  );
  if (!stillWinner || stillWinner.pageId !== fresh.pageId) {
    await store.markDuplicate?.(fresh.pageId);
    return "error";
  }
  const outcome = await completeSocialVerification(
    fresh,
    input.dependencies,
    conversionContext(input.bound),
    input.now,
  );
  return outcome === "verified" || outcome === "already" ? "confirmed" : "error";
}

export function isSocialLocale(value: string | undefined): value is Locale {
  return isLocale(value);
}
