import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type AnalyzeCapabilities,
  type AnalyzeJob,
  type AnalyzePlan,
  type AnalyzePlanResponse,
} from "../api";
import { ErrorBox, Spinner } from "../components/Spinner";
import { decodeProjectDir, formatNumber, shortProject } from "../lib/format";

export function AnalyzePage() {
  const [params] = useSearchParams();
  const projectDir = params.get("project") ?? undefined;

  const [caps, setCaps] = useState<AnalyzeCapabilities | null>(null);
  const [model, setModel] = useState<string>("");
  const [limit, setLimit] = useState<number>(25);
  const [planResp, setPlanResp] = useState<AnalyzePlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<AnalyzeJob | null>(null);

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

  const startRun = async () => {
    setRunError(null);
    try {
      const { job_id } = await api.analyzeRun({ project: projectDir, limit, model });
      setJobId(job_id);
    } catch (e) {
      setRunError((e as Error).message);
    }
  };

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

      {caps && !caps.llm_available && (
        <ErrorBox message="ANTHROPIC_API_KEY is not set on the server. Restart `csk serve` with the env var to enable analysis." />
      )}

      <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
      </section>

      {planError && <ErrorBox message={planError} />}
      {planning && <Spinner label="Computing estimate…" />}
      {planResp && <PlanCard plan={planResp.plan} />}

      {planResp && planResp.plan.api_calls > 0 && caps?.llm_available && !jobId && (
        <div className="flex items-center gap-3">
          <button
            onClick={startRun}
            className="px-4 py-2 rounded border border-neutral-200 bg-neutral-100 text-neutral-900 text-sm font-medium hover:bg-white"
          >
            Run analysis
          </button>
          <button
            onClick={refreshPlan}
            className="px-4 py-2 rounded border border-neutral-700 text-sm hover:border-neutral-500"
          >
            Refresh estimate
          </button>
        </div>
      )}

      {runError && <ErrorBox message={runError} />}
      {jobId && job && <JobProgress job={job} onReset={() => { setJobId(null); setJob(null); void refreshPlan(); }} />}
    </div>
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

function PlanCard({ plan }: { plan: AnalyzePlan }) {
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
          <Stat label="Sessions" value={formatNumber(plan.api_calls)} />
          <Stat label="API calls" value={formatNumber(plan.api_calls)} />
          <Stat label="≈ Input tokens" value={formatNumber(plan.est_input_tokens)} />
          <Stat label="≈ Output tokens" value={formatNumber(plan.est_output_tokens)} />
          <Stat
            label="≈ Cost"
            value={plan.est_cost_usd === null ? "unknown" : `$${plan.est_cost_usd.toFixed(4)}`}
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

function JobProgress({ job, onReset }: { job: AnalyzeJob; onReset: () => void }) {
  const pct = job.total === 0 ? 0 : Math.floor((job.processed / job.total) * 100);
  const done = job.status === "done" || job.status === "error";
  return (
    <section className="rounded border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-200">
          Job {job.id.slice(0, 8)}
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

      <div className="text-xs text-neutral-400">
        Tokens used so far: <span className="text-neutral-200">{formatNumber(job.total_input_tokens)}</span> in / <span className="text-neutral-200">{formatNumber(job.total_output_tokens)}</span> out
      </div>

      {job.error && <ErrorBox message={job.error} />}

      {job.results.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
            Per-session results ({job.results.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {job.results.slice(-50).reverse().map((r) => (
              <li key={r.source_key} className="flex gap-2 items-start">
                <span className={r.status === "ok" ? "text-emerald-400" : "text-red-400"}>
                  {r.status === "ok" ? "✓" : "✗"}
                </span>
                <span className="font-mono text-[11px] text-neutral-500 truncate">{r.source_key}</span>
                <span className="ml-auto text-neutral-300 truncate max-w-[40%]">
                  {r.error ? r.error : r.one_liner ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {done && (
        <button
          onClick={onReset}
          className="px-3 py-1.5 rounded border border-neutral-700 text-xs hover:border-neutral-500"
        >
          Done — analyze more
        </button>
      )}
    </section>
  );
}
