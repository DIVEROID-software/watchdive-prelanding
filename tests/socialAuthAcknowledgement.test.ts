import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSocialAcknowledgement, socialAckCookie, SOCIAL_ACK_COOKIE } from '../src/lib/socialAuthAcknowledgement.ts';

test('a pasted success URL without a callback receipt cannot claim completion', () => {
  for (const value of ['confirmed', 'Confirmed', null, 'error', 'pending', 'check-email']) {
    assert.equal(hasSocialAcknowledgement(value, ''), false);
  }
});
test('only the exact success callback and exact receipt value acknowledge completion', () => {
  assert.equal(hasSocialAcknowledgement('confirmed', `other=1; ${SOCIAL_ACK_COOKIE}=1`), true);
  for (const auth of [null, 'Confirmed', 'error', 'pending', 'check-email']) {
    assert.equal(hasSocialAcknowledgement(auth, `${SOCIAL_ACK_COOKIE}=1`), false);
  }
  for (const cookie of [`${SOCIAL_ACK_COOKIE}=0`, `${SOCIAL_ACK_COOKIE}=11`, `prefix${SOCIAL_ACK_COOKIE}=1`]) {
    assert.equal(hasSocialAcknowledgement('confirmed', cookie), false);
  }
});
test('callback receipt is secure host-only short-lived and can be consumed', () => {
  assert.match(socialAckCookie(true), /Max-Age=180/);
  assert.match(socialAckCookie(true), /Path=\/; Secure; SameSite=Lax/);
  assert.doesNotMatch(socialAckCookie(true), /Domain=/i);
  assert.match(socialAckCookie(false), /Max-Age=0/);
});
