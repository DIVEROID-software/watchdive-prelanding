// Provider claim rules. The ID token is already signature-checked before this.
// A client profile or the unsigned Apple `user` form field never reaches here.

import type { SocialProvider } from "./config.ts";

const SUBJECT = /^[A-Za-z0-9._-]{1,255}$/;
const EMAIL = /^[^\s@]{1,64}@[A-Za-z0-9.-]{1,253}$/;

export type ProviderClaims = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  is_private_email?: unknown;
};

export type ClassifiedIdentity = {
  provider: SocialProvider;
  sub: string;
  email?: string;
  authoritative: boolean;
  /** True when Apple's signed claim or a dedicated relay domain says so. */
  relay: boolean;
  provenance: string;
};

export type ClaimRejection = { ok: false; reason: "invalid" | "unverified" | "no-email" };

function verifiedFlag(value: unknown): boolean {
  return value === true || value === "true";
}

function privateRelayFlag(value: unknown): boolean {
  return value === true || value === "true";
}

export function validSubject(value: unknown): string | undefined {
  if (typeof value !== "string" || !SUBJECT.test(value)) return undefined;
  return value;
}

export function validEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  for (let index = 0; index < email.length; index += 1) {
    if (email.charCodeAt(index) < 0x20) return undefined;
  }
  if (email.length > 254 || !EMAIL.test(email) || email.includes("..")) return undefined;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!domain.includes(".")) return undefined;
  return email;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/** Dedicated relay domains. `@icloud.com` alone is not one of them. */
export function isDocumentedRelayDomain(email: string): boolean {
  const domain = domainOf(email);
  return domain === "privaterelay.appleid.com" || domain === "private.icloud.com";
}

export function classifyProviderClaims(
  provider: SocialProvider,
  claims: ProviderClaims,
): { ok: true; identity: ClassifiedIdentity } | ClaimRejection {
  const sub = validSubject(claims.sub);
  if (!sub) return { ok: false, reason: "invalid" };

  if (provider === "apple" && (claims.email === undefined || claims.email === "")) {
    return { ok: false, reason: "no-email" };
  }

  const email = validEmail(claims.email);
  if (!email) return { ok: false, reason: "invalid" };
  if (!verifiedFlag(claims.email_verified)) return { ok: false, reason: "unverified" };

  if (provider === "google") {
    const domain = domainOf(email);
    const hd = typeof claims.hd === "string" ? claims.hd.trim().toLowerCase() : "";
    if (domain === "gmail.com" || domain === "googlemail.com") {
      return {
        ok: true,
        identity: {
          provider,
          sub,
          email,
          authoritative: true,
          relay: false,
          provenance: "google:gmail",
        },
      };
    }
    if (hd && hd === domain) {
      return {
        ok: true,
        identity: {
          provider,
          sub,
          email,
          authoritative: true,
          relay: false,
          provenance: "google:workspace-hd",
        },
      };
    }
    return {
      ok: true,
      identity: {
        provider,
        sub,
        email,
        authoritative: false,
        relay: false,
        provenance: "google:external-email",
      },
    };
  }

  const relay = privateRelayFlag(claims.is_private_email) || isDocumentedRelayDomain(email);
  return {
    ok: true,
    identity: {
      provider,
      sub,
      email,
      authoritative: true,
      relay,
      provenance: relay ? "apple:private-relay" : "apple:verified-email",
    },
  };
}
