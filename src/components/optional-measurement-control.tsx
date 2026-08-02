import { useEffect, useState } from "react";

import { setLaunchOsMeasurementAuthority } from "@/lib/api/launchOsRelay";
import {
  requestLaunchOsMeasurementWithdrawal,
  type LaunchOsMeasurementWithdrawalInput,
  type LaunchOsMeasurementWithdrawalResult,
} from "@/lib/api/launchOsWithdrawal";
import { clearBrowserWatchDiveMeasurementContext } from "@/lib/funnelContext";
import { initMetaPixel, revokeMetaMeasurementRuntime } from "@/lib/metaPixel";
import {
  dispatchOptionalMeasurementConsentChanged,
  getEffectiveOptionalMeasurementConsent,
  hasGlobalPrivacyControl,
  optionalMeasurementChoiceRequiresDocumentReset,
  readStoredOptionalMeasurementConsent,
  setOptionalMeasurementConsent,
} from "@/lib/measurementConsent";
import { useCurrentLocale } from "@/lib/i18n/use-current-locale";
import { localizePath } from "@/lib/i18n/locale";
import {
  acknowledgePendingMeasurementWithdrawal,
  beginPendingMeasurementWithdrawal,
  readPendingMeasurementWithdrawal,
} from "@/lib/measurementWithdrawal";

type Choice = "granted" | "denied" | "unknown";
type WithdrawalUiState = "idle" | "sending" | "pending_purge" | "purged" | "delivery_failed";

