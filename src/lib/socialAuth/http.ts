import { socialAckCookie } from "../socialAuthAcknowledgement.ts";
// HTTP entry points for Google and Apple signup.
// Routes stay thin. This module does not import the server-only dependency
// graph, so node tests can call it with fakes. No token or address is logged.

import { createNetworkGate, type NetworkGate } from "../verification/networkGate.ts";
import { firstIp, isHeadlessUA } from "../api/abuse.ts";
import { readSignupCountryProbe, sanitizeSignupAttribution, toLeadAttribution } from "../attribution.ts";
import { sanitizePressRef } from "../press/pressAttribution.server.ts";
import { experimentContextSchema } from "../conversionExperimentContract.ts";
import { homePath, isLocale, type Locale } from "../i18n/locale.ts";
import type { ServiceDependencies } from "../verification/service.ts";
import { networkKey } from "../verification/token.ts";
import { classifyEmbeddedBrowser } from "../socialSignupCopy.ts";
import { completeSocialIdentity, type SocialFinish } from "./complete.ts";
import {
  appleClient,
  googleClient,
  isAllowedSocialOrigin,
  providerConfigured,
  socialAuthSecret,
  socialRedirectUri,
  type SocialEnv,
  type SocialProvider,
} from "./config.ts";
import { authorizationUrl, exchangeAuthorizationCode, SocialTokenRejected } from "./oidc.ts";
import {
  clearSocialStateCookie,
  consumeJti,
  newSocialState,
  readRequestCookie,
  readSocialState,
  issueSocialStateCookie,
  signSocialState,
  SOCIAL_STATE_COOKIE,
  type SocialState,
} from "./state.ts";

const META_COOKIE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_.-]{1,200}$/;
const moduleGate = createNetworkGate();

export type SocialHttpDependencies = {
  env: SocialEnv;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  serviceDependencies?: ServiceDependencies;
  /** Fail closed when omitted: a route that forgot the cap check cannot create rows. */
  isClosed?: () => Promise<boolean>;
  log?: (line: string) => void;
  networkGate?: NetworkGate;
};

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return classifyEmbeddedBrowser(userAgent).blocksGoogle;
}

