// Social signup configuration. Flags are exact "true" only.
// The request Host header is never an origin. Callers pass the request URL.

export const SOCIAL_PRODUCTION_ORIGIN = "https://watchdive.diveroid.com";

export const GOOGLE_ISSUER = "https://accounts.google.com";
export const APPLE_ISSUER = "https://appleid.apple.com";

export const SOCIAL_PROVIDERS = ["google", "apple"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export type SocialEnv = Record<string, string | undefined>;

const ENABLED = "true";

export function flagEnabled(value: string | undefined): boolean {
  return value === ENABLED;
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 400) return undefined;
  return trimmed;
}

export function socialAuthSecret(env: SocialEnv): string | undefined {
  const value = env.WATCHDIVE_SOCIAL_AUTH_SECRET ?? "";
  if (Buffer.byteLength(value, "utf8") < 32) return undefined;
  return value;
}

export function googleConfigured(env: SocialEnv): boolean {
  return (
    flagEnabled(env.WATCHDIVE_GOOGLE_AUTH_ENABLED) &&
    Boolean(nonempty(env.GOOGLE_CLIENT_ID)) &&
    Boolean(nonempty(env.GOOGLE_CLIENT_SECRET)) &&
    Boolean(socialAuthSecret(env))
  );
}

export function appleConfigured(env: SocialEnv): boolean {
  return (
    flagEnabled(env.WATCHDIVE_APPLE_AUTH_ENABLED) &&
    Boolean(nonempty(env.APPLE_CLIENT_ID)) &&
    Boolean(nonempty(env.APPLE_TEAM_ID)) &&
    Boolean(nonempty(env.APPLE_KEY_ID)) &&
    Boolean(env.APPLE_PRIVATE_KEY?.trim()) &&
    Boolean(socialAuthSecret(env))
  );
}

export function providerConfigured(env: SocialEnv, provider: SocialProvider): boolean {
  return provider === "google" ? googleConfigured(env) : appleConfigured(env);
}

/** Relay mail stays unverified until root records that Apple accepted the sender. */
export function appleRelayMailReady(env: SocialEnv): boolean {
  return flagEnabled(env.WATCHDIVE_APPLE_RELAY_MAIL_READY);
}

export function googleClient(env: SocialEnv): { clientId: string; clientSecret: string } | undefined {
  if (!googleConfigured(env)) return undefined;
  return {
    clientId: nonempty(env.GOOGLE_CLIENT_ID) as string,
    clientSecret: nonempty(env.GOOGLE_CLIENT_SECRET) as string,
  };
}

export function appleClient(env: SocialEnv):
  | {
      clientId: string;
      teamId: string;
      keyId: string;
      privateKey: string;
    }
  | undefined {
  if (!appleConfigured(env)) return undefined;
  return {
    clientId: nonempty(env.APPLE_CLIENT_ID) as string,
    teamId: nonempty(env.APPLE_TEAM_ID) as string,
    keyId: nonempty(env.APPLE_KEY_ID) as string,
    privateKey: env.APPLE_PRIVATE_KEY?.trim() as string,
  };
}

/**
 * Production is always allowed. Anything else, including loopback, must be
 * listed exactly in WATCHDIVE_SOCIAL_CALLBACK_ORIGINS. No wildcard and no
 * forwarded-host header.
 */
export function isAllowedSocialOrigin(origin: string, env: SocialEnv): boolean {
  if (origin === SOCIAL_PRODUCTION_ORIGIN) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.username || url.password) return false;
  const extras = (env.WATCHDIVE_SOCIAL_CALLBACK_ORIGINS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return extras.includes(origin);
}

export function socialRedirectUri(origin: string, provider: SocialProvider): string {
  return `${origin}/api/auth/${provider}/callback`;
}
