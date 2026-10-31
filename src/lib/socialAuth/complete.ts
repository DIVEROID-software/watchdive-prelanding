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
import { socialContinuationAllowed } from "./continuation.ts";
import {
  completeSocialVerification,
  reportPressNow,
  requestVerificationService,
  sendSocialVerificationMail,
  type ServiceDependencies,
} from "../verification/service.ts";
import { noteStageSignup } from "../stageScore/observe.ts";
import { PRESS_SYNC_PENDING, pressOutboxFor } from "../press/pressAttribution.server.ts";
import { newLeadId, requireSecret } from "../verification/token.ts";
import { measureSocialSignup } from "../retargeting/apply.ts";
import type { BrowserRetargetingEvent } from "../retargeting/events.ts";
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
  const leftKey = pageKey(left.pageId);
  const rightKey = pageKey(right.pageId);
  if (leftKey === rightKey) return left;
  return leftKey < rightKey ? left : right;
}

/** Notion page ids are UUIDs. A dashed and an undashed form are one page. */
function pageKey(pageId: string): string {
  return pageId.replace(/-/g, "").toLowerCase();
}

function samePage(left: string, right: string): boolean {
  return pageKey(left) === pageKey(right);
}

/**
 * A subject query that has not indexed the page just written is not evidence
 * of another signup. The row we created stays in the candidate set. A query
 * that already contains that page, in either id spelling, is left as it is.
 */
function peersIncludingCreated(created: LeadRecord, peers: LeadRecord[]): LeadRecord[] {
  if (peers.some((peer) => samePage(peer.pageId, created.pageId))) return peers;
  return [created, ...peers];
}

function otherSubjectRows(self: LeadRecord, peers: LeadRecord[]): LeadRecord[] {
  return peers.filter((peer) => !samePage(peer.pageId, self.pageId));
}

/**
 * A subject that already opted out must not gain a verified row when that
 * opt-out was missing from the lookup that decided to create. A query that
 * contains only duplicate rows is the same kind of gap: filtering those rows
 * out is not an empty index.
 */
async function closedSubject(
  store: LeadStore,
  self: LeadRecord,
  peers: LeadRecord[],
): Promise<boolean> {
  const others = otherSubjectRows(self, peers);
  const optedOut = others.some((peer) => peer.status === "unsubscribed");
  const onlyDuplicates =
    others.length > 0 &&
    others.every((peer) => peer.duplicate) &&
    !peers.some((peer) => samePage(peer.pageId, self.pageId));
  if (!optedOut && !onlyDuplicates) return false;
  await retireDuplicate(store, self.pageId);
  return true;
}

/**
 * A real second row should be marked Duplicate. A database that rejects that
 * checkbox is a controlled finish: the new row stays unverified, and the
 * callback must not become an HTTP 500. Any other write failure still throws.
 */
