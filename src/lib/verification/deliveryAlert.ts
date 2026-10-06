// Operator alerts for confirmation mail that never left.
//
// When the provider fails, the visitor still sees "check your inbox" (the
// generic response is deliberate — see service.ts), so without an alert an
// outage silently burns paid leads. This module turns those failures into a
// Slack message.
//
// Two rules shape everything here:
//
//   1. No personal data. An alert is built only from counts, a time window and
//      the fixed failure class from `classifyDeliveryFailure` — never from an
//      error message, a recipient, a name or a network address. The message
//      builders take no argument that could carry one.
//   2. One useful alert per outage, not one per visitor. Failures are
//      aggregated per process into windows; the first failure of a window
//      alerts at once, the rest of that window are counted and reported in the
//      next alert. A tail that never gets reported here (the instance went
//      cold) is still caught by the daily sweep in the reminder job, which
//      counts pending rows with no recorded send straight from Notion.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { classifyDeliveryFailure, type DeliveryFailureClass } from "./resend.ts";

/** At most one delivery-failure alert per process in this window. */
export const DELIVERY_ALERT_WINDOW_MS = 15 * 60 * 1000;

const SLACK_TIMEOUT_MS = 3000;

/** Posts one plain-text message. Must never throw. */
export type AlertPoster = (text: string) => Promise<void>;

export type DeliveryAlerter = {
  /** Record one failed confirmation send. Resolves once any alert is posted. */
  record(error: unknown): Promise<void>;
};

type WindowState = {
  startedAtMs: number;
  /** Failures in this window not yet included in any posted alert. */
  unreported: Map<string, number>;
  unreportedTotal: number;
};

function classKey(failure: DeliveryFailureClass): string {
  return failure.status === null ? failure.reason : `${failure.reason} (HTTP ${failure.status})`;
}

function isoMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The whole vocabulary of a failure alert. Error classes are drawn from a fixed
 * set of reasons and a numeric status, so nothing a visitor typed can reach it.
 */
export function formatDeliveryFailureAlert(input: {
  count: number;
  fromMs: number;
  toMs: number;
  classes: ReadonlyMap<string, number>;
}): string {
  const classes = [...input.classes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} x${count}`)
    .join(", ");
  return [
    `:warning: WatchDive confirmation email failed to send: ${input.count} failure${
      input.count === 1 ? "" : "s"
    } between ${isoMinute(input.fromMs)} and ${isoMinute(input.toMs)}.`,
    `Error class: ${classes || "unknown"}.`,
    "These visitors were told to check their inbox, and Meta still counted a Lead. " +
      "Check Resend status and Vercel logs for `[watchdive] email_delivery_failed`. " +
      `Further failures on this server instance are batched into at most one alert per ${Math.round(
        DELIVERY_ALERT_WINDOW_MS / 60000,
      )} minutes.`,
  ].join("\n");
}

export function createDeliveryAlerter(options: {
  post: AlertPoster;
  now?: () => number;
  windowMs?: number;
}): DeliveryAlerter {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? DELIVERY_ALERT_WINDOW_MS;
  let state: WindowState | undefined;

  return {
    async record(error) {
      const key = classKey(classifyDeliveryFailure(error));
      const at = now();

      if (state && at - state.startedAtMs < windowMs) {
        // Inside an alerted window: count it for the next alert, stay quiet.
        state.unreported.set(key, (state.unreported.get(key) ?? 0) + 1);
        state.unreportedTotal += 1;
        return;
      }

      // A new window. Its alert also carries whatever the previous window
      // counted after its own alert went out, so nothing is silently dropped
      // by this instance.
      const classes = new Map(state?.unreported ?? []);
      classes.set(key, (classes.get(key) ?? 0) + 1);
      const count = (state?.unreportedTotal ?? 0) + 1;
      const fromMs = state && state.unreportedTotal > 0 ? state.startedAtMs : at;
      state = { startedAtMs: at, unreported: new Map(), unreportedTotal: 0 };
      await options.post(formatDeliveryFailureAlert({ count, fromMs, toMs: at, classes }));
    },
  };
}

export type SlackEnvironment = {
  SLACK_BOT_TOKEN?: string;
  SLACK_SIGNUP_CHANNEL_ID?: string;
};

/**
 * `chat.postMessage` to the signup channel. Unconfigured is a silent no-op; a
 * failed post logs only Slack's own error code. The token and channel id are
 * never logged.
 */
export function createSlackPoster(
  env: SlackEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): AlertPoster {
  return async (text) => {
    const token = (env.SLACK_BOT_TOKEN ?? "").trim();
    const channel = (env.SLACK_SIGNUP_CHANNEL_ID ?? "").trim();
    if (!token || !channel) {
      console.error("[watchdive] ops_alert_skipped", { reason: "slack_not_configured" });
      return;
    }
    try {
      const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
      if (!response.ok || body.ok !== true) {
        const code =
          typeof body.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? body.error : "";
        console.error("[watchdive] ops_alert_failed", { status: response.status, error: code });
      }
    } catch {
      console.error("[watchdive] ops_alert_failed", { status: 0, error: "transport_error" });
    }
  };
}
