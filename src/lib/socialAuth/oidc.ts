// Authorization-code + PKCE + ID token checks via oauth4webapi.
// Signature verification is a separate library call and is required here.
// Tokens are not returned and are not logged.

import * as oauth from "oauth4webapi";

import { appleClientSecret } from "./appleSecret.ts";
import type { ProviderClaims } from "./claims.ts";
import {
  APPLE_ISSUER,
  GOOGLE_ISSUER,
  googleClient,
  type SocialEnv,
  type SocialProvider,
} from "./config.ts";

export class SocialTokenRejected extends Error {
  constructor() {
    super("social_token_rejected");
    this.name = "SocialTokenRejected";
  }
}

function authorizationServer(provider: SocialProvider): oauth.AuthorizationServer {
  if (provider === "google") {
    return {
      issuer: GOOGLE_ISSUER,
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      id_token_signing_alg_values_supported: ["RS256"],
    };
  }
  return {
    issuer: APPLE_ISSUER,
    authorization_endpoint: "https://appleid.apple.com/auth/authorize",
    token_endpoint: "https://appleid.apple.com/auth/token",
    jwks_uri: "https://appleid.apple.com/auth/keys",
    id_token_signing_alg_values_supported: ["RS256"],
  };
}

export async function authorizationUrl(input: {
  provider: SocialProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
}): Promise<string> {
  const challenge = await oauth.calculatePKCECodeChallenge(input.verifier);
  const endpoint =
    input.provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : "https://appleid.apple.com/auth/authorize";
  const url = new URL(endpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", input.provider === "apple" ? "code id_token" : "code");
  url.searchParams.set("scope", input.provider === "google" ? "openid email" : "name email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.provider === "apple") url.searchParams.set("response_mode", "form_post");
  if (input.provider === "google") url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeAuthorizationCode(input: {
  provider: SocialProvider;
  env: SocialEnv;
  code: string;
  /** State value the provider returned. */
  oauthState: string;
  /** State value from the signed browser cookie. These must not be the same variable at the call site. */
  expectedState: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<ProviderClaims> {
  const as = authorizationServer(input.provider);
  const clientId =
    input.provider === "google"
      ? googleClient(input.env)?.clientId
      : input.env.APPLE_CLIENT_ID?.trim();
  if (!clientId) throw new SocialTokenRejected();
  const client: oauth.Client = {
    client_id: clientId,
    id_token_signed_response_alg: "RS256",
  };
  let clientSecret: string;
  try {
    clientSecret =
      input.provider === "google"
        ? (googleClient(input.env)?.clientSecret ?? "")
        : await appleClientSecret(input.env);
  } catch {
    throw new SocialTokenRejected();
  }
  if (!clientSecret) throw new SocialTokenRejected();
  const transport = input.fetchImpl ? { [oauth.customFetch]: input.fetchImpl } : {};
  try {
    const parameters = oauth.validateAuthResponse(
      as,
      client,
      new URLSearchParams({ code: input.code, state: input.oauthState }),
      input.expectedState,
    );
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.ClientSecretPost(clientSecret),
      parameters,
      input.redirectUri,
      input.verifier,
      transport,
    );
    const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
      expectedNonce: input.nonce,
      requireIdToken: true,
      maxAge: oauth.skipAuthTimeCheck,
    });
    await oauth.validateApplicationLevelSignature(as, response, transport);
    const claims = oauth.getValidatedIdTokenClaims(result);
    if (!claims?.sub) throw new SocialTokenRejected();
    return {
      sub: claims.sub,
      email: claims.email,
      email_verified: claims.email_verified,
      hd: claims.hd,
      is_private_email: claims.is_private_email,
    };
  } catch (error) {
    if (error instanceof SocialTokenRejected) throw error;
    throw new SocialTokenRejected();
  }
}
