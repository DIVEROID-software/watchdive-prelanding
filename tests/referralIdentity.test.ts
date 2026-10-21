import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { referralIdentityKey as key } from "../src/lib/referral/identity.ts";

test("Gmail: dots and +tags fold, googlemail.com is gmail.com", () => {
  assert.equal(key("J.Doe+Buddy@Gmail.com"), "jdoe@gmail.com");
  assert.equal(key(" j.d.o.e@googlemail.com "), "jdoe@gmail.com");
  assert.equal(key("jdoe@gmail.com."), "jdoe@gmail.com");
});

test("Apple: icloud.com, me.com and mac.com are one mailbox per user name", () => {
  assert.equal(key("Reef@me.com"), "reef@icloud.com");
  assert.equal(key("reef@mac.com"), "reef@icloud.com");
  assert.equal(key("reef@icloud.com"), "reef@icloud.com");
  // No documented plus addressing or dot folding for iCloud.
  assert.equal(key("re.ef+x@icloud.com"), "re.ef+x@icloud.com");
});

test("Proton: +tags fold, domains and dots stay", () => {
  assert.equal(key("sea+shop@proton.me"), "sea@proton.me");
  assert.equal(key("s.ea+x@protonmail.com"), "s.ea@protonmail.com");
  assert.equal(key("sea+x@pm.me"), "sea@pm.me");
  assert.notEqual(key("sea@pm.me"), key("sea@proton.me"));
});

test("Fastmail: +tags and one-level subdomain addressing fold", () => {
  assert.equal(key("kim+dive@fastmail.com"), "kim@fastmail.com");
  assert.equal(key("anything@kim.fastmail.com"), "kim@fastmail.com");
  assert.equal(key("x@a.b.fastmail.com"), "x@a.b.fastmail.com");
});

test("undocumented providers are left alone apart from case and trim", () => {
  assert.equal(key("Sea+X@Outlook.com"), "sea+x@outlook.com");
  assert.equal(key("s.ea@hotmail.com"), "s.ea@hotmail.com");
  assert.equal(key("kim-shop@yahoo.com"), "kim-shop@yahoo.com");
  assert.equal(key("kim@hanmail.net"), "kim@hanmail.net");
  assert.notEqual(key("kim@hanmail.net"), key("kim@daum.net"));
  assert.equal(key("k.i.m+a@naver.com"), "k.i.m+a@naver.com");
  assert.equal(key("Kim@Example.COM"), "kim@example.com");
});

test("a +tag alone is not stripped to an empty mailbox; junk passes through", () => {
  assert.equal(key("+x@gmail.com"), "+x@gmail.com");
  assert.equal(key("not-an-email"), "not-an-email");
  assert.equal(key("@gmail.com"), "@gmail.com");
  assert.equal(key(undefined as unknown as string), "");
});

test("signup canonicalization is unchanged by the referral key", () => {
  // The stored `Canonical email` still strips +tags on every domain.
  assert.equal(canonicalEmail("Sea+X@Outlook.com"), "sea@outlook.com");
  assert.equal(canonicalEmail("reef@me.com"), "reef@me.com");
  assert.equal(canonicalEmail("J.Doe+x@googlemail.com"), "jdoe@gmail.com");
});
