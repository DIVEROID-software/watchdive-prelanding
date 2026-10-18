// Reservation inbox identity. The waitlist canonicalizer is not under test here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalEmail } from "../src/lib/api/abuse.ts";
import { reservationCanonicalEmail } from "../src/lib/reservation/emailIdentity.ts";
import { issueReservationInvite, verifyReservationInvite } from "../src/lib/reservation/invite.ts";

const SECRET = "reservation-token-secret-32bytes-min!!";
const LEAD = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-18T04:00:00.000Z");

test("only Gmail and googlemail.com collapse plus-tags, dots, and the domain", () => {
  assert.equal(reservationCanonicalEmail("  A.B+left@gmail.com "), "ab@gmail.com");
  assert.equal(reservationCanonicalEmail("a.b+x@googlemail.com"), "ab@gmail.com");
  assert.equal(reservationCanonicalEmail("Diver+tag@example.com"), "diver+tag@example.com");
  assert.equal(reservationCanonicalEmail("a.b@example.com"), "a.b@example.com");
  assert.notEqual(reservationCanonicalEmail("a.b@example.com"), reservationCanonicalEmail("ab@example.com"));
  assert.equal(reservationCanonicalEmail("a.b+c@something.gmail.com"), "a.b+c@something.gmail.com");
  assert.equal(reservationCanonicalEmail("ab+tag@googlemail.co.uk"), "ab+tag@googlemail.co.uk");
  assert.equal(reservationCanonicalEmail("+tag@gmail.com"), "@gmail.com");
  assert.equal(canonicalEmail("diver+tag@example.com"), "diver@example.com");
  assert.notEqual(
    reservationCanonicalEmail("diver+tag@example.com"),
    canonicalEmail("diver+tag@example.com"),
  );
});

test("a non-Gmail plus address is its own invite identity", () => {
  const token = issueReservationInvite({
    leadId: LEAD,
    email: "Diver+tag@example.com",
    emailVerified: true,
    expiresAtMs: NOW + 60_000,
    secret: SECRET,
    nowMs: NOW,
  });
  assert.equal(verifyReservationInvite(token, SECRET, NOW)?.email, "diver+tag@example.com");
  assert.throws(
    () =>
      issueReservationInvite({
        leadId: LEAD,
        email: "+tag@gmail.com",
        emailVerified: true,
        expiresAtMs: NOW + 60_000,
        secret: SECRET,
        nowMs: NOW,
      }),
    /Invalid email/,
  );
});
