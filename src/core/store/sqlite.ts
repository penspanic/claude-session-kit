import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionStore } from "./index.js";
import type {
  BackupRun,
  SessionFilter,
  SessionKind,
  SessionRecord,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS backup_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  files_scanned   INTEGER NOT NULL DEFAULT 0,
  files_copied    INTEGER NOT NULL DEFAULT 0,
  bytes_copied    INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_host_started
  ON backup_runs (host_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  source_key         TEXT    NOT NULL,
  host_id            TEXT    NOT NULL,
  user_id            TEXT    NOT NULL,
  project_dir        TEXT    NOT NULL,
  session_id         TEXT    NOT NULL,
  parent_session_id  TEXT,
  kind               TEXT    NOT NULL,
  file_size          INTEGER NOT NULL,
  file_mtime         TEXT    NOT NULL,
  first_seen_at      TEXT    NOT NULL,
  last_seen_at       TEXT    NOT NULL,
  PRIMARY KEY (source_key, host_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_last_seen
  ON sessions (project_dir, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_host_user
  ON sessions (host_id, user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON sessions (parent_session_id);
`;

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

export class SqliteStore implements SessionStore {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  init(): void {
    this.db.exec(SCHEMA);
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
        .prepare(`SELECT * FROM sessions ${sql} ORDER BY last_seen_at DESC`)
        .all(...params) as SessionRow[]
    ).map((r) => this.rowToSession(r));
  }

  countSessions(filter: SessionFilter = {}): number {
    const { sql, params } = this.buildSessionQuery(filter);
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM sessions ${sql}`)
      .get(...params) as { n: number };
    return row.n;
  }

  private buildSessionQuery(filter: SessionFilter): { sql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.host_id) {
      where.push("host_id = ?");
      params.push(filter.host_id);
    }
    if (filter.user_id) {
      where.push("user_id = ?");
      params.push(filter.user_id);
    }
    if (filter.project_dir) {
      where.push("project_dir = ?");
      params.push(filter.project_dir);
    }
    if (filter.kind) {
      where.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.since) {
      where.push("last_seen_at >= ?");
      params.push(filter.since);
    }
    if (filter.until) {
      where.push("last_seen_at <= ?");
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
