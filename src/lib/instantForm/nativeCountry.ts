import { coerceSignupCountryObservation } from "../attribution.ts";
import {
  SIGNUP_COUNTRY_SOURCE_NATIVE_FORM,
  type SignupCountryObservation,
} from "../verification/contracts.ts";

/**
 * Country stored for a new native Instant Form row.
 *
 * `market` is the allowlisted form's market code. Locale, email domain, and
 * the ad set's targeting are not inputs. An existing trusted observation is
 * left as it arrived so a later Vercel probe is not replaced by the form.
 */
export function signupCountryForNativeCreate(
  existing: SignupCountryObservation | undefined,
  market: string,
  observedAt: Date,
): SignupCountryObservation | undefined {
  if (existing) return coerceSignupCountryObservation(existing);
  const ms = observedAt.getTime();
  if (!Number.isFinite(ms)) return undefined;
  return coerceSignupCountryObservation({
    country: market,
    countrySource: SIGNUP_COUNTRY_SOURCE_NATIVE_FORM,
    countryObservedAt: new Date(ms).toISOString(),
  });
}
