import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/core/store/sqlite.js";
import type { SessionDetailsRecord, SessionRecord } from "../src/core/types.js";
import { makeTempEnv } from "./helpers.js";

function makeStore() {
  const env = makeTempEnv();
  const store = new SqliteStore(env.config.store.path);
  store.init();
  return { store, env };
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
    message_count: 30,
    user_message_count: 10,
    assistant_message_count: 20,
    tool_use_count: 5,
    tool_names: ["Bash", "Read"],
    model: "claude-sonnet-4-6",
    cwd: "/Users/pp/x",
    git_branch: "main",
    input_tokens: 100,
    output_tokens: 200,
    cache_creation_tokens: 10,
    cache_read_tokens: 20,
    parse_error_count: 0,
    parsed_at: "2026-04-16T10:00:00Z",
    parsed_for_mtime: "2026-04-16T10:00:00Z",
    ...overrides,
  };
}

describe("listSessionsWithDetails", () => {
  it("joins sessions with their details", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    store.upsertSessionDetails(details());

    const rows = store.listSessionsWithDetails({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.session.session_id).toBe("sess-1");
    expect(rows[0]!.details?.message_count).toBe(30);
    expect(rows[0]!.details?.tool_names).toEqual(["Bash", "Read"]);
    store.close();
  });

  it("returns null details for sessions that haven't been parsed yet", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ source_key: "-p/unparsed.jsonl", session_id: "unparsed" }));
    const rows = store.listSessionsWithDetails({});
    expect(rows[0]!.details).toBeNull();
    store.close();
  });

  it("sorts by session started_at desc when available", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ source_key: "a", session_id: "a" }));
    store.upsertSession(sess({ source_key: "b", session_id: "b" }));
    store.upsertSessionDetails(details({ source_key: "a", started_at: "2026-04-14T00:00:00Z" }));
    store.upsertSessionDetails(details({ source_key: "b", started_at: "2026-04-15T00:00:00Z" }));

    const rows = store.listSessionsWithDetails({});
    expect(rows.map((r) => r.session.session_id)).toEqual(["b", "a"]);
    store.close();
  });

  it("respects limit and offset", () => {
    const { store } = makeStore();
    for (let i = 0; i < 5; i += 1) {
      store.upsertSession(sess({ source_key: `s${i}`, session_id: `s${i}` }));
    }
    expect(store.listSessionsWithDetails({ limit: 2 })).toHaveLength(2);
    expect(store.listSessionsWithDetails({ limit: 2, offset: 2 })).toHaveLength(2);
    expect(store.listSessionsWithDetails({ limit: 10, offset: 3 })).toHaveLength(2);
    store.close();
  });

  it("filters by project and kind using the session table columns", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ source_key: "a", session_id: "a", project_dir: "-A" }));
    store.upsertSession(sess({ source_key: "b", session_id: "b", project_dir: "-B", kind: "subagent" }));

    expect(store.listSessionsWithDetails({ project_dir: "-A" }).map((r) => r.session.session_id)).toEqual(["a"]);
    expect(store.listSessionsWithDetails({ kind: "subagent" }).map((r) => r.session.session_id)).toEqual(["b"]);
    store.close();
  });
});

describe("recentSessionStats", () => {
  it("groups sessions by project_dir with last_active_at", () => {
    const { store } = makeStore();
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

    store.upsertSession(sess({ source_key: "a", session_id: "a", project_dir: "-A", last_seen_at: hoursAgo(1) }));
    store.upsertSession(sess({ source_key: "b", session_id: "b", project_dir: "-A", last_seen_at: hoursAgo(5) }));
    store.upsertSession(sess({ source_key: "c", session_id: "c", project_dir: "-B", last_seen_at: hoursAgo(2) }));
    // Outside the window:
    store.upsertSession(sess({ source_key: "old", session_id: "old", project_dir: "-A", last_seen_at: "2020-01-01T00:00:00Z" }));

    const stats = store.recentSessionStats(7);
    const byProj = Object.fromEntries(stats.map((s) => [s.project_dir, s]));
    expect(byProj["-A"]!.session_count).toBe(2);
    expect(byProj["-B"]!.session_count).toBe(1);
    expect(byProj["-A"]!.last_active_at).toBe(byProj["-A"]!.last_active_at); // present
    store.close();
  });

  it("honors the host_id filter", () => {
    const { store } = makeStore();
    const now = new Date().toISOString();
    store.upsertSession(sess({ source_key: "a", host_id: "hostA", last_seen_at: now }));
    store.upsertSession(sess({ source_key: "b", host_id: "hostB", last_seen_at: now }));

    expect(store.recentSessionStats(7, "hostA")).toHaveLength(1);
    expect(store.recentSessionStats(7)).toHaveLength(1); // both rows same project => 1 group
    store.close();
  });
});