export function OptionalMeasurementControl() {
  const locale = useCurrentLocale();
  const korean = locale === "ko";
  const [choice, setChoice] = useState<Choice>("unknown");
  const [open, setOpen] = useState(false);
  const [gpc, setGpc] = useState(false);
  const [withdrawalState, setWithdrawalState] = useState<WithdrawalUiState>("idle");

  const deliverWithdrawal = async (
    intent: LaunchOsMeasurementWithdrawalInput,
  ): Promise<LaunchOsMeasurementWithdrawalResult | null> => {
    setWithdrawalState("sending");
    const result = await requestLaunchOsMeasurementWithdrawal({ data: intent }).catch(() => null);
    if (!result?.accepted) {
      setWithdrawalState("delivery_failed");
      return result;
    }
    // Aggregate exclusion may already be accepted while source suppression is
    // still retrying. Keep the marker until both legs are complete.
    if (!result.retryPending) acknowledgePendingMeasurementWithdrawal(intent.requestId);
    setWithdrawalState(result.status === "purged" ? "purged" : "pending_purge");
    return result;
  };

  useEffect(() => {
    const gpcEnabled = hasGlobalPrivacyControl();
    const stored = readStoredOptionalMeasurementConsent();
    setGpc(gpcEnabled);
    if (gpcEnabled) {
      const withdrawal = beginPendingMeasurementWithdrawal("global_privacy_control");
      const denied = setOptionalMeasurementConsent("denied");
      clearBrowserWatchDiveMeasurementContext();
      revokeMetaMeasurementRuntime();
      if (withdrawal) {
        void deliverWithdrawal(withdrawal.intent);
      } else {
        void setLaunchOsMeasurementAuthority({ data: denied });
      }
      setChoice("denied");
      setOpen(true);
      return;
    }
    const pendingWithdrawal = readPendingMeasurementWithdrawal();
    if (pendingWithdrawal) void deliverWithdrawal(pendingWithdrawal);
    const effective = getEffectiveOptionalMeasurementConsent();
    setChoice(effective?.state ?? "unknown");
    setOpen(stored === null);
    if (effective?.state === "granted") {
      initMetaPixel();
      void setLaunchOsMeasurementAuthority({ data: effective }).then((result) => {
        if (result.ok && result.state === "granted") {
          if (result.code === "CONSENT_AUTHORITY_BOUND_FRESH") {
            clearBrowserWatchDiveMeasurementContext();
            window.location.reload();
            return;
          }
          dispatchOptionalMeasurementConsentChanged(effective);
        }
      });
    }
  }, []);

  const choose = async (requested: "granted" | "denied") => {
    const pendingBeforeChoice = readPendingMeasurementWithdrawal();
    if (requested === "granted" && pendingBeforeChoice) {
      const pendingResult = await deliverWithdrawal(pendingBeforeChoice);
      if (!pendingResult?.accepted) {
        setChoice("denied");
        setOpen(true);
        return;
      }
    }
    const previous = getEffectiveOptionalMeasurementConsent()?.state ?? "unknown";
    const withdrawal =
      requested === "denied" ? beginPendingMeasurementWithdrawal("user_denied") : null;
    const resolved = setOptionalMeasurementConsent(requested);
    setChoice(resolved.state);
    setOpen(false);
    const withdrawalResult = withdrawal ? await deliverWithdrawal(withdrawal.intent) : null;
    const authority = withdrawal
      ? withdrawalResult?.accepted
        ? ({ ok: true, state: "denied", code: "CONSENT_AUTHORITY_REVOKED" } as const)
        : null
      : await setLaunchOsMeasurementAuthority({ data: resolved }).catch(() => null);
    if (resolved.state === "granted") {
      if (authority?.ok && authority.state === "granted") {
        if (
          optionalMeasurementChoiceRequiresDocumentReset(previous, resolved.state, authority.code)
        ) {
          // A newly issued receipt may not be mixed with events already sent
          // under an older/expired grant. Reload resets every one-shot ref and
          // starts one clean funnel under the fresh authority.
          clearBrowserWatchDiveMeasurementContext();
          window.location.reload();
          return;
        }
        initMetaPixel();
        dispatchOptionalMeasurementConsentChanged(resolved);
      }
    } else {
      clearBrowserWatchDiveMeasurementContext();
      revokeMetaMeasurementRuntime();
      if (withdrawal && !withdrawalResult?.accepted) setOpen(true);
      if (
        optionalMeasurementChoiceRequiresDocumentReset(previous, resolved.state, authority?.code) &&
        (!withdrawal || !withdrawalResult?.retryPending || withdrawal.persisted) &&
        typeof window !== "undefined"
      ) {
        // A clean document resets CTA/form one-shot refs. A later re-grant then
        // starts a new, internally consistent funnel instance.
        window.location.reload();
      }
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-16 z-[90] rounded-full border border-white/25 bg-[color:var(--color-deep-2)]/95 px-3 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur hover:bg-[color:var(--color-deep-2)] sm:right-5"
      >
        {korean ? "개인정보 선택" : "Privacy choices"}
      </button>
    );
  }

  return (
    <aside
      role="dialog"
      aria-label={korean ? "선택적 광고 성과 측정" : "Optional advertising measurement"}
      aria-modal="false"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-xl rounded-2xl border border-white/15 bg-[color:var(--color-deep-2)]/98 p-4 text-white shadow-2xl backdrop-blur sm:bottom-5 sm:p-5"
    >
      <h2 className="text-sm font-semibold">
        {korean ? "선택적 광고 성과 측정" : "Optional advertising measurement"}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-white/75">
        {korean
          ? "허용하면 가명(무작위) 방문 ID와 Meta 광고 식별자로 어떤 광고가 가입으로 이어졌는지 측정합니다. 선택하지 않아도 대기 명단 가입은 정상 동작합니다. 거부하면 이후 측정과 이 브라우저의 측정 세션을 중단하고, 기존 LaunchOS 기록의 집계 제외·삭제 처리를 요청합니다."
          : "If you allow it, we use a pseudonymous random visit ID and Meta ad identifiers to measure which ad led to a signup. Your waitlist signup works without it. Declining stops future measurement, clears this browser's measurement session, and submits prior LaunchOS records for exclusion and deletion processing."}
      </p>
      {gpc && (
        <p className="mt-2 text-xs font-medium text-[color:var(--color-cyan-glow)]">
          {korean
            ? "Global Privacy Control이 켜져 있어 선택적 측정은 꺼진 상태로 유지됩니다."
            : "Global Privacy Control is enabled, so optional measurement remains off."}
        </p>
      )}
      {choice !== "unknown" && (
        <p className="mt-2 text-xs text-white/60">
          {korean ? "현재 선택: " : "Current choice: "}
          {choice === "granted" ? (korean ? "허용" : "allowed") : korean ? "거부" : "declined"}
        </p>
      )}
      {withdrawalState !== "idle" && (
        <p
          role={withdrawalState === "delivery_failed" ? "alert" : "status"}
          className="mt-2 text-xs text-white/70"
        >
          {withdrawalState === "sending"
            ? korean
              ? "기존 측정 기록의 제외 요청을 전송 중입니다."
              : "Sending the request to exclude prior measurement records."
            : withdrawalState === "pending_purge"
              ? korean
                ? "기존 기록은 성과 집계에서 제외됐고, 물리 삭제는 대기 중입니다."
                : "Prior records are excluded from reporting; physical deletion is pending."
              : withdrawalState === "purged"
                ? korean
                  ? "기존 측정 기록의 삭제 처리가 완료됐습니다."
                  : "Prior measurement records have been purged."
                : korean
                  ? "이후 측정은 중단됐습니다. 기존 기록 제외 요청은 아직 접수되지 않아 다시 시도합니다."
                  : "Future measurement is off. The prior-record exclusion request has not been accepted yet and will be retried."}
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void choose("granted")}
          disabled={gpc || withdrawalState === "sending"}
          className="rounded-lg border border-white/35 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {korean ? "허용" : "Allow"}
        </button>
        <button
          type="button"
          onClick={() => void choose("denied")}
          disabled={withdrawalState === "sending"}
          className="rounded-lg border border-white/35 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {korean ? "거부" : "Decline"}
        </button>
      </div>
      <a
        href={localizePath("/privacy", locale)}
        className="mt-3 inline-block text-xs text-white/70 underline underline-offset-4 hover:text-white"
      >
        {korean ? "개인정보 처리방침" : "Privacy notice"}
      </a>
    </aside>
  );
}
