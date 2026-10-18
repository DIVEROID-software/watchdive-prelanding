// Reservation invitation run. scripts/reservation-mail.ts is the CLI.
// This library has no cron. The office Mac mini tick calls the same CLI and
// writes one shared private ledger. Dry run is the default: it reads, counts,
// and renders samples. It does not send and it does not write Notion or the
// receipt log.
//
// A send may resume only when no provider outcome exists yet and the first
// intent is still inside the idempotency window. The receipt log is written
// and fsynced before the provider call, and the idempotency key is stable per
// lead. An unknown outcome is held and is not replayed, including inside that
// window. A clear provider rejection is not replayed either. After the window,
// an unfinished intent is a hold and is not sent again.
//
// Kept free of path-alias imports so `npm test` can load it directly.
import { SUPPORTED_LOCALES, privacyPath, termsPath, type Locale } from "../i18n/locale.ts";
import { classifyDeliveryFailure, ResendDeliveryError } from "../verification/resend.ts";
import {
  requirePublicOrigin,
  requireSecret,
  type TokenEnvironment,
} from "../verification/token.ts";
import { createUnsubscribeToken, unsubscribeUrl } from "../launchMail/unsubscribeToken.ts";
import type { SkipReason } from "./audience.ts";
import { selectAudience } from "./audience.ts";
import {
  RESERVATION_CAMPAIGN_ID,
  failedMarker,
  holdMarker,
  isFailureClass,
  reservationIdempotencyKey,
  sentMarker,
  type FailureClass,
} from "./campaign.ts";
import {
  UNSIGNED_PREVIEW_TOKEN,
  buildReservationInviteUrl,
  mintReservationInviteUrl,
  readReservationTokenSecret,
  type ReservationInviteSigner,
} from "./inviteLink.ts";
import {
  acquireReceiptLock,
  appendReceipt,
  applyReceiptLine,
  decideMailAction,
  ledgerUnsafe,
  loadLedger,
  openReceiptLog,
  prepareReceiptDir,
  receiptFileExists,
  receiptPaths,
  releaseReceiptLock,
  type ReceiptRecord,
} from "./receipts.ts";
import { renderReservationMail, type RenderedReservationMail } from "./render.ts";
import type { ReservationSchema, ReservationStore } from "./store.ts";

export const DEFAULT_SEND_RATE_PER_SECOND = 2;
export const MAX_SEND_RATE_PER_SECOND = 50;
export const SEND_CONCURRENCY = 2;
export const PREVIEW_LEAD_ID = "00000000-0000-4000-8000-000000000000";
/** Not a customer. Dry-run samples only, and only when a token secret is set. */
export const PREVIEW_EMAIL = "preview@watchdive.invalid";

const NOTION_WRITE_ATTEMPTS = 3;

export type ReservationMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
  idempotencyKey: string;
};

export type ReservationRunOptions = {
  mode: "dry-run" | "send";
  postalAddress?: string;
  /** Verified UK legal name. A send refuses while this is empty. */
  legalName?: string;
  ratePerSecond?: number;
  /** First n eligible recipients only, oldest first. Recorded like any send. */
  limit?: number;
  receiptDir: string;
  unsubscribeMailto?: string;
};

export type ReservationDependencies = {
  store: ReservationStore;
  send: (message: ReservationMessage) => Promise<void>;
  /** Test double only. Production uses issueReservationInvite. */
  signInvite?: ReservationInviteSigner;
  env?: TokenEnvironment & { WATCHDIVE_RESERVATION_TOKEN_SECRET?: string };
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  writeSample?: (locale: Locale, mail: RenderedReservationMail) => Promise<void>;
};

export type ReservationAbort =
  | "invalid_input"
  | "not_configured"
  | "schema_read_failed"
  | "required_property_missing"
  | "reservation_mail_property_missing"
  | "launch_mail_unreadable"
  | "postal_address_missing"
  | "legal_name_missing"
  | "invite_secret_missing"
  | "audience_query_failed"
  | "receipt_unsafe"
  | "receipt_lock_held"
  | "receipt_write_failed"
  | "reservation_mail_write_rejected"
  | "template_rejected";

export type PlannedActions = {
  deliver: number;
  reconcile: number;
  accepted: number;
  expired: number;
  unresolved: number;
};

