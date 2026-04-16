import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  RecentProjectStats,
  SessionStore,
  SessionWithDetails,
} from "./index.js";
import type {
  BackupRun,
  SearchHit,
  SessionDetailsRecord,
  SessionFilter,
  SessionKind,
  SessionRecord,
  SessionSummary,
  SessionSummaryRecord,
  UserMessageRecord,
} from "../types.js";
import { migrate } from "./migrations/index.js";

interface BackupRunRow {
  id: number;
  host_id: string;
  user_id: string;
  started_at: string;
  finished_at: string | null;
  files_scanned: number;
  files_copied: number;
  bytes_copied: number;
  status: string;
  error_message: string | null;
}

interface SessionRow {
  source_key: string;
  host_id: string;
  user_id: string;
  project_dir: string;
  session_id: string;
  parent_session_id: string | null;
  kind: string;
  file_size: number;
  file_mtime: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface SessionDetailsRow {
  source_key: string;
  host_id: string;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_use_count: number;
  tool_names: string | null;
  model: string | null;
  cwd: string | null;
  git_branch: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  parse_error_count: number;
  parsed_at: string;
  parsed_for_mtime: string;
  custom_title: string | null;
  agent_name: string | null;
  last_prompt: string | null;
}

export class SqliteStore implements SessionStore {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  init(): void {
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  createBackupRun(run: Omit<BackupRun, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO backup_runs
        (host_id, user_id, started_at, finished_at, files_scanned, files_copied, bytes_copied, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      run.host_id,
      run.user_id,
      run.started_at,
      run.finished_at,
      run.files_scanned,
      run.files_copied,
      run.bytes_copied,
      run.status,
      run.error_message,
    );
    return Number(info.lastInsertRowid);
  }

