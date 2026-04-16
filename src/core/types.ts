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

export interface UserMessageRecord {
  source_key: string;
  host_id: string;
  seq: number;
  timestamp: string | null;
  content: string;
}

export interface SearchHit {
  source_key: string;
  host_id: string;
  seq: number;
  timestamp: string | null;
  snippet: string;
  project_dir: string;
  session_id: string;
  started_at: string | null;
}

export interface SessionSummary {
  one_liner: string;
  what_tried: string;
  outcome: string;
  notable: string[];
  blog_hooks: string[];
  tags: string[];
}

export interface SessionSummaryRecord {
  source_key: string;
  host_id: string;
  one_liner: string;
  summary: SessionSummary;
  tags: string[];
  model: string;
  input_tokens: number;
  output_tokens: number;
  generated_at: string;
  generated_for_mtime: string;
}

export interface SessionDetailsRecord {
  source_key: string;
  host_id: string;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_use_count: number;
  tool_names: string[];
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
