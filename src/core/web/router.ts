import {
  deleteAnalyzeKey,
  getAnalyzeCapabilities,
  getAnalyzeJob,
  getRecent,
  getSession,
  getSessions,
  getStats,
  postAnalyzeKey,
  postAnalyzePlan,
  postAnalyzeRun,
  search,
  type AnalyzeRequestBody,
  type HandlerContext,
} from "./handlers.js";

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export async function routeApi(ctx: HandlerContext, req: ApiRequest): Promise<ApiResponse> {
  if (req.method === "POST") {
    return routePost(ctx, req);
  }
  if (req.method === "DELETE") {
    return routeDelete(ctx, req);
  }
  if (req.method !== "GET") {
    return { status: 405, body: { error: "Method Not Allowed" } };
  }

  if (req.path === "/api/stats") {
    return { status: 200, body: await getStats(ctx) };
  }

  if (req.path === "/api/recent") {
    return {
      status: 200,
      body: await getRecent(ctx, {
        days: parseIntOr(req.query.days, undefined),
        host: req.query.host,
      }),
    };
  }

  if (req.path === "/api/sessions") {
    const kind = req.query.kind;
    const group = req.query.group;
    return {
      status: 200,
      body: await getSessions(ctx, {
        project: req.query.project,
        host: req.query.host,
        kind: kind === "main" || kind === "subagent" ? kind : undefined,
        since: req.query.since,
        until: req.query.until,
        limit: parseIntOr(req.query.limit, undefined),
        offset: parseIntOr(req.query.offset, undefined),
        group: group === "parent" || group === "flat" ? group : undefined,
      }),
    };
  }

  if (req.path.startsWith("/api/sessions/")) {
    const sourceKey = decodeURIComponent(req.path.slice("/api/sessions/".length));
    if (!sourceKey) return { status: 400, body: { error: "source_key required" } };
    const payload = await getSession(ctx, sourceKey, { host: req.query.host });
    return { status: payload.found ? 200 : 404, body: payload };
  }

  if (req.path === "/api/analyze/capabilities") {
    return { status: 200, body: await getAnalyzeCapabilities(ctx) };
  }

  if (req.path.startsWith("/api/analyze/jobs/")) {
    const id = decodeURIComponent(req.path.slice("/api/analyze/jobs/".length));
    if (!id) return { status: 400, body: { error: "job id required" } };
    const out = await getAnalyzeJob(ctx, id);
    return { status: out.found ? 200 : 404, body: out };
  }

  if (req.path === "/api/search") {
    return {
      status: 200,
      body: await search(ctx, {
        q: req.query.q,
        project: req.query.project,
        host: req.query.host,
        since: req.query.since,
        until: req.query.until,
        limit: parseIntOr(req.query.limit, undefined),
      }),
    };
  }

  return { status: 404, body: { error: "Not Found" } };
}

async function routePost(ctx: HandlerContext, req: ApiRequest): Promise<ApiResponse> {
  if (req.path === "/api/analyze/plan") {
    const body = (req.body ?? {}) as AnalyzeRequestBody;
    return { status: 200, body: await postAnalyzePlan(ctx, body) };
  }
  if (req.path === "/api/analyze/run") {
    const body = (req.body ?? {}) as AnalyzeRequestBody;
    const out = await postAnalyzeRun(ctx, body);
    return { status: out.ok ? 202 : 400, body: out };
  }
  if (req.path === "/api/analyze/key") {
    const body = (req.body ?? {}) as { api_key?: unknown };
    const out = await postAnalyzeKey(ctx, body);
    return { status: out.ok ? 200 : 400, body: out };
  }
  return { status: 404, body: { error: "Not Found" } };
}

async function routeDelete(ctx: HandlerContext, req: ApiRequest): Promise<ApiResponse> {
  if (req.path === "/api/analyze/key") {
    const out = await deleteAnalyzeKey(ctx);
    return { status: out.ok ? 200 : 400, body: out };
  }
  return { status: 404, body: { error: "Not Found" } };
}

function parseIntOr(value: string | undefined, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
