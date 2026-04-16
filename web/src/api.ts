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

export interface AnalyzePlan {
  model: string;
  model_known: boolean;
  est_input_tokens: number;
  est_output_tokens: number;
  est_cost_usd: number | null;
  api_calls: number;
  candidates: Array<{ source_key: string; session_id: string; project_dir: string }>;
  prices: { input_per_mtok: number; output_per_mtok: number } | null;
  notes: string;
}

export interface AnalyzeCapabilities {
  llm_available: boolean;
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
  analyzeRun: (body: { project?: string; limit?: number; model?: string; host?: string }) =>
    postJson<{ ok: true; job_id: string }>("/api/analyze/run", body),
  analyzeJob: (id: string) =>
    getJson<{ found: boolean; job: AnalyzeJob | null }>(`/api/analyze/jobs/${encodeURIComponent(id)}`),
};