async function retireDuplicate(store: LeadStore, pageId: string): Promise<void> {
  try {
    await store.markDuplicate?.(pageId);
  } catch (error) {
    if (error instanceof SocialAuthSchemaError) return;
    throw error;
  }
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

export type SocialContinuationSink = {
  leadId?: string;
  /** Browser events for this finish. Never put these on the redirect URL. */
  measurement?: BrowserRetargetingEvent[];
};

async function rememberContinuation(
  store: LeadStore,
  pageId: string,
  provider: SocialProvider,
  sub: string,
  grant: SocialContinuationSink | undefined,
): Promise<void> {
  if (!grant) return;
  try {
    const fresh = await store.reread(pageId);
    const leadId = socialContinuationAllowed(fresh, provider, sub);
    if (leadId) grant.leadId = leadId;
  } catch {
    // The presentation redirect still finishes. No phone or reservation grant.
  }
}

export async function completeSocialIdentity(
  input: {
    provider: SocialProvider;
    claims: ProviderClaims;
    bound: SocialState;
    dependencies: ServiceDependencies;
    now: Date;
    relayReady: boolean;
    /** Disposable, headless, or network-blocked. Nothing is written. */
    blocked: boolean;
  },
  grant?: SocialContinuationSink,
): Promise<SocialFinish> {
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
      if (!alreadyVerified(row)) return "error";
      await rememberContinuation(store, row.pageId, "apple", sub, grant);
      return "confirmed";
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
        if (current || !externalGoogle) {
          await rememberContinuation(store, existing.pageId, identity.provider, identity.sub, grant);
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
      if (alreadyVerified(fresh)) {
        await rememberContinuation(store, fresh.pageId, identity.provider, identity.sub, grant);
        return "confirmed";
      }
      const outcome = await completeSocialVerification(
        fresh,
        input.dependencies,
        conversionContext(input.bound),
        input.now,
      );
      if (outcome !== "verified" && outcome !== "already") return "error";
      if (outcome === "verified") {
        const measured = await store.reread(fresh.pageId).catch(() => undefined);
        if (measured) {
          await rememberSocialMeasurement(grant, measured, false, true, input.dependencies, input.bound, input.now);
        }
      }
      await rememberContinuation(store, fresh.pageId, identity.provider, identity.sub, grant);
      return "confirmed";
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
          attribution: leadAttribution(input.bound, Boolean(input.dependencies.gpc)),
          signupCountryProbe: input.bound.country,
          measurementConsent: input.bound.measurementConsent && !input.dependencies.gpc,
          googleClientId: input.bound.googleClientId,
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
          // Held on the row until the mailed link verifies the address.
          ...(input.bound.pressRef ? { pressRef: input.bound.pressRef } : {}),
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
      attribution: leadAttribution(input.bound, Boolean(input.dependencies.gpc)),
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
      ...socialPressOutbox(input.bound, canonical, input.now),
    });
    if (process.env.WATCHDIVE_STAGE_SCORE_INTEGRATION === "enabled") {
      await noteStageSignup({
        email: identity.email,
        at: input.now.toISOString(),
        source: "oauth",
        measurementCell: measurementState(input.bound, Boolean(input.dependencies.gpc)),
        suspect: false,
        suppressed: false,
        phonePresent: false,
      });
    }
    return await settleCreated(created, identity.provider, identity.sub, authoritative, input, grant);
  } catch (error) {
    if (error instanceof SocialAuthSchemaError) return "error";
    return "error";
  }
}

/** A social lead write from a press link owes an "accepted" report (CONTRACT §3). */
function socialPressOutbox(bound: SocialState, canonical: string, now: Date): { pressOutbox?: string; pressSync?: string } {
  const pressOutbox = pressOutboxFor({ pressRef: bound.pressRef, canonical, signedUpAt: now.toISOString(), flagged: false });
  return pressOutbox ? { pressOutbox, pressSync: PRESS_SYNC_PENDING } : {};
}

function conversionContext(bound: SocialState): {
  fbp?: string;
  fbc?: string;
  googleClientId?: string;
} {
  if (!bound.measurementConsent) return {};
  return {
    ...(bound.googleClientId ? { googleClientId: bound.googleClientId } : {}),
    ...(bound.fbp ? { fbp: bound.fbp } : {}),
    ...(bound.fbc ? { fbc: bound.fbc } : {}),
  };
}

