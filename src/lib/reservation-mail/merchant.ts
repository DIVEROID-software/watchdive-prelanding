// Verified sender. Companies House company 16343651.
// Source: https://find-and-update.company-information.service.gov.uk/company/16343651
// An omitted name or office uses these constants. A different shape-valid
// value is a conflict and is rejected. The supplied string is not echoed.

export const RESERVATION_LEGAL_NAME = "DIVEROID LTD";
export const RESERVATION_COMPANY_NUMBER = "16343651";
export const RESERVATION_REGISTERED_OFFICE =
  "Office 12146, 182-184 High Street North, East Ham, London, United Kingdom, E6 2JA";

export type ReservationMerchant = {
  legalName: string;
  postalAddress: string;
  companyNumber: string;
};

export type ReservationMerchantRead =
  | { ok: true; merchant: ReservationMerchant }
  | { ok: false; code: "invalid_input" | "merchant_identity_mismatch"; error: string };

function cleanPostal(value: string): string | undefined {
  if (!value) return undefined;
  if (value.length < 8 || value.length > 300 || /[\u0000-\u001f<>]/.test(value)) {
    throw new Error("--postal-address must be a single-line postal address");
  }
  return value;
}

function cleanLegalName(value: string): string | undefined {
  if (!value) return undefined;
  if (value.length < 2 || value.length > 120 || /[\u0000-\u001f<>]/.test(value)) {
    throw new Error("--legal-name must be a single-line legal name");
  }
  return value;
}

/** Empty or an exact match is accepted. A conflict does not quote the input. */
export function resolveReservationMerchant(
  legalName: string | undefined,
  postalAddress: string | undefined,
): { ok: true; merchant: ReservationMerchant } | { ok: false; error: string } {
  const name = legalName?.trim() ?? "";
  const office = postalAddress?.trim() ?? "";
  if (name && name !== RESERVATION_LEGAL_NAME) {
    return { ok: false, error: "legal name does not match the verified UK company" };
  }
  if (office && office !== RESERVATION_REGISTERED_OFFICE) {
    return {
      ok: false,
      error: "postal address does not match the registered office of company 16343651",
    };
  }
  return {
    ok: true,
    merchant: {
      legalName: RESERVATION_LEGAL_NAME,
      postalAddress: RESERVATION_REGISTERED_OFFICE,
      companyNumber: RESERVATION_COMPANY_NUMBER,
    },
  };
}

/**
 * Shape is checked before identity. A control character or angle bracket is
 * invalid input. A well-formed different company is a merchant mismatch.
 */
export function readReservationMerchant(
  legalName: string | undefined,
  postalAddress: string | undefined,
): ReservationMerchantRead {
  let name = "";
  let office = "";
  try {
    name = cleanLegalName(legalName?.trim() ?? "") ?? "";
    office = cleanPostal(postalAddress?.trim() ?? "") ?? "";
  } catch (error) {
    return {
      ok: false,
      code: "invalid_input",
      error: error instanceof Error ? error.message : "invalid input",
    };
  }
  const resolved = resolveReservationMerchant(name, office);
  if (!resolved.ok) return { ok: false, code: "merchant_identity_mismatch", error: resolved.error };
  return resolved;
}
