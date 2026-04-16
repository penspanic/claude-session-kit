import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBackup } from "../src/core/backup.js";
import { FsBlobStore } from "../src/core/blob/fs.js";
import { SqliteStore } from "../src/core/store/sqlite.js";
import { makeTempEnv, writeFakeSession, writeFakeSubagent } from "./helpers.js";

function bootstrap(configOverrides = {}) {
  const env = makeTempEnv(configOverrides);
  const store = new SqliteStore(env.config.store.path);
  store.init();
  const blob = new FsBlobStore(env.config.blob.root);
  return { env, store, blob };
}

describe("runBackup", () => {
  it("copies everything on the first run — sessions, subagents, and tool results", async () => {
    const { env, store, blob } = bootstrap();
    writeFakeSession(env.sourceDir, "-projA", "sess-1", '{"hello":"world"}');
    writeFakeSubagent(env.sourceDir, "-projA", "sess-1", "agent-1", "{}");
    const toolPath = join(env.sourceDir, "-projA", "sess-1", "tool-results", "out.txt");
    mkdirSync(dirname(toolPath), { recursive: true });
    writeFileSync(toolPath, "output");

    const result = await runBackup(env.config, store, blob);
    expect(result.status).toBe("success");
    expect(result.filesScanned).toBe(3);
    expect(result.filesCopied).toBe(3);
    expect(result.filesSkipped).toBe(0);
    expect(result.sessionsIndexed).toBe(2); // tool-results/out.txt is mirrored but not indexed

    expect(await blob.stat("-projA/sess-1.jsonl")).not.toBeNull();
    expect(await blob.stat("-projA/sess-1/subagents/agent-1.jsonl")).not.toBeNull();
    expect(await blob.stat("-projA/sess-1/tool-results/out.txt")).not.toBeNull();

    expect(store.countSessions()).toBe(2);
    expect(store.countSessions({ kind: "subagent" })).toBe(1);
    const subagents = store.listSessions({ kind: "subagent" });
    expect(subagents[0]!.parent_session_id).toBe("sess-1");
    store.close();
  });

  it("skips unchanged files on a second run", async () => {
    const { env, store, blob } = bootstrap();
    writeFakeSession(env.sourceDir, "-proj", "sess-1", "{}");
    writeFakeSubagent(env.sourceDir, "-proj", "sess-1", "agent-1", "{}");

    await runBackup(env.config, store, blob);
    const second = await runBackup(env.config, store, blob);
    expect(second.filesScanned).toBe(2);
    expect(second.filesCopied).toBe(0);
    expect(second.filesSkipped).toBe(2);
    store.close();
  });

  it("recopies a file when its content changes", async () => {
    const { env, store, blob } = bootstrap();
    const path = writeFakeSession(env.sourceDir, "-proj", "sess-1", "{}", 1_700_000_000);

    await runBackup(env.config, store, blob);
    writeFileSync(path, '{"changed":true}');
    const second = await runBackup(env.config, store, blob);
    expect(second.filesCopied).toBe(1);
    store.close();
  });

  it("respects the project allowlist", async () => {
    const { env, store, blob } = bootstrap({
      projects: { allow: ["-projA"], block: [] },
    });
    writeFakeSession(env.sourceDir, "-projA", "sess-1", "{}");
    writeFakeSession(env.sourceDir, "-projB", "sess-2", "{}");

    const result = await runBackup(env.config, store, blob);
    expect(result.filesCopied).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(store.countSessions()).toBe(1);
    expect(store.listSessions()[0]!.project_dir).toBe("-projA");
    store.close();
  });

  it("respects the project blocklist", async () => {
    const { env, store, blob } = bootstrap({
      projects: { allow: [], block: ["-secrets"] },
    });
    writeFakeSession(env.sourceDir, "-projA", "sess-1", "{}");
    writeFakeSession(env.sourceDir, "-secrets", "sess-2", "{}");

    const result = await runBackup(env.config, store, blob);
    expect(result.filesCopied).toBe(1);
    expect(store.listSessions()[0]!.project_dir).toBe("-projA");
    store.close();
  });

  it("records an error status when something throws", async () => {
    const { env, store } = bootstrap();
    const failingBlob = {
      stat: async () => null,
      putFile: async () => {
        throw new Error("disk full");
      },
      list: async function* () {},
      delete: async () => {},
    };
    writeFakeSession(env.sourceDir, "-proj", "sess-1", "{}");

    const result = await runBackup(env.config, store, failingBlob);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toContain("disk full");
    store.close();
  });
});
