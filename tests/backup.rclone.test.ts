import { execFileSync } from "node:child_process";
import { mkdtempSync as fsMkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runBackup } from "../src/core/backup.js";
import { RcloneBlobStore } from "../src/core/blob/rclone.js";
import { SqliteStore } from "../src/core/store/sqlite.js";
import { makeTempEnv, writeFakeSession, writeFakeSubagent } from "./helpers.js";

function hasRclone(): boolean {
  try {
    execFileSync("rclone", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// End-to-end test: runBackup against a RcloneBlobStore (using :local: backend).
// This validates that the incremental logic works with rclone's mtime handling.
describe.skipIf(!hasRclone())("runBackup → RcloneBlobStore", () => {
  it("mirrors sessions through rclone and is idempotent", async () => {
    const remoteRoot = fsMkdtempSync(join(tmpdir(), "csk-rclone-e2e-"));
    const env = makeTempEnv({
      blob: { type: "rclone", remote: `:local:${remoteRoot}` },
    });
    const store = new SqliteStore(env.config.store.path);
    store.init();
    const blob = new RcloneBlobStore({
      remote: (env.config.blob as { remote: string }).remote,
    });

    writeFakeSession(env.sourceDir, "-projA", "sess-1", '{"a":1}');
    writeFakeSubagent(env.sourceDir, "-projA", "sess-1", "agent-1", "{}");

    const first = await runBackup(env.config, store, blob);
    expect(first.status).toBe("success");
    expect(first.filesCopied).toBe(2);
    expect(first.sessionsIndexed).toBe(2);

    // Second run must detect unchanged files and skip them.
    const second = await runBackup(env.config, store, blob);
    expect(second.status).toBe("success");
    expect(second.filesCopied).toBe(0);
    expect(second.filesSkipped).toBe(2);

    store.close();
  }, 30_000);
});
