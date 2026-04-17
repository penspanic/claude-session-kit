import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type AnalyzeCandidate,
  type AnalyzeCapabilities,
  type AnalyzeJob,
  type AnalyzePlan,
  type AnalyzePlanResponse,
} from "../api";
import { ErrorBox, Spinner } from "../components/Spinner";
import { decodeProjectDir, formatNumber, relTime, shortProject, shortSessionId } from "../lib/format";

export function AnalyzePage() {
  const [params] = useSearchParams();
  const projectDir = params.get("project") ?? undefined;

  const [caps, setCaps] = useState<AnalyzeCapabilities | null>(null);
  const [model, setModel] = useState<string>("");
  const [limit, setLimit] = useState<number>(25);
  const [language, setLanguage] = useState<string>("auto");
  const [planResp, setPlanResp] = useState<AnalyzePlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AnalyzeJob | null>(null);
  /** source_keys the user has selected (or null until plan loads → defaults to all). */
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    api.analyzeCapabilities().then((c) => {
      setCaps(c);
      setModel(c.suggested_models[0]?.id ?? c.default_model);
    }).catch((e) => setPlanError((e as Error).message));
  }, []);

  const refreshPlan = async () => {
    if (!model) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const res = await api.analyzePlan({ project: projectDir, limit, model });
      setPlanResp(res);
      // Default selection: every candidate checked.
      setSelected(new Set(res.plan.candidates.map((c) => c.source_key)));
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanning(false);
    }
  };

  useEffect(() => {
    if (caps) void refreshPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps, model, limit, projectDir]);

  const selectedKeys = useMemo(
    () => (selected ? Array.from(selected) : []),
    [selected],
  );

  const startRun = async () => {
    setRunError(null);
    try {
      const { job_id } = await api.analyzeRun({
        project: projectDir,
        limit,
        model,
        language,
        source_keys: selectedKeys,
      });
      setJobId(job_id);
    } catch (e) {
      setRunError((e as Error).message);
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectAll = () => {
    if (planResp) setSelected(new Set(planResp.plan.candidates.map((c) => c.source_key)));
  };
  const deselectAll = () => setSelected(new Set());

  // Poll job state every second while running.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      try {
        const { job } = await api.analyzeJob(jobId);
        if (job) setJob(job);
        if (job && (job.status === "done" || job.status === "error")) {
          if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        /* keep polling — transient */
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, 1000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId]);

  if (!caps && !planError) return <Spinner label="Loading capabilities…" />;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        {projectDir ? (
          <Link to={`/p?dir=${encodeURIComponent(projectDir)}`} className="text-xs text-neutral-500 hover:text-neutral-300">
            ← {shortProject(projectDir)}
          </Link>
        ) : (
          <Link to="/" className="text-xs text-neutral-500 hover:text-neutral-300">← Home</Link>
        )}
        <h1 className="text-lg font-semibold mt-1">Analyze sessions</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Generate LLM summaries for sessions that don't have one yet
          {projectDir && (
            <>
              {" in "}
              <span className="text-neutral-200">{shortProject(projectDir)}</span>
              <span className="text-neutral-600 ml-1 text-xs">({decodeProjectDir(projectDir)})</span>
            </>
          )}
          .
        </p>
      </div>

      {caps && (
        <ApiKeyBanner
          caps={caps}
          onChanged={async () => {
            const fresh = await api.analyzeCapabilities();
            setCaps(fresh);
          }}
        />
      )}

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Model">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            >
              {caps?.suggested_models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Max sessions">
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(200, Number.parseInt(e.target.value, 10) || 1)))}
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </Field>
          <Field label='Language (e.g. "auto", "en", "한국어")'>
            <input
              type="text"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="auto"
              className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>
      </section>

      {planError && <ErrorBox message={planError} />}
      {planning && <Spinner label="Computing estimate…" />}

      {planResp && !jobId && (
        <>
          <PlanCard plan={planResp.plan} selected={selected} />
          <CandidateList
            candidates={planResp.plan.candidates}
            selected={selected ?? new Set()}
            onToggle={toggle}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />
          {caps?.llm_available && planResp.plan.api_calls > 0 && (
            <div className="flex items-center gap-3 sticky bottom-0 bg-neutral-950/95 -mx-6 px-6 py-3 border-t border-neutral-800">
              <button
                onClick={startRun}
                disabled={selectedKeys.length === 0}
                className="px-4 py-2 rounded border border-neutral-200 bg-neutral-100 text-neutral-900 text-sm font-medium hover:bg-white disabled:opacity-30"
              >
                Run analysis on {selectedKeys.length} selected
              </button>
              <button
                onClick={refreshPlan}
                className="px-4 py-2 rounded border border-neutral-700 text-sm hover:border-neutral-500"
              >
                Refresh
              </button>
            </div>
          )}
        </>
      )}

      {runError && <ErrorBox message={runError} />}
      {jobId && job && (
        <JobProgress
          job={job}
          projectDir={projectDir}
          rate={planResp?.plan.prices ?? null}
          onReset={() => {
            setJobId(null);
            setJob(null);
            void refreshPlan();
          }}
        />
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  candidates: AnalyzeCandidate[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900/60">
        <div className="text-xs text-neutral-400">
          <span className="font-semibold text-neutral-200">
            {selected.size}/{candidates.length}
          </span>{" "}
          selected
        </div>
        <div className="flex gap-2 text-xs">
          <button
            onClick={onSelectAll}
            className="px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500"
          >
            All
          </button>
          <button
            onClick={onDeselectAll}
            className="px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500"
          >
            None
          </button>
        </div>
      </header>
      <ul className="divide-y divide-neutral-800 max-h-[480px] overflow-y-auto">
        {candidates.map((c) => {
          const checked = selected.has(c.source_key);
          return (
            <li key={c.source_key}>
              <label
                className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-neutral-900/60 ${
                  checked ? "" : "opacity-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(c.source_key)}
                  className="mt-1 accent-neutral-200"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-100 truncate">
                    {c.display_label ?? <span className="italic text-neutral-500">untitled session</span>}
                  </div>
                  <div className="text-[11px] text-neutral-500 font-mono flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span>{shortSessionId(c.session_id)}</span>
                    {c.kind === "subagent" && (
                      <span className="px-1 rounded bg-amber-950/60 text-amber-300 text-[10px]">subagent</span>
                    )}
                    {c.display_label_source && c.display_label_source !== "summary" && (
                      <span className="px-1 rounded bg-neutral-800 text-neutral-400 text-[10px]">
                        {c.display_label_source.replace("_", " ")}
                      </span>
                    )}
                    <span className="text-neutral-600">·</span>
                    <span>{relTime(c.started_at)}</span>
                    {c.user_message_count !== null && (
                      <>
                        <span className="text-neutral-600">·</span>
                        <span>{c.user_message_count} user msgs</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-neutral-500 tabular-nums shrink-0 mt-1">
                  ≈{formatNumber(c.est_input_tokens)} tok
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function PlanCard({ plan, selected }: { plan: AnalyzePlan; selected: Set<string> | null }) {
  const sel = selected ?? new Set(plan.candidates.map((c) => c.source_key));
  const chosen = plan.candidates.filter((c) => sel.has(c.source_key));
  const selInputTokens = chosen.reduce((acc, c) => acc + c.est_input_tokens, 0);
  const selOutputTokens = chosen.length * plan.est_output_tokens_per_call;
  const selCost = plan.prices
    ? (selInputTokens * plan.prices.input_per_mtok + selOutputTokens * plan.prices.output_per_mtok) /
      1_000_000
    : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-200">Estimate</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300">추정치 · estimate</span>
      </div>

      {plan.api_calls === 0 && (
        <div className="text-sm text-neutral-400">
          Nothing to analyze in this scope — every session already has a fresh summary.
        </div>
      )}

      {plan.api_calls > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Selected" value={`${chosen.length} / ${plan.candidates.length}`} />
          <Stat label="API calls" value={formatNumber(chosen.length)} />
          <Stat label="≈ Input tokens" value={formatNumber(selInputTokens)} />
          <Stat label="≈ Output tokens" value={formatNumber(selOutputTokens)} />
          <Stat
            label="≈ Cost"
            value={selCost === null ? "unknown" : `$${selCost.toFixed(4)}`}
            highlight
          />
          <Stat
            label="Rate"
            value={
              plan.prices
                ? `$${plan.prices.input_per_mtok}/MTok · $${plan.prices.output_per_mtok}/MTok`
                : "—"
            }
            small
          />
          <Stat label="Model" value={plan.model} small mono />
        </div>
      )}

      <p className="text-[11px] text-neutral-500 leading-relaxed">{plan.notes}</p>
    </section>
  );
}

function Stat({
  label,
  value,
  highlight,
  small,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  small?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        className={[
          "mt-1",
          small ? "text-xs" : "text-base",
          highlight ? "font-semibold text-amber-300" : "text-neutral-100",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function JobProgress({
  job,
  onReset,
  projectDir,
  rate,
}: {
  job: AnalyzeJob;
  onReset: () => void;
  projectDir?: string;
  rate: { input_per_mtok: number; output_per_mtok: number } | null;
}) {
  const pct = job.total === 0 ? 0 : Math.floor((job.processed / job.total) * 100);
  const done = job.status === "done" || job.status === "error";
  const actualCost = rate
    ? (job.total_input_tokens * rate.input_per_mtok + job.total_output_tokens * rate.output_per_mtok) / 1_000_000
    : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-200">
          {done && job.status === "done" ? "Analysis complete" : "Running analysis"}
        </h2>
        <span
          className={[
            "px-2 py-0.5 rounded text-[11px]",
            job.status === "done" ? "bg-emerald-950/60 text-emerald-300" : "",
            job.status === "error" ? "bg-red-950/60 text-red-300" : "",
            job.status === "running" ? "bg-blue-950/60 text-blue-300" : "",
            job.status === "queued" ? "bg-neutral-800 text-neutral-300" : "",
          ].join(" ")}
        >
          {job.status}
        </span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-neutral-400 mb-1">
          <span>{job.processed} / {job.total} ({pct}%)</span>
          <span>ok={job.ok} · failed={job.failed}</span>
        </div>
        <div className="h-2 bg-neutral-800 rounded overflow-hidden">
          <div
            className={`h-full transition-all ${job.status === "error" ? "bg-red-400" : "bg-emerald-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <Stat label="Input tokens" value={formatNumber(job.total_input_tokens)} small />
        <Stat label="Output tokens" value={formatNumber(job.total_output_tokens)} small />
        <Stat
          label={done ? "Actual cost" : "Cost so far"}
          value={actualCost === null ? "—" : `$${actualCost.toFixed(4)}`}
          small
          highlight
        />
      </div>

      {job.error && <ErrorBox message={job.error} />}

      {done && (
        <div className="flex gap-2 pt-1">
          {projectDir && (
            <Link
              to={`/p?dir=${encodeURIComponent(projectDir)}`}
              className="px-3 py-1.5 rounded border border-neutral-200 bg-neutral-100 text-neutral-900 text-xs font-medium hover:bg-white"
            >
              View summaries in project →
            </Link>
          )}
          <button
            onClick={onReset}
            className="px-3 py-1.5 rounded border border-neutral-700 text-xs hover:border-neutral-500"
          >
            Analyze more
          </button>
        </div>
      )}

      {job.results.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1.5 mt-2">
            Per-session results
          </div>
          <ul className="divide-y divide-neutral-800 rounded border border-neutral-800 overflow-hidden">
            {[...job.results].reverse().map((r) => (
              <li key={r.source_key}>
                <Link
                  to={`/s?key=${encodeURIComponent(r.source_key)}`}
                  className="flex gap-2 items-start px-3 py-2 hover:bg-neutral-900/60 text-xs"
                >
                  <span className={`mt-0.5 ${r.status === "ok" ? "text-emerald-400" : "text-red-400"}`}>
                    {r.status === "ok" ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-neutral-100 truncate">
                      {r.error ? <span className="text-red-300">{r.error}</span> : r.one_liner ?? "—"}
                    </div>
                    <div className="font-mono text-[10px] text-neutral-500 truncate">{r.source_key}</div>
                  </div>
                  {r.status === "ok" && (
                    <span className="text-neutral-500 tabular-nums shrink-0">
                      {r.input_tokens}/{r.output_tokens}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ApiKeyBanner({
  caps,
  onChanged,
}: {
  caps: AnalyzeCapabilities;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  if (caps.llm_available) {
    return (
      <div className="rounded border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200 flex items-center gap-3 flex-wrap">
        <span>
          API key active
          {caps.api_key_preview && (
            <span className="ml-1 font-mono text-emerald-400">…{caps.api_key_preview}</span>
          )}
          <span className="ml-1 text-emerald-500/80 text-xs">
            ({caps.api_key_source === "env" ? "from env" : "set in browser"})
          </span>
        </span>
        <div className="ml-auto flex gap-2 text-xs">
          <button
            onClick={() => setOpen(true)}
            className="px-2 py-1 rounded border border-emerald-800/60 hover:border-emerald-500"
          >
            Change
          </button>
          {caps.api_key_source === "runtime" && (
            <button
              onClick={async () => {
                if (!confirm("Clear the runtime API key?")) return;
                await api.clearApiKey();
                await onChanged();
              }}
              className="px-2 py-1 rounded border border-emerald-800/60 hover:border-red-500 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>
        {open && (
          <ApiKeyModal
            onClose={() => setOpen(false)}
            onSaved={async () => {
              setOpen(false);
              await onChanged();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200 flex items-center gap-3 flex-wrap">
      <span>No API key set — analysis is disabled.</span>
      <button
        onClick={() => setOpen(true)}
        className="ml-auto px-3 py-1 rounded border border-amber-700 text-xs hover:border-amber-400"
      >
        Set API key
      </button>
      {open && (
        <ApiKeyModal
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ApiKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setApiKey(value.trim());
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-neutral-900 border border-neutral-700 rounded-lg p-5 w-full max-w-md space-y-4"
      >
        <h2 className="text-base font-semibold text-neutral-100">Set Anthropic API key</h2>
        <p className="text-xs text-neutral-400 leading-relaxed">
          Stored in this server process's memory only — not written to disk and lost when{" "}
          <code className="text-neutral-300">csk serve</code> exits. For persistent setup, launch with{" "}
          <code className="text-neutral-300">ANTHROPIC_API_KEY</code> set in the env.
        </p>
        <input
          autoFocus
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono"
        />
        {error && <ErrorBox message={error} />}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-neutral-700 text-sm hover:border-neutral-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="px-3 py-1.5 rounded border border-neutral-200 bg-neutral-100 text-neutral-900 text-sm font-medium disabled:opacity-30"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
