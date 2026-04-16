#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../core/config.js";
import { createStore } from "../core/store/index.js";

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
