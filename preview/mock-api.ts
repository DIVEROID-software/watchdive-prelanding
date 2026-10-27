// Local preview only. No fetch, persistent email storage, CRM, mail or Stripe.
// Vite aliases these boundaries only for preview:reservation; production never imports this file.
import { GENERIC_PENDING_MESSAGE } from "../src/lib/verification/contracts";
const HANDLE = "local-preview-attempt-not-a-real-credential";
let pending = false;
let verified = false;
let phoneSaveAttempts = 0;
export function previewState() { return {pending, verified}; }
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event("wd:local-preview-state")); }
export function previewVerify() { if (pending) { verified = true; changed(); } }
export async function joinWaitlist(_input: unknown) {
  pending = true; verified = false; phoneSaveAttempts = 0; changed();
  return {ok:true, status:"pending" as const, handle:HANDLE, message:GENERIC_PENDING_MESSAGE};
}
export async function pollVerification(_input: unknown) {
  // Wait for the explicit preview control, instead of pretending a real inbox was verified.
  if (!verified) await new Promise<void>(resolve => {
    const done = () => { if (verified) { window.removeEventListener("wd:local-preview-state", done); resolve(); } };
    window.addEventListener("wd:local-preview-state", done);
  });
  return {status:"verified" as const, refCode:"preview"};
}
export async function confirmVerification(_input: unknown) { verified=true; changed(); return {status:"verified",refCode:"preview"}; }
export async function loadWaitlistCount() { return null; }
export async function getWaitlistCount() { return {count:null}; }
export async function getReferralCount(_input: unknown) { return {count:0}; }
export async function waitlistSignupOpen() { return true; }
export async function savePhoneOptIn(_input: unknown) {
  phoneSaveAttempts += 1;
  const scenario = typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("qaPhoneSave");
  if (scenario === "retry-once" && phoneSaveAttempts === 1) return {status:"retry"};
  return {status:"saved"};
}
export async function grantAttemptMeasurement(_input: unknown) { return {ok:true}; }
export const grantConfirmationMeasurement = grantAttemptMeasurement;
export const withdrawAttemptMeasurement = grantAttemptMeasurement;
export const withdrawConfirmationMeasurement = grantAttemptMeasurement;
export async function getOnsiteReservation(input: {data:{locale:string;credential?:{kind:string;value:string}}}) {
  // Current main requires authoritative email verification before the bridge.
  // This fixture issues only a visibly fake verified credential.
  const socialFixture = typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("qaSocial") === "verified" &&
    input.data.credential?.value === "local-preview-social-confirmation-not-a-real-token";
  if (!verified && !socialFixture) return {status:"verification_required" as const};
  const token = "v1.local_preview_only.not_a_real_signed_invite";
  return {status:"ready" as const, mode: "verified" as const,
    href:`/reservation?lang=${encodeURIComponent(input.data.locale)}#invite=${token}`};
}

// UI preparation only: compatibility requests are never sent or stored outside memory.
export async function getAcquisitionReadiness() { return { compatibility: true, push: { enabled: false } }; }
