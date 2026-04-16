// Public data types. All persisted records carry `host_id` and `user_id`
// so multiple machines and users can contribute to a shared store.

export type BackupRunStatus = "running" | "success" | "error";

export interface BackupRun {
  id?: number;
  host_id: string;
  user_id: string;
  started_at: string; // ISO 8601
  finished_at: string | null;
  files_scanned: number;
  files_copied: number;
  bytes_copied: number;
  status: BackupRunStatus;
  error_message: string | null;
}

export type SessionKind = "main" | "subagent";

export interface SessionRecord {
  /** Canonical key: relative path from the source root. Stable across backups. */
  source_key: string;
  kind: SessionKind;
  host_id: string;
  user_id: string;
  project_dir: string;        // Encoded project dir name, e.g. "-Users-pp-dev-private-Foo"
  session_id: string;         // Filename without ".jsonl"
  parent_session_id: string | null;
  file_size: number;
  file_mtime: string;         // ISO 8601
  first_seen_at: string;
  last_seen_at: string;
}

export interface SessionFilter {
  host_id?: string;
  user_id?: string;
  project_dir?: string;
  kind?: SessionKind;
  since?: string;
  until?: string;
}