export type ReservationRunResult = {
  mode: "dry-run" | "send";
  campaignId: typeof RESERVATION_CAMPAIGN_ID;
  aborted?: ReservationAbort;
  detail?: string;
  sendBlockers: string[];
  schema?: ReservationSchema;
  rowsScanned: number;
  eligible: number;
  byLocale: Partial<Record<Locale, number>>;
  skipped: Partial<Record<SkipReason, number>>;
  planned: PlannedActions;
  heldBack: number;
  sent: number;
  failed: number;
  reconciled: number;
  expired: number;
  unresolved: number;
  inviteRejected: number;
  unrecorded: number;
  failureClasses: Record<string, number>;
  samples: Locale[];
  samplesUnsigned: boolean;
  helperLoaded: boolean;
  /** True when the reservation token secret is present. The secret is never stored. */
  tokenSecretReady: boolean;
};

function emptyPlanned(): PlannedActions {
  return { deliver: 0, reconcile: 0, accepted: 0, expired: 0, unresolved: 0 };
}

function emptyResult(mode: ReservationRunOptions["mode"]): ReservationRunResult {
  return {
    mode,
    campaignId: RESERVATION_CAMPAIGN_ID,
    sendBlockers: [],
    rowsScanned: 0,
    eligible: 0,
    byLocale: {},
    skipped: {},
    planned: emptyPlanned(),
    heldBack: 0,
    sent: 0,
    failed: 0,
    reconciled: 0,
    expired: 0,
    unresolved: 0,
    inviteRejected: 0,
    unrecorded: 0,
    failureClasses: {},
    samples: [],
    samplesUnsigned: false,
    helperLoaded: true,
    tokenSecretReady: false,
  };
}

function cleanPostal(value: string | undefined): string {
  const postal = value?.trim() ?? "";
  if (!postal) return "";
  if (postal.length < 8 || postal.length > 300 || /[\u0000-\u001f<>]/.test(postal)) {
    throw new Error("--postal-address must be a single-line postal address");
  }
  return postal;
}

function cleanLegalName(value: string | undefined): string {
  const name = value?.trim() ?? "";
  if (!name) return "";
  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f<>]/.test(name)) {
    throw new Error("--legal-name must be a single-line legal name");
  }
  return name;
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

function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && /validation_error/.test(error.message);
}

function isConflict(error: unknown): boolean {
  return error instanceof ResendDeliveryError && error.status === 409;
}

function failureClassOf(error: unknown): FailureClass {
  const reason = classifyDeliveryFailure(error).reason;
  return isFailureClass(reason) ? reason : "unexpected_error";
}

