import { describe, expect, it } from "vitest";
import { detectPatterns } from "../src/core/patterns/detect.js";
import type { LLMClient, LLMResponse } from "../src/core/analyze.js";
import type { EnrichedSummary } from "../src/core/store/index.js";
import { SqliteStore } from "../src/core/store/sqlite.js";
import { makeTempEnv } from "./helpers.js";
import type { Finding, PatternRunRecord, SessionRecord, SessionSummaryRecord } from "../src/core/types.js";

function cannedClient(text: string, usage = { input_tokens: 500, output_tokens: 300 }): LLMClient {
  return {
    async summarize() {
      return { text, model: "test-model", usage } satisfies LLMResponse;
    },
  };
}

function makeSummary(overrides: Partial<EnrichedSummary> = {}): EnrichedSummary {
  return {
    source_key: "-proj/a.jsonl",
    host_id: "h1",
    project_dir: "-proj",
    session_id: "a",
    started_at: "2026-04-16T10:00:00Z",
    one_liner: "Refactored a React component",
    tags: ["react", "refactor"],
    signals_version: 1,
    summary: {
      one_liner: "Refactored a React component",
      what_tried: "Extract hook",
      outcome: "Done",
      notable: [],
      blog_hooks: [],
      tags: ["react", "refactor"],
      intent: "react component refactor",
      friction_events: ["retried the same failing test three times"],
      corrections: [
        { user_quote: "no don't use any", assistant_action: "added `any` cast" },
      ],
    },
    ...overrides,
  };
}

