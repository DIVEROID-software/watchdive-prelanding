import assert from "node:assert/strict";
import { test } from "node:test";

import {
  referralSecret,
  rulesUrl,
  shareUrl,
  signStatusToken,
  statusUrl,
  verifyStatusToken,
} from "../src/lib/referral/statusToken.ts";

const ENV = { WATCHDIVE_VERIFICATION_SECRET: "s".repeat(40) };
const SECRET = referralSecret(ENV);
const ORIGIN = "https://watchdive.test";

test("referralSecret derives a separate key and rejects a missing or short secret", () => {
  assert.notEqual(SECRET, ENV.WATCHDIVE_VERIFICATION_SECRET);
  assert.equal(referralSecret(ENV), SECRET);
  assert.notEqual(referralSecret({ WATCHDIVE_VERIFICATION_SECRET: "t".repeat(40) }), SECRET);
  assert.throws(() => referralSecret({}));
  assert.throws(() => referralSecret({ WATCHDIVE_VERIFICATION_SECRET: "short" }));
});

test("a token round-trips and is URL-safe", () => {
  const token = signStatusToken("ab12cd34", SECRET);
  assert.match(token, /^ab12cd34\.1\.[A-Za-z0-9_-]{24}$/);
  assert.equal(encodeURIComponent(token), token);
  assert.equal(token.includes("="), false);
  assert.equal(verifyStatusToken(token, SECRET), "ab12cd34");
});

test("tampered, re-targeted, wrong-secret and wrong-version tokens are refused", () => {
  const token = signStatusToken("ab12cd34", SECRET);
  const [code, version, mac] = token.split(".");
  const flipped = mac.slice(0, -1) + (mac.endsWith("A") ? "B" : "A");
  assert.equal(verifyStatusToken(`${code}.${version}.${flipped}`, SECRET), null);
  assert.equal(verifyStatusToken(`zz12cd34.${version}.${mac}`, SECRET), null);
  assert.equal(verifyStatusToken(`${code}.2.${mac}`, SECRET), null);
  assert.equal(verifyStatusToken(`${code}.${mac}`, SECRET), null);
  assert.equal(
    verifyStatusToken(token, referralSecret({ WATCHDIVE_VERIFICATION_SECRET: "t".repeat(40) })),
    null,
  );
  // The raw verification secret is not the status key.
  assert.equal(verifyStatusToken(token, ENV.WATCHDIVE_VERIFICATION_SECRET), null);
  assert.equal(verifyStatusToken(`${token}x`, SECRET), null);
  assert.equal(verifyStatusToken(token.toUpperCase(), SECRET), null);
  assert.equal(verifyStatusToken("", SECRET), null);
  assert.equal(verifyStatusToken(undefined, SECRET), null);
  assert.equal(verifyStatusToken(token, ""), null);
});

test("signing refuses anything but an 8-char lowercase code", () => {
  assert.throws(() => signStatusToken("AB12CD34", SECRET));
  assert.throws(() => signStatusToken("ab12cd3", SECRET));
  assert.throws(() => signStatusToken("ab12cd34", ""));
});

test("status and rules URLs are localized; the share link is the unprefixed /r path", () => {
  const token = signStatusToken("ab12cd34", SECRET);
  assert.equal(statusUrl(ORIGIN, "ab12cd34", "en", SECRET), `${ORIGIN}/buddy/${token}`);
  assert.equal(statusUrl(ORIGIN, "ab12cd34", "ko", SECRET), `${ORIGIN}/ko/buddy/${token}`);
  assert.equal(statusUrl(ORIGIN, "ab12cd34", "zh-TW", SECRET), `${ORIGIN}/zh-tw/buddy/${token}`);
  assert.equal(rulesUrl(ORIGIN, "en"), `${ORIGIN}/buddy-rules`);
  assert.equal(rulesUrl(ORIGIN, "pt-BR"), `${ORIGIN}/pt-br/buddy-rules`);
  assert.equal(shareUrl(ORIGIN, "ab12cd34"), `${ORIGIN}/r/ab12cd34`);
  assert.equal(shareUrl(ORIGIN, "ab12cd34").includes("="), false);
});
