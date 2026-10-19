// Apple client secret: a short ES256 JWT. The private key never leaves this function.

import { importPKCS8, SignJWT } from "jose";

import type { SocialEnv } from "./config.ts";
import { appleClient } from "./config.ts";

export function normalizeApplePrivateKey(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (!trimmed.includes("BEGIN PRIVATE KEY")) {
    throw new Error("apple_key_shape");
  }
  return trimmed;
}

export async function appleClientSecret(env: SocialEnv, now = new Date()): Promise<string> {
  const client = appleClient(env);
  if (!client) throw new Error("apple_unconfigured");
  const key = await importPKCS8(normalizeApplePrivateKey(client.privateKey), "ES256");
  const issued = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: client.keyId, typ: "JWT" })
    .setIssuer(client.teamId)
    .setSubject(client.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(issued)
    .setExpirationTime(issued + 300)
    .sign(key);
}
