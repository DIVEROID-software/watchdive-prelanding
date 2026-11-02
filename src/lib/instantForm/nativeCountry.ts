import { coerceSignupCountryObservation } from "../attribution.ts";
import {
  SIGNUP_COUNTRY_SOURCE_NATIVE_FORM,
  SIGNUP_COUNTRY_SOURCE_UNKNOWN,
  SIGNUP_COUNTRY_UNKNOWN,
  type SignupCountryObservation,
} from "../verification/contracts.ts";

/**
 * Country stored for a new native Instant Form row.
 *
 * `market` is the allowlisted form's market code. Locale, email domain, and
 * the ad set's targeting are not inputs. A Vercel observation is kept only
 * when it carries an ISO code. The default `unknown` observation is not a
 * country, so the form market is stored instead.
 */
export function signupCountryForNativeCreate(
  existing: SignupCountryObservation | undefined,
  market: string,
  observedAt: Date,
): SignupCountryObservation | undefined {
  const kept = existing ? coerceSignupCountryObservation(existing) : undefined;
  if (
    kept
    && kept.country !== SIGNUP_COUNTRY_UNKNOWN
    && kept.countrySource !== SIGNUP_COUNTRY_SOURCE_UNKNOWN
  ) {
    return kept;
  }
  const ms = observedAt.getTime();
  if (!Number.isFinite(ms)) return undefined;
  return coerceSignupCountryObservation({
    country: market,
    countrySource: SIGNUP_COUNTRY_SOURCE_NATIVE_FORM,
    countryObservedAt: new Date(ms).toISOString(),
  });
}
