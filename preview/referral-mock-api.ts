// Local Buddy Invite preview only (preview/referral.vite.config.ts). No fetch to
// Notion, Resend or any other service; every answer below is a fixed fixture.
// Vite aliases the two server-function modules to this file only under that
// serve-only config; production never imports it.
//
// Scenario selection, so one running server can show every state:
//   - switch:         __WD_PREVIEW_REFERRAL__ ("on" | "off"), fixed per server start
//   - status page:    the token in the path, e.g. /ko/buddy/tier3, /buddy/invalid
//   - landing card:   ?qaCredited=0|1|3|5|10|12 on the landing URL
//   - leaderboard:    ?qaBoard=three|empty|closed|long (answered by the config's middleware)
import { notFound } from "@tanstack/react-router";

import { GENERIC_PENDING_MESSAGE } from "../src/lib/verification/contracts";
import type { ReferralStatus } from "../src/lib/referral/contract";

declare const __WD_PREVIEW_REFERRAL__: string;
const ON = __WD_PREVIEW_REFERRAL__ === "on";
const HANDLE = "local-preview-attempt-not-a-real-credential";
const SHARE = "https://watchdive.diveroid.com/r/prev1ew0";

// ---- waitlist.functions -------------------------------------------------------

export async function joinWaitlist(_input: unknown) {
  return { ok: true, status: "pending" as const, handle: HANDLE, message: GENERIC_PENDING_MESSAGE };
}
export async function pollVerification(_input: unknown) {
  // The real form polls after ~8 s; answering "verified" at once shows the card then.
  return { status: "verified" as const, refCode: "prev1ew0" };
}
export async function confirmVerification(_input: unknown) {
  return { status: "verified" as const, refCode: "prev1ew0", ...(ON ? { statusToken: "verifycard" } : {}) };
}
export async function loadWaitlistCount() {
  return null;
}
export async function getWaitlistCount() {
  return { count: null };
}
export async function getReferralCount(_input: unknown) {
  return { count: qaCredited() };
}
export async function waitlistSignupOpen() {
  return true;
}
export async function getAcquisitionReadiness() {
  return { compatibility: true, push: { enabled: false } };
}
export async function savePhoneOptIn(_input: unknown) {
  return { status: "saved" };
}
export async function grantAttemptMeasurement(_input: unknown) {
  return { ok: true };
}
export const grantConfirmationMeasurement = grantAttemptMeasurement;
export const withdrawAttemptMeasurement = grantAttemptMeasurement;
export const withdrawConfirmationMeasurement = grantAttemptMeasurement;

// ---- referral.functions -------------------------------------------------------

function qaCredited(): number {
  if (typeof window === "undefined") return 0;
  const raw = new URL(window.location.href).searchParams.get("qaCredited");
  const n = Number(raw ?? "2");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
}

export async function getReferralProgramState() {
  return { enabled: ON };
}

export async function requireReferralProgram(): Promise<void> {
  if (!ON) throw notFound();
}

export const BUDDY_PAGE_META = [
  { name: "referrer", content: "no-referrer" },
  { name: "robots", content: "noindex, nofollow, noarchive" },
] as const;

export async function getReferralProgress(_input: unknown) {
  return ON ? { enabled: true as const, credited: qaCredited() } : { enabled: false as const };
}

export async function getMyShareCode(_input: unknown) {
  return ON ? { enabled: true as const, code: "REEF42" } : { enabled: false as const };
}

export async function claimShareCode(input: { data: { code: string } }) {
  const code = input.data.code.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    return { status: "rejected" as const, reason: "invalid_chars" as const };
  }
  return { status: "ok" as const, code, custom: true as const };
}

function statusFor(credited: number, extra: Partial<ReferralStatus> = {}): ReferralStatus {
  const tiers = [
    ["first", 1],
    ["buddy", 3],
    ["team", 5],
    ["leader", 10],
  ] as const;
  const held = tiers.filter(([, min]) => credited >= min);
  const next = tiers.find(([, min]) => credited < min) ?? null;
  const highest = held.length ? held[held.length - 1][0] : null;
  return {
    credited,
    highestTier: highest,
    nextTier: next ? next[0] : null,
    remainingToNext: next ? next[1] - credited : null,
    earlyNoticeHours: highest === null ? 0 : highest === "first" ? 1 : 2,
    lightEligible: credited >= 10,
    rank: credited === 0 ? null : Math.max(1, 40 - credited * 3),
    nickname: credited >= 3 ? "BlueFin" : null,
    leaderboard: credited >= 3,
    nicknameHidden: false,
    noticesOff: false,
    shareUrl: SHARE,
    closed: false,
    shareCode: "REEF42",
    shareCodeCustom: false,
    shareCodeLocked: false,
    ...extra,
  };
}

const STATUSES: Record<string, () => ReferralStatus> = {
  verifycard: () => statusFor(1, { noticesOff: true }),
  tier0: () => statusFor(0),
  tier1: () => statusFor(1),
  tier3: () => statusFor(3),
  tier5: () => statusFor(5),
  tier10: () => statusFor(10, { rank: 2 }),
  tier12: () => statusFor(12, { lightEligible: false, rank: 1 }),
  hidden: () => statusFor(4, { nickname: "BadName", nicknameHidden: true, leaderboard: true }),
  longnick: () => statusFor(7, { nickname: "가나다라마바사아자차카타파하가나" }),
  closed: () => statusFor(6, { closed: true }),
};

export async function getReferralStatus(input: { data: { token: string; locale: string } }) {
  const token = input.data.token;
  if (token === "loading") return new Promise<never>(() => {});
  if (token === "error") throw new Error("local preview: simulated failure");
  const make = STATUSES[token];
  if (!ON) return { status: "disabled" as const };
  return make ? { status: "ok" as const, referral: make() } : { status: "invalid" as const };
}

export async function updateReferralSettings(input: {
  data: { token: string; nickname: string | null; leaderboard: boolean; noticesOff: boolean };
}) {
  if (input.data.token === "verifycard" && input.data.noticesOff !== true) {
    throw new Error("local preview: verify card must preserve noticesOff");
  }
  await new Promise((r) => setTimeout(r, 400));
  const nickname = input.data.nickname?.trim().replace(/\s+/g, " ") ?? null;
  if (nickname && /@|https?:|www\./i.test(nickname))
    return { status: "rejected" as const, reason: "contact_info" as const };
  return {
    status: "ok" as const,
    settings: { nickname, leaderboard: input.data.leaderboard, noticesOff: input.data.noticesOff },
  };
}

export async function referralServiceDeps(): Promise<never> {
  throw new Error("local preview: no service dependencies");
}
