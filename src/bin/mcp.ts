#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CURRENT_SIGNALS_VERSION, summarizeSession } from "../core/analyze.js";
import { AnthropicClient } from "../core/anthropic.js";
import { loadConfig } from "../core/config.js";
import { createStore } from "../core/store/index.js";
import type { SessionSummaryRecord } from "../core/types.js";

async function main() {
  const config = loadConfig();
  const store = createStore(config);
  await store.init();

  const server = new McpServer(
    { name: "claude-session-kit", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "csk_backup_status",
    {
      description:
        "Return the most recent backup run and the number of sessions in the index. Use this to confirm the Claude Code session archive is up to date.",
    },
    async () => {
      const lastRun = await store.getLastBackupRun();
      const totalSessions = await store.countSessions();
      const parsedSessions = await store.countParsedSessions();
      return textContent({
        lastRun,
        totalSessions,
        parsedSessions,
        hostId: config.hostId,
        userId: config.userId,
        dataDir: config.dataDir,
      });
    },
  );

  server.registerTool(
    "csk_list_sessions",
    {
      description:
        "List Claude Code sessions with parsed metadata (timestamps, tool usage, model, tokens). Results are sorted most-recent-first by session start time.",
      inputSchema: {
        project: z.string().optional().describe("Filter by project_dir (e.g. '-Users-pp-dev-private-MyRepo')."),
        host: z.string().optional().describe("Filter by host_id. Defaults to all hosts."),
        kind: z.enum(["main", "subagent"]).optional().describe("Filter by session kind."),
        since: z.string().optional().describe("ISO timestamp lower bound (session started_at or file mtime)."),
        until: z.string().optional().describe("ISO timestamp upper bound."),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
        offset: z.number().int().min(0).optional().describe("Pagination offset."),
      },
    },
    async (args) => {
      const rows = await store.listSessionsWithDetails({
        host_id: args.host,
        project_dir: args.project,
        kind: args.kind,
        since: args.since,
        until: args.until,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
      return textContent({ count: rows.length, sessions: rows });
    },
  );

  server.registerTool(
    "csk_get_session",
    {
      description:
        "Fetch a single session by its source_key (relative path). Returns the indexed row plus parsed details if available.",
      inputSchema: {
        source_key: z
          .string()
          .describe("The session's source_key, e.g. '-Users-pp-dev-private-MyRepo/abc-123.jsonl'."),
        host: z
          .string()
          .optional()
          .describe("host_id. Defaults to this machine's configured host_id."),
      },
    },
    async (args) => {
      const hostId = args.host ?? config.hostId;
      const sessions = await store.listSessions({ host_id: hostId });
      const session = sessions.find((s) => s.source_key === args.source_key);
      if (!session) {
        return textContent({ found: false, reason: "No session with that source_key for the requested host_id." });
      }
      const details = await store.getSessionDetails(args.source_key, hostId);
      return textContent({ found: true, session, details });
    },
  );

  server.registerTool(
    "csk_search",
    {
      description:
        "Full-text search over user-message content across all Claude Code sessions. Accepts FTS5 query syntax (e.g. 'webgpu NEAR/3 shader', 'latency AND profiling'). Returns highlighted snippets plus the owning session's project and source_key.",
      inputSchema: {
        query: z.string().min(1).describe("FTS5 MATCH query."),
        project: z.string().optional().describe("Filter to a single project_dir."),
        host: z.string().optional().describe("Filter by host_id."),
        since: z.string().optional().describe("ISO timestamp lower bound."),
        until: z.string().optional().describe("ISO timestamp upper bound."),
        limit: z.number().int().min(1).max(100).optional().describe("Max hits (default 25)."),
      },
    },
    async (args) => {
      const hits = await store.searchUserMessages({
        query: args.query,
        project_dir: args.project,
        host_id: args.host,
        since: args.since,
        until: args.until,
        limit: args.limit ?? 25,
      });
      return textContent({ count: hits.length, hits });
    },
  );

  server.registerTool(
    "csk_recent",
    {
      description:
        "Summarize activity over the last N days. Returns per-project session counts and the most recent activity timestamp.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Lookback window in days (default 7)."),
        host: z.string().optional().describe("Filter by host_id. Defaults to all hosts."),
      },
    },
    async (args) => {
      const days = args.days ?? 7;
      const stats = await store.recentSessionStats(days, args.host);
      const totalSessions = stats.reduce((a, s) => a + s.session_count, 0);
      return textContent({ days, totalSessions, projects: stats });
    },
  );

  server.registerTool(
    "csk_summarize",
    {
      description:
        "Return the LLM-generated summary for a session. If the session has no cached summary (or its source mtime has changed since generation) and `force` is true, generate a fresh summary via the Anthropic API — requires ANTHROPIC_API_KEY to be set in the MCP server's environment.",
      inputSchema: {
        source_key: z.string().describe("Session source_key."),
        host: z.string().optional().describe("host_id. Defaults to this machine's host_id."),
        force: z
          .boolean()
          .optional()
          .describe("Regenerate even if a fresh summary is cached (costs API credit)."),
      },
    },
    async (args) => {
      const hostId = args.host ?? config.hostId;
      const details = await store.getSessionDetails(args.source_key, hostId);
      if (!details) {
        return textContent({
          found: false,
          reason: "No parsed details exist for this session. Run `csk backup` first.",
        });
      }

      const cached = await store.getSessionSummary(args.source_key, hostId);
      const isFresh = cached && cached.generated_for_mtime === details.parsed_for_mtime;
      if (cached && isFresh && !args.force) {
        return textContent({ source: "cache", ...cached });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        if (cached) {
          return textContent({ source: "cache (stale)", ...cached });
        }
        return textContent({
          found: false,
          reason:
            "No cached summary and ANTHROPIC_API_KEY is not set — cannot generate. Set the key and retry, or run `csk analyze` first.",
        });
      }

      const sessions = await store.listSessions({ host_id: hostId });
      const session = sessions.find((s) => s.source_key === args.source_key);
      if (!session) {
        return textContent({ found: false, reason: "Session not found in index." });
      }

      const userMessages = await store.getUserMessages(args.source_key, hostId);
      const client = new AnthropicClient({ apiKey });
      const { summary, model, usage } = await summarizeSession(
        { session, details, userMessages },
        client,
      );
      const record: SessionSummaryRecord = {
        source_key: args.source_key,
        host_id: hostId,
        one_liner: summary.one_liner,
        summary,
        tags: summary.tags,
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        generated_at: new Date().toISOString(),
        generated_for_mtime: details.parsed_for_mtime,
        signals_version: CURRENT_SIGNALS_VERSION,
      };
      await store.upsertSessionSummary(record);
      return textContent({ source: "generated", ...record });
    },
  );

  server.registerTool(
    "csk_recap",
    {
      description:
        "List LLM summaries over a date range, filtered by project. Use this to answer 'what did I do this week?' — returns one_liner + tags + blog_hooks per session, ordered by time.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Lookback window (default 7)."),
        project: z.string().optional().describe("Filter to one project_dir."),
        host: z.string().optional().describe("Filter by host_id. Defaults to all hosts."),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
      },
    },
    async (args) => {
      const days = args.days ?? 7;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const rows = await store.listSessionsWithDetails({
        host_id: args.host,
        project_dir: args.project,
        since,
        limit: args.limit ?? 50,
      });
      const recap: Array<Record<string, unknown>> = [];
      for (const { session, details } of rows) {
        const summary = await store.getSessionSummary(session.source_key, session.host_id);
        if (!summary) continue;
        recap.push({
          source_key: session.source_key,
          project_dir: session.project_dir,
          started_at: details?.started_at,
          one_liner: summary.one_liner,
          tags: summary.tags,
          blog_hooks: summary.summary.blog_hooks,
        });
      }
      return textContent({ days, count: recap.length, recap });
    },
  );

  server.registerTool(
    "csk_patterns",
    {
      description:
        "Cross-session skill-gap and friction findings from `csk patterns`. Two modes: 'project' (single repo / worktree group) and 'global' (cross-project habits). Returns findings from the latest matching run by default; pass run_id for a specific run.",
      inputSchema: {
        scope: z
          .enum(["project", "global"])
          .optional()
          .describe("Filter past runs by scope. Omit to include any."),
        project_dir: z
          .string()
          .optional()
          .describe("With scope='project': only runs that included this project_dir."),
        run_id: z.string().optional().describe("Pattern run id. Defaults to the latest matching run."),
        kind: z
          .enum([
            "repetition",
            "correction_pattern",
            "friction",
            "skill_gap",
            "codebase_smell",
            "documentation_gap",
            "test_coverage_gap",
            "api_friction",
          ])
          .optional()
          .describe("Filter findings by kind."),
        limit: z.number().int().min(1).max(200).optional().describe("Max findings (default 50)."),
      },
    },
    async (args) => {
      let runId = args.run_id;
      if (!runId) {
        const runs = await store.listPatternRuns({
          scope: args.scope,
          project_dir: args.project_dir,
          limit: 1,
        });
        if (runs.length === 0) {
          return textContent({
            found: false,
            reason:
              "No pattern runs match. Run `csk patterns project --dir <X>` or `csk patterns global` to produce findings.",
          });
        }
        runId = runs[0]!.run_id;
      }
      const run = await store.getPatternRun(runId);
      const findings = await store.listFindings({
        run_id: runId,
        kind: args.kind,
        limit: args.limit ?? 50,
      });
      return textContent({ run, count: findings.length, findings });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function textContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
