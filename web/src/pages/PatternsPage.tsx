import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type FindingRecord,
  type PatternRun,
  type PatternRunSourceItem,
  type PatternsJob,
  type PatternsPlan,
  type PatternsPlanResponse,
} from "../api";
import { ErrorBox } from "../components/Spinner";
import { absTime, formatNumber, relTime, shortProject, shortSessionId } from "../lib/format";

const KIND_LABELS: Record<string, string> = {
  repetition: "Repetition",
  correction_pattern: "Correction pattern",
  friction: "Friction",
  skill_gap: "Skill gap",
  codebase_smell: "Codebase smell",
  documentation_gap: "Documentation gap",
  test_coverage_gap: "Test coverage gap",
  api_friction: "API friction",
};

const KIND_ACCENT: Record<string, string> = {
  repetition:
    "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/60",
  correction_pattern:
    "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300 dark:bg-fuchsia-950/60 dark:text-fuchsia-300 dark:border-fuchsia-800/60",
  friction:
    "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60",
  skill_gap:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60",
  codebase_smell:
    "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60",
  documentation_gap:
    "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/60",
  test_coverage_gap:
    "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/60",
  api_friction:
    "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/60",
};

/** Reused by the /patterns (global) route and the per-project patterns card. */
export function PatternsPage({ scope: fixedScope }: { scope?: "project" | "global" } = {}) {
  const [params, setParams] = useSearchParams();
  const paramScope = (params.get("scope") ?? fixedScope ?? "global") as "project" | "global";
  const scope: "project" | "global" = fixedScope ?? paramScope;
  const dirsParam = params.get("dirs");
  const initialDirs = dirsParam ? dirsParam.split(",").filter(Boolean) : [];

  const [selectedDirs, setSelectedDirs] = useState<string[]>(initialDirs);
  const [planResp, setPlanResp] = useState<PatternsPlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [model, setModel] = useState<string>("");
  const [limit, setLimit] = useState<number>(80);
  const [language, setLanguage] = useState<string>("auto");

  const [runs, setRuns] = useState<PatternRun[] | null>(null);
  const [findings, setFindings] = useState<FindingRecord[] | null>(null);
  const [viewingRun, setViewingRun] = useState<PatternRun | null>(null);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const [sources, setSources] = useState<PatternRunSourceItem[] | null>(null);

  const [runError, setRunError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<PatternsJob | null>(null);

  // Refresh plan + runs whenever scope or selected dirs change.
  useEffect(() => {
    void refreshPlan();
    void refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedDirs.join(",")]);

  useEffect(() => {
    const runId = params.get("run") ?? undefined;
    void loadFindings(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("run")]);

  useEffect(() => {
    if (planResp && model === "") {
      setModel(planResp.suggested_models[0]?.id ?? planResp.default_model);
    }
  }, [planResp, model]);

  useEffect(() => {
    if (!model) return;
    void refreshPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, limit]);

  const refreshPlan = async () => {
    if (scope === "project" && selectedDirs.length === 0) {
      // Still need plan data (projects list) even before user picks dirs.
      // Call with an impossible filter to get projects list + zero plan.
      setPlanning(true);
      setPlanError(null);
      try {
        const res = await api.patternsPlan({
          scope: "project",
          project_dirs: ["__placeholder_no_such_dir__"],
          limit,
          model: model || undefined,
        });
        setPlanResp(res);
      } catch (e) {
        // 400 is expected ("at least one project_dir"); fetch projects via a
        // throwaway global plan call to populate the picker.
        try {
          const globalRes = await api.patternsPlan({ scope: "global", limit, model: model || undefined });
          setPlanResp({ ...globalRes, scope: "project", plan: { ...globalRes.plan, summary_count: 0, candidates: [] } });
        } catch (ee) {
          setPlanError((ee as Error).message);
        }
      } finally {
        setPlanning(false);
      }
      return;
    }

    setPlanning(true);
    setPlanError(null);
    try {
      const res = await api.patternsPlan({
        scope,
        project_dirs: scope === "project" ? selectedDirs : undefined,
        limit,
        model: model || undefined,
      });
      setPlanResp(res);
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  const refreshRuns = async () => {
    try {
      const { runs } = await api.patternsRuns({
        scope,
        project_dir: scope === "project" && selectedDirs.length > 0 ? selectedDirs[0] : undefined,
      });
      setRuns(runs);
    } catch (e) {
      setFindingsError((e as Error).message);
    }
  };

  const loadFindings = async (runId?: string) => {
    setFindingsError(null);
    try {
      const [findingsRes, sourcesRes] = await Promise.all([
        api.patternsFindings(runId ? { run_id: runId } : {}),
        api.patternsSources(runId),
      ]);
      setFindings(findingsRes.findings);
      setViewingRun(findingsRes.run);
      setSources(sourcesRes.sources);
    } catch (e) {
      setFindingsError((e as Error).message);
    }
  };

  const startRun = async () => {
    setRunError(null);
    try {
      const { job_id } = await api.patternsRun({
        scope,
        project_dirs: scope === "project" ? selectedDirs : undefined,
        limit,
        model,
        language,
      });
      setJobId(job_id);
    } catch (e) {
      setRunError((e as Error).message);
    }
  };

  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const { job } = await api.patternsJob(jobId);
        if (job) setJob(job);
        if (job && (job.status === "done" || job.status === "error")) {
          if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (job.status === "done" && job.run_id) {
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.set("run", job.run_id!);
              return next;
            });
            void refreshRuns();
          }
        }
      } catch {
        /* transient */
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 2000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const findingsByKind = useMemo(() => {
    if (!findings) return null;
    const groups = new Map<string, FindingRecord[]>();
    for (const f of findings) {
      const list = groups.get(f.kind) ?? [];
      list.push(f);
      groups.set(f.kind, list);
    }
    return groups;
  }, [findings]);

  const toggleDir = (dir: string) => {
    setSelectedDirs((prev) => (prev.includes(dir) ? prev.filter((d) => d !== dir) : [...prev, dir]));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link to="/" className="text-xs text-faint hover:text-dim">← Home</Link>
        <div className="flex items-baseline gap-3 mt-1">
          <h1 className="text-lg font-semibold">Patterns</h1>
          <ScopeTabs
            scope={scope}
            disabled={!!fixedScope}
            onChange={(s) => {
              setParams((p) => {
                const next = new URLSearchParams(p);
                next.set("scope", s);
                next.delete("run");
                return next;
              });
            }}
          />
        </div>
        <p className="text-sm text-dim mt-2">
          {scope === "project"
            ? "Project mode: find patterns within one logical project (pick one or more worktrees of the same repo). Remedies target the project's CLAUDE.md or project-specific skills."
            : "Global mode: find universal habits across all projects. Each finding must cite evidence from ≥2 distinct project_dirs. Remedies target ~/.claude/CLAUDE.md."}
        </p>
      </div>

      {scope === "project" && planResp && (
        <ProjectPicker
          projects={planResp.projects}
          selected={selectedDirs}
          onToggle={toggleDir}
          onClear={() => setSelectedDirs([])}
        />
      )}

      {planError && <ErrorBox message={planError} />}

      {planResp && (scope === "global" || selectedDirs.length > 0) && (
        <PlanSection
          plan={planResp.plan}
          scope={scope}
          totalEnriched={planResp.total_enriched_summaries}
          totalSummaries={planResp.total_summaries}
          llmAvailable={planResp.llm_available}
          suggestedModels={planResp.suggested_models}
          model={model}
          setModel={setModel}
          limit={limit}
          setLimit={setLimit}
          language={language}
          setLanguage={setLanguage}
          onRefresh={refreshPlan}
          onRun={startRun}
          planning={planning}
          running={jobId !== null && job?.status !== "done" && job?.status !== "error"}
        />
      )}

      {runError && <ErrorBox message={runError} />}
      {jobId && job && (
        <JobProgress
          job={job}
          onReset={() => {
            setJobId(null);
            setJob(null);
          }}
        />
      )}

      {runs && runs.length > 0 && (
        <RunHistory
          runs={runs}
          selectedRunId={viewingRun?.run_id ?? null}
          onSelect={(runId) => {
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.set("run", runId);
              return next;
            });
          }}
        />
      )}

      {findingsError && <ErrorBox message={findingsError} />}
      {findings !== null && (
        <FindingsList
          findings={findings}
          findingsByKind={findingsByKind!}
          run={viewingRun}
        />
      )}
      {sources !== null && sources.length > 0 && <SourcesList sources={sources} />}
    </div>
  );
}

