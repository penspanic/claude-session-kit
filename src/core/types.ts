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

export interface SessionCorrection {
  /** Verbatim user phrase that redirects or corrects the assistant. */
  user_quote: string;
  /** One-line description of the assistant behavior being corrected. */
  assistant_action: string;
}

export interface SessionSummary {
  one_liner: string;
  what_tried: string;
  outcome: string;
  notable: string[];
  blog_hooks: string[];
  tags: string[];
  /** Normalized task intent, e.g. "react refactor" or "sql migration debugging". */
  intent?: string;
  /** Natural-language observations of retries, backtracks, redo-loops. */
  friction_events?: string[];
  /** User corrections captured verbatim so cross-session passes can cluster them. */
  corrections?: SessionCorrection[];
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
  /** 0 = pre-signals summary. 1 = summary includes intent/friction/corrections. */
  signals_version: number;
}

export type FindingKind =
  | "repetition"
  | "correction_pattern"
  | "friction"
  | "skill_gap"
  /** Codebase smell: inconsistent or anti-pattern code that repeatedly trips
   *  assistants — remedy is usually refactor, not a behavioral rule. */
  | "codebase_smell"
  /** Missing inline/module documentation that would have prevented confusion. */
  | "documentation_gap"
  /** Missing or weak tests that let regressions slip. */
  | "test_coverage_gap"
  /** API/module surface where correct use requires unstated side actions
   *  (e.g. manual cache invalidation) — remedy is API redesign. */
  | "api_friction";

export interface FindingEvidence {
  source_key: string;
  host_id: string;
  /** Short verbatim excerpt from the cited session's signals. */
  quote?: string;
}

export interface Finding {
  kind: FindingKind;
  /** Stable-ish grouping key within a run so duplicates can be folded. */
  cluster_key?: string;
  title: string;
  description: string;
  /** Recommended remedy, e.g. "add slash-command X" or "add rule to CLAUDE.md". */
  suggested_remedy?: string;
  evidence: FindingEvidence[];
  /** 0..1 confidence/severity as judged by the LLM. */
  score?: number;
}

export interface FindingRecord extends Finding {
  id: number;
  run_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  generated_at: string;
}

export type PatternScope = "project" | "global";

export interface PatternRunRecord {
  run_id: string;
  host_id: string;
  model: string;
  summary_count: number;
  input_tokens: number;
  output_tokens: number;
  finding_count: number;
  filter_json: string | null;
  started_at: string;
  finished_at: string | null;
  scope: PatternScope | null;
  /** Project-mode: list of project_dirs this run consumed. Null for global. */
  scope_project_dirs: string[] | null;
}

export interface PatternRunSource {
  source_key: string;
  host_id: string;
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
