// Reads the real handler, invite helper, contract, tick, and plist.
// It does not start a server, send mail, or install launchd.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function text(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the frozen reservation contract matches the real handler and mail link", () => {
  const contract = text("docs/reservation-contract.md");
  const handlers = text("src/lib/reservation/handlers.ts");
  const invite = text("src/lib/reservation/invite.ts");
  const mail = text("src/lib/reservation-mail/inviteLink.ts");

  assert.match(contract, /"acceptedTerms": true/);
  assert.match(contract, /"termsVersion": "2026-10-18"/);
  assert.match(contract, /Authorization: Bearer/);
  assert.match(contract, /reservation\?lang=ko#invite=/);
  assert.match(contract, /`en`, `ko`, `zh-CN`, `zh-TW`, `ja`, `es`, `fr`, `de`, or `pt-BR`/);
  assert.match(contract, /\/ko\/reservation` does not exist/);
  assert.match(contract, /issueReservationInvite/);
  assert.match(contract, /amountRefundPending/);
  assert.match(contract, /duplicatePaid/);
  assert.match(contract, /"source": "stripe"/);

  assert.match(handlers, /acceptedTerms !== true/);
  assert.match(handlers, /termsVersion !== TERMS_VERSION/);
  assert.match(handlers, /missing_bearer/);
  assert.match(handlers, /amountRefundPending: snapshot.amountRefundPending/);
  assert.match(handlers, /duplicatePaid: snapshot.duplicatePaid/);
  assert.match(handlers, /source: snapshot.source/);
  assert.match(invite, /export function issueReservationInvite/);
  assert.equal(invite.includes("export function createReservationInviteToken"), false);
  assert.match(mail, /RESERVATION_INVITE_FRAGMENT = "invite"/);
  assert.match(mail, /issueReservationInvite/);
  assert.equal(mail.includes('RESERVATION_INVITE_QUERY = "token"'), false);
});

test("the tick and launchd template stay gated and uninstalled", () => {
  const tick = text("scripts/reservation-mail-tick.sh");
  const plist = text(
    "docs/reservation-mail-operations/com.diveroid.watchdive-reservation-mail.plist",
  );
  assert.match(tick, /wd-reservation-invite-v1/);
  assert.match(tick, /lock held; nothing sent/);
  assert.match(tick, /send-enabled/);
  assert.match(tick, /reservation-mail\/receipts|RECEIPTS/);
  assert.equal(tick.includes("launchctl"), false);
  assert.match(plist, /com\.diveroid\.watchdive-reservation-mail/);
  assert.match(plist, /<key>Disabled<\/key>\s*<true\/>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>30<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.equal(/\bexec\b/.test(tick), false);
  assert.match(tick, /trap cleanup EXIT/);
  assert.equal(plist.includes("launchctl"), false);
  assert.equal(plist.includes("RESEND_API_KEY"), false);
  assert.equal(plist.includes("WATCHDIVE_RESERVATION_TOKEN_SECRET"), false);
});