function ScopeTabs({
  scope,
  disabled,
  onChange,
}: {
  scope: "project" | "global";
  disabled?: boolean;
  onChange: (s: "project" | "global") => void;
}) {
  if (disabled) {
    return (
      <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-bg-sunk text-dim">
        {scope}
      </span>
    );
  }
  return (
    <div className="flex gap-0 rounded border border-border overflow-hidden text-xs">
      {(["global", "project"] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`px-3 py-1 transition-colors ${
            scope === s
              ? "bg-accent text-accent-text"
              : "bg-bg-elev text-dim hover:text-text"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ProjectPicker({
  projects,
  selected,
  onToggle,
  onClear,
}: {
  projects: Array<{ project_dir: string; count: number }>;
  selected: string[];
  onToggle: (dir: string) => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = filter
    ? projects.filter((p) => p.project_dir.includes(filter))
    : projects;

  return (
    <section className="rounded border border-border bg-bg-elev/60 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-elev/80">
        <div className="text-xs uppercase tracking-wide text-dim">
          Pick project(s)
        </div>
        <div className="text-[11px] text-faint">
          {selected.length} selected · worktrees of the same repo should be checked together
        </div>
        <div className="ml-auto flex gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter substring…"
            className="rounded border border-border-strong bg-bg px-2 py-1 text-xs w-40"
          />
          {selected.length > 0 && (
            <button
              onClick={onClear}
              className="px-2 py-1 rounded border border-border-strong text-xs hover:border-border-strong"
            >
              Clear
            </button>
          )}
        </div>
      </header>
      <ul className="divide-y divide-border max-h-60 overflow-y-auto">
        {visible.map((p) => {
          const checked = selected.includes(p.project_dir);
          return (
            <li key={p.project_dir}>
              <label
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-bg-elev/80 ${
                  checked ? "" : "opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(p.project_dir)}
                  className="accent-accent"
                />
                <span className="text-sm text-text flex-1 truncate">
                  {shortProject(p.project_dir)}{" "}
                  <span className="text-[11px] text-faint font-mono">({p.project_dir})</span>
                </span>
                <span className="text-[11px] text-faint tabular-nums shrink-0">
                  {p.count} summaries
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-4 py-3 text-sm text-faint">No projects match filter.</li>
        )}
      </ul>
    </section>
  );
}

function PlanSection({
  plan,
  scope,
  totalEnriched,
  totalSummaries,
  llmAvailable,
  suggestedModels,
  model,
  setModel,
  limit,
  setLimit,
  language,
  setLanguage,
  onRefresh,
  onRun,
  planning,
  running,
}: {
  plan: PatternsPlan;
  scope: "project" | "global";
  totalEnriched: number;
  totalSummaries: number;
  llmAvailable: boolean;
  suggestedModels: Array<{ id: string; label: string }>;
  model: string;
  setModel: (m: string) => void;
  limit: number;
  setLimit: (n: number) => void;
  language: string;
  setLanguage: (l: string) => void;
  onRefresh: () => void;
  onRun: () => void;
  planning: boolean;
  running: boolean;
}) {
  const cost = plan.est_cost_usd === null ? "—" : `$${plan.est_cost_usd.toFixed(4)}`;
  const staleSummaries = totalSummaries - totalEnriched;

  return (
    <section className="rounded border border-border bg-bg-elev/60 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text">
          New {scope} run
        </h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
          추정치 · estimate
        </span>
      </div>

      {totalEnriched === 0 && (
        <ErrorBox
          message={
            staleSummaries > 0
              ? `No enriched summaries match this scope. You have ${staleSummaries} summaries at signals_version=0; re-run Analyze to upgrade them.`
              : "No summaries yet for this scope. Run Analyze first."
          }
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Model">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded border border-border-strong bg-bg-elev px-3 py-2 text-sm"
          >
            {suggestedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Max summaries">
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(200, Number.parseInt(e.target.value, 10) || 1)))}
            className="w-full rounded border border-border-strong bg-bg-elev px-3 py-2 text-sm"
          />
        </Field>
        <Field label='Language (e.g. "auto", "en", "한국어")'>
          <input
            type="text"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="auto"
            className="w-full rounded border border-border-strong bg-bg-elev px-3 py-2 text-sm font-mono"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Summaries in scope" value={String(plan.summary_count)} />
        <Stat label="≈ Input tokens" value={formatNumber(plan.est_input_tokens)} small />
        <Stat label="≈ Output tokens" value={formatNumber(plan.est_output_tokens)} small />
        <Stat label="≈ Cost" value={cost} highlight />
      </div>

      <p className="text-[11px] text-faint leading-relaxed">{plan.notes}</p>

      <div className="flex items-center gap-3 sticky bottom-0 bg-bg/95 -mx-4 px-4 py-3 border-t border-border">
        <button
          onClick={onRun}
          disabled={!llmAvailable || plan.summary_count === 0 || running || planning}
          className="px-4 py-2 rounded border border-accent bg-accent text-accent-text text-sm font-medium hover:opacity-90 disabled:opacity-30"
        >
          Run on {plan.summary_count} summaries
        </button>
        <button
          onClick={onRefresh}
          disabled={planning}
          className="px-4 py-2 rounded border border-border-strong text-sm hover:border-border-strong disabled:opacity-50"
        >
          {planning ? "Refreshing…" : "Refresh"}
        </button>
        {!llmAvailable && (
          <span className="text-xs text-amber-700 dark:text-amber-300 ml-auto">
            Set API key on <Link to="/analyze" className="underline">Analyze</Link> page first.
          </span>
        )}
      </div>
    </section>
  );
}

function JobProgress({ job, onReset }: { job: PatternsJob; onReset: () => void }) {
  const done = job.status === "done" || job.status === "error";
  return (
    <section className="rounded border border-border bg-bg-elev/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text">
          {done ? (job.status === "done" ? "Run complete" : "Run failed") : "Running…"}
        </h2>
        <span
          className={[
            "px-2 py-0.5 rounded text-[11px]",
            job.status === "done" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300" : "",
            job.status === "error" ? "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-300" : "",
            job.status === "running" ? "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300" : "",
            job.status === "queued" ? "bg-bg-sunk text-dim" : "",
          ].join(" ")}
        >
          {job.status}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Stat label="Summaries" value={String(job.summary_count)} small />
        <Stat label="Input tokens" value={formatNumber(job.input_tokens)} small />
        <Stat label="Output tokens" value={formatNumber(job.output_tokens)} small />
        <Stat label="Findings" value={String(job.finding_count)} small highlight={done} />
      </div>
      {job.error && <ErrorBox message={job.error} />}
      {done && (
        <button
          onClick={onReset}
          className="px-3 py-1.5 rounded border border-border-strong text-xs hover:border-border-strong"
        >
          Close
        </button>
      )}
    </section>
  );
}

function RunHistory({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: PatternRun[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <section className="rounded border border-border bg-bg-elev/60 overflow-hidden">
      <header className="px-4 py-2 border-b border-border bg-bg-elev/80 text-xs uppercase tracking-wide text-dim">
        Past runs
      </header>
      <ul className="divide-y divide-border max-h-60 overflow-y-auto">
        {runs.map((r) => {
          const active = r.run_id === selectedRunId;
          const dirs = r.scope_project_dirs;
          return (
            <li key={r.run_id}>
              <button
                onClick={() => onSelect(r.run_id)}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-bg-elev/80 ${
                  active ? "bg-bg-sunk/60" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text flex items-center gap-2 flex-wrap">
                    {r.scope && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-sunk text-dim">
                        {r.scope}
                      </span>
                    )}
                    <span>{r.finding_count} findings</span>
                    <span className="text-faint">·</span>
                    <span className="text-dim">{r.summary_count} summaries</span>
                    {dirs && dirs.length > 0 && (
                      <span className="text-faint text-[11px] truncate">
                        · {dirs.map((d) => shortProject(d)).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-faint font-mono truncate">
                    {r.run_id.slice(0, 8)} · {relTime(r.started_at)} · {r.model}
                  </div>
                </div>
                {active && <span className="text-[10px] text-dim">viewing</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FindingsList({
  findings,
  findingsByKind,
  run,
}: {
  findings: FindingRecord[];
  findingsByKind: Map<string, FindingRecord[]>;
  run: PatternRun | null;
}) {
  if (findings.length === 0) {
    return (
      <section className="rounded border border-border bg-bg-elev/60 p-4 text-sm text-dim">
        {run
          ? "No findings produced in this run. The summary set may have been too small or too diverse."
          : "No runs yet. Start one above to produce findings."}
      </section>
    );
  }
  return (
    <div className="space-y-4">
      {run && (
        <div className="text-xs text-faint">
          Viewing run <span className="font-mono text-dim">{run.run_id.slice(0, 8)}</span>
          {" · "}
          {run.scope && <span className="text-dim">{run.scope}</span>}
          {run.scope && " · "}
          <span title={absTime(run.started_at)}>{relTime(run.started_at)}</span>
          {" · "}
          {run.model}
          {" · "}
          {formatNumber(run.input_tokens)}in / {formatNumber(run.output_tokens)}out
        </div>
      )}
      {[...findingsByKind.entries()].map(([kind, list]) => (
        <section key={kind} className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-wide text-faint">
            {KIND_LABELS[kind] ?? kind} · {list.length}
          </h3>
          <ul className="space-y-1.5">
            {list.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FindingCard({ finding }: { finding: FindingRecord }) {
  const accent = KIND_ACCENT[finding.kind] ?? "bg-bg-elev/80 text-dim border-border";
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  return (
    <li className="rounded border border-border bg-bg-elev/60 px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] border shrink-0 mt-0.5 ${accent}`}
          >
            {KIND_LABELS[finding.kind] ?? finding.kind}
          </span>
          <h4 className="text-sm font-medium text-text break-words leading-snug">
            {finding.title}
          </h4>
        </div>
        {finding.score !== undefined && (
          <span className="text-[10px] text-faint tabular-nums shrink-0">
            {finding.score.toFixed(2)}
          </span>
        )}
      </div>
      <p className="text-[13px] text-dim leading-snug">{finding.description}</p>
      {finding.suggested_remedy && (
        <p className="text-[13px] text-amber-800 dark:text-amber-200/90 leading-snug">
          → {finding.suggested_remedy}
        </p>
      )}
      <button
        onClick={() => setEvidenceOpen((v) => !v)}
        className="w-full flex items-center justify-between pt-1.5 border-t border-border/60 text-[10px] uppercase tracking-wide text-faint hover:text-dim"
      >
        <span>Evidence · {finding.evidence.length} sessions</span>
        <span>{evidenceOpen ? "▾ hide" : "▸ show"}</span>
      </button>
      {evidenceOpen && (
        <ul className="space-y-1">
          {finding.evidence.map((e, i) => (
            <li key={`${e.source_key}-${i}`} className="text-xs">
              <Link
                to={`/s?key=${encodeURIComponent(e.source_key)}`}
                className="text-dim hover:text-text font-mono"
              >
                {e.source_key}
              </Link>
              {e.quote && (
                <span className="text-faint italic ml-2">"{e.quote}"</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SourcesList({ sources }: { sources: PatternRunSourceItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded border border-border bg-bg-elev/60 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 border-b border-border bg-bg-elev/80 hover:bg-bg-elev/80"
      >
        <span className="text-xs uppercase tracking-wide text-dim">
          Source sessions · {sources.length}
        </span>
        <span className="text-[11px] text-faint">{open ? "▾ hide" : "▸ show"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-border max-h-[480px] overflow-y-auto">
          {sources.map((s) => (
            <li key={`${s.source_key}-${s.host_id}`}>
              <Link
                to={`/s?key=${encodeURIComponent(s.source_key)}`}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg-elev/80"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">
                    {s.one_liner ?? (
                      <span className="italic text-faint">(no summary one-liner)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-faint font-mono flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span>{shortProject(s.project_dir)}</span>
                    <span className="text-faint">·</span>
                    <span>{shortSessionId(s.session_id)}</span>
                    {s.kind === "subagent" && (
                      <span className="px-1 rounded bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 text-[10px]">
                        subagent
                      </span>
                    )}
                    <span className="text-faint">·</span>
                    <span>{relTime(s.started_at)}</span>
                    {s.user_message_count !== null && (
                      <>
                        <span className="text-faint">·</span>
                        <span>{s.user_message_count} msgs</span>
                      </>
                    )}
                  </div>
                </div>
                {s.tags && s.tags.length > 0 && (
                  <div className="text-[10px] text-faint shrink-0 mt-1 flex gap-1 flex-wrap justify-end max-w-[40%]">
                    {s.tags.slice(0, 4).map((t) => (
                      <span key={t} className="px-1 rounded bg-bg-sunk text-dim">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-faint mb-1">{label}</div>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  highlight,
  small,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-bg/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
      <div
        className={[
          "mt-1",
          small ? "text-xs" : "text-base",
          highlight ? "font-semibold text-amber-700 dark:text-amber-300" : "text-text",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}