  updateBackupRun(id: number, patch: Partial<BackupRun>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id") continue;
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE backup_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  getLastBackupRun(hostId?: string): BackupRun | null {
    const sql = hostId
      ? `SELECT * FROM backup_runs WHERE host_id = ? ORDER BY started_at DESC LIMIT 1`
      : `SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 1`;
    const stmt = this.db.prepare(sql);
    const row = (hostId ? stmt.get(hostId) : stmt.get()) as BackupRunRow | undefined;
    return row ? this.rowToRun(row) : null;
  }

  listBackupRuns(limit: number): BackupRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as BackupRunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  upsertSession(session: SessionRecord): void {
    this.db
      .prepare(`
        INSERT INTO sessions
          (source_key, host_id, user_id, project_dir, session_id, parent_session_id, kind,
           file_size, file_mtime, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_key, host_id) DO UPDATE SET
          file_size     = excluded.file_size,
          file_mtime    = excluded.file_mtime,
          last_seen_at  = excluded.last_seen_at
      `)
      .run(
        session.source_key,
        session.host_id,
        session.user_id,
        session.project_dir,
        session.session_id,
        session.parent_session_id,
        session.kind,
        session.file_size,
        session.file_mtime,
        session.first_seen_at,
        session.last_seen_at,
      );
  }

  listSessions(filter: SessionFilter = {}): SessionRecord[] {
    const { sql, params } = this.buildSessionQuery(filter);
    return (
      this.db
        .prepare(`SELECT s.* FROM sessions s ${sql} ORDER BY s.last_seen_at DESC`)
        .all(...params) as SessionRow[]
    ).map((r) => this.rowToSession(r));
  }

  countSessions(filter: SessionFilter = {}): number {
    const { sql, params } = this.buildSessionQuery(filter);
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM sessions s ${sql}`)
      .get(...params) as { n: number };
    return row.n;
  }

  private buildSessionQuery(filter: SessionFilter): { sql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.host_id) {
      where.push("s.host_id = ?");
      params.push(filter.host_id);
    }
    if (filter.user_id) {
      where.push("s.user_id = ?");
      params.push(filter.user_id);
    }
    if (filter.project_dir) {
      where.push("s.project_dir = ?");
      params.push(filter.project_dir);
    }
    if (filter.kind) {
      where.push("s.kind = ?");
      params.push(filter.kind);
    }
    if (filter.since) {
      where.push("s.last_seen_at >= ?");
      params.push(filter.since);
    }
    if (filter.until) {
      where.push("s.last_seen_at <= ?");
      params.push(filter.until);
    }
    const sql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { sql, params };
  }

  private rowToRun(row: BackupRunRow): BackupRun {
    return {
      id: row.id,
      host_id: row.host_id,
      user_id: row.user_id,
      started_at: row.started_at,
      finished_at: row.finished_at,
      files_scanned: row.files_scanned,
      files_copied: row.files_copied,
      bytes_copied: row.bytes_copied,
      status: row.status as BackupRun["status"],
      error_message: row.error_message,
    };
  }

  upsertSessionDetails(details: SessionDetailsRecord): void {
    this.db
      .prepare(`
        INSERT INTO session_details (
          source_key, host_id, started_at, ended_at,
          message_count, user_message_count, assistant_message_count,
          tool_use_count, tool_names, model, cwd, git_branch,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
          parse_error_count, parsed_at, parsed_for_mtime,
          custom_title, agent_name, last_prompt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_key, host_id) DO UPDATE SET
          started_at              = excluded.started_at,
          ended_at                = excluded.ended_at,
          message_count           = excluded.message_count,
          user_message_count      = excluded.user_message_count,
          assistant_message_count = excluded.assistant_message_count,
          tool_use_count          = excluded.tool_use_count,
          tool_names              = excluded.tool_names,
          model                   = excluded.model,
          cwd                     = excluded.cwd,
          git_branch              = excluded.git_branch,
          input_tokens            = excluded.input_tokens,
          output_tokens           = excluded.output_tokens,
          cache_creation_tokens   = excluded.cache_creation_tokens,
          cache_read_tokens       = excluded.cache_read_tokens,
          parse_error_count       = excluded.parse_error_count,
          parsed_at               = excluded.parsed_at,
          parsed_for_mtime        = excluded.parsed_for_mtime,
          custom_title            = excluded.custom_title,
          agent_name              = excluded.agent_name,
          last_prompt             = excluded.last_prompt
      `)
      .run(
        details.source_key,
        details.host_id,
        details.started_at,
        details.ended_at,
        details.message_count,
        details.user_message_count,
        details.assistant_message_count,
        details.tool_use_count,
        JSON.stringify(details.tool_names),
        details.model,
        details.cwd,
        details.git_branch,
        details.input_tokens,
        details.output_tokens,
        details.cache_creation_tokens,
        details.cache_read_tokens,
        details.parse_error_count,
        details.parsed_at,
        details.parsed_for_mtime,
        details.custom_title,
        details.agent_name,
        details.last_prompt,
      );
  }

  getSessionDetails(sourceKey: string, hostId: string): SessionDetailsRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM session_details WHERE source_key = ? AND host_id = ?`)
      .get(sourceKey, hostId) as SessionDetailsRow | undefined;
    return row ? this.rowToDetails(row) : null;
  }

