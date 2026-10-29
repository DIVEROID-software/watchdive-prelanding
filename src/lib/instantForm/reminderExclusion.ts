import type { LeadRecord } from "../verification/contracts.ts";

export const NATIVE_ONE_MAIL_SKIP = "native_one_mail";

/**
 * One native confirmation is the whole consent. Source is the field the
 * current Notion reader returns. Acquisition path is not parsed back onto
 * LeadRecord, so a reminder or drip check must not depend on it.
 */
export function nativeOneMailExcluded(record: {
  source?: string;
  acquisitionPath?: string;
}): boolean {
  return record.source === "instant-form" || record.acquisitionPath === "instant_form";
}

const PROBE_AT = Date.parse("2026-10-30T00:00:00.000Z");

export function nativeReminderProbe(source: string): LeadRecord {
  return {
    pageId: "probe-page",
    email: "probe@example.com",
    status: "pending",
    emailVerified: false,
    refCode: "probe",
    source,
    suspect: false,
    flags: [],
    phone: "",
    leadId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
    metaEventId: "",
    sends: 1,
    sentAt: new Date(PROBE_AT - 25 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(PROBE_AT + 60 * 60 * 1000).toISOString(),
  };
}
