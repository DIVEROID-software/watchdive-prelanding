// Names only. This module never reads a credential value and never opens a
// network connection. WATCHDIVE_SENDER_PHONE is the Korean email footer, not
// an SMS transport.

export const EMAIL_FOOTER_PHONE_ENV = "WATCHDIVE_SENDER_PHONE";

/** Env names that would identify a real SMS account. None is implemented here. */
export const SMS_TRANSPORT_ENV_NAMES = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM",
  "INFOBIP_API_KEY",
  "INFOBIP_BASE_URL",
  "INFOBIP_SENDER",
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET",
  "SOLAPI_SENDER",
  "COOLSMS_API_KEY",
  "COOLSMS_API_SECRET",
  "NCP_SENS_ACCESS_KEY",
  "NCP_SENS_SECRET_KEY",
  "NCP_SENS_SERVICE_ID",
  "ALIGO_API_KEY",
  "ALIGO_USER_ID",
  "ALIGO_SENDER",
  "VONAGE_API_KEY",
  "VONAGE_API_SECRET",
  "VONAGE_FROM",
  "MESSAGEBIRD_ACCESS_KEY",
  "PLIVO_AUTH_ID",
  "PLIVO_AUTH_TOKEN",
  "TELNYX_API_KEY",
  "TELNYX_FROM",
  "AWS_SNS_ACCESS_KEY_ID",
  "AWS_SNS_SECRET_ACCESS_KEY",
  "AWS_SNS_REGION",
  "SMS_PROVIDER",
  "SMS_API_KEY",
  "SMS_API_SECRET",
  "SMS_FROM",
] as const;

export type SmsTransportName = (typeof SMS_TRANSPORT_ENV_NAMES)[number];

export type SmsTransportInspection = {
  transport: "none" | "named_but_not_implemented";
  recognizedTransportNames: SmsTransportName[];
  emailFooterPhoneKeyPresent: boolean;
  adapterImplemented: false;
};

export function inspectSmsTransport(envNames: readonly string[]): SmsTransportInspection {
  const present = new Set(envNames);
  const recognizedTransportNames = SMS_TRANSPORT_ENV_NAMES.filter((name) => present.has(name));
  return {
    transport: recognizedTransportNames.length > 0 ? "named_but_not_implemented" : "none",
    recognizedTransportNames,
    emailFooterPhoneKeyPresent: present.has(EMAIL_FOOTER_PHONE_ENV),
    adapterImplemented: false,
  };
}
