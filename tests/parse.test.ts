import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSessionFile } from "../src/core/parse.js";

function writeJsonl(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "csk-parse-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((o) => JSON.stringify(o)).join("\n"));
  return path;
}

describe("parseSessionFile", () => {
  it("aggregates message counts, tools, timestamps, and tokens", async () => {
    const path = writeJsonl([
      { type: "permission-mode", sessionId: "s1" },
      {
        type: "user",
        timestamp: "2026-04-16T10:00:00Z",
        cwd: "/Users/pp/work",
        gitBranch: "main",
        message: { role: "user", content: "hi" },
      },
      {
        type: "assistant",
        timestamp: "2026-04-16T10:00:05Z",
        message: {
          model: "claude-sonnet-4-6",
          content: [
            { type: "text", text: "hey" },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 3,
          },
        },
      },
      {
        type: "assistant",
        timestamp: "2026-04-16T10:01:00Z",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "tool_use", name: "Read", input: {} }],
          usage: { input_tokens: 2, output_tokens: 4 },
        },
      },
      { type: "user", timestamp: "2026-04-16T10:01:30Z", message: { role: "user", content: "thanks" } },
    ]);

    const d = await parseSessionFile(path);
    expect(d.started_at).toBe("2026-04-16T10:00:00Z");
    expect(d.ended_at).toBe("2026-04-16T10:01:30Z");
    expect(d.message_count).toBe(4);
    expect(d.user_message_count).toBe(2);
    expect(d.assistant_message_count).toBe(2);
    expect(d.tool_use_count).toBe(2);
    expect(d.tool_names).toEqual(["Bash", "Read"]);
    expect(d.model).toBe("claude-sonnet-4-6");
    expect(d.cwd).toBe("/Users/pp/work");
    expect(d.git_branch).toBe("main");
    expect(d.input_tokens).toBe(12);
    expect(d.output_tokens).toBe(24);
    expect(d.cache_creation_tokens).toBe(5);
    expect(d.cache_read_tokens).toBe(3);
    expect(d.parse_error_count).toBe(0);
  });

  it("returns zeroed details for empty files", async () => {
    const path = writeJsonl([]);
    const d = await parseSessionFile(path);
    expect(d.message_count).toBe(0);
    expect(d.started_at).toBeNull();
    expect(d.ended_at).toBeNull();
    expect(d.model).toBeNull();
    expect(d.tool_names).toEqual([]);
  });

  it("counts malformed lines without aborting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "csk-parse-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      [
        '{"type":"user","timestamp":"2026-04-16T10:00:00Z","message":{"role":"user","content":"ok"}}',
        "not valid json",
        '{"type":"assistant","timestamp":"2026-04-16T10:00:05Z","message":{"model":"x","content":[],"usage":{"input_tokens":1,"output_tokens":1}}}',
      ].join("\n"),
    );
    const d = await parseSessionFile(path);
    expect(d.parse_error_count).toBe(1);
    expect(d.user_message_count).toBe(1);
    expect(d.assistant_message_count).toBe(1);
  });

  it("picks the most frequently used model when there's a mix", async () => {
    const path = writeJsonl([
      { type: "assistant", message: { model: "haiku", content: [], usage: {} } },
      { type: "assistant", message: { model: "sonnet", content: [], usage: {} } },
      { type: "assistant", message: { model: "sonnet", content: [], usage: {} } },
    ]);
    const d = await parseSessionFile(path);
    expect(d.model).toBe("sonnet");
  });
});
