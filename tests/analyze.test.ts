import { describe, expect, it } from "vitest";
import { summarizeSession, type LLMClient, type LLMResponse } from "../src/core/analyze.js";
import type { SessionDetailsRecord, SessionRecord, UserMessageRecord } from "../src/core/types.js";

function fakeClient(text: string, usage = { input_tokens: 100, output_tokens: 50 }): LLMClient {
  return {
    async summarize() {
      return { text, model: "test-model", usage } satisfies LLMResponse;
    },
  };
}

function recordClient(responses: LLMResponse[]): {
  client: LLMClient;
  prompts: string[];
  systems: string[];
} {
  const prompts: string[] = [];
  const systems: string[] = [];
  let i = 0;
  const client: LLMClient = {
    async summarize(p) {
      prompts.push(p.user);
      systems.push(p.system);
      const r = responses[i++];
      if (!r) throw new Error("no more canned responses");
      return r;
    },
  };
  return { client, prompts, systems };
}

const baseSession: SessionRecord = {
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
};

const baseDetails: SessionDetailsRecord = {
  source_key: "-proj/sess-1.jsonl",
  host_id: "h1",
  started_at: "2026-04-16T10:00:00Z",
  ended_at: "2026-04-16T10:30:00Z",
  message_count: 30,
  user_message_count: 5,
  assistant_message_count: 25,
  tool_use_count: 8,
  tool_names: ["Bash", "Edit", "Read"],
  model: "claude-sonnet-4-6",
  cwd: "/Users/pp/proj",
  git_branch: "main",
  input_tokens: 1000,
  output_tokens: 2000,
  cache_creation_tokens: 500,
  cache_read_tokens: 200,
  parse_error_count: 0,
  parsed_at: "2026-04-16T10:30:00Z",
  parsed_for_mtime: "2026-04-16T10:00:00Z",
};

function msgs(contents: string[]): UserMessageRecord[] {
  return contents.map((c, i) => ({
    source_key: "-proj/sess-1.jsonl",
    host_id: "h1",
    seq: i + 1,
    timestamp: `2026-04-16T10:0${i}:00Z`,
    content: c,
  }));
}

describe("summarizeSession", () => {
  it("returns a structured summary from a well-formed LLM response", async () => {
    const client = fakeClient(
      JSON.stringify({
        one_liner: "Debugged a WebGPU shader compile error.",
        what_tried: "Fix the shader.",
        outcome: "Fixed it by adjusting the bind group layout.",
        notable: ["Missing binding in layout descriptor."],
        blog_hooks: ["Common WebGPU layout mistakes"],
        tags: ["debugging", "webgpu", "shader"],
      }),
    );
    const result = await summarizeSession(
      { session: baseSession, details: baseDetails, userMessages: msgs(["help with webgpu"]) },
      client,
    );
    expect(result.summary.one_liner).toContain("WebGPU");
    expect(result.summary.tags).toEqual(["debugging", "webgpu", "shader"]);
    expect(result.usage.output_tokens).toBe(50);
    expect(result.model).toBe("test-model");
  });

  it("tolerates responses wrapped in a json code fence", async () => {
    const client = fakeClient(
      "```json\n" +
        JSON.stringify({
          one_liner: "x",
          what_tried: "x",
          outcome: "x",
          notable: [],
          blog_hooks: [],
          tags: ["a"],
        }) +
        "\n```",
    );
    const result = await summarizeSession(
      { session: baseSession, details: baseDetails, userMessages: msgs(["hi"]) },
      client,
    );
    expect(result.summary.tags).toEqual(["a"]);
  });

  it("throws a helpful error on non-JSON responses", async () => {
    const client = fakeClient("I'm sorry I can't help with that.");
    await expect(
      summarizeSession(
        { session: baseSession, details: baseDetails, userMessages: msgs(["hi"]) },
        client,
      ),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("includes metadata and user messages in the prompt", async () => {
    const { client, prompts } = recordClient([
      {
        text: JSON.stringify({
          one_liner: "",
          what_tried: "",
          outcome: "",
          notable: [],
          blog_hooks: [],
          tags: [],
        }),
        model: "test",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    await summarizeSession(
      {
        session: baseSession,
        details: baseDetails,
        userMessages: msgs(["first request", "second request"]),
      },
      client,
    );
    const prompt = prompts[0]!;
    expect(prompt).toContain("project_dir: -proj");
    expect(prompt).toContain("tools: Bash, Edit, Read");
    expect(prompt).toContain("first request");
    expect(prompt).toContain("second request");
  });

  it("coerces malformed fields to safe defaults", async () => {
    const client = fakeClient(
      JSON.stringify({
        one_liner: "ok",
        what_tried: 42, // wrong type
        outcome: null, // wrong type
        notable: "string instead of array",
        blog_hooks: [null, "valid hook", 7],
        tags: ["ok"],
      }),
    );
    const result = await summarizeSession(
      { session: baseSession, details: baseDetails, userMessages: msgs(["x"]) },
      client,
    );
    expect(result.summary.what_tried).toBe("");
    expect(result.summary.outcome).toBe("");
    expect(result.summary.notable).toEqual([]);
    expect(result.summary.blog_hooks).toEqual(["valid hook"]);
  });

  it("injects a language directive into the system prompt (auto by default)", async () => {
    const { client, systems } = recordClient([
      {
        text: JSON.stringify({
          one_liner: "",
          what_tried: "",
          outcome: "",
          notable: [],
          blog_hooks: [],
          tags: [],
        }),
        model: "m",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    await summarizeSession(
      { session: baseSession, details: baseDetails, userMessages: msgs(["x"]) },
      client,
    );
    expect(systems[0]!).toContain("Language:");
    expect(systems[0]!).toContain("same primary language");
  });

  it("interpolates the provided language verbatim when not auto", async () => {
    const { client, systems } = recordClient([
      {
        text: JSON.stringify({
          one_liner: "",
          what_tried: "",
          outcome: "",
          notable: [],
          blog_hooks: [],
          tags: [],
        }),
        model: "m",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    await summarizeSession(
      {
        session: baseSession,
        details: baseDetails,
        userMessages: msgs(["x"]),
        language: "한국어",
      },
      client,
    );
    expect(systems[0]!).toContain("respond in 한국어");
  });

  it("truncates very long user messages to stay within prompt budget", async () => {
    const big = "x".repeat(5000);
    const many: UserMessageRecord[] = Array.from({ length: 20 }, (_, i) => ({
      source_key: "-proj/sess-1.jsonl",
      host_id: "h1",
      seq: i + 1,
      timestamp: null,
      content: big,
    }));
    const { client, prompts } = recordClient([
      {
        text: JSON.stringify({
          one_liner: "",
          what_tried: "",
          outcome: "",
          notable: [],
          blog_hooks: [],
          tags: [],
        }),
        model: "m",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ]);
    await summarizeSession(
      { session: baseSession, details: baseDetails, userMessages: many },
      client,
    );
    const prompt = prompts[0]!;
    // 20 messages × 5000 chars = 100k. Budget is 20k. Should contain the
    // truncation footer telling the LLM some messages were dropped.
    expect(prompt).toContain("additional user messages truncated");
  });
});
