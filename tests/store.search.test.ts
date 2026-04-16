import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/core/store/sqlite.js";
import type { SessionRecord, UserMessageRecord } from "../src/core/types.js";
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

function msg(overrides: Partial<UserMessageRecord>): UserMessageRecord {
  return {
    source_key: "-proj/sess-1.jsonl",
    host_id: "h1",
    seq: 1,
    timestamp: "2026-04-16T10:00:00Z",
    content: "",
    ...overrides,
  };
}

describe("replaceUserMessages + searchUserMessages", () => {
  it("indexes user messages and finds them via FTS match", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      msg({ seq: 1, content: "I'm debugging a webgpu shader today" }),
      msg({ seq: 2, content: "what's the deal with metal command buffers" }),
    ]);

    const hits = store.searchUserMessages({ query: "webgpu" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.seq).toBe(1);
    expect(hits[0]!.snippet).toContain("<mark>webgpu</mark>");
    expect(hits[0]!.project_dir).toBe("-proj");
  });

  it("is idempotent — replacing doesn't duplicate rows", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      msg({ seq: 1, content: "hello world" }),
    ]);
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      msg({ seq: 1, content: "hello world" }),
    ]);

    const hits = store.searchUserMessages({ query: "hello" });
    expect(hits).toHaveLength(1);
  });

  it("updates the FTS index when re-parsed content changes", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      msg({ seq: 1, content: "first version — mentions webgpu" }),
    ]);
    expect(store.searchUserMessages({ query: "webgpu" })).toHaveLength(1);

    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", [
      msg({ seq: 1, content: "rewritten — now about metal" }),
    ]);
    expect(store.searchUserMessages({ query: "webgpu" })).toHaveLength(0);
    expect(store.searchUserMessages({ query: "metal" })).toHaveLength(1);
  });

  it("filters by project_dir", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ source_key: "-A/s.jsonl", session_id: "a", project_dir: "-A" }));
    store.upsertSession(sess({ source_key: "-B/s.jsonl", session_id: "b", project_dir: "-B" }));
    store.replaceUserMessages("-A/s.jsonl", "h1", [msg({ source_key: "-A/s.jsonl", content: "find me needle" })]);
    store.replaceUserMessages("-B/s.jsonl", "h1", [msg({ source_key: "-B/s.jsonl", content: "find me needle" })]);

    const aOnly = store.searchUserMessages({ query: "needle", project_dir: "-A" });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0]!.source_key).toBe("-A/s.jsonl");
  });

  it("honors the limit", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg({ seq: i + 1, content: `message number ${i + 1} pattern` }),
    );
    store.replaceUserMessages("-proj/sess-1.jsonl", "h1", messages);
    const hits = store.searchUserMessages({ query: "pattern", limit: 3 });
    expect(hits).toHaveLength(3);
  });
});