/** A start POST may set a cookie only for the page's own origin. */
function browserPostAllowed(request: Request, origin: string): boolean {
  const header = request.headers.get("origin");
  if (!header || header !== origin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (!site) return true;
  return site === "same-origin" || site === "none";
}

function finishUrl(origin: string, locale: Locale, auth: SocialFinish | "open-browser"): string {
  const url = new URL(homePath(locale), origin);
  url.search = "";
  url.hash = "";
  url.searchParams.set("auth", auth);
  return url.toString();
}

function noStore(headers: Headers): Headers {
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return headers;
}

function redirectFinish(
  origin: string,
  locale: Locale,
  auth: SocialFinish | "open-browser",
): Response {
  const headers = noStore(new Headers());
  headers.set("Location", finishUrl(origin, locale, auth));
  headers.append("Set-Cookie", clearSocialStateCookie());
  headers.append("Set-Cookie", socialAckCookie(auth === "confirmed"));
  return new Response(null, { status: 303, headers });
}

function plainReject(): Response {
  return new Response("rejected", {
    status: 400,
    headers: noStore(new Headers()),
  });
}

function requestOrigin(request: Request, env: SocialEnv): string | undefined {
  try {
    const origin = new URL(request.url).origin;
    return isAllowedSocialOrigin(origin, env) ? origin : undefined;
  } catch {
    return undefined;
  }
}

function json(body: unknown, status: number): Response {
  const headers = noStore(new Headers());
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleSocialProviders(
  _request: Request,
  dependencies: SocialHttpDependencies,
): Promise<Response> {
  return json(
    {
      google: providerConfigured(dependencies.env, "google"),
      apple: providerConfigured(dependencies.env, "apple"),
    },
    200,
  );
}

export async function handleSocialStart(
  request: Request,
  dependencies: SocialHttpDependencies,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const env = dependencies.env;
  const origin = requestOrigin(request, env);
  const secret = socialAuthSecret(env);
  if (!origin || !secret || !browserPostAllowed(request, origin)) return json({ error: "origin" }, 400);

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 8000) return json({ error: "body" }, 400);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "body" }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "body" }, 400);
  }

  const provider = body.provider === "google" || body.provider === "apple" ? body.provider : undefined;
  const source = body.source === "hero" || body.source === "offer" ? body.source : undefined;
  if (!provider || !source || !isLocale(body.locale)) return json({ error: "body" }, 400);
  if (!providerConfigured(env, provider)) return json({ error: "disabled" }, 404);

  const userAgent = request.headers.get("user-agent");
  if (provider === "google" && isInAppBrowser(userAgent)) {
    return json({ error: "in_app_browser" }, 409);
  }
  if (isHeadlessUA(userAgent)) return json({ error: "rejected" }, 400);

  const closed = dependencies.isClosed ? await dependencies.isClosed().catch(() => true) : true;
  if (closed) return json({ error: "closed" }, 403);

  const gate = dependencies.networkGate ?? moduleGate;
  const ip = firstIp(request.headers.get("x-forwarded-for"));
  const verdict = gate.record(networkKey(ip, secret));
  if (verdict.blocked) return json({ error: "limited" }, 429);

  const gpc = request.headers.get("sec-gpc") === "1";
  const measurementConsent = body.measurementConsent === true && !gpc;
  const sanitized = sanitizeSignupAttribution(
    body.attribution && typeof body.attribution === "object"
      ? (body.attribution as Record<string, unknown>)
      : undefined,
  );
  const experiment = experimentContextSchema.safeParse(body.experiment);
  const referredBy =
    typeof body.referredBy === "string"
      ? body.referredBy.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)
      : "";
  const fbp = measurementConsent && typeof body.fbp === "string" && META_COOKIE.test(body.fbp) ? body.fbp : undefined;
  const fbc = measurementConsent && typeof body.fbc === "string" && META_COOKIE.test(body.fbc) ? body.fbc : undefined;
  // Survives the provider round trip inside the signed state; malformed = dropped.
  const pressRef = sanitizePressRef(body.pressRef);
  const now = (dependencies.now ?? (() => new Date()))();
  const state = newSocialState(
    {
      provider,
      source,
      locale: body.locale,
      origin,
      attribution: {
        ...toLeadAttribution(sanitized),
        ...(sanitized.fbclid ? { fbclid: sanitized.fbclid } : {}),
      },
      measurementConsent,
      ...(measurementConsent && experiment.success ? { experiment: experiment.data } : {}),
      country: readSignupCountryProbe({
        vercelEnv: env.VERCEL,
        readHeader: () => request.headers.get("x-vercel-ip-country"),
      }),
      ...(fbp ? { fbp } : {}),
      ...(fbc ? { fbc } : {}),
      ...(referredBy ? { referredBy } : {}),
      ...(pressRef ? { pressRef } : {}),
    },
    now.getTime(),
  );
  const clientId = provider === "google" ? googleClient(env)?.clientId : appleClient(env)?.clientId;
  if (!clientId) return json({ error: "disabled" }, 404);
  const url = await authorizationUrl({
    provider,
    clientId,
    redirectUri: socialRedirectUri(origin, provider),
    state: state.state,
    nonce: state.nonce,
    verifier: state.verifier,
  });
  const setCookie = issueSocialStateCookie(signSocialState(state, secret));
  if (!setCookie) return json({ error: "state" }, 400);
  const headers = noStore(new Headers());
  headers.set("Content-Type", "application/json");
  headers.set("Set-Cookie", setCookie);
  return new Response(JSON.stringify({ url }), { status: 200, headers });
}

function readBound(
  request: Request,
  env: SocialEnv,
  provider: SocialProvider,
  nowMs: number,
): SocialState | undefined {
  const secret = socialAuthSecret(env);
  if (!secret) return undefined;
  const token = readRequestCookie(request.headers.get("cookie"), SOCIAL_STATE_COOKIE);
  const bound = readSocialState(token, secret, env, nowMs);
  if (!bound || bound.provider !== provider) return undefined;
  const origin = requestOrigin(request, env);
  if (!origin || origin !== bound.origin) return undefined;
  return bound;
}

