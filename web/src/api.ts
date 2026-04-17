export interface StatsPayload {
  totalSessions: number;
  parsedSessions: number;
  summarizedSessions: number;
  hostId: string;
  userId: string;
  dataDir: string;
}

export interface RecentProject {
  project_dir: string;
  session_count: number;
  last_active_at: string;
}

export interface RecentPayload {
  days: number;
  totalSessions: number;
  projects: RecentProject[];
}

export interface SessionListItem {
  source_key: string;
  host_id: string;
  session_id: string;
  project_dir: string;
  kind: string;
  parent_session_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  message_count: number | null;
  user_message_count: number | null;
  tool_use_count: number | null;
  tool_names: string[] | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  one_liner: string | null;
  tags: string[] | null;
  has_summary: boolean;
  file_mtime: string;
  custom_title: string | null;
  agent_name: string | null;
  last_prompt: string | null;
  display_label: string | null;
  display_label_source: "summary" | "custom_title" | "agent_name" | "last_prompt" | null;
  children?: SessionListItem[];
}

export interface SessionListPayload {
  count: number;
  limit: number;
  offset: number;
  group: "flat" | "parent";
  sessions: SessionListItem[];
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
  one_liner: string;
  summary: SessionSummary;
  tags: string[];
  model: string;
  input_tokens: number;
  output_tokens: number;
  generated_at: string;
}

export interface SessionDetailPayload {
  found: boolean;
  reason?: string;
  session?: SessionListItem;
  summary?: SessionSummaryRecord | null;
  user_messages?: Array<{ seq: number; timestamp: string | null; content: string }>;
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

export interface SearchPayload {
  query: string;
  count: number;
  hits: SearchHit[];
}

export interface AnalyzeCandidate {
  source_key: string;
  host_id: string;
  session_id: string;
  project_dir: string;
  kind: string;
  parent_session_id: string | null;
  started_at: string | null;
  user_message_count: number | null;
  est_input_tokens: number;
  display_label: string | null;
  display_label_source: "summary" | "custom_title" | "agent_name" | "last_prompt" | null;
}

export interface AnalyzePlan {
  model: string;
  model_known: boolean;
  est_input_tokens: number;
  est_output_tokens: number;
  est_output_tokens_per_call: number;
  est_cost_usd: number | null;
  api_calls: number;
  candidates: AnalyzeCandidate[];
  prices: { input_per_mtok: number; output_per_mtok: number } | null;
  notes: string;
}

export interface AnalyzeCapabilities {
  llm_available: boolean;
  api_key_source: "env" | "runtime" | null;
  api_key_preview: string | null;
  default_model: string;
  suggested_models: Array<{ id: string; label: string }>;
}

export interface AnalyzePlanResponse extends AnalyzeCapabilities {
  plan: AnalyzePlan;
}

export interface AnalyzeJobResult {
  source_key: string;
  status: "ok" | "failed";
  input_tokens: number;
  output_tokens: number;
  one_liner: string | null;
  error: string | null;
}

export interface AnalyzeJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
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
  results: AnalyzeJobResult[];
  error: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const reason = (json as { error?: string; reason?: string }).error
      ?? (json as { error?: string; reason?: string }).reason
      ?? `${res.status} ${res.statusText}`;
    throw new Error(reason);
  }
  return json;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export const api = {
  stats: () => getJson<StatsPayload>("/api/stats"),
  recent: (days: number) => getJson<RecentPayload>(`/api/recent${qs({ days })}`),
  sessions: (params: {
    project?: string;
    limit?: number;
    offset?: number;
    group?: "flat" | "parent";
  }) => getJson<SessionListPayload>(`/api/sessions${qs(params)}`),
  session: (sourceKey: string) =>
    getJson<SessionDetailPayload>(`/api/sessions/${encodeURIComponent(sourceKey)}`),
  search: (params: { q: string; project?: string; limit?: number }) =>
    getJson<SearchPayload>(`/api/search${qs(params)}`),
  analyzeCapabilities: () => getJson<AnalyzeCapabilities>("/api/analyze/capabilities"),
  analyzePlan: (body: { project?: string; limit?: number; model?: string; host?: string }) =>
    postJson<AnalyzePlanResponse>("/api/analyze/plan", body),
  analyzeRun: (body: {
    project?: string;
    limit?: number;
    model?: string;
    host?: string;
    source_keys?: string[];
  }) => postJson<{ ok: true; job_id: string }>("/api/analyze/run", body),
  analyzeJob: (id: string) =>
    getJson<{ found: boolean; job: AnalyzeJob | null }>(`/api/analyze/jobs/${encodeURIComponent(id)}`),
  setApiKey: (apiKey: string) =>
    postJson<{ ok: true; api_key_preview: string | null }>("/api/analyze/key", { api_key: apiKey }),
  clearApiKey: async () => {
    const res = await fetch("/api/analyze/key", { method: "DELETE" });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (!res.ok || !json.ok) throw new Error(json.reason ?? `${res.status} ${res.statusText}`);
    return json as { ok: true };
  },
  patternsPlan: (body: PatternsRequest) =>
    postJson<PatternsPlanResponse>("/api/patterns/plan", body),
  patternsRun: (body: PatternsRequest) =>
    postJson<{ ok: true; job_id: string }>("/api/patterns/run", body),
  patternsJob: (id: string) =>
    getJson<{ found: boolean; job: PatternsJob | null }>(
      `/api/patterns/jobs/${encodeURIComponent(id)}`,
    ),
  patternsRuns: (params: { scope?: "project" | "global"; project_dir?: string; limit?: number } = {}) =>
    getJson<{ runs: PatternRun[] }>(`/api/patterns/runs${qs(params)}`),
  patternsFindings: (params: { run_id?: string; kind?: string; limit?: number }) =>
    getJson<{
      run: PatternRun | null;
      findings: FindingRecord[];
      latest_run_id: string | null;
    }>(`/api/patterns/findings${qs(params)}`),
  patternsSources: (runId?: string) =>
    getJson<{ run_id: string | null; sources: PatternRunSourceItem[] }>(
      `/api/patterns/sources${qs({ run_id: runId })}`,
    ),
};

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

