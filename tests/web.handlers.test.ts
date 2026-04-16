import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/core/store/sqlite.js";
import type {
  SessionDetailsRecord,
  SessionRecord,
  SessionSummary,
  SessionSummaryRecord,
  UserMessageRecord,
} from "../src/core/types.js";
import {
  getRecent,
  getSession,
  getSessions,
  getStats,
  search,
  type HandlerContext,
} from "../src/core/web/handlers.js";
import { routeApi } from "../src/core/web/router.js";
import { makeTempEnv } from "./helpers.js";

function makeCtx(): { ctx: HandlerContext; store: SqliteStore } {
  const env = makeTempEnv();
  const store = new SqliteStore(env.config.store.path);
  store.init();
  return {
    store,
    ctx: { store, hostId: "h1", userId: "u1", dataDir: env.dataDir },
  };
}

function sess(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    source_key: "-proj/sess-1.jsonl",
    kind: "main",
    host_id: "h1",
    user_id: "u1",
    project_dir: "-proj",
    session_id: "sess-1",
    parent_session_id: null,
    file_size: 100,
    file_mtime: "2026-04-16T10:00:00Z",
    first_seen_at: "2026-04-16T10:00:00Z",
    last_seen_at: "2026-04-16T10:00:00Z",
    ...overrides,
  };
}

function details(overrides: Partial<SessionDetailsRecord> = {}): SessionDetailsRecord {
  return {
    source_key: "-proj/sess-1.jsonl",
    host_id: "h1",
    started_at: "2026-04-15T08:00:00Z",
    ended_at: "2026-04-15T09:00:00Z",
    message_count: 10,
    user_message_count: 4,
    assistant_message_count: 6,
    tool_use_count: 3,
    tool_names: ["Bash", "Read"],
    model: "claude-sonnet-4-6",
    cwd: "/tmp",
    git_branch: "main",
    input_tokens: 100,
    output_tokens: 200,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    parse_error_count: 0,
    parsed_at: "2026-04-16T10:00:00Z",
    parsed_for_mtime: "2026-04-16T10:00:00Z",
    ...overrides,
  };
}

function summary(overrides: Partial<SessionSummaryRecord> = {}): SessionSummaryRecord {
  const body: SessionSummary = {
    one_liner: "fixed a bug",
    what_tried: "tried things",
    outcome: "shipped it",
    notable: [],
    blog_hooks: [],
    tags: ["bugfix"],
  };
  return {
    source_key: "-proj/sess-1.jsonl",
    host_id: "h1",
    one_liner: body.one_liner,
    summary: body,
    tags: body.tags,
    model: "claude-haiku-4-5",
    input_tokens: 50,
    output_tokens: 75,
    generated_at: "2026-04-16T11:00:00Z",
    generated_for_mtime: "2026-04-16T10:00:00Z",
    ...overrides,
  };
}

describe("getStats", () => {
  it("returns counts and identity from context", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess());
    store.upsertSessionDetails(details());
    store.upsertSessionSummary(summary());

    const out = await getStats(ctx);
    expect(out).toEqual({
      totalSessions: 1,
      parsedSessions: 1,
      summarizedSessions: 1,
      hostId: "h1",
      userId: "u1",
      dataDir: ctx.dataDir,
    });
    store.close();
  });
});

describe("getRecent", () => {
  it("groups by project and totals counts", async () => {
    const { ctx, store } = makeCtx();
    const now = new Date().toISOString();
    store.upsertSession(sess({ source_key: "a", session_id: "a", project_dir: "-A", last_seen_at: now }));
    store.upsertSession(sess({ source_key: "b", session_id: "b", project_dir: "-A", last_seen_at: now }));
    store.upsertSession(sess({ source_key: "c", session_id: "c", project_dir: "-B", last_seen_at: now }));

    const out = await getRecent(ctx, { days: 7 });
    expect(out.totalSessions).toBe(3);
    expect(out.projects).toHaveLength(2);
    store.close();
  });

  it("clamps days to fallback when missing or out of range", async () => {
    const { ctx, store } = makeCtx();
    expect((await getRecent(ctx, {})).days).toBe(7);
    expect((await getRecent(ctx, { days: 9999 })).days).toBe(365);
    expect((await getRecent(ctx, { days: 0 })).days).toBe(1);
    store.close();
  });
});

