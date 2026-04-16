import { describe, expect, it } from "vitest";
import { SqliteStore } from "../src/core/store/sqlite.js";
import type { SessionRecord } from "../src/core/types.js";
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

describe("SqliteStore: backup runs", () => {
  it("creates and finishes a backup run", () => {
    const { store } = makeStore();
    const id = store.createBackupRun({
      host_id: "h1",
      user_id: "u1",
      started_at: "2026-04-16T10:00:00Z",
      finished_at: null,
      files_scanned: 0,
      files_copied: 0,
      bytes_copied: 0,
      status: "running",
      error_message: null,
    });
    expect(id).toBeGreaterThan(0);

    store.updateBackupRun(id, {
      finished_at: "2026-04-16T10:00:05Z",
      files_scanned: 3,
      files_copied: 2,
      bytes_copied: 1024,
      status: "success",
    });

    const last = store.getLastBackupRun();
    expect(last).not.toBeNull();
    expect(last!.id).toBe(id);
    expect(last!.status).toBe("success");
    expect(last!.files_copied).toBe(2);
    store.close();
  });

  it("filters last backup by host_id", () => {
    const { store } = makeStore();
    store.createBackupRun({
      host_id: "hostA",
      user_id: "u1",
      started_at: "2026-04-16T09:00:00Z",
      finished_at: "2026-04-16T09:00:01Z",
      files_scanned: 0,
      files_copied: 0,
      bytes_copied: 0,
      status: "success",
      error_message: null,
    });
    store.createBackupRun({
      host_id: "hostB",
      user_id: "u2",
      started_at: "2026-04-16T10:00:00Z",
      finished_at: "2026-04-16T10:00:01Z",
      files_scanned: 0,
      files_copied: 0,
      bytes_copied: 0,
      status: "success",
      error_message: null,
    });
    expect(store.getLastBackupRun("hostA")!.user_id).toBe("u1");
    expect(store.getLastBackupRun("hostB")!.user_id).toBe("u2");
    expect(store.getLastBackupRun()!.user_id).toBe("u2");
    store.close();
  });
});

describe("SqliteStore: sessions", () => {
  it("upserts on (source_key, host_id) without duplicating", () => {
    const { store } = makeStore();
    store.upsertSession(sess());
    store.upsertSession(sess({ file_size: 200, last_seen_at: "2026-04-16T11:00:00Z" }));

    expect(store.countSessions()).toBe(1);
    const [row] = store.listSessions({ host_id: "h1" });
    expect(row!.file_size).toBe(200);
    expect(row!.last_seen_at).toBe("2026-04-16T11:00:00Z");
    expect(row!.first_seen_at).toBe("2026-04-16T10:00:00Z"); // preserved
    store.close();
  });

  it("keeps separate rows across hosts (team aggregation)", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ host_id: "hostA" }));
    store.upsertSession(sess({ host_id: "hostB" }));
    expect(store.countSessions()).toBe(2);
    expect(store.countSessions({ host_id: "hostA" })).toBe(1);
    store.close();
  });

  it("preserves parent-subagent linkage", () => {
    const { store } = makeStore();
    store.upsertSession(sess({ source_key: "-p/sess-1.jsonl", session_id: "sess-1" }));
    store.upsertSession(
      sess({
        source_key: "-p/sess-1/subagents/agent-1.jsonl",
        kind: "subagent",
        session_id: "agent-1",
        parent_session_id: "sess-1",
      }),
    );
    const subagents = store.listSessions({ kind: "subagent" });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.parent_session_id).toBe("sess-1");
    store.close();
  });

  it("filters by project, kind, and date range", () => {
    const { store } = makeStore();
    store.upsertSession(
      sess({ source_key: "a", session_id: "a", project_dir: "-A", last_seen_at: "2026-04-10T00:00:00Z" }),
    );
    store.upsertSession(
      sess({ source_key: "b", session_id: "b", project_dir: "-A", last_seen_at: "2026-04-15T00:00:00Z" }),
    );
    store.upsertSession(
      sess({ source_key: "c", session_id: "c", project_dir: "-B", last_seen_at: "2026-04-15T00:00:00Z", kind: "subagent" }),
    );

    expect(store.listSessions({ project_dir: "-A" }).map((s) => s.session_id).sort()).toEqual(["a", "b"]);
    expect(store.listSessions({ kind: "subagent" }).map((s) => s.session_id)).toEqual(["c"]);
    expect(store.listSessions({ since: "2026-04-12T00:00:00Z" }).map((s) => s.session_id).sort()).toEqual(["b", "c"]);
    store.close();
  });
});
