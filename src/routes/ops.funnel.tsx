import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadFunnelDashboard,
  type DashboardBreakdownRow,
  type DashboardHealthItem,
  type DashboardPayload,
  type DashboardStage,
} from "@/lib/api/dashboard.functions";

export const Route = createFileRoute("/ops/funnel")({
  head: () => ({
    meta: [
      { title: "WatchDive Funnel Operations" },
      {
        name: "description",
        content: "Private, aggregate WatchDive funnel measurement dashboard.",
      },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
  component: FunnelDashboardPage,
});

type BreakdownKey = keyof DashboardPayload["breakdowns"];
type DashboardRequest = { token: string; from: string; to: string };
type RefreshOrigin = "manual" | "automatic";

const AUTO_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_INTERVAL_SECONDS = AUTO_REFRESH_INTERVAL_MS / 1_000;

const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  path: "전환 경로",
  source: "폼 위치 / 소스",
  page: "랜딩 경로",
  channel: "채널",
  placement: "게재 위치",
  country: "국가",
  campaign: "캠페인",
  adSet: "광고 세트",
  ad: "광고",
  creative: "소재",
};

function kstDate(offsetDays = 0): string {
  const value = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatNumber(value: number | null, ready = true): string {
  if (!ready || value === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatEuro(value: number | null, ready = true): string {
  if (!ready || value === null) return "—";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(value < 10 ? 2 : 1)}%`;
}

function formatDecimal(value: number | null, ready = true): string {
  if (!ready || value === null) return "—";
  return value.toFixed(2);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatClockTimestamp(value: number | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatCountdown(value: number): string {
  const safeValue = Math.max(0, Math.ceil(value));
  const minutes = Math.floor(safeValue / 60);
  const seconds = safeValue % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function dashboardErrorMessage(reason: string, automatic: boolean): string {
  const prefix = automatic ? "자동 갱신에 실패했습니다. 이전 값을 유지합니다. " : "";
  if (reason === "dashboard_token_unconfigured") {
    return `${prefix}서버에 FUNNEL_DASHBOARD_TOKEN이 아직 설정되지 않았습니다.`;
  }
  if (reason === "aggregate_unavailable") {
    return `${prefix}정확 집계 쿼리를 실행하지 못했습니다. 부분 수치는 표시하지 않습니다. 서버 로그와 측정 migration을 확인해 주세요.`;
  }
  if (reason === "meta_sync_failed") {
    return automatic
      ? "자동 갱신에 실패했습니다. 이전 값을 유지합니다. Meta 토큰·권한·RPC 로그를 확인한 뒤 다시 시도해 주세요."
      : "Meta 성과 동기화에 실패해 이전 광고 수치를 표시하지 않습니다. 토큰·권한·RPC 로그를 확인한 뒤 다시 시도해 주세요.";
  }
  return `${prefix}대시보드 토큰이 올바르지 않습니다.`;
}

function FunnelDashboardPage() {
  const [token, setToken] = useState("");
  const [from, setFrom] = useState(() => kstDate());
  const [to, setTo] = useState(() => kstDate());
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeBreakdown, setActiveBreakdown] = useState<BreakdownKey>("path");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(AUTO_REFRESH_INTERVAL_SECONDS);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const activeRequestRef = useRef<DashboardRequest | null>(null);
  const nextRefreshAtRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const scheduleNextRefresh = useCallback(() => {
    nextRefreshAtRef.current = Date.now() + AUTO_REFRESH_INTERVAL_MS;
    setSecondsUntilRefresh(AUTO_REFRESH_INTERVAL_SECONDS);
  }, []);

  const refreshDashboard = useCallback(
    async (request: DashboardRequest, origin: RefreshOrigin) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const automatic = origin === "automatic";
      if (!automatic) setError("");
      setLoading(true);

      try {
        const result = await loadFunnelDashboard({ data: request });
        if (!result.ok) {
          if (!automatic) {
            setDashboard(null);
            activeRequestRef.current = null;
            nextRefreshAtRef.current = null;
          }
          setError(dashboardErrorMessage(result.reason, automatic));
          return;
        }
        activeRequestRef.current = request;
        setDashboard(result);
        setLastReceivedAt(Date.now());
        setError("");
        scheduleNextRefresh();
      } catch {
        if (!automatic) {
          setDashboard(null);
          activeRequestRef.current = null;
          nextRefreshAtRef.current = null;
        }
        setError(
          automatic
            ? "자동 갱신에 실패했습니다. 이전 값을 유지합니다. 서버 연결을 확인해 주세요."
            : "대시보드를 불러오지 못했습니다. 날짜 범위와 서버 연결을 확인해 주세요.",
        );
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [scheduleNextRefresh],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refreshDashboard({ token, from, to }, "manual");
  }

  useEffect(() => {
    function updateVisibility() {
      setTabVisible(document.visibilityState === "visible");
    }

    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!dashboard || !autoRefreshEnabled || !tabVisible) return;
    if (nextRefreshAtRef.current === null) scheduleNextRefresh();

    function tick() {
      const nextRefreshAt = nextRefreshAtRef.current;
      if (nextRefreshAt === null) return;
      const remaining = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1_000));
      setSecondsUntilRefresh(remaining);
      if (remaining > 0 || loadingRef.current) return;

      const request = activeRequestRef.current;
      nextRefreshAtRef.current = Date.now() + AUTO_REFRESH_INTERVAL_MS;
      setSecondsUntilRefresh(AUTO_REFRESH_INTERVAL_SECONDS);
      if (request) void refreshDashboard(request, "automatic");
    }

    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [autoRefreshEnabled, dashboard, refreshDashboard, scheduleNextRefresh, tabVisible]);

  function toggleAutoRefresh() {
    if (autoRefreshEnabled) {
      setAutoRefreshEnabled(false);
      return;
    }
    nextRefreshAtRef.current = Date.now() + Math.max(1, secondsUntilRefresh) * 1_000;
    setAutoRefreshEnabled(true);
  }

  function applyRange(days: number) {
    setFrom(kstDate(-(days - 1)));
    setTo(kstDate());
  }

  const hasAutomaticRefreshError = Boolean(dashboard && error);
  const liveStatus = !dashboard
    ? "인증 후 퍼널은 60초, Meta는 최대 10분 간격으로 실제값을 갱신합니다."
    : hasAutomaticRefreshError
      ? "자동 갱신 오류 · 이전 실제값 유지"
      : loading
        ? "실제값 갱신 중…"
        : !tabVisible
          ? "탭 숨김 · 자동 갱신 대기"
          : autoRefreshEnabled
            ? `다음 퍼널 갱신 ${formatCountdown(secondsUntilRefresh)} · Meta 최대 10분`
            : "자동 갱신 일시정지";

  return (
    <main className="wdops-shell">
      <DashboardStyles />
      <div className="wdops-wrap">
        <header className="wdops-header">
          <div>
            <p className="wdops-eyebrow">WATCHDIVE · PRIVATE OPERATIONS</p>
            <h1>Full-funnel measurement</h1>
            <p className="wdops-subtitle">
              광고 노출부터 유효·검증 리드까지, 개인정보 없이 집계합니다.
            </p>
          </div>
          <div className="wdops-lock">🔒 Unlinked · token protected</div>
        </header>

        <form className="wdops-controls" onSubmit={submit}>
          <label>
            <span>Dashboard token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="current-password"
              placeholder="FUNNEL_DASHBOARD_TOKEN"
              required
            />
          </label>
          <label>
            <span>From · KST</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </label>
          <label>
            <span>To · KST</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </label>
          <button className="wdops-primary" type="submit" disabled={loading}>
            {loading ? "집계 중…" : dashboard ? "새로고침" : "대시보드 열기"}
          </button>
          <div className="wdops-ranges" aria-label="Quick date ranges">
            {[1, 7, 14, 30].map((days) => (
              <button key={days} type="button" onClick={() => applyRange(days)}>
                {days}일
              </button>
            ))}
          </div>
          <div className="wdops-live-control">
            <span
              className={`wdops-live-dot${
                dashboard && autoRefreshEnabled && tabVisible && !hasAutomaticRefreshError
                  ? " is-live"
                  : ""
              }${hasAutomaticRefreshError ? " is-error" : ""}`}
              aria-hidden="true"
            />
            <span className="wdops-live-status" aria-live="polite">
              {liveStatus}
            </span>
            {lastReceivedAt !== null ? (
              <span className="wdops-live-freshness">
                화면·1P 수신 {formatClockTimestamp(lastReceivedAt)} KST
              </span>
            ) : null}
            {dashboard ? (
              <span className="wdops-live-freshness">
                Meta 집계{" "}
                {dashboard.integrations.metaLastSyncedAt
                  ? `${formatTimestamp(dashboard.integrations.metaLastSyncedAt)} KST`
                  : "미수신"}
              </span>
            ) : null}
            {dashboard ? (
              <button
                type="button"
                className="wdops-live-toggle"
                aria-pressed={!autoRefreshEnabled}
                onClick={toggleAutoRefresh}
              >
                {autoRefreshEnabled ? "일시정지" : "계속"}
              </button>
            ) : null}
          </div>
        </form>

        {error ? <div className="wdops-alert wdops-alert--critical">{error}</div> : null}

        {!dashboard ? (
          <LockedState />
        ) : (
          <DashboardBody
            dashboard={dashboard}
            activeBreakdown={activeBreakdown}
            setActiveBreakdown={setActiveBreakdown}
          />
        )}
      </div>
    </main>
  );
}

function LockedState() {
  return (
    <section className="wdops-locked">
      <div className="wdops-locked-icon">↳</div>
      <h2>측정 데이터는 서버 인증 후에만 표시됩니다.</h2>
      <p>
        이메일·전화·IP·사용자 에이전트는 이 대시보드에서 조회하지 않습니다. 서버는 익명 세션 이벤트,
        리드 품질 상태, Meta 집계치만 반환합니다.
      </p>
      <div className="wdops-definition-grid">
        <Definition number="01" title="광고" text="Spend · Impressions · Clicks · Meta form" />
        <Definition number="02" title="웹사이트" text="Landing · Form view/start · Submit" />
        <Definition number="03" title="리드 품질" text="Valid · Verified · Duplicate · Suspect" />
      </div>
    </section>
  );
}

function DashboardBody({
  dashboard,
  activeBreakdown,
  setActiveBreakdown,
}: {
  dashboard: DashboardPayload;
  activeBreakdown: BreakdownKey;
  setActiveBreakdown: (value: BreakdownKey) => void;
}) {
  const storageReady = dashboard.integrations.storage === "ready";
  // A current exact-range marker makes a zero-row Graph response an
  // authoritative zero, so readiness must not depend on daily row count.
  const metaReady = dashboard.integrations.meta === "ready";
  const exactMetaRangeReady = metaReady && dashboard.coverage.exactMetaRangeAvailable;
  const currentRows = dashboard.breakdowns[activeBreakdown];
  const websiteLanding =
    dashboard.funnels.website.find((stage) => stage.key === "landing")?.count ?? null;
  const websiteStart =
    dashboard.funnels.website.find((stage) => stage.key === "form_start")?.count ?? null;
  const websiteSubmit =
    dashboard.funnels.website.find((stage) => stage.key === "submit")?.count ?? null;

  const summaryCards = useMemo(
    () => [
      {
        label: "Spend",
        value: formatEuro(dashboard.totals.spendEur, metaReady),
        hint: metaReady
          ? `${dashboard.coverage.metaRowsRead} insight rows`
          : "Meta data unavailable",
      },
      {
        label: "Exact reach",
        value: formatNumber(dashboard.totals.reach, exactMetaRangeReady),
        hint: exactMetaRangeReady ? "No-breakdown exact range" : "Exact-range sync required",
      },
      {
        label: "Frequency",
        value: formatDecimal(dashboard.totals.frequency, exactMetaRangeReady),
        hint: "Exact campaign/date scope",
      },
      {
        label: "CPM",
        value: formatEuro(dashboard.totals.cpmEur, metaReady),
        hint: `${formatNumber(dashboard.totals.impressions, metaReady)} impressions`,
      },
      {
        label: "Link CTR",
        value: formatPercent(metaReady ? dashboard.totals.linkCtr : null),
        hint: `${formatNumber(dashboard.totals.linkClicks, metaReady)} link clicks`,
      },
      {
        label: "Link CPC",
        value: formatEuro(dashboard.totals.linkCpcEur, metaReady),
        hint: "Spend ÷ link clicks",
      },
      {
        label: "Valid leads",
        value: formatNumber(dashboard.totals.validLeads, storageReady),
        hint: `${formatNumber(dashboard.totals.suspectLeads, storageReady)} suspect · ${formatNumber(
          dashboard.totals.duplicateLeads,
          storageReady,
        )} duplicate`,
      },
      {
        label: "Paid valid-lead CPL",
        value: formatEuro(dashboard.totals.validLeadCpl, storageReady && metaReady),
        hint: `Spend ÷ ${formatNumber(
          dashboard.totals.paidAttributedValidLeads,
          storageReady,
        )} paid-attributed valid`,
        accent: true,
      },
      {
        label: "Verified phone CPL",
        value: formatEuro(dashboard.totals.phoneLeadCpl, storageReady && metaReady),
        hint: `Spend ÷ ${formatNumber(
          dashboard.totals.paidAttributedVerifiedPhoneLeads,
          storageReady,
        )} scoped valid + phone-verified leads`,
      },
      {
        label: "Landing sessions",
        value: formatNumber(websiteLanding, storageReady),
        hint: `Attribution ${formatPercent(dashboard.coverage.attributedLandingRate)}`,
      },
      {
        label: "Form starts",
        value: formatNumber(websiteStart, storageReady),
        hint: `Landing → start ${formatPercent(rate(websiteStart, websiteLanding))}`,
      },
      {
        label: "Submit attempts",
        value: formatNumber(websiteSubmit, storageReady),
        hint: `Start → submit ${formatPercent(rate(websiteSubmit, websiteStart))}`,
      },
      {
        label: "Meta form leads",
        value: formatNumber(dashboard.totals.instantFormMetaLeads, metaReady),
        hint: "Must reconcile to CRM",
      },
      {
        label: "Meta website Contact",
        value: formatNumber(dashboard.totals.websiteMetaContacts, metaReady),
        hint: "Reference signal · not the verified-phone CPL denominator",
      },
      {
        label: "Verified leads",
        value: formatNumber(dashboard.totals.verifiedLeads, storageReady),
        hint: `Email ${formatNumber(
          dashboard.totals.emailVerifiedLeads,
          storageReady,
        )} · Phone ${formatNumber(dashboard.totals.phoneVerifiedLeads, storageReady)}`,
      },
      {
        label: "CTA clicks",
        value: formatNumber(dashboard.totals.ctaClicks, storageReady),
        hint: `CTA view → click ${formatPercent(
          rate(dashboard.totals.ctaClicks, dashboard.totals.ctaViews),
        )}`,
      },
      {
        label: "Video completion",
        value: formatNumber(dashboard.totals.videoCompletions, storageReady),
        hint: `25% ${formatNumber(dashboard.totals.video25, storageReady)} → 50% ${formatNumber(
          dashboard.totals.video50,
          storageReady,
        )} → 75% ${formatNumber(dashboard.totals.video75, storageReady)}`,
      },
      {
        label: "Meta ad video",
        value: formatNumber(dashboard.totals.metaVideoThruplay, metaReady),
        hint: `3s ${formatNumber(dashboard.totals.metaVideo3s, metaReady)} · 25/50/75/95/100 ${[
          dashboard.totals.metaVideo25,
          dashboard.totals.metaVideo50,
          dashboard.totals.metaVideo75,
          dashboard.totals.metaVideo95,
          dashboard.totals.metaVideo100,
        ]
          .map((value) => formatNumber(value, metaReady))
          .join("/")}`,
      },
      {
        label: "Submit successes",
        value: formatNumber(dashboard.totals.submitSuccesses, storageReady),
        hint: `${formatNumber(dashboard.totals.submitErrors, storageReady)} submit errors`,
      },
      {
        label: "Paid-attributed valid",
        value: formatNumber(dashboard.totals.paidAttributedValidLeads, storageReady),
        hint: "Exact scoped CPL denominator",
      },
      {
        label: "Contact coverage",
        value: formatNumber(dashboard.totals.leadsWithEmail, storageReady),
        hint: `Email / ${formatNumber(
          dashboard.totals.totalLeads,
          storageReady,
        )} total · Phone ${formatNumber(dashboard.totals.leadsWithPhone, storageReady)}`,
      },
      {
        label: "Measurement consent",
        value: formatNumber(dashboard.totals.measurementConsentedLeads, storageReady),
        hint: `${formatPercent(
          rate(dashboard.totals.measurementConsentedLeads, dashboard.totals.totalLeads),
        )} of stored leads`,
      },
      {
        label: "CAPI delivery",
        value: `${formatNumber(dashboard.totals.capiSentLeads, storageReady)} / ${formatNumber(
          dashboard.totals.capiEligibleLeads,
          storageReady,
        )}`,
        hint: `${formatNumber(dashboard.totals.capiFailedLeads, storageReady)} failed · ${formatNumber(
          dashboard.totals.capiSkippedLeads,
          storageReady,
        )} skipped · ${formatNumber(dashboard.totals.metaEventsReceived, storageReady)} events`,
      },
      {
        label: "Browser Lead dispatch",
        value: formatNumber(dashboard.totals.metaBrowserLeadDispatches, storageReady),
        hint: "fbq enqueue only · receipt/dedupe는 Events Manager 확인",
      },
      {
        label: "Browser Contact dispatch",
        value: formatNumber(dashboard.totals.metaBrowserContactDispatches, storageReady),
        hint: "Phone submit fbq enqueue · Meta Contact와 교차 확인",
      },
    ],
    [
      dashboard,
      exactMetaRangeReady,
      metaReady,
      storageReady,
      websiteLanding,
      websiteStart,
      websiteSubmit,
    ],
  );

  return (
    <div className="wdops-dashboard">
      <section className="wdops-statusbar">
        <IntegrationBadge label="Storage" state={dashboard.integrations.storage} />
        <IntegrationBadge label="Meta Insights" state={dashboard.integrations.meta} />
        <IntegrationBadge
          label="Meta scope"
          state={dashboard.integrations.metaScopeConfigured ? "ready" : "unconfigured"}
        />
        <IntegrationBadge
          label="Verification webhook"
          state={dashboard.integrations.leadStatusWebhookConfigured ? "ready" : "unconfigured"}
        />
        <span className="wdops-status-time">
          Event {formatTimestamp(dashboard.coverage.latestEventAt)} · Lead{" "}
          {formatTimestamp(dashboard.coverage.latestLeadAt)} · Meta sync{" "}
          {formatTimestamp(dashboard.integrations.metaLastSyncedAt)}
        </span>
      </section>

      <section className="wdops-kpis" aria-label="Headline metrics">
        {summaryCards.map((card) => (
          <article
            className={`wdops-kpi${card.accent ? " wdops-kpi--accent" : ""}`}
            key={card.label}
          >
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <span>{card.hint}</span>
          </article>
        ))}
      </section>

      <section className="wdops-two-column">
        <FunnelPanel
          title="Website journey"
          subtitle="익명 세션 기준"
          stages={dashboard.funnels.website}
        />
        <FunnelPanel
          title="Instant Form journey"
          subtitle="Meta 집계 ↔ CRM 이벤트"
          stages={dashboard.funnels.instantForm}
        />
      </section>

      <section className="wdops-section">
        <div className="wdops-section-heading">
          <div>
            <p className="wdops-eyebrow">SEGMENT DIAGNOSTICS</p>
            <h2>어디에서 전환이 깨지는가</h2>
          </div>
          <p>
            유효 리드 우선, 다음으로 지출과 랜딩 세션 순입니다. “Unknown”은 숨기지 않고 데이터 품질
            문제로 남깁니다.
          </p>
        </div>
        <div className="wdops-tabs" role="tablist" aria-label="Breakdown dimension">
          {(Object.keys(BREAKDOWN_LABELS) as BreakdownKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeBreakdown === key}
              className={activeBreakdown === key ? "is-active" : ""}
              onClick={() => setActiveBreakdown(key)}
            >
              {BREAKDOWN_LABELS[key]}
            </button>
          ))}
        </div>
        <BreakdownTable rows={currentRows} storageReady={storageReady} metaReady={metaReady} />
      </section>

      <section className="wdops-two-column wdops-two-column--bottom">
        <HealthPanel items={dashboard.health} />
        <CoveragePanel dashboard={dashboard} />
      </section>

      <section className="wdops-section wdops-method">
        <div>
          <p className="wdops-eyebrow">METRIC CONTRACT</p>
          <h2>의사결정 기준</h2>
        </div>
        <div className="wdops-method-grid">
          <Definition
            number="A"
            title="Valid lead"
            text="status와 품질 규칙을 통과한 저장 리드. Meta 보고 리드와 동일시하지 않습니다."
          />
          <Definition
            number="B"
            title="Website conversion"
            text="서로 다른 익명 session_id 기준. 이벤트 행 수가 아닌 단계별 고유 세션입니다."
          />
          <Definition
            number="C"
            title="Instant reconciliation"
            text="Meta form lead → Webhook → CRM saved → Valid → Verified를 별도로 비교합니다."
          />
          <Definition
            number="D"
            title="Paid valid-lead CPL"
            text="동일한 Meta account·campaign 범위의 spend ÷ paid-attributed valid lead. 범위 밖 유입과 불완전한 데이터는 분모에서 제외합니다."
          />
          <Definition
            number="E"
            title="Verified phone CPL"
            text="동일 범위 spend ÷ valid이면서 phone_verified인 paid-attributed lead. Meta Contact와 브라우저 dispatch는 진단용 참고값이며 분모가 아닙니다."
          />
          <Definition
            number="F"
            title="Exact reach"
            text="선택한 날짜·account·campaign 전체를 breakdown 없이 다시 조회한 unique reach/frequency만 사용합니다. 일별 reach는 합산하지 않습니다."
          />
        </div>
      </section>

      <footer className="wdops-footer">
        Generated {formatTimestamp(dashboard.generatedAt)} KST · {dashboard.range.from} —{" "}
        {dashboard.range.to} · No PII returned
      </footer>
    </div>
  );
}

function IntegrationBadge({
  label,
  state,
}: {
  label: string;
  state: "ready" | "unconfigured" | "error" | "configured_no_data" | "stale";
}) {
  const mapping = {
    ready: { text: "ready", className: "good" },
    unconfigured: { text: "unconfigured", className: "warning" },
    error: { text: "error", className: "critical" },
    configured_no_data: { text: "no data", className: "warning" },
    stale: { text: "stale", className: "warning" },
  } as const;
  const value = mapping[state];
  return (
    <span className="wdops-integration">
      {label}
      <b className={value.className}>{value.text}</b>
    </span>
  );
}

function FunnelPanel({
  title,
  subtitle,
  stages,
}: {
  title: string;
  subtitle: string;
  stages: DashboardStage[];
}) {
  const firstCount = stages.find((stage) => stage.count !== null && stage.count > 0)?.count ?? null;

  return (
    <section className="wdops-panel">
      <div className="wdops-panel-heading">
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>
      <div className="wdops-funnel">
        {stages.map((stage, index) => {
          const width =
            stage.count === null || firstCount === null
              ? 0
              : Math.max(4, Math.min(100, (stage.count / firstCount) * 100));
          return (
            <div className="wdops-stage" key={stage.key}>
              <div className="wdops-stage-meta">
                <span>
                  <b>{String(index + 1).padStart(2, "0")}</b> {stage.label}
                </span>
                <strong>{formatNumber(stage.count)}</strong>
              </div>
              <div className={`wdops-stage-track${stage.count === null ? " is-empty" : ""}`}>
                <div style={{ width: `${width}%` }} />
              </div>
              <div className="wdops-stage-rates">
                <span>이전 단계 {formatPercent(stage.rateFromPrevious)}</span>
                <span>첫 단계 {formatPercent(stage.rateFromFirst)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BreakdownTable({
  rows,
  storageReady,
  metaReady,
}: {
  rows: DashboardBreakdownRow[];
  storageReady: boolean;
  metaReady: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="wdops-empty">
        이 기간에는 해당 차원의 측정 행이 없습니다. 연결되지 않은 데이터는 0으로 추정하지 않습니다.
      </div>
    );
  }

  return (
    <div className="wdops-table-scroll">
      <table className="wdops-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Spend</th>
            <th>Impr.</th>
            <th>Landing</th>
            <th>Form start</th>
            <th>Submit</th>
            <th>Valid</th>
            <th>Paid valid</th>
            <th>Paid verified phone</th>
            <th>Verified</th>
            <th>Phone</th>
            <th>Consent</th>
            <th>CAPI sent</th>
            <th>Meta IF lead</th>
            <th>Meta Contact</th>
            <th>Meta video 3s → 100%</th>
            <th>Valid CPL</th>
            <th>Phone CPL</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row) => (
            <tr key={row.key}>
              <th title={row.key}>{row.label}</th>
              <td>{formatEuro(row.spendEur, metaReady)}</td>
              <td>{formatNumber(row.impressions, metaReady)}</td>
              <td>{formatNumber(row.landingSessions, storageReady)}</td>
              <td>{formatNumber(row.formStarts, storageReady)}</td>
              <td>{formatNumber(row.submitAttempts, storageReady)}</td>
              <td>{formatNumber(row.validLeads, storageReady)}</td>
              <td>{formatNumber(row.paidAttributedValidLeads, storageReady)}</td>
              <td>{formatNumber(row.paidAttributedVerifiedPhoneLeads, storageReady)}</td>
              <td>{formatNumber(row.verifiedLeads, storageReady)}</td>
              <td>{formatNumber(row.leadsWithPhone, storageReady)}</td>
              <td>{formatNumber(row.measurementConsentedLeads, storageReady)}</td>
              <td>
                {formatNumber(row.capiSentLeads, storageReady)} /{" "}
                {formatNumber(row.capiEligibleLeads, storageReady)}
              </td>
              <td>{formatNumber(row.instantFormMetaLeads, metaReady)}</td>
              <td>{formatNumber(row.websiteMetaContacts, metaReady)}</td>
              <td>
                {formatNumber(row.metaVideo3s, metaReady)} →{" "}
                {formatNumber(row.metaVideo100, metaReady)}
              </td>
              <td>{formatEuro(row.validLeadCpl, storageReady && metaReady)}</td>
              <td>{formatEuro(row.phoneLeadCpl, storageReady && metaReady)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthPanel({ items }: { items: DashboardHealthItem[] }) {
  return (
    <section className="wdops-panel">
      <div className="wdops-panel-heading">
        <h2>Data health</h2>
        <span>경고를 수치보다 먼저 확인</span>
      </div>
      <div className="wdops-health-list">
        {items.map((item) => (
          <article className={`wdops-health wdops-health--${item.severity}`} key={item.code}>
            <span>{item.severity === "good" ? "✓" : item.severity === "info" ? "i" : "!"}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CoveragePanel({ dashboard }: { dashboard: DashboardPayload }) {
  const rows = [
    ["Event rows read", formatNumber(dashboard.coverage.eventRowsRead)],
    ["Lead rows read", formatNumber(dashboard.coverage.leadRowsRead)],
    ["Meta rows read", formatNumber(dashboard.coverage.metaRowsRead)],
    ["Landing attributed", formatPercent(dashboard.coverage.attributedLandingRate)],
    ["Lead attributed", formatPercent(dashboard.coverage.attributedLeadRate)],
    ["Event freshness", formatTimestamp(dashboard.coverage.latestEventAt)],
    ["Lead freshness", formatTimestamp(dashboard.coverage.latestLeadAt)],
    ["Exact Meta range", formatTimestamp(dashboard.coverage.exactMetaRangeSyncedAt)],
    ["Schema", dashboard.coverage.schemaVersions.join(", ") || "—"],
    ["Aggregation", "Exact SQL · 90-day bounded"],
  ];

  return (
    <section className="wdops-panel">
      <div className="wdops-panel-heading">
        <h2>Measurement coverage</h2>
        <span>읽기 범위와 귀속 완성도</span>
      </div>
      <dl className="wdops-coverage">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Definition({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <article className="wdops-definition">
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </article>
  );
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function DashboardStyles() {
  return (
    <style>{`
      .wdops-shell {
        --ops-ink: #f4f7f5;
        --ops-muted: #96a39c;
        --ops-line: rgba(232, 241, 236, 0.13);
        --ops-panel: rgba(21, 29, 26, 0.84);
        --ops-panel-2: rgba(29, 40, 35, 0.72);
        --ops-acid: #bdf541;
        --ops-aqua: #66e5d0;
        --ops-red: #ff746c;
        --ops-amber: #ffc857;
        min-height: 100vh;
        color: var(--ops-ink);
        background:
          radial-gradient(circle at 85% -10%, rgba(102, 229, 208, 0.13), transparent 34rem),
          radial-gradient(circle at 4% 18%, rgba(189, 245, 65, 0.08), transparent 25rem),
          #0a0e0d;
        font-family: "Work Sans", ui-sans-serif, system-ui, sans-serif;
      }
      .wdops-shell * { box-sizing: border-box; }
      .wdops-wrap { width: min(1520px, 100%); margin: 0 auto; padding: 42px 28px 64px; }
      .wdops-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
      .wdops-header h1 { margin: 5px 0 8px; font-size: clamp(2.25rem, 4.2vw, 4.8rem); line-height: .96; letter-spacing: -.055em; }
      .wdops-eyebrow { margin: 0; color: var(--ops-acid); font-size: .7rem; font-weight: 800; letter-spacing: .18em; }
      .wdops-subtitle { margin: 0; color: var(--ops-muted); font-size: 1rem; }
      .wdops-lock { padding: 10px 14px; border: 1px solid var(--ops-line); border-radius: 999px; color: var(--ops-muted); font-size: .74rem; white-space: nowrap; }
      .wdops-controls { display: grid; grid-template-columns: minmax(240px, 1.6fr) repeat(2, minmax(140px, .7fr)) auto; gap: 10px; margin-top: 34px; padding: 14px; border: 1px solid var(--ops-line); border-radius: 18px; background: rgba(10, 14, 13, .74); backdrop-filter: blur(18px); }
      .wdops-controls label { display: grid; gap: 6px; }
      .wdops-controls label span { color: var(--ops-muted); font-size: .67rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .wdops-controls input { width: 100%; min-height: 43px; border: 1px solid var(--ops-line); border-radius: 10px; padding: 0 12px; color: var(--ops-ink); background: #111714; outline: none; }
      .wdops-controls input:focus { border-color: var(--ops-aqua); box-shadow: 0 0 0 3px rgba(102, 229, 208, .1); }
      .wdops-primary { align-self: end; min-height: 43px; border: 0; border-radius: 10px; padding: 0 20px; color: #09100d; background: var(--ops-acid); font-weight: 800; cursor: pointer; }
      .wdops-primary:disabled { cursor: wait; opacity: .62; }
      .wdops-ranges { grid-column: 1 / -1; display: flex; gap: 7px; }
      .wdops-ranges button, .wdops-tabs button { border: 1px solid var(--ops-line); border-radius: 999px; padding: 6px 10px; color: var(--ops-muted); background: transparent; font-size: .72rem; cursor: pointer; }
      .wdops-ranges button:hover, .wdops-tabs button:hover { color: var(--ops-ink); border-color: rgba(232, 241, 236, .3); }
      .wdops-live-control { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; min-height: 28px; color: var(--ops-muted); font-size: .7rem; }
      .wdops-live-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--ops-muted); opacity: .6; }
      .wdops-live-dot.is-live { background: var(--ops-acid); opacity: 1; box-shadow: 0 0 0 4px rgba(189, 245, 65, .09); }
      .wdops-live-dot.is-error { background: var(--ops-red); opacity: 1; box-shadow: 0 0 0 4px rgba(255, 116, 108, .09); }
      .wdops-live-status { color: var(--ops-ink); font-weight: 650; }
      .wdops-live-freshness { font: .65rem ui-monospace, SFMono-Regular, Menlo, monospace; }
      .wdops-live-toggle { margin-left: auto; border: 1px solid var(--ops-line); border-radius: 999px; padding: 5px 10px; color: var(--ops-muted); background: transparent; font-size: .68rem; cursor: pointer; }
      .wdops-live-toggle:hover { color: var(--ops-ink); border-color: rgba(232, 241, 236, .3); }
      .wdops-alert { margin-top: 16px; padding: 12px 14px; border-radius: 12px; font-size: .85rem; }
      .wdops-alert--critical { border: 1px solid rgba(255, 116, 108, .4); color: #ffaaa5; background: rgba(255, 116, 108, .08); }
      .wdops-locked { display: grid; place-items: center; min-height: 440px; margin-top: 20px; border: 1px solid var(--ops-line); border-radius: 22px; padding: 50px 24px; text-align: center; background: linear-gradient(150deg, rgba(23, 32, 28, .9), rgba(13, 18, 16, .72)); }
      .wdops-locked-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 50%; color: #09100d; background: var(--ops-acid); font-size: 1.5rem; font-weight: 900; transform: rotate(-20deg); }
      .wdops-locked h2 { max-width: 660px; margin: 22px 0 9px; font-size: clamp(1.45rem, 3vw, 2.5rem); letter-spacing: -.04em; }
      .wdops-locked > p { max-width: 720px; margin: 0; color: var(--ops-muted); line-height: 1.65; }
      .wdops-definition-grid, .wdops-method-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: min(920px, 100%); margin-top: 32px; text-align: left; }
      .wdops-definition { display: flex; gap: 12px; padding: 15px; border: 1px solid var(--ops-line); border-radius: 14px; background: rgba(255, 255, 255, .018); }
      .wdops-definition > span { flex: 0 0 auto; color: var(--ops-acid); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; }
      .wdops-definition strong { display: block; font-size: .84rem; }
      .wdops-definition p { margin: 5px 0 0; color: var(--ops-muted); font-size: .72rem; line-height: 1.48; }
      .wdops-dashboard { margin-top: 18px; }
      .wdops-statusbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 12px; border: 1px solid var(--ops-line); border-radius: 12px; background: rgba(255, 255, 255, .02); }
      .wdops-integration { display: inline-flex; align-items: center; gap: 7px; color: var(--ops-muted); font-size: .7rem; }
      .wdops-integration b { border-radius: 99px; padding: 3px 7px; font-size: .62rem; text-transform: uppercase; }
      .wdops-integration b.good { color: var(--ops-acid); background: rgba(189, 245, 65, .1); }
      .wdops-integration b.warning { color: var(--ops-amber); background: rgba(255, 200, 87, .1); }
      .wdops-integration b.critical { color: var(--ops-red); background: rgba(255, 116, 108, .1); }
      .wdops-status-time { margin-left: auto; color: var(--ops-muted); font: .65rem ui-monospace, SFMono-Regular, Menlo, monospace; }
      .wdops-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px; }
      .wdops-kpi { min-width: 0; padding: 18px; border: 1px solid var(--ops-line); border-radius: 16px; background: var(--ops-panel); }
      .wdops-kpi--accent { border-color: rgba(189, 245, 65, .36); background: linear-gradient(145deg, rgba(189, 245, 65, .12), var(--ops-panel)); }
      .wdops-kpi p { margin: 0; color: var(--ops-muted); font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
      .wdops-kpi strong { display: block; overflow: hidden; margin-top: 12px; font-size: clamp(1.7rem, 3vw, 2.8rem); line-height: 1; letter-spacing: -.055em; text-overflow: ellipsis; }
      .wdops-kpi span { display: block; margin-top: 10px; color: var(--ops-muted); font-size: .68rem; }
      .wdops-two-column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
      .wdops-panel, .wdops-section { border: 1px solid var(--ops-line); border-radius: 18px; background: var(--ops-panel); }
      .wdops-panel { padding: 20px; }
      .wdops-panel-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      .wdops-panel-heading h2, .wdops-section-heading h2, .wdops-method h2 { margin: 0; font-size: 1.2rem; letter-spacing: -.035em; }
      .wdops-panel-heading span { color: var(--ops-muted); font-size: .68rem; }
      .wdops-funnel { display: grid; gap: 12px; margin-top: 20px; }
      .wdops-stage-meta { display: flex; justify-content: space-between; gap: 16px; font-size: .76rem; }
      .wdops-stage-meta span { color: #c8d1cc; }
      .wdops-stage-meta span b { margin-right: 7px; color: var(--ops-muted); font: .64rem ui-monospace, SFMono-Regular, Menlo, monospace; }
      .wdops-stage-meta strong { font-size: .86rem; }
      .wdops-stage-track { height: 7px; margin-top: 6px; overflow: hidden; border-radius: 99px; background: rgba(255, 255, 255, .055); }
      .wdops-stage-track > div { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--ops-aqua), var(--ops-acid)); }
      .wdops-stage-track.is-empty { border: 1px dashed var(--ops-line); background: transparent; }
      .wdops-stage-rates { display: flex; justify-content: space-between; margin-top: 5px; color: var(--ops-muted); font-size: .62rem; }
      .wdops-section { margin-top: 10px; padding: 22px; }
      .wdops-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; }
      .wdops-section-heading h2 { margin-top: 5px; font-size: 1.55rem; }
      .wdops-section-heading > p { max-width: 560px; margin: 0; color: var(--ops-muted); font-size: .72rem; line-height: 1.5; }
      .wdops-tabs { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 20px; }
      .wdops-tabs button.is-active { color: #08100d; border-color: var(--ops-acid); background: var(--ops-acid); font-weight: 800; }
      .wdops-table-scroll { overflow-x: auto; margin-top: 14px; border: 1px solid var(--ops-line); border-radius: 13px; }
      .wdops-table { width: 100%; border-collapse: collapse; min-width: 1050px; font-size: .72rem; }
      .wdops-table th, .wdops-table td { border-bottom: 1px solid var(--ops-line); padding: 11px 12px; text-align: right; white-space: nowrap; }
      .wdops-table thead th { position: sticky; top: 0; color: var(--ops-muted); background: #121815; font-size: .62rem; text-transform: uppercase; letter-spacing: .06em; }
      .wdops-table th:first-child { max-width: 300px; text-align: left; overflow: hidden; text-overflow: ellipsis; }
      .wdops-table tbody th { color: var(--ops-ink); font-weight: 600; }
      .wdops-table tbody tr:last-child th, .wdops-table tbody tr:last-child td { border-bottom: 0; }
      .wdops-table tbody tr:hover { background: rgba(189, 245, 65, .025); }
      .wdops-empty { margin-top: 14px; border: 1px dashed var(--ops-line); border-radius: 13px; padding: 30px; color: var(--ops-muted); text-align: center; font-size: .78rem; }
      .wdops-two-column--bottom { align-items: start; }
      .wdops-health-list { display: grid; gap: 8px; margin-top: 18px; }
      .wdops-health { display: grid; grid-template-columns: 25px 1fr; gap: 10px; padding: 12px; border: 1px solid var(--ops-line); border-radius: 12px; }
      .wdops-health > span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: .7rem; font-weight: 900; }
      .wdops-health strong { font-size: .76rem; }
      .wdops-health p { margin: 4px 0 0; color: var(--ops-muted); font-size: .68rem; line-height: 1.45; }
      .wdops-health--good > span { color: #09100d; background: var(--ops-acid); }
      .wdops-health--warning > span { color: #1a1200; background: var(--ops-amber); }
      .wdops-health--critical > span { color: #1a0504; background: var(--ops-red); }
      .wdops-health--info > span { color: #041512; background: var(--ops-aqua); }
      .wdops-coverage { margin: 18px 0 0; }
      .wdops-coverage > div { display: flex; justify-content: space-between; gap: 20px; padding: 10px 0; border-bottom: 1px solid var(--ops-line); }
      .wdops-coverage > div:last-child { border-bottom: 0; }
      .wdops-coverage dt { color: var(--ops-muted); font-size: .7rem; }
      .wdops-coverage dd { margin: 0; font: .72rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
      .wdops-cap-warning { margin: 12px 0 0; border-radius: 10px; padding: 10px; color: var(--ops-red); background: rgba(255, 116, 108, .08); font-size: .68rem; }
      .wdops-method { display: grid; grid-template-columns: minmax(180px, .5fr) 2fr; gap: 30px; align-items: start; }
      .wdops-method h2 { margin-top: 5px; font-size: 1.5rem; }
      .wdops-method-grid { grid-template-columns: repeat(2, 1fr); width: auto; margin-top: 0; }
      .wdops-footer { padding: 20px 2px 0; color: var(--ops-muted); font: .62rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
      @media (max-width: 980px) {
        .wdops-controls { grid-template-columns: repeat(2, 1fr); }
        .wdops-primary { align-self: stretch; }
        .wdops-kpis { grid-template-columns: repeat(2, 1fr); }
        .wdops-two-column { grid-template-columns: 1fr; }
        .wdops-section-heading { align-items: flex-start; flex-direction: column; gap: 10px; }
        .wdops-method { grid-template-columns: 1fr; }
      }
      @media (max-width: 620px) {
        .wdops-wrap { padding: 28px 14px 44px; }
        .wdops-header { align-items: flex-start; flex-direction: column; }
        .wdops-lock { white-space: normal; }
        .wdops-controls { grid-template-columns: 1fr; }
        .wdops-controls label, .wdops-primary { grid-column: 1; }
        .wdops-live-control { flex-wrap: wrap; }
        .wdops-live-freshness { width: calc(100% - 20px); margin-left: 15px; }
        .wdops-live-toggle { margin-left: auto; }
        .wdops-kpis { grid-template-columns: 1fr; }
        .wdops-definition-grid, .wdops-method-grid { grid-template-columns: 1fr; }
        .wdops-status-time { width: 100%; margin-left: 0; }
        .wdops-stage-rates { gap: 10px; }
      }
    `}</style>
  );
}
