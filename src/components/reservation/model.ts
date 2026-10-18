import {
  SUPPORTED_LOCALES,
  homePath,
  privacyPath,
  termsPath,
  type Locale,
} from "../../lib/i18n/locale.ts";

import { isRefundStatus, type ReservationStatus } from "./contract.ts";
import { reservationCopy, type ReservationCopy } from "./copy.ts";
import { parseReservationQuery, withReservationLang, type ReservationLocale } from "./query.ts";

export type ReservationPhase =
  | "needs_invitation"
  | "offer"
  | "pending"
  | "paid"
  | "canceled"
  | "refunded"
  | "disputed"
  | "status_unavailable";

export type CheckoutBlock =
  | "missing_invite"
  | "already_paid"
  | "status_loading"
  | "status_unavailable"
  | "payment_closed"
  | "terms_unread"
  | "terms_unaccepted"
  | "submitting";

export type ReservationUiInput = {
  search: string;
  /** Kept from the mail fragment in sessionStorage. Never taken from the query. */
  inviteToken: string | null;
  invalidInvite: boolean;
  termsRead: boolean;
  termsAccepted: boolean;
  submitting: boolean;
  status: ReservationStatus | null;
  statusError: boolean;
  statusLoading: boolean;
  checkoutError: boolean;
  checkoutConflict: boolean;
  localizedSite: boolean;
};

export type ReservationView = {
  locale: ReservationLocale;
  copy: ReservationCopy;
  phase: ReservationPhase;
  checkoutEnabled: boolean;
  checkoutBlock: CheckoutBlock | null;
  showCheckoutForm: boolean;
  showCheckAgain: boolean;
  statusText: string;
  checkoutHint: string | null;
  checkoutErrorText: string | null;
  statusDetail: string | null;
  languageLinks: Record<ReservationLocale, string>;
  supportLinks: { home: string; privacy: string; terms: string };
  invalidInvitation: boolean;
};

export function reservationPhase(input: {
  inviteToken: string | null;
  sessionId: string | null;
  canceled: boolean;
  status: ReservationStatus | null;
  statusError: boolean;
  statusLoading: boolean;
  invalidInvite?: boolean;
}): ReservationPhase {
  if (input.status?.authoritativePaid) return "paid";
  if (input.status && isRefundStatus(input.status.serverStatus)) return "refunded";
  if (input.status?.serverStatus === "disputed") return "disputed";
  if (input.invalidInvite) return "needs_invitation";
  if (!input.inviteToken) return input.canceled ? "canceled" : "needs_invitation";
  if (input.statusLoading) return "pending";
  if (input.statusError || !input.status) return "status_unavailable";
  if (input.status.serverStatus === "invalid") return "status_unavailable";
  if (input.status.serverStatus === "open") return "pending";
  if (input.canceled) return "canceled";
  return "offer";
}

export function checkoutBlockReason(input: {
  inviteToken: string | null;
  termsRead: boolean;
  termsAccepted: boolean;
  submitting: boolean;
  status: ReservationStatus | null;
  statusError: boolean;
  statusLoading: boolean;
}): CheckoutBlock | null {
  if (!input.inviteToken) return "missing_invite";
  if (input.status?.authoritativePaid) return "already_paid";
  if (input.statusLoading) return "status_loading";
  if (input.statusError || !input.status) return "status_unavailable";
  if (
    isRefundStatus(input.status.serverStatus) ||
    input.status.serverStatus === "disputed" ||
    input.status.authoritativePaid
  ) {
    return "payment_closed";
  }
  if (input.status.serverStatus === "invalid") return "status_unavailable";
  if (!input.termsRead) return "terms_unread";
  if (!input.termsAccepted) return "terms_unaccepted";
  if (input.submitting) return "submitting";
  if (input.status.serverStatus !== "unpaid" && input.status.serverStatus !== "open") {
    return "payment_closed";
  }
  return null;
}

