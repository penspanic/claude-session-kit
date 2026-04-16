import type { Config } from "../config.js";
import type {
  BackupRun,
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