  listSessionsWithDetails(
    filter: SessionFilter & { limit?: number; offset?: number } = {},
  ): SessionWithDetails[] {
    const { sql, params } = this.buildSessionQuery(filter);
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(`
        SELECT
          s.*,
          d.started_at              AS d_started_at,
          d.ended_at                AS d_ended_at,
          d.message_count           AS d_message_count,
          d.user_message_count      AS d_user_message_count,
          d.assistant_message_count AS d_assistant_message_count,
          d.tool_use_count          AS d_tool_use_count,
          d.tool_names              AS d_tool_names,
          d.model                   AS d_model,
          d.cwd                     AS d_cwd,
          d.git_branch              AS d_git_branch,
          d.input_tokens            AS d_input_tokens,
          d.output_tokens           AS d_output_tokens,
          d.cache_creation_tokens   AS d_cache_creation_tokens,
          d.cache_read_tokens       AS d_cache_read_tokens,
          d.parse_error_count       AS d_parse_error_count,
          d.parsed_at               AS d_parsed_at,
          d.parsed_for_mtime        AS d_parsed_for_mtime,
          d.custom_title            AS d_custom_title,
          d.agent_name              AS d_agent_name,
          d.last_prompt             AS d_last_prompt
        FROM sessions s
        LEFT JOIN session_details d
          ON s.source_key = d.source_key AND s.host_id = d.host_id
        ${sql.replace(/^WHERE /i, "WHERE ")}
        ORDER BY COALESCE(d.started_at, s.last_seen_at) DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset) as Array<
        SessionRow & Record<string, unknown>
      >;

    return rows.map((row) => ({
      session: this.rowToSession(row),
      details: row.d_parsed_at
        ? this.rowToDetails(this.projectDetailRow(row))
        : null,
    }));
  }

  listChildSessionsWithDetails(args: {
    parent_session_ids: string[];
    project_dir?: string;
    host_id?: string;
  }): SessionWithDetails[] {
    if (args.parent_session_ids.length === 0) return [];
    const placeholders = args.parent_session_ids.map(() => "?").join(",");
    const where: string[] = [`s.parent_session_id IN (${placeholders})`];
    const params: unknown[] = [...args.parent_session_ids];
    if (args.project_dir) {
      where.push("s.project_dir = ?");
      params.push(args.project_dir);
    }
    if (args.host_id) {
      where.push("s.host_id = ?");
      params.push(args.host_id);
    }

    const rows = this.db
      .prepare(`
        SELECT
          s.*,
          d.started_at              AS d_started_at,
          d.ended_at                AS d_ended_at,
          d.message_count           AS d_message_count,
          d.user_message_count      AS d_user_message_count,
          d.assistant_message_count AS d_assistant_message_count,
          d.tool_use_count          AS d_tool_use_count,
          d.tool_names              AS d_tool_names,
          d.model                   AS d_model,
          d.cwd                     AS d_cwd,
          d.git_branch              AS d_git_branch,
          d.input_tokens            AS d_input_tokens,
          d.output_tokens           AS d_output_tokens,
          d.cache_creation_tokens   AS d_cache_creation_tokens,
          d.cache_read_tokens       AS d_cache_read_tokens,
          d.parse_error_count       AS d_parse_error_count,
          d.parsed_at               AS d_parsed_at,
          d.parsed_for_mtime        AS d_parsed_for_mtime,
          d.custom_title            AS d_custom_title,
          d.agent_name              AS d_agent_name,
          d.last_prompt             AS d_last_prompt
        FROM sessions s
        LEFT JOIN session_details d
          ON s.source_key = d.source_key AND s.host_id = d.host_id
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(d.started_at, s.last_seen_at) ASC
      `)
      .all(...params) as Array<SessionRow & Record<string, unknown>>;

    return rows.map((row) => ({
      session: this.rowToSession(row),
      details: row.d_parsed_at ? this.rowToDetails(this.projectDetailRow(row)) : null,
    }));
  }

  recentSessionStats(days: number, hostId?: string): RecentProjectStats[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const where = hostId ? `AND s.host_id = ?` : "";
    const params: unknown[] = [since];
    if (hostId) params.push(hostId);

    return this.db
      .prepare(`
        SELECT
          s.project_dir                                AS project_dir,
          COUNT(*)                                     AS session_count,
          MAX(COALESCE(d.started_at, s.last_seen_at))  AS last_active_at
        FROM sessions s
        LEFT JOIN session_details d
          ON s.source_key = d.source_key AND s.host_id = d.host_id
        WHERE COALESCE(d.started_at, s.last_seen_at) >= ? ${where}
        GROUP BY s.project_dir
        ORDER BY last_active_at DESC
      `)
      .all(...params) as RecentProjectStats[];
  }

  private projectDetailRow(row: Record<string, unknown>): SessionDetailsRow {
    return {
      source_key: row.source_key as string,
      host_id: row.host_id as string,
      started_at: row.d_started_at as string | null,
      ended_at: row.d_ended_at as string | null,
      message_count: row.d_message_count as number,
      user_message_count: row.d_user_message_count as number,
      assistant_message_count: row.d_assistant_message_count as number,
      tool_use_count: row.d_tool_use_count as number,
      tool_names: row.d_tool_names as string | null,
      model: row.d_model as string | null,
      cwd: row.d_cwd as string | null,
      git_branch: row.d_git_branch as string | null,
      input_tokens: row.d_input_tokens as number,
      output_tokens: row.d_output_tokens as number,
      cache_creation_tokens: row.d_cache_creation_tokens as number,
      cache_read_tokens: row.d_cache_read_tokens as number,
      parse_error_count: row.d_parse_error_count as number,
      parsed_at: row.d_parsed_at as string,
      parsed_for_mtime: row.d_parsed_for_mtime as string,
      custom_title: row.d_custom_title as string | null,
      agent_name: row.d_agent_name as string | null,
      last_prompt: row.d_last_prompt as string | null,
    };
  }

  replaceUserMessages(
    sourceKey: string,
    hostId: string,
    messages: UserMessageRecord[],
  ): void {
    const del = this.db.prepare(
      `DELETE FROM user_messages WHERE source_key = ? AND host_id = ?`,
    );
    const insert = this.db.prepare(`
      INSERT INTO user_messages (source_key, host_id, seq, timestamp, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      del.run(sourceKey, hostId);
      for (const m of messages) {
        insert.run(m.source_key, m.host_id, m.seq, m.timestamp, m.content);
      }
    });
    tx();
  }

