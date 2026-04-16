import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifySessionFile, projectOf, walkFiles } from "../src/core/scan.js";
import { makeTempEnv, writeFakeSession, writeFakeSubagent } from "./helpers.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe("walkFiles", () => {
  it("yields nothing when source dir is missing", async () => {
    const files = await collect(walkFiles("/nonexistent/path/csk-test"));
    expect(files).toEqual([]);
  });

  it("recursively finds every file, skipping dotfiles", async () => {
    const { sourceDir } = makeTempEnv();
    writeFakeSession(sourceDir, "-projA", "sess-1", "{}");
    writeFakeSubagent(sourceDir, "-projA", "sess-1", "agent-1", "{}");
    writeFakeSession(sourceDir, "-projB", "sess-2", "{}");
    writeFileSync(join(sourceDir, ".DS_Store"), "noise");

    const files = await collect(walkFiles(sourceDir));
    const keys = files.map((f) => f.relativeKey).sort();
    expect(keys).toEqual([
      "-projA/sess-1.jsonl",
      "-projA/sess-1/subagents/agent-1.jsonl",
      "-projB/sess-2.jsonl",
    ]);
  });

  it("includes non-jsonl files (tool results, screenshots)", async () => {
    const { sourceDir } = makeTempEnv();
    writeFakeSession(sourceDir, "-proj", "sess-1", "{}");
    // tool-results/*.txt live alongside the session id directory
    writeFakeSubagent(sourceDir, "-proj", "sess-1", "agent-1", "{}");
    const toolPath = join(sourceDir, "-proj", "sess-1", "tool-results", "tool-1.txt");
    mkdirSync(dirname(toolPath), { recursive: true });
    writeFileSync(toolPath, "hello");

    const files = await collect(walkFiles(sourceDir));
    const keys = files.map((f) => f.relativeKey).sort();
    expect(keys).toContain("-proj/sess-1/tool-results/tool-1.txt");
  });
});

describe("classifySessionFile", () => {
  it("classifies main sessions", () => {
    const c = classifySessionFile("-projA/uuid-1.jsonl");
    expect(c).toEqual({
      kind: "main",
      projectDir: "-projA",
      sessionId: "uuid-1",
      parentSessionId: null,
    });
  });

  it("classifies subagent sessions", () => {
    const c = classifySessionFile("-projA/uuid-1/subagents/agent-abc.jsonl");
    expect(c).toEqual({
      kind: "subagent",
      projectDir: "-projA",
      sessionId: "agent-abc",
      parentSessionId: "uuid-1",
    });
  });

  it("returns null for unrelated files", () => {
    expect(classifySessionFile("-projA/uuid-1/tool-results/out.txt")).toBeNull();
    expect(classifySessionFile("-projA/meta.json")).toBeNull();
    expect(classifySessionFile("stray.jsonl")).toBeNull();
  });
});

describe("projectOf", () => {
  it("extracts the first path segment", () => {
    expect(projectOf("-projA/sess.jsonl")).toBe("-projA");
    expect(projectOf("-projA/sess/subagents/a.jsonl")).toBe("-projA");
    expect(projectOf("toplevel")).toBe("toplevel");
  });
});
