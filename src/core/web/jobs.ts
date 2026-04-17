import { randomUUID } from "node:crypto";
import {
  CURRENT_SIGNALS_VERSION,
  summarizeSession,
  type AnalyzeCandidate,
  type AnalyzePlan,
} from "../analyze.js";
import type { LLMClient } from "../analyze.js";
import type { SessionStore } from "../store/index.js";
import type { SessionSummaryRecord } from "../types.js";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobSessionResult {
  source_key: string;
  status: "ok" | "failed";
  input_tokens: number;
  output_tokens: number;
  one_liner: string | null;
  error: string | null;
}

export interface AnalyzeJob {
  id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  model: string;
  total: number;
  processed: number;
  ok: number;
  failed: number;
  total_input_tokens: number;
  total_output_tokens: number;
  results: JobSessionResult[];
  error: string | null;
}

/**
 * Single-tenant in-memory job registry. The dashboard is localhost-only and
 * one user, so we don't need persistence — jobs that were running when the
 * server stops simply disappear. Polling endpoints surface progress.
 */
export class AnalyzeJobRegistry {
  private readonly jobs = new Map<string, AnalyzeJob>();
  /** Cap on retained job records; oldest evicted when exceeded. */
  private readonly maxJobs: number;

  constructor(maxJobs = 50) {
    this.maxJobs = maxJobs;
  }

  list(): AnalyzeJob[] {
    return [...this.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(id: string): AnalyzeJob | null {
    return this.jobs.get(id) ?? null;
  }

  /**
   * Start a job. Returns immediately with the seeded record; the actual
   * `summarizeSession` calls run in the background. Errors per session don't
   * abort — they're recorded in `results` and counted in `failed`.
   */
  start(args: {
    plan: AnalyzePlan;
    store: SessionStore;
    client: LLMClient;
  }): AnalyzeJob {
    const id = randomUUID();
    const job: AnalyzeJob = {
      id,
      status: "queued",
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      model: args.plan.model,
      total: args.plan.candidates.length,
      processed: 0,
      ok: 0,
      failed: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      results: [],
      error: null,
    };
    this.jobs.set(id, job);
    this.evictIfNeeded();

    void this.run(job, args.plan.candidates, args.store, args.client);
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

  private async run(
    job: AnalyzeJob,
    candidates: AnalyzeCandidate[],
    store: SessionStore,
    client: LLMClient,
  ): Promise<void> {
    job.status = "running";
    job.started_at = new Date().toISOString();

    try {
      for (const session of candidates) {
        const result: JobSessionResult = {
          source_key: session.source_key,
          status: "failed",
          input_tokens: 0,
          output_tokens: 0,
          one_liner: null,
          error: null,
        };
        try {
          const details = await Promise.resolve(
            store.getSessionDetails(session.source_key, session.host_id),
          );
          if (!details) throw new Error("session has no parsed details");
          const userMessages = await Promise.resolve(
            store.getUserMessages(session.source_key, session.host_id),
          );

          const { summary, model: usedModel, usage } = await summarizeSession(
            { session, details, userMessages },
            client,
          );

          const record: SessionSummaryRecord = {
            source_key: session.source_key,
            host_id: session.host_id,
            one_liner: summary.one_liner,
            summary,
            tags: summary.tags,
            model: usedModel,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            generated_at: new Date().toISOString(),
            generated_for_mtime: details.parsed_for_mtime,
            signals_version: CURRENT_SIGNALS_VERSION,
          };
          await Promise.resolve(store.upsertSessionSummary(record));

          result.status = "ok";
          result.input_tokens = usage.input_tokens;
          result.output_tokens = usage.output_tokens;
          result.one_liner = summary.one_liner;

          job.ok += 1;
          job.total_input_tokens += usage.input_tokens;
          job.total_output_tokens += usage.output_tokens;
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          job.failed += 1;
        }

        job.results.push(result);
        job.processed += 1;
      }

      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.finished_at = new Date().toISOString();
    }
  }
}
