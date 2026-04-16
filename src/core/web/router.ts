import {
  getRecent,
  getSession,
  getSessions,
  getStats,
  search,
  type HandlerContext,
} from "./handlers.js";

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export async function routeApi(ctx: HandlerContext, req: ApiRequest): Promise<ApiResponse> {
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

function parseIntOr(value: string | undefined, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
