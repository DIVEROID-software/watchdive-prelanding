// The launch-mail run: T-1d, T-1h and T-0 to everyone who confirmed.
//
// A human fires it (scripts/launch-mail.ts); there is no cron. It defaults to a
// dry run, which reads Notion, counts, renders one sample per language and
// sends nothing and writes nothing.
//
// How "never twice" holds
//   1. The `Launch mail` cell records the last wave each row was sent. A row
//      that already has this wave, or a later one, is skipped — and so is
//      every other row with the same address.
//   2. Every message carries `Idempotency-Key: watchdive-launch-<wave>-<leadId>`
//      and a byte-identical payload for the same run arguments. A re-run inside
//      Resend's 24-hour key window — after a crash, a failed Notion write, or a
//      second terminal firing the same wave — collapses onto the first message
//      at the provider (or is refused, if the arguments changed). Never a copy.
//   3. The outcome is written straight after each accepted send, so the window
//      in which a row is mailed but not yet recorded is about one request long.
//   4. Without the `Launch mail` property none of the above can be recorded, so
//      a send run refuses to start at all.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { SUPPORTED_LOCALES, type Locale } from "../i18n/locale.ts";
import { classifyDeliveryFailure } from "../verification/resend.ts";
import {
  requirePublicOrigin,
  requireSecret,
  type TokenEnvironment,
} from "../verification/token.ts";
import {
  failedMarker,
  selectAudience,
  sentMarker,
  type LaunchSkipReason,
  type LaunchWave,
} from "./audience.ts";
import type { LaunchSchema, LaunchStore } from "./notionLaunchStore.ts";
import { renderLaunchMail, type RenderedLaunchMail } from "./render.ts";
import { createUnsubscribeToken, unsubscribeUrl } from "./unsubscribeToken.ts";

/** Resend's default team limit is 2 requests/second. Raise only after Resend raises it. */
export const DEFAULT_SEND_RATE_PER_SECOND = 2;
export const MAX_SEND_RATE_PER_SECOND = 50;

/** Two sends in flight keep the rate busy while a Notion write is outstanding. */
export const SEND_CONCURRENCY = 2;

const NOTION_WRITE_ATTEMPTS = 3;

/** A synthetic attempt id for preview samples: no row carries it. */
export const PREVIEW_LEAD_ID = "00000000-0000-4000-8000-000000000000";

export type LaunchMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
  idempotencyKey: string;
};

export type LaunchRunOptions = {
  wave: LaunchWave;
  kickstarterUrl: string;
  /** ISO 8601 with an explicit offset or `Z`. */
  launchAt: string;
  mode: "dry-run" | "send";
  postalAddress?: string;
  ratePerSecond?: number;
  /** Send to at most this many recipients (a canary). Recorded like any send. */
  limit?: number;
  unsubscribeMailto?: string;
};

export type LaunchDependencies = {
  store: LaunchStore;
  /** Only ever called in send mode. */
  send: (message: LaunchMessage) => Promise<void>;
  env?: TokenEnvironment;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Dry run only: receives one rendered sample per language. */
  writeSample?: (locale: Locale, mail: RenderedLaunchMail) => Promise<void>;
};

export type LaunchAbort =
  | "invalid_input"
  | "not_configured"
  | "schema_read_failed"
  | "required_property_missing"
  | "launch_mail_property_missing"
  | "off_schedule"
  | "postal_address_missing"
  | "audience_query_failed"
  | "launch_mail_write_rejected";

export type LaunchRunResult = {
  mode: "dry-run" | "send";
  wave: LaunchWave;
  aborted?: LaunchAbort;
  /** Human-readable reason, counts and names only. */
  detail?: string;
  /** Dry run: why a send run with these arguments would refuse right now. */
  sendBlockers: string[];
  schema?: LaunchSchema;
  rowsRead: number;
  eligible: number;
  byLocale: Partial<Record<Locale, number>>;
  skipped: Partial<Record<LaunchSkipReason, number>>;
  /** Not attempted because of --limit. */
  heldBack: number;
  sent: number;
  failed: number;
  failureClasses: Record<string, number>;
  /** Sent, but the Notion record did not land. The idempotency key still holds for 24h. */
  unrecorded: number;
  samples: Locale[];
};

