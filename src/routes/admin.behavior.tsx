import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import type { BehaviorReport } from "@/lib/adminBehaviorReport";
import { getBehaviorReport, signInBehaviorAdmin } from "@/lib/api/adminBehavior.functions";

export const Route = createFileRoute("/admin/behavior")({
  head: () => ({
    meta: [
      { title: "Watch Dive 페이지 측정" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: () => getBehaviorReport(),
  component: BehaviorAdminPage,
});

function BehaviorAdminPage() {
  const initial = Route.useLoaderData();
  const [state, setState] = useState(initial);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [rejected, setRejected] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setRejected(false);
    const result = await signInBehaviorAdmin({ data: { password } });
    if (!result.ok) {
      setRejected(result.reason === "rejected");
      setPending(false);
      return;
    }
    setState(await getBehaviorReport());
    setPassword("");
    setPending(false);
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-muted-foreground">Watch Dive</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">페이지 측정</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          허용을 누른 방문만 표시합니다. 이메일, 전화번호, IP, 나이, 성별은 여기 없습니다.
        </p>
        {state.ok ? <Report report={state.report} /> : <Gate
          reason={state.reason}
          password={password}
          pending={pending}
          rejected={rejected}
          onPassword={setPassword}
          onSubmit={submit}
        />}
      </div>
    </main>
  );
}

function Gate({
  reason,
  password,
  pending,
  rejected,
  onPassword,
  onSubmit,
}: {
  reason: "unconfigured" | "locked";
  password: string;
  pending: boolean;
  rejected: boolean;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  if (reason === "unconfigured") {
    return (
      <p className="mt-8 text-sm">
        관리자 비밀번호가 서버에 없습니다. 12자 이상인 WATCHDIVE_ADMIN_PASSWORD 가 필요합니다.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-sm space-y-3">
      <label className="block text-sm" htmlFor="admin-password">
        비밀번호
      </label>
      <input
        id="admin-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => onPassword(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        들어가기
      </button>
      {rejected ? <p className="text-sm text-muted-foreground">비밀번호가 맞지 않습니다.</p> : null}
    </form>
  );
}

function Report({ report }: { report: BehaviorReport }) {
  return (
    <div className="mt-8 space-y-8">
      {!report.configured ? (
        <p className="text-sm text-muted-foreground">
          NOTION_UX_DB_ID 가 없어 아직 저장된 방문이 없습니다.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="최근 방문" value={String(report.sessions)} />
        <Stat label="평균 체류" value={`${report.meanDuration}초`} />
        <Stat label="평균 스크롤" value={`${report.meanScroll}%`} />
        <Stat label="많이 누른 곳" value={report.topClicks[0]?.name ?? "—"} />
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <CountList title="기기" rows={report.devices} />
        <CountList title="국가" rows={report.countries} />
        <CountList title="클릭" rows={report.topClicks} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">시간</th>
              <th className="py-2 pr-3 font-medium">언어</th>
              <th className="py-2 pr-3 font-medium">기기</th>
              <th className="py-2 pr-3 font-medium">국가</th>
              <th className="py-2 pr-3 font-medium">체류</th>
              <th className="py-2 pr-3 font-medium">스크롤</th>
              <th className="py-2 font-medium">클릭</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.when}-${row.locale}-${row.viewport}`} className="border-t border-border">
                <td className="py-2 pr-3">{row.when}</td>
                <td className="py-2 pr-3">{row.locale}</td>
                <td className="py-2 pr-3">{row.device}</td>
                <td className="py-2 pr-3">{row.country || "—"}</td>
                <td className="py-2 pr-3">{row.durationSec}초</td>
                <td className="py-2 pr-3">{row.scroll}%</td>
                <td className="py-2">{row.clicks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function CountList({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  return (
    <section>
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {rows.length === 0 ? <li>—</li> : null}
        {rows.map((row) => (
          <li key={row.name}>
            {row.name} · {row.count}
          </li>
        ))}
      </ul>
    </section>
  );
}
