import { randomUUID } from "node:crypto";
import type { LLMClient } from "../analyze.js";
import { detectPatterns } from "../patterns/detect.js";
import type { EnrichedSummary, SessionStore } from "../store/index.js";
import type { Finding, PatternRunRecord, PatternScope } from "../types.js";

export type PatternsJobStatus = "queued" | "running" | "done" | "error";

export interface PatternsJob {
  id: string;
  status: PatternsJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  model: string;
  summary_count: number;
  input_tokens: number;
  output_tokens: number;
  finding_count: number;
  run_id: string | null;
  error: string | null;
}

export interface StartPatternsJobArgs {
  summaries: EnrichedSummary[];
  model: string;
  hostId: string;
  scope: PatternScope;
  scopeProjectDirs: string[] | null;
  language: string;
  filter: Record<string, unknown>;
  client: LLMClient;
  store: SessionStore;
}

/** Cross-session pattern detection is a single LLM call, so a job here just
 * tracks one long request. We keep the registry shape similar to
 * AnalyzeJobRegistry so the frontend polling pattern is identical. */
export class PatternsJobRegistry {
  private readonly jobs = new Map<string, PatternsJob>();
  private readonly maxJobs: number;

  constructor(maxJobs = 20) {
    this.maxJobs = maxJobs;
  }

  list(): PatternsJob[] {
    return [...this.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string): PatternsJob | null {
    return this.jobs.get(id) ?? null;
  }

  start(args: StartPatternsJobArgs): PatternsJob {
    const id = randomUUID();
    const job: PatternsJob = {
      id,
      status: "queued",
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      model: args.model,
      summary_count: args.summaries.length,
      input_tokens: 0,
      output_tokens: 0,
      finding_count: 0,
      run_id: null,
      error: null,
    };
    this.jobs.set(id, job);
    this.evictIfNeeded();
    void this.run(job, args);
    return job;
  }

  private evictIfNeeded(): void {
    while (this.jobs.size > this.maxJobs) {
      const oldest = [...this.jobs.values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      )[0];
      if (!oldest) break;
      this.jobs.delete(oldest.id);
    }
  }

  private async run(job: PatternsJob, args: StartPatternsJobArgs): Promise<void> {
    job.status = "running";
    job.started_at = new Date().toISOString();
    try {
      const result = await detectPatterns(args.summaries, args.client, {
        scope: args.scope,
        language: args.language,
      });
      const runId = randomUUID();
      const finishedAt = new Date().toISOString();
      const run: PatternRunRecord = {
        run_id: runId,
        host_id: args.hostId,
        model: result.model,
        summary_count: args.summaries.length,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        finding_count: result.findings.length,
        filter_json: JSON.stringify(args.filter),
        started_at: job.started_at,
        finished_at: finishedAt,
        scope: args.scope,
        scope_project_dirs: args.scopeProjectDirs,
      };
      await Promise.resolve(
        args.store.insertPatternRun({
          run,
          findings: result.findings,
          sources: args.summaries.map((s) => ({
            source_key: s.source_key,
            host_id: s.host_id,
          })),
        }),
      );
      job.input_tokens = result.usage.input_tokens;
      job.output_tokens = result.usage.output_tokens;
      job.finding_count = result.findings.length;
      job.run_id = runId;
      job.status = "done";
      job.finished_at = finishedAt;
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.finished_at = new Date().toISOString();
    }
  }
}

export type { Finding };