function statusText(
  phase: ReservationPhase,
  copy: ReservationCopy,
  status: ReservationStatus | null,
  invalidInvitation: boolean,
): string {
  if (status?.authoritativePaid || phase === "paid") return copy.paidStatus;
  if (status?.serverStatus === "disputed" || phase === "disputed") return copy.disputedStatus;
  if (status?.serverStatus === "refunded") return copy.refundedStatus;
  if (status?.serverStatus === "partially_refunded") return copy.partialRefundStatus;
  if (status?.serverStatus === "refund_pending") return copy.refundPendingStatus;
  if (status?.serverStatus === "invalid") return copy.invalidStatus;
  if (status?.serverStatus === "open") return copy.openStatus;
  if (phase === "canceled") return copy.canceledStatus;
  if (phase === "pending") return copy.pendingStatus;
  if (phase === "status_unavailable") return copy.unavailableStatus;
  if (phase === "needs_invitation") {
    return invalidInvitation ? copy.invalidInvitation : copy.needsInvitation;
  }
  return copy.offerStatus;
}

function checkoutHint(block: CheckoutBlock | null, copy: ReservationCopy): string | null {
  switch (block) {
    case "terms_unread":
      return copy.checkoutHintUnread;
    case "terms_unaccepted":
      return copy.checkoutHintUnaccepted;
    case "payment_closed":
    case "status_loading":
      return copy.checkoutHintPending;
    case "status_unavailable":
      return copy.checkoutHintUnavailable;
    case "submitting":
      return copy.checkingOut;
    default:
      return null;
  }
}

export function reservationSupportLinks(locale: ReservationLocale, localizedSite: boolean) {
  const siteLocale: Locale = localizedSite ? locale : "en";
  return {
    home: homePath(siteLocale),
    privacy: privacyPath(siteLocale),
    terms: termsPath(siteLocale),
  };
}

export function buildReservationView(input: ReservationUiInput): ReservationView {
  const query = parseReservationQuery(input.search);
  const locale: ReservationLocale = query.lang ?? "en";
  const copy = reservationCopy(locale);
  const phase = reservationPhase({
    inviteToken: input.inviteToken,
    sessionId: query.sessionId,
    canceled: query.canceled,
    status: input.status,
    statusError: input.statusError,
    statusLoading: input.statusLoading,
    invalidInvite: input.invalidInvite,
  });
  const checkoutBlock = checkoutBlockReason({
    inviteToken: input.inviteToken,
    termsRead: input.termsRead,
    termsAccepted: input.termsAccepted,
    submitting: input.submitting,
    status: input.status,
    statusError: input.statusError,
    statusLoading: input.statusLoading,
  });
  const invalidInvitation = input.invalidInvite || query.invalidSession;
  const showCheckoutForm =
    Boolean(input.inviteToken) &&
    phase !== "paid" &&
    phase !== "refunded" &&
    phase !== "disputed" &&
    phase !== "needs_invitation";
  const statusDetail =
    phase === "canceled" ? (input.inviteToken ? copy.canceledRetry : copy.needsInvitation) : null;
  return {
    locale,
    copy,
    phase,
    checkoutEnabled: checkoutBlock === null,
    checkoutBlock,
    showCheckoutForm,
    showCheckAgain:
      Boolean(input.inviteToken) &&
      (phase === "pending" ||
        phase === "status_unavailable" ||
        phase === "canceled" ||
        phase === "refunded" ||
        phase === "disputed"),
    statusText: statusText(phase, copy, input.status, invalidInvitation),
    checkoutHint: showCheckoutForm ? checkoutHint(checkoutBlock, copy) : null,
    checkoutErrorText:
      phase === "paid"
        ? null
        : input.checkoutConflict
          ? copy.checkoutConflict
          : input.checkoutError
            ? copy.checkoutFailed
            : null,
    statusDetail,
    languageLinks: Object.fromEntries(
      SUPPORTED_LOCALES.map((lang) => [lang, withReservationLang(input.search, lang)]),
    ) as Record<ReservationLocale, string>,
    supportLinks: reservationSupportLinks(locale, input.localizedSite),
    invalidInvitation,
  };
}
