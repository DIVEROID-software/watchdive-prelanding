import { z } from "zod";

const WITHDRAWAL_REQUEST_ID = /^pwr_v1_[A-Za-z0-9_-]{22,120}$/;
const FUNNEL_INSTANCE_ID = /^fi_v1_[A-Za-z0-9_-]{32}$/;

/**
 * Browser-to-server contract. It deliberately contains no attribution,
 * canonical lead identity, contact data, cookie value, or consent-authority
 * hash. The server binds the request to the current HttpOnly authority cookie.
 */
export const launchOsMeasurementWithdrawalSchema = z
  .object({
    requestId: z.string().regex(WITHDRAWAL_REQUEST_ID),
    funnelInstanceId: z.string().regex(FUNNEL_INSTANCE_ID),
    occurredAt: z.string().datetime({ offset: true }),
    reason: z.enum(["user_denied", "global_privacy_control"]),
  })
  .strict();

export type LaunchOsMeasurementWithdrawalInput = z.infer<
  typeof launchOsMeasurementWithdrawalSchema
>;

export type LaunchOsMeasurementWithdrawalResult = {
  accepted: boolean;
  status: "pending_purge" | "purged" | "failed" | "disabled" | "invalid";
  code: string;
  attempts: number;
  retryable: boolean;
  auditState: "not_recorded" | "tombstone_recorded" | "purge_completed";
  /** True while the same requestId must be retried with the withdrawal-only cookie. */
  retryPending: boolean;
  sourceSuppression: "complete" | "pending" | "not_started";
};

export function withdrawalResult(
  status: LaunchOsMeasurementWithdrawalResult["status"],
  code: string,
  attempts = 0,
  retryable = false,
): LaunchOsMeasurementWithdrawalResult {
  return {
    accepted: status === "pending_purge" || status === "purged",
    status,
    code,
    attempts,
    retryable,
    auditState:
      status === "purged"
        ? "purge_completed"
        : status === "pending_purge"
          ? "tombstone_recorded"
          : "not_recorded",
    retryPending: false,
    sourceSuppression: "not_started",
  };
}
