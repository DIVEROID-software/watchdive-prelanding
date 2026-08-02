import { createServerFn } from "@tanstack/react-start";

import {
  launchOsMeasurementWithdrawalSchema,
  withdrawalResult,
} from "./launchOsWithdrawal.contract.ts";

export {
  launchOsMeasurementWithdrawalSchema,
  type LaunchOsMeasurementWithdrawalInput,
  type LaunchOsMeasurementWithdrawalResult,
} from "./launchOsWithdrawal.contract.ts";

/** Client-safe shell; the secret-bearing HMAC implementation stays server-only. */
export const requestLaunchOsMeasurementWithdrawal = createServerFn({ method: "POST" })
  .validator(launchOsMeasurementWithdrawalSchema)
  .handler(async ({ data }) => {
    try {
      const { withdrawLaunchOsMeasurementFromCurrentRequest } =
        await import("./launchOsWithdrawal.server.ts");
      return await withdrawLaunchOsMeasurementFromCurrentRequest(data);
    } catch {
      return withdrawalResult("invalid", "WITHDRAWAL_REQUEST_CONTEXT_UNAVAILABLE");
    }
  });