  searchUserMessages(args: {
    query: string;
    project_dir?: string;
    host_id?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): SearchHit[] {
    const where: string[] = ["um.rowid = f.rowid", "user_messages_fts MATCH ?"];
    const params: unknown[] = [args.query];
    if (args.project_dir) {
      where.push("s.project_dir = ?");
      params.push(args.project_dir);
    }
    if (args.host_id) {
      where.push("um.host_id = ?");
      params.push(args.host_id);
    }
    if (args.since) {
      where.push("COALESCE(um.timestamp, s.last_seen_at) >= ?");
      params.push(args.since);
    }
    if (args.until) {
      where.push("COALESCE(um.timestamp, s.last_seen_at) <= ?");
      params.push(args.until);
    }
    const limit = args.limit ?? 25;

    const rows = this.db
      .prepare(`
        SELECT
          um.source_key  AS source_key,
          um.host_id     AS host_id,
          um.seq         AS seq,
          um.timestamp   AS timestamp,
          snippet(user_messages_fts, 0, '<mark>', '</mark>', '...', 12) AS snippet,
          s.project_dir  AS project_dir,
          s.session_id   AS session_id,
          d.started_at   AS started_at
        FROM user_messages_fts f
        JOIN user_messages um ON um.rowid = f.rowid
        LEFT JOIN sessions s
          ON s.source_key = um.source_key AND s.host_id = um.host_id
        LEFT JOIN session_details d
          ON d.source_key = um.source_key AND d.host_id = um.host_id
        WHERE ${where.join(" AND ")}
        ORDER BY rank
        LIMIT ?
      `)
      .all(...params, limit) as SearchHit[];
    return rows;
  }

  getUserMessages(sourceKey: string, hostId: string): UserMessageRecord[] {
    return this.db
      .prepare(`
        SELECT source_key, host_id, seq, timestamp, content
        FROM user_messages
        WHERE source_key = ? AND host_id = ?
        ORDER BY seq
      `)
      .all(sourceKey, hostId) as UserMessageRecord[];
  }

  upsertSessionSummary(record: SessionSummaryRecord): void {
    this.db
      .prepare(`
        INSERT INTO session_summaries (
          source_key, host_id, one_liner, summary_json, tags, model,
          input_tokens, output_tokens, generated_at, generated_for_mtime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (source_key, host_id) DO UPDATE SET
          one_liner            = excluded.one_liner,
          summary_json         = excluded.summary_json,
          tags                 = excluded.tags,
          model                = excluded.model,
          input_tokens         = excluded.input_tokens,
          output_tokens        = excluded.output_tokens,
          generated_at         = excluded.generated_at,
          generated_for_mtime  = excluded.generated_for_mtime
      `)
      .run(
        record.source_key,
        record.host_id,
        record.one_liner,
        JSON.stringify(record.summary),
        JSON.stringify(record.tags),
        record.model,
        record.input_tokens,
        record.output_tokens,
        record.generated_at,
        record.generated_for_mtime,
      );
  }

  getSessionSummary(sourceKey: string, hostId: string): SessionSummaryRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM session_summaries WHERE source_key = ? AND host_id = ?`,
      )
      .get(sourceKey, hostId) as
      | {
          source_key: string;
          host_id: string;
          one_liner: string | null;
          summary_json: string;
          tags: string | null;
          model: string;
          input_tokens: number;
          output_tokens: number;
          generated_at: string;
          generated_for_mtime: string;
        }
      | undefined;
    if (!row) return null;
    return {
      source_key: row.source_key,
      host_id: row.host_id,
      one_liner: row.one_liner ?? "",
      summary: JSON.parse(row.summary_json) as SessionSummary,
      tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      generated_at: row.generated_at,
      generated_for_mtime: row.generated_for_mtime,
    };
  }

  listUnanalyzedSessions(filter: {
    host_id?: string;
    project_dir?: string;
    since?: string;
    limit?: number;
  }): SessionRecord[] {
    const where: string[] = ["d.source_key IS NOT NULL"];
    const params: unknown[] = [];
    if (filter.host_id) {
      where.push("s.host_id = ?");
      params.push(filter.host_id);
    }
    if (filter.project_dir) {
      where.push("s.project_dir = ?");
      params.push(filter.project_dir);
    }
    if (filter.since) {
      where.push("COALESCE(d.started_at, s.last_seen_at) >= ?");
      params.push(filter.since);
    }
    where.push(
      "(sum.source_key IS NULL OR sum.generated_for_mtime != d.parsed_for_mtime)",
    );

    const limit = filter.limit ?? 50;

    return this.db
      .prepare(`
        SELECT s.*
        FROM sessions s
        INNER JOIN session_details d
          ON s.source_key = d.source_key AND s.host_id = d.host_id
        LEFT JOIN session_summaries sum
          ON s.source_key = sum.source_key AND s.host_id = sum.host_id
        WHERE ${where.join(" AND ")}
        ORDER BY COALESCE(d.started_at, s.last_seen_at) DESC
        LIMIT ?
      `)
      .all(...params, limit)
      .map((r) => this.rowToSession(r as SessionRow));
  }

  countSummaries(hostId?: string): number {
    const sql = hostId
      ? `SELECT COUNT(*) AS n FROM session_summaries WHERE host_id = ?`
      : `SELECT COUNT(*) AS n FROM session_summaries`;
    const stmt = this.db.prepare(sql);
    const row = (hostId ? stmt.get(hostId) : stmt.get()) as { n: number };
    return row.n;
  }

  countParsedSessions(hostId?: string): number {
    const sql = hostId
      ? `SELECT COUNT(*) AS n FROM session_details WHERE host_id = ?`
      : `SELECT COUNT(*) AS n FROM session_details`;
    const stmt = this.db.prepare(sql);
    const row = (hostId ? stmt.get(hostId) : stmt.get()) as { n: number };
    return row.n;
  }

  private rowToDetails(row: SessionDetailsRow): SessionDetailsRecord {
    return {
      source_key: row.source_key,
      host_id: row.host_id,
      started_at: row.started_at,
      ended_at: row.ended_at,
      message_count: row.message_count,
      user_message_count: row.user_message_count,
      assistant_message_count: row.assistant_message_count,
      tool_use_count: row.tool_use_count,
      tool_names: row.tool_names ? (JSON.parse(row.tool_names) as string[]) : [],
      model: row.model,
      cwd: row.cwd,
      git_branch: row.git_branch,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_creation_tokens: row.cache_creation_tokens,
      cache_read_tokens: row.cache_read_tokens,
      parse_error_count: row.parse_error_count,
      parsed_at: row.parsed_at,
      parsed_for_mtime: row.parsed_for_mtime,
      custom_title: row.custom_title,
      agent_name: row.agent_name,
      last_prompt: row.last_prompt,
    };
  }

  private rowToSession(row: SessionRow): SessionRecord {
    return {
      source_key: row.source_key,
      host_id: row.host_id,
      user_id: row.user_id,
      project_dir: row.project_dir,
      session_id: row.session_id,
      parent_session_id: row.parent_session_id,
      kind: row.kind as SessionKind,
      file_size: row.file_size,
      file_mtime: row.file_mtime,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
    };
  }
}
