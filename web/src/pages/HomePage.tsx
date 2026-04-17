import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RecentPayload, type StatsPayload } from "../api";
import { relTime, shortProject } from "../lib/format";

export function HomePage() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [recent, setRecent] = useState<RecentPayload | null>(null);
  const [days, setDays] = useState<7 | 30>(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    setRecent(null);
    api.recent(days).then(setRecent).catch((e) => setError((e as Error).message));
  }, [days]);

  if (error) {
    return <div className="text-red-600 dark:text-red-400 text-sm">Failed to load: {error}</div>;
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-lg font-semibold mb-3">Overview</h1>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Sessions" value={stats?.totalSessions} />
          <StatCard label="Parsed" value={stats?.parsedSessions} />
          <StatCard label="Summarized" value={stats?.summarizedSessions} />
          <StatCard label="Host" value={stats?.hostId} mono />
        </div>
        {stats && (
          <div className="text-xs text-faint mt-2">
            data dir: <span className="text-dim">{stats.dataDir}</span>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <div className="flex gap-1 text-xs">
            <RangeButton active={days === 7} onClick={() => setDays(7)}>
              7d
            </RangeButton>
            <RangeButton active={days === 30} onClick={() => setDays(30)}>
              30d
            </RangeButton>
          </div>
        </div>

        {!recent && <div className="text-faint text-sm">Loading…</div>}
        {recent && recent.projects.length === 0 && (
          <div className="text-faint text-sm">No activity in the last {days} days.</div>
        )}
        {recent && recent.projects.length > 0 && (
          <ProjectTable projects={recent.projects} totalSessions={recent.totalSessions} />
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: number | string | undefined;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-bg-elev px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-1 text-xl ${mono ? "text-sm font-mono text-dim" : "font-semibold"}`}>
        {value === undefined ? "…" : typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded border ${
        active
          ? "bg-accent text-accent-text border-accent"
          : "border-border text-dim hover:text-text hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}

function ProjectTable({
  projects,
  totalSessions,
}: {
  projects: RecentPayload["projects"];
  totalSessions: number;
}) {
  const max = projects.reduce((acc, p) => Math.max(acc, p.session_count), 0) || 1;
  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="bg-bg-elev px-4 py-2 text-xs text-faint flex justify-between">
        <span>{projects.length} project(s)</span>
        <span>{totalSessions} sessions total</span>
      </div>
      <ul className="divide-y divide-border">
        {projects.map((p) => (
          <li key={p.project_dir}>
            <Link
              to={`/p?dir=${encodeURIComponent(p.project_dir)}`}
              className="px-4 py-3 flex items-center gap-4 hover:bg-bg-elev"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text truncate" title={p.project_dir}>
                  {shortProject(p.project_dir)}
                </div>
                <div className="text-xs text-faint truncate">{p.project_dir}</div>
              </div>
              <div className="w-24 text-right text-xs text-dim">{relTime(p.last_active_at)}</div>
              <div className="w-32 hidden sm:block">
                <div className="h-1.5 bg-bg-sunk rounded overflow-hidden">
                  <div
                    className="h-full bg-dim"
                    style={{ width: `${(p.session_count / max) * 100}%` }}
                  />
                </div>
              </div>
              <div className="w-12 text-right tabular-nums text-sm">{p.session_count}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
