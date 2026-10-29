import type { LeadRecord } from "../../verification/contracts.ts";

export const NATIVE_ONE_MAIL_SKIP = "native_one_mail";

/**
 * Native consent is one confirmation mail. The 24h reminder must not treat
 * that row as a website signup. Source is already read back onto LeadRecord.
 * Acquisition path is checked when a reader has attached it.
 */
export function nativeOneMailExcluded(record: {
  source?: string;
  acquisitionPath?: string;
}): boolean {
  return record.source === "instant-form" || record.acquisitionPath === "instant_form";
}

const PROBE_AT = Date.parse("2026-10-29T12:00:00.000Z");

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

export function reminderExclusionInstalled(
  skip: (record: LeadRecord, nowMs: number) => string | undefined,
): boolean {
  const native = skip(nativeReminderProbe("instant-form"), PROBE_AT);
  const website = skip(nativeReminderProbe("hero"), PROBE_AT);
  return native === NATIVE_ONE_MAIL_SKIP && website !== NATIVE_ONE_MAIL_SKIP;
}