export type FindingKind = "repetition" | "correction_pattern" | "friction" | "skill_gap";

export interface FindingEvidence {
  source_key: string;
  host_id: string;
  quote?: string;
}

export interface FindingRecord {
  id: number;
  run_id: string;
  kind: FindingKind;
  cluster_key?: string;
  title: string;
  description: string;
  suggested_remedy?: string;
  evidence: FindingEvidence[];
  score?: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  generated_at: string;
}

export interface PatternRun {
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
  scope: "project" | "global" | null;
  scope_project_dirs: string[] | null;
}

export interface PatternsRequest {
  scope: "project" | "global";
  project_dirs?: string[];
  limit?: number;
  model?: string;
  host?: string;
}

export interface PatternsPlanCandidate {
  source_key: string;
  host_id: string;
  project_dir: string;
  session_id: string;
  started_at: string | null;
  one_liner: string;
}

export interface PatternsPlan {
  model: string;
  model_known: boolean;
  summary_count: number;
  est_input_tokens: number;
  est_output_tokens: number;
  est_cost_usd: number | null;
  prices: { input_per_mtok: number; output_per_mtok: number } | null;
  notes: string;
  candidates: PatternsPlanCandidate[];
}

export interface PatternsPlanResponse {
  plan: PatternsPlan;
  scope: "project" | "global";
  llm_available: boolean;
  default_model: string;
  suggested_models: Array<{ id: string; label: string }>;
  total_enriched_summaries: number;
  total_summaries: number;
  projects: Array<{ project_dir: string; count: number }>;
}

export interface PatternsJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
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