const KICKSTARTER_HOSTS = new Set(["www.kickstarter.com", "kickstarter.com"]);

/**
 * The campaign URL, exactly as given, or a throw saying why not. It must be a
 * kickstarter.com project page, and must not contain `=` followed by two hex
 * digits: quoted-printable would eat those three characters in the mail body.
 */
export function validateKickstarterUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("--kickstarter-url is not a URL");
  }
  if (url.protocol !== "https:") throw new Error("--kickstarter-url must use https");
  if (!KICKSTARTER_HOSTS.has(url.hostname)) {
    throw new Error("--kickstarter-url must be on kickstarter.com");
  }
  if (!/^\/projects\/[^/]+\/[^/]+/.test(url.pathname)) {
    throw new Error("--kickstarter-url must be a project page (/projects/<creator>/<project>)");
  }
  if (url.username || url.password) throw new Error("--kickstarter-url must not carry credentials");
  if (/=[0-9A-Fa-f]{2}/.test(raw)) {
    throw new Error(
      "--kickstarter-url has '=' followed by two hex digits, which mail encoding would corrupt",
    );
  }
  return url.toString();
}

/** A real instant with an explicit zone. A bare local time is refused: whose local? */
export function parseLaunchAt(raw: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw.trim())) {
    throw new Error("--launch-at must be ISO 8601 with a zone, e.g. 2026-12-01T14:00:00Z");
  }
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) throw new Error("--launch-at is not a valid instant");
  return date;
}

const HOUR = 60 * 60 * 1000;

/**
 * Each mail makes a time claim ("tomorrow", "in an hour", "live now"). A send
 * outside the window where that claim is true is refused.
 */
export const WAVE_WINDOWS: Record<LaunchWave, { earliest: number; latest: number }> = {
  // "tomorrow": between 30 and 18 hours before.
  "t-1d": { earliest: -30 * HOUR, latest: -18 * HOUR },
  // "one hour to go": between 90 and 40 minutes before.
  "t-1h": { earliest: -1.5 * HOUR, latest: -(40 / 60) * HOUR },
  // "live now": from the launch moment, for 12 hours.
  "t-0": { earliest: 0, latest: 12 * HOUR },
};

export function waveTimingProblem(wave: LaunchWave, launchAt: Date, now: Date): string | undefined {
  const offset = now.getTime() - launchAt.getTime();
  const window = WAVE_WINDOWS[wave];
  if (offset < window.earliest) {
    return `too early for ${wave}: its window opens ${Math.round((window.earliest - offset) / 60000)} min from now`;
  }
  if (offset > window.latest) {
    return `too late for ${wave}: its window closed ${Math.round((offset - window.latest) / 60000)} min ago`;
  }
  return undefined;
}

export function launchIdempotencyKey(wave: LaunchWave, leadId: string): string {
  return `watchdive-launch-${wave}-${leadId.toLowerCase()}`;
}

function emptyResult(options: LaunchRunOptions): LaunchRunResult {
  return {
    mode: options.mode,
    wave: options.wave,
    sendBlockers: [],
    rowsRead: 0,
    eligible: 0,
    byLocale: {},
    skipped: {},
    heldBack: 0,
    sent: 0,
    failed: 0,
    failureClasses: {},
    unrecorded: 0,
    samples: [],
  };
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && /validation_error/.test(error.message);
}

