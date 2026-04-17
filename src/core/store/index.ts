import type { Config } from "../config.js";
import type {
  BackupRun,
  Finding,
  FindingKind,
  FindingRecord,
  PatternRunRecord,
  PatternRunSource,
  PatternScope,
  SearchHit,
  SessionDetailsRecord,
  SessionFilter,
  SessionRecord,
  SessionSummaryRecord,
  UserMessageRecord,
} from "../types.js";
import { SqliteStore } from "./sqlite.js";

export interface SessionStore {
  init(): void | Promise<void>;
  close(): void | Promise<void>;

  createBackupRun(run: Omit<BackupRun, "id">): number | Promise<number>;
  updateBackupRun(id: number, patch: Partial<BackupRun>): void | Promise<void>;
  getLastBackupRun(hostId?: string): BackupRun | null | Promise<BackupRun | null>;
  listBackupRuns(limit: number): BackupRun[] | Promise<BackupRun[]>;

  upsertSession(session: SessionRecord): void | Promise<void>;
  listSessions(filter?: SessionFilter): SessionRecord[] | Promise<SessionRecord[]>;
  countSessions(filter?: SessionFilter): number | Promise<number>;

  upsertSessionDetails(
    details: SessionDetailsRecord,
  ): void | Promise<void>;
  getSessionDetails(
    sourceKey: string,
    hostId: string,
  ): SessionDetailsRecord | null | Promise<SessionDetailsRecord | null>;
  countParsedSessions(hostId?: string): number | Promise<number>;

  /**
   * List sessions joined with their parsed details. Sorted by activity time
   * (session_details.started_at) when available, falling back to file mtime.
   * Applies all SessionFilter fields and honors a row limit.
   */
  listSessionsWithDetails(
    filter: SessionFilter & { limit?: number; offset?: number },
  ): SessionWithDetails[] | Promise<SessionWithDetails[]>;

  /**
   * Per-project activity counts over the last `days` days. Uses the session's
   * started_at when available, file mtime otherwise.
   */
  recentSessionStats(
    days: number,
    hostId?: string,
  ): RecentProjectStats[] | Promise<RecentProjectStats[]>;

  /**
   * Sessions whose parent_session_id is in the given list (i.e. the subagents
   * spawned by the listed main sessions). Returns the join with details.
   */
  listChildSessionsWithDetails(args: {
    parent_session_ids: string[];
    project_dir?: string;
    host_id?: string;
  }): SessionWithDetails[] | Promise<SessionWithDetails[]>;

  /**
   * Replace all user messages for a session atomically. A re-parse must be
   * idempotent — calling this with the same input must not duplicate rows.
   */
  replaceUserMessages(
    sourceKey: string,
    hostId: string,
    messages: UserMessageRecord[],
  ): void | Promise<void>;

  /**
   * Full-text search over user-message content. Returns session context with
   * a highlighted snippet. Results are ranked by FTS5's built-in relevance.
   */
  searchUserMessages(args: {
    query: string;
    project_dir?: string;
    host_id?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): SearchHit[] | Promise<SearchHit[]>;

  /** Fetch all user messages for one session, ordered by seq. */
  getUserMessages(
    sourceKey: string,
    hostId: string,
  ): UserMessageRecord[] | Promise<UserMessageRecord[]>;

  upsertSessionSummary(
    summary: SessionSummaryRecord,
  ): void | Promise<void>;

  getSessionSummary(
    sourceKey: string,
    hostId: string,
  ): SessionSummaryRecord | null | Promise<SessionSummaryRecord | null>;

  /**
   * List sessions that have parsed details but no summary (or a summary whose
   * `generated_for_mtime` predates the parsed details' `parsed_for_mtime`).
   * Useful for `csk analyze` to find what still needs work.
   */
  listUnanalyzedSessions(filter: {
    host_id?: string;
    project_dir?: string;
    since?: string;
    limit?: number;
  }): SessionRecord[] | Promise<SessionRecord[]>;

  /** Count summaries in the store. */
  countSummaries(hostId?: string): number | Promise<number>;

  /**
   * Summaries eligible for cross-session pattern detection: only rows whose
   * signals_version is at or above `minVersion` (default 1). Joined with
   * project_dir + started_at for context.
   */
  listEnrichedSummaries(filter: {
    host_id?: string;
    project_dir?: string;
    /** Multi-project filter. If both project_dir and project_dirs are given,
     *  project_dirs wins. Project-mode patterns uses this to group worktrees. */
    project_dirs?: string[];
    since?: string;
    limit?: number;
    minVersion?: number;
  }):
    | EnrichedSummary[]
    | Promise<EnrichedSummary[]>;

  /** How many summaries are at or above the given signals_version. */
  countEnrichedSummaries(args: {
    host_id?: string;
    project_dirs?: string[];
    minVersion?: number;
  }): number | Promise<number>;

  /** Per-project breakdown of enriched-summary counts. Used by the project
   *  patterns page to show the picker list (with counts alongside each). */
  countEnrichedSummariesByProject(args: {
    host_id?: string;
    minVersion?: number;
  }):
    | Array<{ project_dir: string; count: number }>
    | Promise<Array<{ project_dir: string; count: number }>>;

  /**
   * Persist the full result of a `csk patterns` run: a row in csk_pattern_runs
   * plus one row in csk_findings per finding, written in a single transaction.
   * `sources` captures the full input set for later display (pre-filtering, as
   * the enriched-summary pool may grow between runs).
   */
  insertPatternRun(args: {
    run: PatternRunRecord;
    findings: Finding[];
    sources: PatternRunSource[];
  }): void | Promise<void>;

  listPatternRuns(
    filter?: { scope?: PatternScope; project_dir?: string; limit?: number },
  ): PatternRunRecord[] | Promise<PatternRunRecord[]>;

  getPatternRun(runId: string): PatternRunRecord | null | Promise<PatternRunRecord | null>;

  listFindings(filter: {
    run_id?: string;
    kind?: FindingKind;
    limit?: number;
  }): FindingRecord[] | Promise<FindingRecord[]>;

  /**
   * Decorated source-session list for a patterns run: each entry carries the
   * session's basic metadata, started_at, and one_liner summary (if any).
   * Returns empty array for pre-migration runs that didn't persist sources.
   */
  listPatternRunSources(runId: string): PatternRunSourceItem[] | Promise<PatternRunSourceItem[]>;
}

export interface PatternRunSourceItem {
  source_key: string;
  host_id: string;
  session_id: string;
  project_dir: string;
  kind: string;
  parent_session_id: string | null;
  started_at: string | null;
  user_message_count: number | null;
  one_liner: string | null;
  tags: string[] | null;
}

export interface EnrichedSummary {
  source_key: string;
  host_id: string;
  project_dir: string;
  session_id: string;
  started_at: string | null;
  summary: SessionSummaryRecord["summary"];
  one_liner: string;
  tags: string[];
  signals_version: number;
}

export interface SessionWithDetails {
  session: SessionRecord;
  details: SessionDetailsRecord | null;
}

export interface RecentProjectStats {
  project_dir: string;
  session_count: number;
  last_active_at: string;
}

export function createStore(config: Config): SessionStore {
  switch (config.store.type) {
    case "sqlite":
      return new SqliteStore(config.store.path);
    default: {
      const type: never = config.store.type;
      throw new Error(`Unsupported store type: ${String(type)}`);
    }
  }
}
