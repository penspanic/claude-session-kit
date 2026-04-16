import { DEFAULT_ANALYZE_MODEL, planAnalyzeRun, type AnalyzePlan } from "../analyze.js";
import { SUGGESTED_MODELS } from "../pricing.js";
import type { SessionStore } from "../store/index.js";
import type { SessionSummaryRecord } from "../types.js";
import type { AnalyzeJobRegistry } from "./jobs.js";

export interface StatsPayload {
  totalSessions: number;
  parsedSessions: number;
  summarizedSessions: number;
  hostId: string;
  userId: string;
  dataDir: string;
}

export interface RecentPayload {
  days: number;
  totalSessions: number;
  projects: Array<{
    project_dir: string;
    session_count: number;
    last_active_at: string;
  }>;
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

export interface SessionDetailPayload {
  found: boolean;
  reason?: string;
  session?: SessionListItem;
  summary?: SessionSummaryRecord | null;
  user_messages?: Array<{ seq: number; timestamp: string | null; content: string }>;
}

export interface SearchPayload {
  query: string;
  count: number;
  hits: Array<{
    source_key: string;
    host_id: string;
    seq: number;
    timestamp: string | null;
    snippet: string;
    project_dir: string;
    session_id: string;
    started_at: string | null;
  }>;
}

export interface HandlerContext {
  store: SessionStore;
  hostId: string;
  userId: string;
  dataDir: string;
  jobs: AnalyzeJobRegistry;
  /** Factory for the LLM client. Returns null when no API key is configured. */
  makeLLMClient: (model: string) => import("../analyze.js").LLMClient | null;
  /** Whether an API key is currently available (env or runtime-set). */
  llmAvailable: () => boolean;
  /**
   * Where the current API key came from. UI uses this to label the banner
   * ("set in env" vs "set in browser") and to decide whether DELETE is sane
   * (clearing a runtime key is fine; clearing an env key has no effect after
   * restart so we still allow it but warn).
   */
  apiKeySource: () => "env" | "runtime" | null;
  /** Last 4 chars of the active key, for non-secret display. */
  apiKeyPreview: () => string | null;
  /** Set the runtime API key. Validates the prefix loosely (Anthropic keys start with `sk-`). */
  setApiKey: (key: string) => { ok: boolean; reason?: string };
  /** Clear the runtime API key. Returns false if the active key came from env (no-op). */
  clearApiKey: () => boolean;
}

export async function getStats(ctx: HandlerContext): Promise<StatsPayload> {
  const [totalSessions, parsedSessions, summarizedSessions] = await Promise.all([
    Promise.resolve(ctx.store.countSessions()),
    Promise.resolve(ctx.store.countParsedSessions()),
    Promise.resolve(ctx.store.countSummaries()),
  ]);
  return {
    totalSessions,
    parsedSessions,
    summarizedSessions,
    hostId: ctx.hostId,
    userId: ctx.userId,
    dataDir: ctx.dataDir,
  };
}

export async function getRecent(
  ctx: HandlerContext,
  params: { days?: number; host?: string },
): Promise<RecentPayload> {
  const days = clampInt(params.days, 1, 365, 7);
  const projects = await Promise.resolve(ctx.store.recentSessionStats(days, params.host));
  const totalSessions = projects.reduce((acc, p) => acc + p.session_count, 0);
  return { days, totalSessions, projects };
}

export async function getSessions(
  ctx: HandlerContext,
  params: {
    project?: string;
    host?: string;
    kind?: "main" | "subagent";
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
    group?: "flat" | "parent";
  },
): Promise<SessionListPayload> {
  const limit = clampInt(params.limit, 1, 200, 50);
  const offset = clampInt(params.offset, 0, 100_000, 0);
  const group = params.group ?? "flat";

  const kindFilter = group === "parent" ? "main" : params.kind;
  const rows = await Promise.resolve(
    ctx.store.listSessionsWithDetails({
      host_id: params.host,
      project_dir: params.project,
      kind: kindFilter,
      since: params.since,
      until: params.until,
      limit,
      offset,
    }),
  );

  const items: SessionListItem[] = [];
  for (const { session, details } of rows) {
    const summary = await Promise.resolve(
      ctx.store.getSessionSummary(session.source_key, session.host_id),
    );
    items.push(toListItem(session, details, summary));
  }

  if (group === "parent" && items.length > 0) {
    const parentIds = items.map((i) => i.session_id);
    const childRows = await Promise.resolve(
      ctx.store.listChildSessionsWithDetails({
        parent_session_ids: parentIds,
        project_dir: params.project,
        host_id: params.host,
      }),
    );
    const childrenByParent = new Map<string, SessionListItem[]>();
    for (const { session, details } of childRows) {
      const summary = await Promise.resolve(
        ctx.store.getSessionSummary(session.source_key, session.host_id),
      );
      const child = toListItem(session, details, summary);
      const key = session.parent_session_id ?? "";
      const list = childrenByParent.get(key) ?? [];
      list.push(child);
      childrenByParent.set(key, list);
    }
    for (const item of items) {
      item.children = childrenByParent.get(item.session_id) ?? [];
    }
  }

  return { count: items.length, limit, offset, group, sessions: items };
}

export async function getSession(
  ctx: HandlerContext,
  sourceKey: string,
  params: { host?: string },
): Promise<SessionDetailPayload> {
  const hostId = params.host ?? ctx.hostId;
  const sessions = await Promise.resolve(ctx.store.listSessions({ host_id: hostId }));
  const session = sessions.find((s) => s.source_key === sourceKey);
  if (!session) {
    return { found: false, reason: "No session with that source_key for the requested host_id." };
  }
  const [details, summary, userMessages] = await Promise.all([
    Promise.resolve(ctx.store.getSessionDetails(sourceKey, hostId)),
    Promise.resolve(ctx.store.getSessionSummary(sourceKey, hostId)),
    Promise.resolve(ctx.store.getUserMessages(sourceKey, hostId)),
  ]);
  return {
    found: true,
    session: toListItem(session, details, summary),
    summary,
    user_messages: userMessages.map((m) => ({
      seq: m.seq,
      timestamp: m.timestamp,
      content: m.content,
    })),
  };
}

export async function search(
  ctx: HandlerContext,
  params: {
    q?: string;
    project?: string;
    host?: string;
    since?: string;
    until?: string;
    limit?: number;
  },
): Promise<SearchPayload> {
  const query = (params.q ?? "").trim();
  if (!query) {
    return { query: "", count: 0, hits: [] };
  }
  const limit = clampInt(params.limit, 1, 100, 25);
  const hits = await Promise.resolve(
    ctx.store.searchUserMessages({
      query,
      project_dir: params.project,
      host_id: params.host,
      since: params.since,
      until: params.until,
      limit,
    }),
  );
  return { query, count: hits.length, hits };
}

function toListItem(
  session: import("../types.js").SessionRecord,
  details: import("../types.js").SessionDetailsRecord | null,
  summary: SessionSummaryRecord | null,
): SessionListItem {
  let durationMs: number | null = null;
  if (details?.started_at && details.ended_at) {
    const start = Date.parse(details.started_at);
    const end = Date.parse(details.ended_at);
    if (Number.isFinite(start) && Number.isFinite(end)) durationMs = Math.max(0, end - start);
  }

  const customTitle = details?.custom_title ?? null;
  const agentName = details?.agent_name ?? null;
  const lastPrompt = details?.last_prompt ?? null;
  const oneLiner = summary?.one_liner ?? null;

  let displayLabel: string | null = null;
  let displayLabelSource: SessionListItem["display_label_source"] = null;
  if (oneLiner) {
    displayLabel = oneLiner;
    displayLabelSource = "summary";
  } else if (customTitle) {
    displayLabel = customTitle;
    displayLabelSource = "custom_title";
  } else if (agentName) {
    displayLabel = agentName;
    displayLabelSource = "agent_name";
  } else if (lastPrompt) {
    displayLabel = lastPrompt;
    displayLabelSource = "last_prompt";
  }

  return {
    source_key: session.source_key,
    host_id: session.host_id,
    session_id: session.session_id,
    project_dir: session.project_dir,
    kind: session.kind,
    parent_session_id: session.parent_session_id,
    started_at: details?.started_at ?? null,
    ended_at: details?.ended_at ?? null,
    duration_ms: durationMs,
    message_count: details?.message_count ?? null,
    user_message_count: details?.user_message_count ?? null,
    tool_use_count: details?.tool_use_count ?? null,
    tool_names: details?.tool_names ?? null,
    model: details?.model ?? null,
    input_tokens: details?.input_tokens ?? null,
    output_tokens: details?.output_tokens ?? null,
    one_liner: oneLiner,
    tags: summary?.tags ?? null,
    has_summary: summary !== null,
    file_mtime: session.file_mtime,
    custom_title: customTitle,
    agent_name: agentName,
    last_prompt: lastPrompt,
    display_label: displayLabel,
    display_label_source: displayLabelSource,
  };
}

export interface AnalyzeRequestBody {
  project?: string;
  host?: string;
  since?: string;
  limit?: number;
  model?: string;
}

export interface AnalyzePlanResponse {
  plan: AnalyzePlan;
  llm_available: boolean;
  default_model: string;
  suggested_models: typeof SUGGESTED_MODELS;
}

export async function getAnalyzeCapabilities(ctx: HandlerContext): Promise<{
  llm_available: boolean;
  api_key_source: "env" | "runtime" | null;
  api_key_preview: string | null;
  default_model: string;
  suggested_models: typeof SUGGESTED_MODELS;
}> {
  return {
    llm_available: ctx.llmAvailable(),
    api_key_source: ctx.apiKeySource(),
    api_key_preview: ctx.apiKeyPreview(),
    default_model: DEFAULT_ANALYZE_MODEL,
    suggested_models: SUGGESTED_MODELS,
  };
}

export async function postAnalyzeKey(
  ctx: HandlerContext,
  body: { api_key?: unknown },
): Promise<{ ok: boolean; reason?: string; api_key_preview?: string | null }> {
  if (typeof body.api_key !== "string") {
    return { ok: false, reason: "Body must be { api_key: string }." };
  }
  const result = ctx.setApiKey(body.api_key);
  if (!result.ok) return result;
  return { ok: true, api_key_preview: ctx.apiKeyPreview() };
}

export async function deleteAnalyzeKey(
  ctx: HandlerContext,
): Promise<{ ok: boolean; reason?: string }> {
  const cleared = ctx.clearApiKey();
  if (!cleared) {
    return {
      ok: false,
      reason: "Active API key was set via ANTHROPIC_API_KEY env var; cannot clear at runtime. Restart `csk serve` without the env var to remove it.",
    };
  }
  return { ok: true };
}

export async function postAnalyzePlan(
  ctx: HandlerContext,
  body: AnalyzeRequestBody,
): Promise<AnalyzePlanResponse> {
  const limit = clampInt(body.limit, 1, 200, 25);
  const plan = await planAnalyzeRun(
    ctx.store,
    {
      host_id: body.host ?? ctx.hostId,
      project_dir: body.project,
      since: body.since,
      limit,
    },
    body.model ?? DEFAULT_ANALYZE_MODEL,
  );
  return {
    plan,
    llm_available: ctx.llmAvailable(),
    default_model: DEFAULT_ANALYZE_MODEL,
    suggested_models: SUGGESTED_MODELS,
  };
}

export async function postAnalyzeRun(
  ctx: HandlerContext,
  body: AnalyzeRequestBody,
): Promise<{ ok: false; reason: string } | { ok: true; job_id: string }> {
  if (!ctx.llmAvailable()) {
    return {
      ok: false,
      reason: "API key not set. Use the Set API Key button (or set ANTHROPIC_API_KEY before launching).",
    };
  }
  const limit = clampInt(body.limit, 1, 200, 25);
  const model = body.model ?? DEFAULT_ANALYZE_MODEL;
  const plan = await planAnalyzeRun(
    ctx.store,
    {
      host_id: body.host ?? ctx.hostId,
      project_dir: body.project,
      since: body.since,
      limit,
    },
    model,
  );
  if (plan.candidates.length === 0) {
    return { ok: false, reason: "No candidate sessions to analyze." };
  }
  const client = ctx.makeLLMClient(model);
  if (!client) {
    return { ok: false, reason: "Failed to construct LLM client." };
  }
  const job = ctx.jobs.start({ plan, store: ctx.store, client });
  return { ok: true, job_id: job.id };
}

export async function getAnalyzeJob(
  ctx: HandlerContext,
  id: string,
): Promise<{ found: boolean; job: ReturnType<AnalyzeJobRegistry["get"]> }> {
  const job = ctx.jobs.get(id);
  return { found: job !== null, job };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