describe("getSessions", () => {
  it("attaches parsed details and one_liner when summary exists", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess());
    store.upsertSessionDetails(details());
    store.upsertSessionSummary(summary());

    const out = await getSessions(ctx, {});
    expect(out.count).toBe(1);
    const item = out.sessions[0]!;
    expect(item.session_id).toBe("sess-1");
    expect(item.tool_use_count).toBe(3);
    expect(item.tool_names).toEqual(["Bash", "Read"]);
    expect(item.duration_ms).toBe(60 * 60 * 1000);
    expect(item.one_liner).toBe("fixed a bug");
    expect(item.has_summary).toBe(true);
    store.close();
  });

  it("returns nulls for sessions without details or summary", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess({ source_key: "x", session_id: "x" }));

    const out = await getSessions(ctx, {});
    const item = out.sessions[0]!;
    expect(item.message_count).toBeNull();
    expect(item.duration_ms).toBeNull();
    expect(item.one_liner).toBeNull();
    expect(item.has_summary).toBe(false);
    store.close();
  });

  it("groups subagents under parent main sessions when group=parent", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess({ source_key: "main.jsonl", session_id: "main-1", kind: "main" }));
    store.upsertSession(
      sess({
        source_key: "main.jsonl/subagents/sa-a.jsonl",
        session_id: "sa-a",
        kind: "subagent",
        parent_session_id: "main-1",
      }),
    );
    store.upsertSession(
      sess({
        source_key: "main.jsonl/subagents/sa-b.jsonl",
        session_id: "sa-b",
        kind: "subagent",
        parent_session_id: "main-1",
      }),
    );
    store.upsertSession(sess({ source_key: "orphan.jsonl", session_id: "orphan", kind: "subagent", parent_session_id: "missing" }));

    const flat = await getSessions(ctx, { group: "flat" });
    expect(flat.sessions).toHaveLength(4);
    expect(flat.group).toBe("flat");

    const tree = await getSessions(ctx, { group: "parent" });
    expect(tree.group).toBe("parent");
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0]!.session_id).toBe("main-1");
    expect(tree.sessions[0]!.children?.map((c) => c.session_id).sort()).toEqual(["sa-a", "sa-b"]);
    store.close();
  });

  it("filters by project and clamps limit/offset", async () => {
    const { ctx, store } = makeCtx();
    for (let i = 0; i < 5; i += 1) {
      store.upsertSession(sess({ source_key: `s${i}`, session_id: `s${i}`, project_dir: "-A" }));
    }
    store.upsertSession(sess({ source_key: "other", session_id: "other", project_dir: "-B" }));

    const aOnly = await getSessions(ctx, { project: "-A" });
    expect(aOnly.sessions).toHaveLength(5);

    const paged = await getSessions(ctx, { project: "-A", limit: 2, offset: 2 });
    expect(paged.sessions).toHaveLength(2);
    expect(paged.limit).toBe(2);
    expect(paged.offset).toBe(2);
    store.close();
  });
});

describe("getSession", () => {
  it("returns 404-shaped payload when not found", async () => {
    const { ctx, store } = makeCtx();
    const out = await getSession(ctx, "nope", {});
    expect(out.found).toBe(false);
    expect(out.reason).toBeTruthy();
    store.close();
  });

  it("returns session, summary, and user messages", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess());
    store.upsertSessionDetails(details());
    store.upsertSessionSummary(summary());
    const userMsgs: UserMessageRecord[] = [
      { source_key: "-proj/sess-1.jsonl", host_id: "h1", seq: 1, timestamp: null, content: "hi" },
    ];
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", userMsgs);

    const out = await getSession(ctx, "-proj/sess-1.jsonl", {});
    expect(out.found).toBe(true);
    expect(out.session?.session_id).toBe("sess-1");
    expect(out.summary?.one_liner).toBe("fixed a bug");
    expect(out.user_messages).toHaveLength(1);
    expect(out.user_messages?.[0]?.content).toBe("hi");
    store.close();
  });
});

describe("search", () => {
  it("returns empty result for blank query without hitting the store", async () => {
    const { ctx, store } = makeCtx();
    const out = await search(ctx, { q: "  " });
    expect(out).toEqual({ query: "", count: 0, hits: [] });
    store.close();
  });

  it("forwards FTS hits with snippet markup", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess());
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      { source_key: "-proj/sess-1.jsonl", host_id: "h1", seq: 1, timestamp: null, content: "needle in a haystack" },
    ]);

    const out = await search(ctx, { q: "needle" });
    expect(out.count).toBe(1);
    expect(out.hits[0]!.snippet).toContain("<mark>needle</mark>");
    store.close();
  });
});

describe("routeApi", () => {
  it("rejects non-GET methods", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, { method: "POST", path: "/api/stats", query: {} });
    expect(res.status).toBe(405);
    store.close();
  });

  it("returns 404 for unknown api paths", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, { method: "GET", path: "/api/nope", query: {} });
    expect(res.status).toBe(404);
    store.close();
  });

  it("dispatches /api/sessions/:source_key with URL-decoded key", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess());
    const encoded = encodeURIComponent("-proj/sess-1.jsonl");
    const res = await routeApi(ctx, {
      method: "GET",
      path: `/api/sessions/${encoded}`,
      query: {},
    });
    expect(res.status).toBe(200);
    expect((res.body as { found: boolean }).found).toBe(true);
    store.close();
  });

  it("returns 404 on unknown session", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, {
      method: "GET",
      path: `/api/sessions/missing.jsonl`,
      query: {},
    });
    expect(res.status).toBe(404);
    store.close();
  });

  it("parses ?days as integer for /api/recent", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, {
      method: "GET",
      path: "/api/recent",
      query: { days: "30" },
    });
    expect(res.status).toBe(200);
    expect((res.body as { days: number }).days).toBe(30);
    store.close();
  });
});
