import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/core/store/sqlite.js";
import type {
  SessionDetailsRecord,
  SessionRecord,
  SessionSummary,
  SessionSummaryRecord,
  UserMessageRecord,
} from "../src/core/types.js";
import type { LLMClient, LLMResponse, SummarizePrompt } from "../src/core/analyze.js";
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
  type HandlerContext,
} from "../src/core/web/handlers.js";
import { AnalyzeJobRegistry } from "../src/core/web/jobs.js";
import { routeApi } from "../src/core/web/router.js";
import { makeTempEnv } from "./helpers.js";

class StubLLM implements LLMClient {
  calls = 0;
  fail = false;
  async summarize(_p: SummarizePrompt): Promise<LLMResponse> {
    this.calls += 1;
    if (this.fail) throw new Error("stub failure");
    return {
      text: JSON.stringify({
        one_liner: `summary #${this.calls}`,
        what_tried: "x",
        outcome: "y",
        notable: [],
        blog_hooks: [],
        tags: ["t"],
      }),
      model: "claude-haiku-4-5-20251001",
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }
}

function makeCtx(opts: { llmAvailable?: boolean; llm?: LLMClient; keySource?: "env" | "runtime" } = {}): {
  ctx: HandlerContext;
  store: SqliteStore;
  llm: LLMClient;
  runtime: { apiKey: string | null; source: "env" | "runtime" | null };
} {
  const env = makeTempEnv();
  const store = new SqliteStore(env.config.store.path);
  store.init();
  const llm = opts.llm ?? new StubLLM();
  const available = opts.llmAvailable ?? true;
  const runtime = {
    apiKey: available ? "sk-test-1234" : null,
    source: (available ? opts.keySource ?? "runtime" : null) as "env" | "runtime" | null,
  };
  return {
    store,
    llm,
    runtime,
    ctx: {
      store,
      hostId: "h1",
      userId: "u1",
      dataDir: env.dataDir,
      jobs: new AnalyzeJobRegistry(),
      llmAvailable: () => runtime.apiKey !== null,
      apiKeySource: () => runtime.source,
      apiKeyPreview: () => runtime.apiKey?.slice(-4) ?? null,
      setApiKey: (k) => {
        if (!k.startsWith("sk-")) return { ok: false, reason: "bad prefix" };
        runtime.apiKey = k;
        runtime.source = "runtime";
        return { ok: true };
      },
      clearApiKey: () => {
        if (runtime.source === "env") return false;
        runtime.apiKey = null;
        runtime.source = null;
        return true;
      },
      makeLLMClient: () => llm,
    },
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
    signals_version: 1,
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

describe("analyze: capabilities + plan", () => {
  it("getAnalyzeCapabilities reports llm flag and suggested models", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: false });
    const out = await getAnalyzeCapabilities(ctx);
    expect(out.llm_available).toBe(false);
    expect(out.api_key_source).toBeNull();
    expect(out.api_key_preview).toBeNull();
    expect(out.suggested_models.length).toBeGreaterThan(0);
    expect(out.default_model).toMatch(/^claude-/);
    store.close();
  });

  it("getAnalyzeCapabilities surfaces key source and preview when set", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: true, keySource: "env" });
    const out = await getAnalyzeCapabilities(ctx);
    expect(out.llm_available).toBe(true);
    expect(out.api_key_source).toBe("env");
    expect(out.api_key_preview).toBe("1234");
    store.close();
  });

  it("postAnalyzeKey rejects non-sk- prefix", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: false });
    const out = await postAnalyzeKey(ctx, { api_key: "wrong-prefix" });
    expect(out.ok).toBe(false);
    expect(ctx.llmAvailable()).toBe(false);
    store.close();
  });

  it("postAnalyzeKey accepts a well-formed key and flips llmAvailable", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: false });
    const out = await postAnalyzeKey(ctx, { api_key: "sk-ant-test-abcd" });
    expect(out.ok).toBe(true);
    expect(ctx.llmAvailable()).toBe(true);
    expect(ctx.apiKeyPreview()).toBe("abcd");
    expect(ctx.apiKeySource()).toBe("runtime");
    store.close();
  });

  it("deleteAnalyzeKey clears a runtime key", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: true, keySource: "runtime" });
    const out = await deleteAnalyzeKey(ctx);
    expect(out.ok).toBe(true);
    expect(ctx.llmAvailable()).toBe(false);
    store.close();
  });

  it("deleteAnalyzeKey refuses to clear an env-set key", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: true, keySource: "env" });
    const out = await deleteAnalyzeKey(ctx);
    expect(out.ok).toBe(false);
    expect(ctx.llmAvailable()).toBe(true);
    store.close();
  });

  it("postAnalyzePlan returns estimate based on candidates", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: true });
    store.upsertSession(sess({ source_key: "a.jsonl", session_id: "a" }));
    store.upsertSessionDetails(details({ source_key: "a.jsonl", user_message_count: 4 }));
    store.upsertSession(sess({ source_key: "b.jsonl", session_id: "b" }));
    store.upsertSessionDetails(details({ source_key: "b.jsonl", user_message_count: 8 }));

    const out = await postAnalyzePlan(ctx, { model: "claude-haiku-4-5" });
    expect(out.plan.api_calls).toBe(2);
    expect(out.plan.model_known).toBe(true);
    expect(out.plan.est_input_tokens).toBeGreaterThan(0);
    expect(out.plan.est_output_tokens).toBe(2 * 500);
    expect(out.plan.est_cost_usd).toBeGreaterThan(0);
    expect(out.plan.prices).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
    store.close();
  });

  it("postAnalyzePlan returns null cost for unknown model", async () => {
    const { ctx, store } = makeCtx();
    store.upsertSession(sess({ source_key: "a.jsonl", session_id: "a" }));
    store.upsertSessionDetails(details({ source_key: "a.jsonl" }));
    const out = await postAnalyzePlan(ctx, { model: "not-a-model" });
    expect(out.plan.model_known).toBe(false);
    expect(out.plan.est_cost_usd).toBeNull();
    store.close();
  });

  it("postAnalyzeRun refuses when no API key", async () => {
    const { ctx, store } = makeCtx({ llmAvailable: false });
    const out = await postAnalyzeRun(ctx, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/ANTHROPIC_API_KEY/);
    store.close();
  });

  it("postAnalyzeRun starts a job and runs it to completion", async () => {
    const { ctx, store, llm } = makeCtx();
    store.upsertSession(sess({ source_key: "a.jsonl", session_id: "a" }));
    store.upsertSessionDetails(details({ source_key: "a.jsonl" }));
    store.upsertSession(sess({ source_key: "b.jsonl", session_id: "b" }));
    store.upsertSessionDetails(details({ source_key: "b.jsonl" }));

    const out = await postAnalyzeRun(ctx, {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // Wait briefly for the async job to drain. Stub LLM resolves on next tick.
    for (let i = 0; i < 50; i += 1) {
      const probe = await getAnalyzeJob(ctx, out.job_id);
      if (probe.job?.status === "done") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const finished = await getAnalyzeJob(ctx, out.job_id);
    expect(finished.found).toBe(true);
    expect(finished.job?.status).toBe("done");
    expect(finished.job?.processed).toBe(2);
    expect(finished.job?.ok).toBe(2);
    expect(finished.job?.failed).toBe(0);
    expect(finished.job?.total_input_tokens).toBe(200);
    expect(finished.job?.total_output_tokens).toBe(100);

    // Stub got called twice and summary rows landed in the store.
    expect((llm as StubLLM).calls).toBe(2);
    expect(store.getSessionSummary("a.jsonl", "h1")?.one_liner).toMatch(/^summary #/);
    expect(store.getSessionSummary("b.jsonl", "h1")?.one_liner).toMatch(/^summary #/);
    store.close();
  });

  it("postAnalyzeRun records per-session failures without aborting", async () => {
    const llm = new StubLLM();
    llm.fail = true;
    const { ctx, store } = makeCtx({ llm });
    store.upsertSession(sess({ source_key: "a.jsonl", session_id: "a" }));
    store.upsertSessionDetails(details({ source_key: "a.jsonl" }));

    const out = await postAnalyzeRun(ctx, {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    for (let i = 0; i < 50; i += 1) {
      const probe = await getAnalyzeJob(ctx, out.job_id);
      if (probe.job?.status === "done") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const finished = await getAnalyzeJob(ctx, out.job_id);
    expect(finished.job?.status).toBe("done");
    expect(finished.job?.ok).toBe(0);
    expect(finished.job?.failed).toBe(1);
    expect(finished.job?.results[0]?.error).toMatch(/stub failure/);
    store.close();
  });
});

describe("routeApi", () => {
  it("rejects non-GET/POST/DELETE methods", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, { method: "PUT", path: "/api/stats", query: {} });
    expect(res.status).toBe(405);
    store.close();
  });

  it("returns 404 for POST to an unknown api path", async () => {
    const { ctx, store } = makeCtx();
    const res = await routeApi(ctx, { method: "POST", path: "/api/no-such-thing", query: {} });
    expect(res.status).toBe(404);
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
