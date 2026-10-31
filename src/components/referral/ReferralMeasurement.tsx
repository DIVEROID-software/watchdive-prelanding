import { useEffect } from "react";

import { bindReferralMeasurement } from "@/lib/referral/measurement";

/**
 * Document scanner for referral and price-path measurement.
 * Root mounts one instance. The component renders nothing and does not
 * change layout. UI hooks stay on the existing elements.
 */
export function ReferralMeasurement() {
  useEffect(() => bindReferralMeasurement(), []);
  return null;
}