function isUnknownFailure(failureClass: FailureClass): boolean {
  return (
    failureClass === "transport_error" ||
    failureClass === "invalid_provider_response" ||
    failureClass === "unexpected_error"
  );
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runReservationMail(
  options: ReservationRunOptions,
  dependencies: ReservationDependencies,
): Promise<ReservationRunResult> {
  const result = emptyResult(options.mode);
  const clock = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const env = dependencies.env ?? process.env;
  const sending = options.mode === "send";
  const abort = (aborted: ReservationAbort, detail: string): ReservationRunResult => ({
    ...result,
    aborted,
    detail,
  });

  let postal = "";
  let legalName = "";
  try {
    postal = cleanPostal(options.postalAddress);
    legalName = cleanLegalName(options.legalName);
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

  let tokenSecret = "";
  try {
    tokenSecret = readReservationTokenSecret(env);
  } catch {
    tokenSecret = "";
  }
  result.tokenSecretReady = tokenSecret.length > 0;
  result.helperLoaded = true;

  const blockers = result.sendBlockers;
  if (!postal) {
    blockers.push("no postal address (--postal-address or WATCHDIVE_POSTAL_ADDRESS)");
  }
  if (!legalName) {
    blockers.push(
      "no verified UK legal name (--legal-name or WATCHDIVE_LEGAL_NAME); a send would refuse",
    );
  }
  if (!tokenSecret) {
    blockers.push(
      "WATCHDIVE_RESERVATION_TOKEN_SECRET is missing or shorter than 32 bytes; a send would refuse",
    );
  }

  let schema: ReservationSchema;
  try {
    schema = await dependencies.store.readSchema();
  } catch {
    return abort("schema_read_failed", "schema read failed");
  }
  result.schema = schema;
  if (schema.missingRequired.length) {
    return abort(
      "required_property_missing",
      `waitlist database lacks: ${schema.missingRequired.join(", ")}`,
    );
  }
  if (schema.reservationMail !== "ok") {
    const why =
      schema.reservationMail === "missing"
        ? "the waitlist database has no `Reservation mail` text property, so a send cannot be recorded"
        : "`Reservation mail` exists but is not a Text property, so a send cannot be recorded";
    if (sending) return abort("reservation_mail_property_missing", why);
    blockers.push(why);
  }
  if (schema.launchMail === "wrong_type") {
    const why = "`Launch mail` is not a Text property, so unsubscribe markers cannot be read";
    if (sending) return abort("launch_mail_unreadable", why);
    blockers.push(why);
  }
  if (sending && !postal) {
    return abort("postal_address_missing", "a commercial mail needs the sender's postal address");
  }
  if (sending && !legalName) {
    return abort(
      "legal_name_missing",
      "a commercial mail needs the verified UK legal name; none is configured",
    );
  }
  if (sending && !tokenSecret) {
    return abort(
      "invite_secret_missing",
      "WATCHDIVE_RESERVATION_TOKEN_SECRET must be at least 32 bytes",
    );
  }

  let rows;
  try {
    rows = await dependencies.store.listRows(schema);
  } catch {
    return abort("audience_query_failed", "audience query failed");
  }
  result.rowsScanned = rows.length;
  const audience = selectAudience(rows);
  result.skipped = audience.skipped;
  result.eligible = audience.recipients.length;
  for (const { locale } of audience.recipients) {
    result.byLocale[locale] = (result.byLocale[locale] ?? 0) + 1;
  }

  const paths = receiptPaths(options.receiptDir);
  let ledger = await (async () => {
    if (await receiptFileExists(paths.file)) return loadLedger(paths.file);
    return loadLedger(paths.file);
  })();
  if (ledgerUnsafe(ledger)) {
    const why = "receipt ledger has a corrupt, foreign, or unsafe line; nothing will be sent";
    if (sending) return abort("receipt_unsafe", why);
    blockers.push(why);
  }
  for (const { row } of audience.recipients) {
    const action = decideMailAction(
      row.reservationMail,
      ledger.byLead.get(row.leadId.toLowerCase()),
      clock(),
    );
    if (action.type === "deliver") result.planned.deliver += 1;
    else if (action.type === "record_only") result.planned.reconcile += 1;
    else if (action.reason === "expired") result.planned.expired += 1;
    else if (action.reason === "unresolved") result.planned.unresolved += 1;
    else result.planned.accepted += 1;
  }

  const unsubscribeFor = (leadId: string, locale: Locale) =>
    unsubscribeUrl(publicOrigin, createUnsubscribeToken(leadId, locale, secret));
  const pageUrl = (path: string) => new URL(path, publicOrigin).toString();
  const renderFor = (locale: Locale, leadId: string, invite: string) =>
    renderReservationMail({
      locale,
      inviteUrl: invite,
      unsubscribeUrl: unsubscribeFor(leadId, locale),
      privacyUrl: pageUrl(privacyPath(locale)),
      termsUrl: pageUrl(termsPath(locale)),
      ...(postal ? { postalAddress: postal } : {}),
      ...(legalName ? { legalName } : {}),
    });

  if (!sending) {
    for (const locale of SUPPORTED_LOCALES) {
      let invite: string;
      if (tokenSecret) {
        try {
          const previewAt = clock().getTime();
          invite = mintReservationInviteUrl({
            leadId: PREVIEW_LEAD_ID,
            email: PREVIEW_EMAIL,
            locale,
            publicOrigin,
            secret: tokenSecret,
            firstIntentAtMs: previewAt,
            nowMs: previewAt,
            ...(dependencies.signInvite ? { sign: dependencies.signInvite } : {}),
          });
        } catch {
          result.samplesUnsigned = true;
          invite = buildReservationInviteUrl(publicOrigin, locale, UNSIGNED_PREVIEW_TOKEN);
        }
      } else {
        result.samplesUnsigned = true;
        invite = buildReservationInviteUrl(publicOrigin, locale, UNSIGNED_PREVIEW_TOKEN);
      }
      try {
        await dependencies.writeSample?.(locale, renderFor(locale, PREVIEW_LEAD_ID, invite));
      } catch {
        return abort("template_rejected", "A sample could not be rendered");
      }
      result.samples.push(locale);
    }
    return result;
  }

  try {
    await prepareReceiptDir(paths.dir);
    await acquireReceiptLock(paths.lock);
  } catch (error) {
    if (error instanceof Error && error.message === "Receipt lock is held") {
      return abort("receipt_lock_held", "another reservation-mail send holds the receipt lock");
    }
    return abort("receipt_write_failed", "the receipt directory could not be prepared");
  }

  let handle;
  try {
    ledger = await loadLedger(paths.file);
    if (ledgerUnsafe(ledger)) {
      await releaseReceiptLock(paths.lock);
      return abort("receipt_unsafe", "receipt ledger has a corrupt, foreign, or unsafe line");
    }
    handle = await openReceiptLog(paths.file);
  } catch {
    await releaseReceiptLock(paths.lock);
    return abort("receipt_write_failed", "the receipt ledger could not be opened");
  }

  const queue = options.limit ? audience.recipients.slice(0, options.limit) : audience.recipients;
  result.heldBack = audience.recipients.length - queue.length;
  const acquire = createRateLimiter(rate, () => clock().getTime(), sleep);
  const exclusive = createMutex();
  const mailto = options.unsubscribeMailto ?? "help@diveroid.com";
  let stopped: ReservationAbort | undefined;
  let cursor = 0;

  const remember = async (record: ReceiptRecord): Promise<boolean> => {
    try {
      await appendReceipt(handle, record);
      applyReceiptLine(ledger, JSON.stringify(record));
      return true;
    } catch {
      stopped = "receipt_write_failed";
      return false;
    }
  };

  const recordNotion = async (
    pageId: string,
    value: string,
    rowMail: { reservationMail?: string },
  ): Promise<"ok" | "rejected" | "failed"> => {
    for (let attempt = 1; attempt <= NOTION_WRITE_ATTEMPTS; attempt++) {
      try {
        await dependencies.store.recordReservationMail(pageId, value);
        rowMail.reservationMail = value;
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
      const item = queue[cursor++];
      const { row, locale } = item;
      const decidedAt = clock();
      const optimistic = decideMailAction(
        row.reservationMail,
        ledger.byLead.get(row.leadId.toLowerCase()),
        decidedAt,
      );
      let message: ReservationMessage | undefined;
      if (optimistic.type === "deliver") {
        try {
          const invite = mintReservationInviteUrl({
            leadId: row.leadId,
            email: row.email,
            locale,
            publicOrigin,
            secret: tokenSecret,
            firstIntentAtMs: Date.parse(optimistic.firstIntentAt),
            nowMs: decidedAt.getTime(),
            ...(dependencies.signInvite ? { sign: dependencies.signInvite } : {}),
          });
          const mail = renderFor(locale, row.leadId, invite);
          const unsubscribe = unsubscribeFor(row.leadId, locale);
          message = {
            to: row.email.trim(),
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            headers: {
              "List-Unsubscribe": `<${unsubscribe}>, <mailto:${mailto}?subject=unsubscribe>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            tags: [
              { name: "campaign", value: RESERVATION_CAMPAIGN_ID },
              { name: "locale", value: locale },
            ],
            idempotencyKey: reservationIdempotencyKey(row.leadId),
          };
        } catch (error) {
          if (
            error instanceof Error &&
            /forbidden claim|required fee|required paragraph|mail link/i.test(error.message)
          ) {
            stopped = "template_rejected";
            break;
          }
          result.inviteRejected += 1;
          continue;
        }
      }

      const step = await exclusive(async () => {
        if (stopped) return "stop" as const;
        const action = decideMailAction(
          row.reservationMail,
          ledger.byLead.get(row.leadId.toLowerCase()),
          decidedAt,
        );
        if (action.type === "block") {
          if (action.writeUnresolved) {
            const at = clock().toISOString();
            const wrote = await remember({
              v: 1,
              campaignId: RESERVATION_CAMPAIGN_ID,
              leadId: row.leadId.toLowerCase(),
              state: "unresolved",
              at,
              firstIntentAt: action.firstIntentAt ?? at,
              notion: "pending",
            });
            if (!wrote) return "stop" as const;
            const notion = await recordNotion(
              row.pageId,
              holdMarker("expired_intent", clock()),
              row,
            );
            if (notion === "rejected") {
              stopped = "reservation_mail_write_rejected";
              return "stop" as const;
            }
            if (notion !== "ok") result.unrecorded += 1;
            else {
              await remember({
                v: 1,
                campaignId: RESERVATION_CAMPAIGN_ID,
                leadId: row.leadId.toLowerCase(),
                state: "unresolved",
                at: clock().toISOString(),
                firstIntentAt: action.firstIntentAt ?? at,
                notion: "ok",
              });
            }
            result.expired += 1;
          } else if (action.reason === "unresolved") result.unresolved += 1;
          return "skip" as const;
        }
        if (action.type === "record_only") {
          let notionState: ReceiptRecord["notion"] = "ok";
          if (action.writeNotion) {
            const notion = await recordNotion(row.pageId, sentMarker(clock()), row);
            if (notion === "rejected") {
              stopped = "reservation_mail_write_rejected";
              return "stop" as const;
            }
            if (notion !== "ok") {
              notionState = "failed";
              result.unrecorded += 1;
            }
          }
          const wrote = await remember({
            v: 1,
            campaignId: RESERVATION_CAMPAIGN_ID,
            leadId: row.leadId.toLowerCase(),
            state: "accepted",
            at: clock().toISOString(),
            firstIntentAt: action.firstIntentAt,
            notion: notionState,
          });
          if (!wrote) return "stop" as const;
          result.reconciled += 1;
          return "skip" as const;
        }
        const wrote = await remember({
          v: 1,
          campaignId: RESERVATION_CAMPAIGN_ID,
          leadId: row.leadId.toLowerCase(),
          state: "intent",
          at: clock().toISOString(),
          firstIntentAt: action.firstIntentAt,
          notion: "pending",
        });
        if (!wrote) return "stop" as const;
        if (!message) {
          stopped = "template_rejected";
          return "stop" as const;
        }
        return { type: "send" as const, firstIntentAt: action.firstIntentAt };
      });

      if (step === "stop" || step === "skip" || stopped) continue;
      if (step.type !== "send" || !message) continue;
      const intentStarted = step.firstIntentAt;
      await acquire();
      if (stopped) break;
      try {
        await dependencies.send(message);
        const acceptedAt = clock().toISOString();
        const noted = await exclusive(async () =>
          remember({
            v: 1,
            campaignId: RESERVATION_CAMPAIGN_ID,
            leadId: row.leadId.toLowerCase(),
            state: "accepted",
            at: acceptedAt,
            firstIntentAt: intentStarted,
            notion: "pending",
          }),
        );
        if (!noted) break;
        result.sent += 1;
        const notion = await recordNotion(row.pageId, sentMarker(clock()), row);
        if (notion === "rejected") {
          stopped = "reservation_mail_write_rejected";
          result.unrecorded += 1;
          break;
        }
        if (notion !== "ok") result.unrecorded += 1;
        await exclusive(async () =>
          remember({
            v: 1,
            campaignId: RESERVATION_CAMPAIGN_ID,
            leadId: row.leadId.toLowerCase(),
            state: "accepted",
            at: clock().toISOString(),
            firstIntentAt: intentStarted,
            notion: notion === "ok" ? "ok" : "failed",
          }),
        );
      } catch (error) {
        if (isConflict(error)) {
          result.unresolved += 1;
          result.failureClasses.provider_conflict =
            (result.failureClasses.provider_conflict ?? 0) + 1;
          await exclusive(async () =>
            remember({
              v: 1,
              campaignId: RESERVATION_CAMPAIGN_ID,
              leadId: row.leadId.toLowerCase(),
              state: "unresolved",
              at: clock().toISOString(),
              firstIntentAt: intentStarted,
              notion: "pending",
            }),
          );
          const notion = await recordNotion(
            row.pageId,
            holdMarker("provider_conflict", clock()),
            row,
          );
          if (notion === "rejected") stopped = "reservation_mail_write_rejected";
          if (notion !== "ok") result.unrecorded += 1;
          continue;
        }
        const failureClass = failureClassOf(error);
        result.failureClasses[failureClass] = (result.failureClasses[failureClass] ?? 0) + 1;
        if (isUnknownFailure(failureClass)) {
          result.unresolved += 1;
          await exclusive(async () =>
            remember({
              v: 1,
              campaignId: RESERVATION_CAMPAIGN_ID,
              leadId: row.leadId.toLowerCase(),
              state: "unresolved",
              at: clock().toISOString(),
              firstIntentAt: intentStarted,
              notion: "pending",
              failureClass,
            }),
          );
          const notion = await recordNotion(
            row.pageId,
            holdMarker("unknown_outcome", clock()),
            row,
          );
          if (notion === "rejected") stopped = "reservation_mail_write_rejected";
          if (notion !== "ok") result.unrecorded += 1;
          continue;
        }
        result.failed += 1;
        await exclusive(async () =>
          remember({
            v: 1,
            campaignId: RESERVATION_CAMPAIGN_ID,
            leadId: row.leadId.toLowerCase(),
            state: "failed",
            at: clock().toISOString(),
            firstIntentAt: intentStarted,
            notion: "pending",
            failureClass,
          }),
        );
        const notion = await recordNotion(row.pageId, failedMarker(failureClass, clock()), row);
        if (notion === "rejected") stopped = "reservation_mail_write_rejected";
        if (notion !== "ok") result.unrecorded += 1;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, () => worker()));
  } finally {
    await handle.close().catch(() => undefined);
    await releaseReceiptLock(paths.lock);
  }
  if (stopped) {
    return { ...result, aborted: stopped, detail: stopDetail(stopped) };
  }
  return result;
}

function stopDetail(stopped: ReservationAbort): string {
  if (stopped === "reservation_mail_write_rejected") {
    return "Notion rejected a Reservation mail write, so the run stopped";
  }
  if (stopped === "receipt_write_failed") return "the receipt ledger could not be written";
  if (stopped === "template_rejected") return "the reservation template was rejected";
  return "the run stopped";
}

/** Counts only. No address, lead id, page id, token, or message body. */
export function formatReservationSummary(result: ReservationRunResult): string {
  const lines: string[] = [];
  lines.push(
    `Reservation mail ${result.campaignId} — ${result.mode === "send" ? "SEND" : "DRY RUN (nothing sent, nothing written)"}`,
  );
  if (result.aborted) {
    lines.push(`REFUSED: ${result.aborted}${result.detail ? ` — ${result.detail}` : ""}`);
  }
  if (result.schema) {
    lines.push(
      `Notion: Reservation mail ${result.schema.reservationMail}; Launch mail ${result.schema.launchMail}; Duplicate ${result.schema.duplicateType ?? "absent"}; Browser language ${result.schema.hasBrowserLanguage ? "present" : "absent"}`,
    );
    lines.push(
      `Signup country: ${result.schema.hasCountryProperty ? "column present" : "column absent"}. Used only when path and browser language do not choose a language. Not eligibility. Not inferred from phone or IP. Blanks are not backfilled.`,
    );
    lines.push(
      `SMS consent column: ${result.schema.hasSmsConsentProperty ? "present, not used" : "absent"}. Phone column: ${result.schema.hasPhoneProperty ? "present, not used" : "absent"}. Neither is eligibility.`,
    );
  }
  lines.push(`Rows scanned: ${result.rowsScanned}`);
  lines.push(`Eligible: ${result.eligible}`);
  lines.push("Language (not country):");
  for (const locale of SUPPORTED_LOCALES) {
    lines.push(`  ${locale.padEnd(6)} ${result.byLocale[locale] ?? 0}`);
  }
  const skipped = Object.entries(result.skipped);
  if (skipped.length) {
    lines.push(`Skipped: ${skipped.map(([reason, count]) => `${reason} ${count}`).join(", ")}`);
  }
  lines.push(
    `Planned: deliver ${result.planned.deliver}, reconcile ${result.planned.reconcile}, already accepted ${result.planned.accepted}, expire ${result.planned.expired}, unresolved ${result.planned.unresolved}`,
  );
  lines.push(
    `Invite signer: ${result.helperLoaded ? "issueReservationInvite, compiled in" : "missing"}.`,
  );
  lines.push(
    `Reservation token secret: ${result.tokenSecretReady ? "present" : "missing"}. Invite link: fragment only, query is lang.`,
  );
  if (result.mode === "send") {
    lines.push(
      `Sent: ${result.sent}  Failed: ${result.failed}  Reconciled: ${result.reconciled}  Expired: ${result.expired}  Unresolved: ${result.unresolved}  Invite rejected: ${result.inviteRejected}  Held back by --limit: ${result.heldBack}`,
    );
    const classes = Object.entries(result.failureClasses);
    if (classes.length) {
      lines.push(
        `Failure classes: ${classes.map(([name, count]) => `${name} x${count}`).join(", ")}`,
      );
    }
    if (result.unrecorded) {
      lines.push(
        `WARNING: ${result.unrecorded} outcome(s) were not recorded in Notion. Re-running is safe: an accepted receipt is not sent again.`,
      );
    }
  } else {
    if (result.samples.length) {
      lines.push(
        `Samples rendered: ${result.samples.join(", ")}${result.samplesUnsigned ? " (unsigned preview token, not a sendable invite)" : ""}`,
      );
    }
    if (result.sendBlockers.length) {
      lines.push("A --send run with these arguments would REFUSE right now:");
      for (const blocker of result.sendBlockers) lines.push(`  - ${blocker}`);
    } else {
      lines.push("No send blockers.");
    }
  }
  return lines.join("\n");
}
