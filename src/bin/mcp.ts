#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
        "Return the most recent backup run and a session count. Shows when the Claude Code session archive was last updated.",
    },
    async () => {
      const lastRun = await store.getLastBackupRun();
      const totalSessions = await store.countSessions();
      const payload = {
        lastRun,
        totalSessions,
        hostId: config.hostId,
        userId: config.userId,
        dataDir: config.dataDir,
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(payload, null, 2) },
        ],
      };
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

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