function createRateLimiter(
  perSecond: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  const interval = 1000 / perSecond;
  let next = 0;
  return async () => {
    const current = now();
    const slot = Math.max(current, next);
    next = slot + interval;
    if (slot > current) await sleep(slot - current);
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runLaunchMail(
  options: LaunchRunOptions,
  dependencies: LaunchDependencies,
): Promise<LaunchRunResult> {
  const result = emptyResult(options);
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const env = dependencies.env ?? process.env;
  const abort = (aborted: LaunchAbort, detail: string): LaunchRunResult => ({
    ...result,
    aborted,
    detail,
  });

  // --- inputs -----------------------------------------------------------
  let kickstarterUrl: string;
  let launchAt: Date;
  try {
    kickstarterUrl = validateKickstarterUrl(options.kickstarterUrl);
    launchAt = parseLaunchAt(options.launchAt);
  } catch (error) {
    return abort("invalid_input", error instanceof Error ? error.message : "invalid input");
  }
  const rate = options.ratePerSecond ?? DEFAULT_SEND_RATE_PER_SECOND;
  if (!(rate > 0 && rate <= MAX_SEND_RATE_PER_SECOND)) {
    return abort("invalid_input", `--rate must be between 0 and ${MAX_SEND_RATE_PER_SECOND}`);
  }
  if (options.limit !== undefined && !(Number.isInteger(options.limit) && options.limit > 0)) {
    return abort("invalid_input", "--limit must be a positive whole number");
  }

  let secret: string;
  let publicOrigin: string;
  try {
    secret = requireSecret(env);
    publicOrigin = requirePublicOrigin(env);
  } catch (error) {
    return abort("not_configured", error instanceof Error ? error.message : "not configured");
  }

  const sending = options.mode === "send";
  const blockers = result.sendBlockers;
  const timing = waveTimingProblem(options.wave, launchAt, clock());
  if (timing) blockers.push(timing);
  const postalAddress = options.postalAddress?.trim() ?? "";
  if (!postalAddress) {
    blockers.push(
      "no postal address for the footer (--postal-address or WATCHDIVE_POSTAL_ADDRESS)",
    );
  }

  // --- schema -------------------------------------------------------------
  const { store } = dependencies;
  try {
    result.schema = await store.readSchema();
  } catch (error) {
    return abort(
      "schema_read_failed",
      error instanceof Error ? error.message : "schema read failed",
    );
  }
  if (result.schema.missingRequired.length) {
    return abort(
      "required_property_missing",
      `waitlist database lacks: ${result.schema.missingRequired.join(", ")}`,
    );
  }
  if (result.schema.launchMail !== "ok") {
    const why =
      result.schema.launchMail === "missing"
        ? "the waitlist database has no `Launch mail` property. Add it as a Text property; until then nothing can be recorded and nothing is sent"
        : "the `Launch mail` property exists but is not a Text property. Change its type to Text; until then nothing is sent";
    if (sending) return abort("launch_mail_property_missing", why);
    blockers.push(why);
  }
  if (sending && timing) return abort("off_schedule", timing);
  if (sending && !postalAddress) {
    return abort(
      "postal_address_missing",
      "a commercial mail needs the sender's postal address in its footer",
    );
  }

  // --- audience -----------------------------------------------------------
  let rows;
  try {
    rows = await store.listAudienceRows(result.schema);
  } catch (error) {
    return abort(
      "audience_query_failed",
      error instanceof Error ? error.message : "audience query failed",
    );
  }
  result.rowsRead = rows.length;
  const audience = selectAudience(rows, options.wave);
  result.skipped = audience.skipped;
  result.eligible = audience.recipients.length;
  for (const { locale } of audience.recipients) {
    result.byLocale[locale] = (result.byLocale[locale] ?? 0) + 1;
  }

  const unsubscribeFor = (leadId: string, locale: Locale) =>
    unsubscribeUrl(publicOrigin, createUnsubscribeToken(leadId, locale, secret));
  const render = (locale: Locale, unsubscribe: string) =>
    renderLaunchMail({
      wave: options.wave,
      locale,
      kickstarterUrl,
      launchAt,
      unsubscribeUrl: unsubscribe,
      ...(postalAddress ? { postalAddress } : {}),
    });

  // --- dry run: render, never send, never write ----------------------------
  if (!sending) {
    for (const locale of SUPPORTED_LOCALES) {
      await dependencies.writeSample?.(
        locale,
        render(locale, unsubscribeFor(PREVIEW_LEAD_ID, locale)),
      );
      result.samples.push(locale);
    }
    return result;
  }

  // --- send ---------------------------------------------------------------
  const queue = options.limit ? audience.recipients.slice(0, options.limit) : audience.recipients;
  result.heldBack = audience.recipients.length - queue.length;
  const acquire = createRateLimiter(rate, () => clock().getTime(), sleep);
  const mailto = options.unsubscribeMailto ?? "help@diveroid.com";
  let stopped: LaunchAbort | undefined;
  let cursor = 0;

  const record = async (pageId: string, value: string): Promise<"ok" | "rejected" | "failed"> => {
    for (let attempt = 1; attempt <= NOTION_WRITE_ATTEMPTS; attempt++) {
      try {
        await store.recordLaunchMail(pageId, value);
        return "ok";
      } catch (error) {
        if (isValidationError(error)) return "rejected";
        if (attempt < NOTION_WRITE_ATTEMPTS) await sleep(500 * attempt);
      }
    }
    return "failed";
  };

  const worker = async () => {
    while (!stopped && cursor < queue.length) {
      const { row, locale } = queue[cursor++];
      const unsubscribe = unsubscribeFor(row.leadId, locale);
      const mail = render(locale, unsubscribe);
      await acquire();
      if (stopped) break;
      let outcome: string;
      try {
        await dependencies.send({
          to: row.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          // RFC 8058 one-click, with a mailto fallback for clients without it.
          headers: {
            "List-Unsubscribe": `<${unsubscribe}>, <mailto:${mailto}?subject=unsubscribe>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          tags: [
            { name: "campaign", value: "launch" },
            { name: "wave", value: options.wave },
            { name: "locale", value: locale },
          ],
          idempotencyKey: launchIdempotencyKey(options.wave, row.leadId),
        });
        result.sent += 1;
        outcome = sentMarker(options.wave, clock());
      } catch (error) {
        const failure = classifyDeliveryFailure(error);
        const key =
          failure.status === null ? failure.reason : `${failure.reason} (HTTP ${failure.status})`;
        result.failureClasses[key] = (result.failureClasses[key] ?? 0) + 1;
        result.failed += 1;
        outcome = failedMarker(options.wave, failure.reason, clock());
      }
      const written = await record(row.pageId, outcome);
      if (written === "rejected") {
        stopped = "launch_mail_write_rejected";
      } else if (written === "failed" && outcome.includes(" sent ")) {
        result.unrecorded += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker));
  if (stopped) {
    return {
      ...result,
      aborted: stopped,
      detail:
        "Notion rejected a `Launch mail` write, so outcomes cannot be recorded. Stopped before sending more.",
    };
  }
  return result;
}

/** Counts-only summary for the terminal. No address, lead id or page id can reach it. */
export function formatLaunchSummary(result: LaunchRunResult): string {
  const lines: string[] = [];
  lines.push(
    `Launch mail ${result.wave} — ${result.mode === "send" ? "SEND" : "DRY RUN (nothing sent, nothing written)"}`,
  );
  if (result.aborted) {
    lines.push(`REFUSED: ${result.aborted}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  if (result.schema) {
    lines.push(
      `Notion: Launch mail property ${result.schema.launchMail}; Duplicate column ${result.schema.duplicateType ?? "absent (address de-duplication still applies)"}; Browser language column ${result.schema.hasBrowserLanguage ? "present" : "absent"}`,
    );
  }
  lines.push(`Rows read (verified, email verified, not suspect): ${result.rowsRead}`);
  lines.push(`Eligible recipients: ${result.eligible}`);
  for (const locale of SUPPORTED_LOCALES) {
    lines.push(`  ${locale.padEnd(6)} ${result.byLocale[locale] ?? 0}`);
  }
  const skipped = Object.entries(result.skipped);
  if (skipped.length) {
    lines.push(`Skipped: ${skipped.map(([reason, count]) => `${reason} ${count}`).join(", ")}`);
  }
  if (result.mode === "send") {
    lines.push(
      `Sent: ${result.sent}  Failed: ${result.failed}  Held back by --limit: ${result.heldBack}`,
    );
    const classes = Object.entries(result.failureClasses);
    if (classes.length) {
      lines.push(
        `Failure classes: ${classes.map(([name, count]) => `${name} x${count}`).join(", ")}`,
      );
    }
    if (result.unrecorded) {
      lines.push(
        `WARNING: ${result.unrecorded} sent but not recorded in Notion. Re-running this wave within 24h is still safe (same idempotency key); after that it is not.`,
      );
    }
  } else {
    if (result.samples.length) lines.push(`Samples rendered: ${result.samples.join(", ")}`);
    if (result.sendBlockers.length) {
      lines.push("A --send run with these arguments would REFUSE right now:");
      for (const blocker of result.sendBlockers) lines.push(`  - ${blocker}`);
    } else {
      lines.push("No send blockers.");
    }
  }
  return lines.join("\n");
}
