import type { Locale } from "../lib/i18n/locale.ts";
import { normalizePhone } from "../lib/phoneNumbers.ts";
import type { PhoneCredential, PhoneOptInInput, PhoneOptInResult } from "../lib/verification/phoneOptIn.ts";

export type InitialPhoneDraft = {
  phone: string;
  country?: string;
  consent: boolean;
  locale: Locale;
};

export type InitialPhoneSave = (input: PhoneOptInInput) => Promise<PhoneOptInResult>;

/** Completion follows the save result. A filled checkbox is not a result. */
export type InitialPhoneOutcome =
  | { action: "skipped"; completed: false; retry: false }
  | { action: "saved"; completed: true; retry: false; status: "accepted" | "saved" }
  | {
      action: "retry";
      completed: false;
      retry: true;
      status: PhoneOptInResult["status"] | "failed";
    };

const skipped = { action: "skipped", completed: false, retry: false } as const;

/**
 * A number may leave the browser only with an explicit consent and a
 * normalizable phone. Anything else is not sent and not saved.
 */
export function consentedPhone(draft: Pick<InitialPhoneDraft, "phone" | "country" | "consent">): string | null {
  if (draft.consent !== true) return null;
  if (!draft.phone.trim()) return null;
  return normalizePhone(draft.phone, draft.country);
}

/**
 * Records versioned SMS consent through the authenticated phone service.
 * Never throws: a failed save must not fail the email signup that already landed.
 * `accepted` and `saved` are the only completion signals.
 */
export async function recordInitialPhoneConsent(
  draft: InitialPhoneDraft,
  credential: PhoneCredential | null,
  save: InitialPhoneSave,
): Promise<InitialPhoneOutcome> {
  const phone = consentedPhone(draft);
  if (!phone || !credential?.value) return skipped;
  try {
    const result = await save({
      credential,
      phone,
      country: draft.country,
      consent: true,
      locale: draft.locale,
    });
    if (result.status === "accepted" || result.status === "saved") {
      return { action: "saved", completed: true, retry: false, status: result.status };
    }
    return { action: "retry", completed: false, retry: true, status: result.status };
  } catch {
    return { action: "retry", completed: false, retry: true, status: "failed" };
  }
}

/** The retry form is prefilled only after a consented save failed. A success hides it. */
export function phoneRetryDraft(
  draft: { phone: string; country: string; consent: boolean },
  retry: boolean,
  completed: boolean,
): { phone: string; country: string; consent: true; unsuccessful: true } | undefined {
  if (completed || !retry || draft.consent !== true || !draft.phone.trim()) return undefined;
  return { phone: draft.phone, country: draft.country, consent: true, unsuccessful: true };
}