describe("detectPatterns", () => {
  const summaries: EnrichedSummary[] = [
    makeSummary({ source_key: "-p/a.jsonl", session_id: "a" }),
    makeSummary({ source_key: "-p/b.jsonl", session_id: "b" }),
    makeSummary({ source_key: "-p/c.jsonl", session_id: "c" }),
  ];

  it("parses well-formed findings and preserves structure", async () => {
    const response = {
      findings: [
        {
          kind: "correction_pattern",
          title: "User repeatedly bans `any` casts",
          description: "Across three sessions the user had to redirect away from `any`.",
          cluster_key: "ts-any-cast",
          suggested_remedy: "Add a CLAUDE.md rule forbidding `any` in TS.",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1", quote: "no don't use any" },
            { source_key: "-p/b.jsonl", host_id: "h1", quote: "stop using any" },
          ],
          score: 0.8,
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const result = await detectPatterns(summaries, client, { scope: "project" });
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0]!;
    expect(f.kind).toBe("correction_pattern");
    expect(f.cluster_key).toBe("ts-any-cast");
    expect(f.suggested_remedy).toContain("CLAUDE.md");
    expect(f.evidence).toHaveLength(2);
    expect(f.score).toBeCloseTo(0.8);
  });

  it("rejects findings with fewer than 2 real citations", async () => {
    const response = {
      findings: [
        {
          kind: "repetition",
          title: "Vague pattern",
          description: "desc",
          evidence: [{ source_key: "-p/a.jsonl", host_id: "h1" }],
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const result = await detectPatterns(summaries, client, { scope: "project" });
    expect(result.findings).toHaveLength(0);
  });

  it("drops hallucinated citations (source_keys not in input)", async () => {
    const response = {
      findings: [
        {
          kind: "repetition",
          title: "Recurring intent",
          description: "desc",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-p/fake.jsonl", host_id: "h1" }, // hallucinated
          ],
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const result = await detectPatterns(summaries, client, { scope: "project" });
    // After filtering the hallucinated citation, only 1 valid citation remains
    // → finding is dropped because of the ≥2 rule.
    expect(result.findings).toHaveLength(0);
  });

  it("strips code fences and tolerates unknown kinds by dropping the finding", async () => {
    const response = {
      findings: [
        {
          kind: "nonsense",
          title: "bad kind",
          description: "x",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-p/b.jsonl", host_id: "h1" },
          ],
        },
        {
          kind: "friction",
          title: "Real one",
          description: "real",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-p/c.jsonl", host_id: "h1" },
          ],
        },
      ],
    };
    const client = cannedClient("```json\n" + JSON.stringify(response) + "\n```");
    const result = await detectPatterns(summaries, client, { scope: "project" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.kind).toBe("friction");
  });

  it("throws on non-JSON response", async () => {
    const client = cannedClient("I can't do that.");
    await expect(detectPatterns(summaries, client, { scope: "global" })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("throws when there are no summaries", async () => {
    const client = cannedClient(JSON.stringify({ findings: [] }));
    await expect(detectPatterns([], client, { scope: "global" })).rejects.toThrow(/at least one/);
  });

  it("global scope drops findings whose evidence spans <2 distinct projects", async () => {
    // 3 summaries all in the same project. Global mode should reject the
    // finding because the evidence touches only 1 project_dir.
    const oneProjectSummaries: EnrichedSummary[] = [
      makeSummary({ source_key: "-p/a.jsonl", session_id: "a", project_dir: "-p" }),
      makeSummary({ source_key: "-p/b.jsonl", session_id: "b", project_dir: "-p" }),
    ];
    const response = {
      findings: [
        {
          kind: "repetition",
          title: "Project-local pattern",
          description: "Only seen in one project.",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-p/b.jsonl", host_id: "h1" },
          ],
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const globalResult = await detectPatterns(oneProjectSummaries, client, { scope: "global" });
    expect(globalResult.findings).toHaveLength(0);

    // Project mode accepts the same finding since ≥2 sessions is enough.
    const client2 = cannedClient(JSON.stringify(response));
    const projectResult = await detectPatterns(oneProjectSummaries, client2, { scope: "project" });
    expect(projectResult.findings).toHaveLength(1);
  });

  it("global scope accepts findings that span ≥2 distinct projects", async () => {
    const multiProject: EnrichedSummary[] = [
      makeSummary({ source_key: "-p/a.jsonl", session_id: "a", project_dir: "-p" }),
      makeSummary({ source_key: "-q/b.jsonl", session_id: "b", project_dir: "-q" }),
    ];
    const response = {
      findings: [
        {
          kind: "correction_pattern",
          title: "Universal habit",
          description: "Seen across projects.",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-q/b.jsonl", host_id: "h1" },
          ],
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const result = await detectPatterns(multiProject, client, { scope: "global" });
    expect(result.findings).toHaveLength(1);
  });

  it("project prompt does NOT require multi-project evidence", async () => {
    const response = {
      findings: [
        {
          kind: "friction",
          title: "Within-project friction",
          description: "desc",
          evidence: [
            { source_key: "-p/a.jsonl", host_id: "h1" },
            { source_key: "-p/b.jsonl", host_id: "h1" },
            { source_key: "-p/c.jsonl", host_id: "h1" },
          ],
        },
      ],
    };
    const client = cannedClient(JSON.stringify(response));
    const result = await detectPatterns(summaries, client, { scope: "project" });
    expect(result.findings).toHaveLength(1);
  });
});

describe("SqliteStore patterns methods", () => {
  function seed() {
    const env = makeTempEnv();
    const store = new SqliteStore(env.config.store.path);
    store.init();
    // Seed two sessions + summaries: one enriched, one legacy (signals_version=0)
    const base: Omit<SessionRecord, "source_key" | "session_id"> = {
      kind: "main",
      host_id: "h1",
      user_id: "u1",
      project_dir: "-proj",
      parent_session_id: null,
      file_size: 1,
      file_mtime: "2026-04-16T10:00:00Z",
      first_seen_at: "2026-04-16T10:00:00Z",
      last_seen_at: "2026-04-16T10:00:00Z",
    };
    store.upsertSession({ ...base, source_key: "-proj/a.jsonl", session_id: "a" });
    store.upsertSession({ ...base, source_key: "-proj/b.jsonl", session_id: "b" });
    const now = "2026-04-16T10:00:00Z";
    store.upsertSessionDetails({
      source_key: "-proj/a.jsonl",
      host_id: "h1",
      started_at: now,
      ended_at: now,
      message_count: 5,
      user_message_count: 2,
      assistant_message_count: 3,
      tool_use_count: 1,
      tool_names: [],
      model: null,
      cwd: null,
      git_branch: null,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      parse_error_count: 0,
      parsed_at: now,
      parsed_for_mtime: now,
      custom_title: null,
      agent_name: null,
      last_prompt: null,
    });
    const enrichedRec: SessionSummaryRecord = {
      source_key: "-proj/a.jsonl",
      host_id: "h1",
      one_liner: "enriched",
      summary: {
        one_liner: "enriched",
        what_tried: "",
        outcome: "",
        notable: [],
        blog_hooks: [],
        tags: ["t"],
        intent: "react refactor",
        friction_events: ["retried test"],
      },
      tags: ["t"],
      model: "m",
      input_tokens: 1,
      output_tokens: 1,
      generated_at: now,
      generated_for_mtime: now,
      signals_version: 1,
    };
    store.upsertSessionSummary(enrichedRec);
    const legacyRec: SessionSummaryRecord = {
      ...enrichedRec,
      source_key: "-proj/b.jsonl",
      one_liner: "legacy",
      summary: { ...enrichedRec.summary, one_liner: "legacy" },
      signals_version: 0,
    };
    store.upsertSessionSummary(legacyRec);
    return { env, store };
  }

  it("listEnrichedSummaries returns only signals_version >= 1", () => {
    const { store } = seed();
    const rows = store.listEnrichedSummaries({ host_id: "h1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.one_liner).toBe("enriched");
    expect(rows[0]!.summary.intent).toBe("react refactor");
    store.close();
  });

  it("countEnrichedSummaries counts only eligible rows", () => {
    const { store } = seed();
    expect(store.countEnrichedSummaries({ host_id: "h1" })).toBe(1);
    expect(store.countEnrichedSummaries({ host_id: "h1", minVersion: 0 })).toBe(2);
    store.close();
  });

  it("insertPatternRun + listFindings + listPatternRuns round-trip", () => {
    const { store } = seed();
    const run: PatternRunRecord = {
      run_id: "r1",
      host_id: "h1",
      model: "sonnet",
      summary_count: 2,
      input_tokens: 1000,
      output_tokens: 300,
      finding_count: 0,
      filter_json: null,
      started_at: "2026-04-16T11:00:00Z",
      finished_at: "2026-04-16T11:00:05Z",
    };
    const findings: Finding[] = [
      {
        kind: "repetition",
        title: "A",
        description: "d",
        evidence: [
          { source_key: "-proj/a.jsonl", host_id: "h1" },
          { source_key: "-proj/b.jsonl", host_id: "h1", quote: "q" },
        ],
        score: 0.5,
        cluster_key: "c",
      },
    ];
    store.insertPatternRun({
      run,
      findings,
      sources: [
        { source_key: "-proj/a.jsonl", host_id: "h1" },
        { source_key: "-proj/b.jsonl", host_id: "h1" },
      ],
    });
    const runs = store.listPatternRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.run_id).toBe("r1");
    const fr = store.listFindings({ run_id: "r1" });
    expect(fr).toHaveLength(1);
    expect(fr[0]!.evidence).toHaveLength(2);
    expect(fr[0]!.cluster_key).toBe("c");
    expect(fr[0]!.score).toBeCloseTo(0.5);

    // Sources round-trip joined with session + summary rows.
    const src = store.listPatternRunSources("r1");
    expect(src).toHaveLength(2);
    const enriched = src.find((s) => s.source_key === "-proj/a.jsonl");
    expect(enriched?.one_liner).toBe("enriched");
    expect(enriched?.tags).toEqual(["t"]);
    store.close();
  });

  it("listPatternRunSources returns empty array for runs without sources", () => {
    const { store } = seed();
    expect(store.listPatternRunSources("nonexistent")).toEqual([]);
    store.close();
  });
});