function oauthState(value: string | null): string | undefined {
  if (!value || value.length > 128 || /[:/?\\]/.test(value)) return undefined;
  return value;
}

function authorizationCode(value: string | null): string | undefined {
  if (!value || value.length > 2048 || /[\s&]/.test(value)) return undefined;
  return value;
}

async function finishCallback(
  request: Request,
  provider: SocialProvider,
  code: string | undefined,
  oauth: string | undefined,
  providerError: string | null | undefined,
  formIdToken: string | undefined,
  dependencies: SocialHttpDependencies,
): Promise<Response> {
  const env = dependencies.env;
  const now = (dependencies.now ?? (() => new Date()))();
  const bound = readBound(request, env, provider, now.getTime());
  if (!bound || !oauth || bound.state !== oauth) {
    return bound ? redirectFinish(bound.origin, bound.locale, "error") : plainReject();
  }
  if (!consumeJti(bound.jti, bound.exp * 1000, now.getTime())) {
    return redirectFinish(bound.origin, bound.locale, "error");
  }
  if (providerError === "disallowed_useragent" || (provider === "google" && isInAppBrowser(request.headers.get("user-agent")))) {
    return redirectFinish(bound.origin, bound.locale, "open-browser");
  }
  if (providerError || !code || !providerConfigured(env, provider) || isHeadlessUA(request.headers.get("user-agent"))) {
    return redirectFinish(bound.origin, bound.locale, "error");
  }
  const secret = socialAuthSecret(env);
  const gate = dependencies.networkGate ?? moduleGate;
  if (!secret || gate.record(networkKey(firstIp(request.headers.get("x-forwarded-for")), secret)).blocked) {
    return redirectFinish(bound.origin, bound.locale, "error");
  }
  if (!dependencies.serviceDependencies) return redirectFinish(bound.origin, bound.locale, "error");

  let claims;
  try {
    claims = await exchangeAuthorizationCode({
      provider,
      env,
      code,
      oauthState: oauth,
      expectedState: bound.state,
      verifier: bound.verifier,
      nonce: bound.nonce,
      redirectUri: socialRedirectUri(bound.origin, provider),
      ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    });
  } catch (error) {
    if (error instanceof SocialTokenRejected) dependencies.log?.("social_token_rejected");
    else dependencies.log?.("social_token_rejected");
    return redirectFinish(bound.origin, bound.locale, "error");
  }
  if (formIdToken && unverifiedSub(formIdToken) !== claims.sub) {
    return redirectFinish(bound.origin, bound.locale, "error");
  }
  const gpc = request.headers.get("sec-gpc") === "1" || dependencies.serviceDependencies.gpc === true;
  const finish = await completeSocialIdentity({
    provider,
    claims,
    bound,
    dependencies: gpc ? { ...dependencies.serviceDependencies, gpc: true } : dependencies.serviceDependencies,
    now,
    relayReady: env.WATCHDIVE_APPLE_RELAY_MAIL_READY === "true",
    blocked: false,
  });
  return redirectFinish(bound.origin, bound.locale, finish);
}

function unverifiedSub(jwt: string): string | undefined {
  const parts = jwt.split(".");
  if (parts.length !== 3 || parts[1].length > 8192) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

export async function handleGoogleCallback(
  request: Request,
  dependencies: SocialHttpDependencies,
): Promise<Response> {
  if (request.method !== "GET") return plainReject();
  const url = new URL(request.url);
  return finishCallback(
    request,
    "google",
    authorizationCode(url.searchParams.get("code")),
    oauthState(url.searchParams.get("state")),
    url.searchParams.get("error"),
    undefined,
    dependencies,
  );
}

export async function handleAppleCallback(
  request: Request,
  dependencies: SocialHttpDependencies,
): Promise<Response> {
  if (request.method !== "POST") return plainReject();
  const text = await request.text();
  if (text.length > 16_000) return plainReject();
  const form = new URLSearchParams(text);
  return finishCallback(
    request,
    "apple",
    authorizationCode(form.get("code")),
    oauthState(form.get("state")),
    form.get("error"),
    form.get("id_token") ?? undefined,
    dependencies,
  );
}
