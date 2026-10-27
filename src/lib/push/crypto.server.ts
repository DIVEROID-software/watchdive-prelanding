import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { importJWK, SignJWT } from "jose";

const REST_SALT = Buffer.from("watchdive-push-rest-v1");
const REST_INFO = Buffer.from("aes-256-gcm");

export type WebPushKeys = {
  uaPublicKey: Buffer;
  authSecret: Buffer;
  asPublicKey: Buffer;
  asPrivateKey: Buffer;
  salt: Buffer;
};

/** RFC 8291 aes128gcm body, including the 86-byte content-coding header. */
export function encryptWebPushMessage(plaintext: Buffer, keys: WebPushKeys): Buffer {
  if (
    keys.uaPublicKey.length !== 65 ||
    keys.uaPublicKey[0] !== 4 ||
    keys.asPublicKey.length !== 65 ||
    keys.asPublicKey[0] !== 4 ||
    keys.asPrivateKey.length !== 32 ||
    keys.authSecret.length !== 16 ||
    keys.salt.length !== 16
  ) {
    throw new Error("push_encryption_key");
  }
  const agreement = createECDH("prime256v1");
  agreement.setPrivateKey(keys.asPrivateKey);
  const shared = agreement.computeSecret(keys.uaPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    keys.uaPublicKey,
    keys.asPublicKey,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, keys.authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, keys.salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, keys.salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([keys.salt, recordSize, Buffer.from([65]), keys.asPublicKey, encrypted]);
}

/** Receiver-side RFC 8291 decrypt. The user-agent private key never leaves this check. */
export function decryptWebPushMessage(
  body: Buffer,
  uaPrivateKey: Buffer,
  authSecret: Buffer,
): Buffer {
  if (uaPrivateKey.length !== 32 || authSecret.length !== 16 || body.length < 86) {
    throw new Error("push_encryption_key");
  }
  const idLength = body[20];
  if (body.readUInt32BE(16) < 18 || idLength !== 65 || body[21] !== 4) {
    throw new Error("push_body");
  }
  const asPublicKey = body.subarray(21, 86);
  const encrypted = body.subarray(86);
  if (encrypted.length < 17) throw new Error("push_body");
  const agreement = createECDH("prime256v1");
  agreement.setPrivateKey(uaPrivateKey);
  const uaPublicKey = pad(agreement.getPublicKey(null, "uncompressed"), 65);
  const shared = agreement.computeSecret(asPublicKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublicKey, asPublicKey]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const salt = body.subarray(0, 16);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16)),
    Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12)),
  );
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const record = Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ]);
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end -= 1;
  if (end < 1 || record[end - 1] !== 2) throw new Error("push_body");
  return record.subarray(0, end - 1);
}

export function generateEphemeralWebPushKey(): { publicKey: Buffer; privateKey: Buffer } {
  const agreement = createECDH("prime256v1");
  agreement.generateKeys();
  return {
    publicKey: pad(agreement.getPublicKey(null, "uncompressed"), 65),
    privateKey: pad(agreement.getPrivateKey(), 32),
  };
}

function pad(value: Buffer, length: number): Buffer {
  if (value.length === length) return value;
  if (value.length > length) throw new Error("push_encryption_key");
  return Buffer.concat([Buffer.alloc(length - value.length), value]);
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const agreement = createECDH("prime256v1");
  agreement.generateKeys();
  return {
    publicKey: pad(agreement.getPublicKey(null, "uncompressed"), 65).toString("base64url"),
    privateKey: pad(agreement.getPrivateKey(), 32).toString("base64url"),
  };
}

export async function vapidAuthorization(input: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
  expiration: number;
}): Promise<string> {
  const publicBytes = Buffer.from(input.publicKey, "base64url");
  const privateBytes = Buffer.from(input.privateKey, "base64url");
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
    throw new Error("push_vapid_key");
  }
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: privateBytes.toString("base64url"),
    x: publicBytes.subarray(1, 33).toString("base64url"),
    y: publicBytes.subarray(33, 65).toString("base64url"),
  };
  const key = await importJWK(jwk, "ES256");
  const token = await new SignJWT({
    aud: input.audience,
    exp: input.expiration,
    sub: input.subject,
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .sign(key);
  return `vapid t=${token}, k=${input.publicKey}`;
}

type RestPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
};

function restKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("push_encryption_secret");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), REST_SALT, REST_INFO, 32));
}

/** AES-256-GCM bound to the stable subscription id. The endpoint never sits in a property. */
export function encryptSubscription(secret: string, id: string, payload: RestPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", restKey(secret), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSubscription(secret: string, id: string, packed: string): RestPayload {
  const parts = packed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("push_ciphertext");
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0)
    throw new Error("push_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", restKey(secret), iv);
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(json) as Partial<RestPayload>;
  if (
    typeof parsed.endpoint !== "string" ||
    typeof parsed.p256dh !== "string" ||
    typeof parsed.auth !== "string" ||
    !(parsed.expirationTime === null || typeof parsed.expirationTime === "number")
  ) {
    throw new Error("push_ciphertext");
  }
  return {
    endpoint: parsed.endpoint,
    p256dh: parsed.p256dh,
    auth: parsed.auth,
    expirationTime: parsed.expirationTime,
  };
}