function leadAttribution(bound: SocialState, gpc: boolean) {
  const landingPath = signupLandingPath(
    bound.locale,
    bound.attribution.landingPath,
  );
  const fbclid =
    !gpc &&
    bound.measurementConsent &&
    bound.attribution.fbclid &&
    process.env.NOTION_FBCLID_PROPERTY?.trim()
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
  grant: SocialContinuationSink | undefined,
): Promise<SocialFinish> {
  const store = input.dependencies.store;
  const peers = await listSubject(store, provider, sub);
  if (!peers) {
    // The query failed. Do not treat the missing list as an empty one, and
    // do not verify. Marking the new row is best effort.
    await store.markDuplicate?.(created.pageId).catch(() => undefined);
    return "error";
  }
  if (await closedSubject(store, created, peers)) return "error";
  const live = peersIncludingCreated(created, peers).filter(
    (peer) => !peer.duplicate && peer.status !== "unsubscribed",
  );
  const verifiedOther = live.find((peer) => !samePage(peer.pageId, created.pageId) && alreadyVerified(peer));
  if (verifiedOther) {
    await retireDuplicate(store, created.pageId);
    await rememberContinuation(store, verifiedOther.pageId, provider, sub, grant);
    return "confirmed";
  }
  const winner = live.reduce<LeadRecord | undefined>(
    (best, peer) => (best ? earlier(best, peer) : peer),
    undefined,
  );
  if (!winner || !samePage(winner.pageId, created.pageId)) {
    await retireDuplicate(store, created.pageId);
    return "error";
  }
  if (!verify) {
    // The lead is written without a verified address: a completed signup, not a confirmed one.
    await reportPressNow(input.dependencies, "accepted", created, input.now);
    const measured = await store.reread(created.pageId).catch(() => undefined);
    if (measured) {
      await rememberSocialMeasurement(grant, measured, true, false, input.dependencies, input.bound, input.now);
    }
    return "pending";
  }
  const fresh = await store.reread(created.pageId);
  if (!fresh || fresh.duplicate || fresh.status === "unsubscribed") return "error";
  if (alreadyVerified(fresh)) {
    await rememberContinuation(store, fresh.pageId, provider, sub, grant);
    return "confirmed";
  }
  const again = await listSubject(store, provider, sub);
  if (!again) return "error";
  if (await closedSubject(store, fresh, again)) return "error";
  const still = peersIncludingCreated(fresh, again).filter(
    (peer) => !peer.duplicate && peer.status !== "unsubscribed",
  );
  const verifiedPeer = still.find((peer) => !samePage(peer.pageId, fresh.pageId) && alreadyVerified(peer));
  if (verifiedPeer) {
    await retireDuplicate(store, fresh.pageId);
    await rememberContinuation(store, verifiedPeer.pageId, provider, sub, grant);
    return "confirmed";
  }
  const stillWinner = still.reduce<LeadRecord | undefined>(
    (best, peer) => (best ? earlier(best, peer) : peer),
    undefined,
  );
  if (!stillWinner || !samePage(stillWinner.pageId, fresh.pageId)) {
    await retireDuplicate(store, fresh.pageId);
    return "error";
  }
  const outcome = await completeSocialVerification(
    fresh,
    input.dependencies,
    conversionContext(input.bound),
    input.now,
  );
  if (outcome !== "verified" && outcome !== "already") return "error";
  if (outcome === "verified") {
    const measured = await store.reread(fresh.pageId).catch(() => undefined);
    if (measured) {
      await rememberSocialMeasurement(grant, measured, true, true, input.dependencies, input.bound, input.now);
    }
  }
  await rememberContinuation(store, fresh.pageId, provider, sub, grant);
  return "confirmed";
}

async function rememberSocialMeasurement(
  grant: SocialContinuationSink | undefined,
  row: LeadRecord,
  rowCreated: boolean,
  verifiedNow: boolean,
  dependencies: ServiceDependencies,
  bound: SocialState,
  now: Date,
): Promise<void> {
  if (!grant) return;
  try {
    const secret = requireSecret(dependencies.env ?? {});
    const source = row.signupMethod === "google" || row.signupMethod === "apple"
      ? row.signupMethod
      : row.source;
    const events = await measureSocialSignup({
      row,
      rowCreated,
      verifiedNow,
      secret,
      gpc: dependencies.gpc === true,
      source,
      landingPath: bound.attribution.landingPath,
      fbp: bound.fbp,
      fbc: bound.fbc ?? row.metaFbc,
      nowSeconds: Math.floor(now.getTime() / 1000),
    });
    if (events.length) grant.measurement = events;
  } catch {
    // The redirect still finishes. No event id is added to the URL.
  }
}

export function isSocialLocale(value: string | undefined): value is Locale {
  return isLocale(value);
}
