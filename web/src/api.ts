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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return (await res.json()) as T;
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
};
