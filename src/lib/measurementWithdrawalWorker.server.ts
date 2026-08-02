import {
  launchOsMeasurementWithdrawalSchema,
  type LaunchOsMeasurementWithdrawalInput,
} from "./api/launchOsWithdrawal.contract.ts";

const ADAPTER_KEY = /^[a-z][a-z0-9_:-]{1,39}$/;
const MAX_ADAPTERS = 8;
const MAX_ATTEMPTS = 2;

export type ExternalMeasurementSuppressionState =
  "suppressed" | "not_found" | "retryable_failure" | "terminal_failure";

export type ExternalMeasurementSuppressionAdapter = {
  /** A non-personal system identifier such as `notion_waitlist`. */
  key: string;
  suppress: (input: LaunchOsMeasurementWithdrawalInput) => Promise<{
    state: ExternalMeasurementSuppressionState;
    /** Controlled code only; never include names, email, phone, or opaque IDs. */
    auditCode: string;
  }>;
};

export type ExternalMeasurementSuppressionRun = {
  allSettled: boolean;
  configuredAdapters: number;
  results: ReadonlyArray<{
    adapter: string;
    state: ExternalMeasurementSuppressionState;
    auditCode: string;
    attempts: number;
  }>;
};

function validAuditCode(value: string) {
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value);
}

/**
 * Bounded, dependency-injected seam for source-system suppression. No real
 * Notion/email-provider adapter is registered here: activation must provide a
 * reviewed adapter and durable scheduler. Therefore this helper is executable
 * in tests without falsely claiming an upstream purge exists.
 */
export async function runBoundedExternalMeasurementSuppression(
  input: LaunchOsMeasurementWithdrawalInput,
  adapters: readonly ExternalMeasurementSuppressionAdapter[],
  dependencies: { sleep?: (delayMs: number) => Promise<void> } = {},
): Promise<ExternalMeasurementSuppressionRun> {
  const parsed = launchOsMeasurementWithdrawalSchema.safeParse(input);
  if (
    !parsed.success ||
    adapters.length > MAX_ADAPTERS ||
    adapters.some((adapter) => !ADAPTER_KEY.test(adapter.key)) ||
    new Set(adapters.map((adapter) => adapter.key)).size !== adapters.length
  ) {
    throw new TypeError("External measurement suppression input is invalid.");
  }
  const sleep =
    dependencies.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Awaited<ReturnType<typeof adapter.suppress>>;
        try {
          response = await adapter.suppress(parsed.data);
        } catch {
          response = { state: "retryable_failure", auditCode: "ADAPTER_TRANSPORT_FAILED" };
        }
        if (!validAuditCode(response.auditCode)) {
          return {
            adapter: adapter.key,
            state: "terminal_failure" as const,
            auditCode: "ADAPTER_AUDIT_CODE_INVALID",
            attempts: attempt,
          };
        }
        if (response.state !== "retryable_failure" || attempt === MAX_ATTEMPTS) {
          return { adapter: adapter.key, ...response, attempts: attempt };
        }
        await sleep(150 * attempt);
      }
      return {
        adapter: adapter.key,
        state: "terminal_failure" as const,
        auditCode: "ADAPTER_ATTEMPTS_EXHAUSTED",
        attempts: MAX_ATTEMPTS,
      };
    }),
  );
  return {
    allSettled:
      results.length > 0 &&
      results.every((result) => result.state === "suppressed" || result.state === "not_found"),
    configuredAdapters: adapters.length,
    results: Object.freeze(results.map((result) => Object.freeze(result))),
  };
}
