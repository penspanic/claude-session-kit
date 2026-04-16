#!/usr/bin/env node
import { Command } from "commander";
import { summarizeSession } from "../core/analyze.js";
import { AnthropicClient } from "../core/anthropic.js";
import { runBackup } from "../core/backup.js";
import { createBlob } from "../core/blob/index.js";
import { RcloneBlobStore } from "../core/blob/rclone.js";
import { loadConfig } from "../core/config.js";
import { createStore } from "../core/store/index.js";
import type { SessionSummaryRecord } from "../core/types.js";

const program = new Command();
program
  .name("csk")
  .description("claude-session-kit — back up and inspect Claude Code session logs")
  .version("0.1.0");

program
  .command("backup")
  .description("Mirror session files into the configured blob store")
  .action(async () => {
    const config = loadConfig();
    const store = createStore(config);
    const blob = createBlob(config);
    await store.init();
    try {
      const result = await runBackup(config, store, blob);
      const mb = (result.bytesCopied / 1024 / 1024).toFixed(2);
      console.log(
        `[${result.status}] scanned=${result.filesScanned} copied=${result.filesCopied} skipped=${result.filesSkipped} indexed=${result.sessionsIndexed} parsed=${result.sessionsParsed} bytes=${mb}MB duration=${result.durationMs}ms`,
      );
      if (result.errorMessage) console.error(result.errorMessage);
      process.exit(result.status === "success" ? 0 : 1);
    } finally {
      await store.close();
    }
  });

program
  .command("status")
  .description("Show the last backup run and index totals")
  .option("--host <id>", "Filter by host_id")
  .option("--json", "Emit JSON")
  .action(async (opts: { host?: string; json?: boolean }) => {
    const config = loadConfig();
    const store = createStore(config);
    await store.init();
    try {
      const last = await store.getLastBackupRun(opts.host);
      const totalSessions = await store.countSessions(opts.host ? { host_id: opts.host } : undefined);

      if (opts.json) {
        console.log(JSON.stringify({ lastRun: last, totalSessions, config: summarizeConfig(config) }, null, 2));
        return;
      }

      if (!last) {
        console.log("No backup has been run yet. Try: csk backup");
        return;
      }

      console.log(`Last run    : #${last.id} (${last.status})`);
      console.log(`  host/user : ${last.host_id} / ${last.user_id}`);
      console.log(`  started   : ${last.started_at}`);
      console.log(`  finished  : ${last.finished_at ?? "—"}`);
      console.log(`  scanned   : ${last.files_scanned}`);
      console.log(`  copied    : ${last.files_copied}`);
      console.log(`  bytes     : ${(last.bytes_copied / 1024 / 1024).toFixed(2)} MB`);
      if (last.error_message) console.log(`  error     : ${last.error_message}`);
      const parsedSessions = await store.countParsedSessions(opts.host);
      const summarized = await store.countSummaries(opts.host);
      console.log(
        `Sessions in index: ${totalSessions} (parsed: ${parsedSessions}, summarized: ${summarized})`,
      );
      console.log(`Blob backend: ${describeBlob(config)}`);
    } finally {
      await store.close();
    }
  });

program
  .command("analyze")
  .description("Generate LLM summaries for parsed sessions (requires ANTHROPIC_API_KEY)")
  .option("--limit <n>", "Max sessions to summarize in this run", (v) => Number.parseInt(v, 10), 25)
  .option("--project <dir>", "Only analyze sessions in this project_dir")
  .option("--host <id>", "Only analyze sessions from this host_id")
  .option("--since <iso>", "Only analyze sessions active since this ISO timestamp")
  .option("--dry-run", "List candidate sessions without calling the LLM")
  .option("--model <name>", "Anthropic model id (default: claude-haiku-4-5-20251001)")
  .action(async (opts: {
    limit: number;
    project?: string;
    host?: string;
    since?: string;
    dryRun?: boolean;
    model?: string;
  }) => {
    const config = loadConfig();
    const store = createStore(config);
    await store.init();
    try {
      const candidates = await store.listUnanalyzedSessions({
        host_id: opts.host ?? config.hostId,
        project_dir: opts.project,
        since: opts.since,
        limit: opts.limit,
      });

      if (candidates.length === 0) {
        console.log("Nothing to analyze. All sessions in range have fresh summaries.");
        return;
      }

      if (opts.dryRun) {
        console.log(`${candidates.length} session(s) would be summarized:`);
        for (const s of candidates) console.log(`  ${s.source_key}`);
        return;
      }

      const client = new AnthropicClient({ model: opts.model });
      let ok = 0;
      let failed = 0;
      let totalIn = 0;
      let totalOut = 0;

      for (const [i, session] of candidates.entries()) {
        const details = await store.getSessionDetails(session.source_key, session.host_id);
        if (!details) continue;
        const userMessages = await store.getUserMessages(session.source_key, session.host_id);

        process.stdout.write(`[${i + 1}/${candidates.length}] ${session.source_key} ... `);
        try {
          const { summary, model, usage } = await summarizeSession(
            { session, details, userMessages },
            client,
          );
          const record: SessionSummaryRecord = {
            source_key: session.source_key,
            host_id: session.host_id,
            one_liner: summary.one_liner,
            summary,
            tags: summary.tags,
            model,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            generated_at: new Date().toISOString(),
            generated_for_mtime: details.parsed_for_mtime,
          };
          await store.upsertSessionSummary(record);
          ok += 1;
          totalIn += usage.input_tokens;
          totalOut += usage.output_tokens;
          console.log(`ok (in=${usage.input_tokens} out=${usage.output_tokens})`);
        } catch (err) {
          failed += 1;
          console.log(`FAIL: ${(err as Error).message}`);
        }
      }

      console.log(
        `\nDone: ok=${ok} failed=${failed} tokens=${totalIn}in/${totalOut}out`,
      );
    } finally {
      await store.close();
    }
  });

program
  .command("doctor")
  .description("Verify the environment (source dir, store, blob backend)")
  .action(async () => {
    const config = loadConfig();
    let ok = true;
    const line = (status: "OK" | "WARN" | "FAIL", msg: string) => {
      const tag = status === "OK" ? "✓" : status === "WARN" ? "!" : "✗";
      console.log(`${tag} ${msg}`);
      if (status === "FAIL") ok = false;
    };

    line("OK", `data dir : ${config.dataDir}`);
    line("OK", `source   : ${config.sourceDir}`);
    line("OK", `host/user: ${config.hostId} / ${config.userId}`);
    line("OK", `store    : ${config.store.type} @ ${config.store.path}`);

    if (config.blob.type === "fs") {
      line("OK", `blob     : fs @ ${config.blob.root}`);
    } else {
      line("OK", `blob     : rclone → ${config.blob.remote}`);
      const blob = new RcloneBlobStore({
        remote: config.blob.remote,
        rcloneBin: config.blob.rcloneBin,
        configPath: config.blob.configPath,
      });
      try {
        const version = await blob.version();
        line("OK", `  rclone : ${version}`);
      } catch (err) {
        line("FAIL", `  rclone not runnable: ${(err as Error).message}`);
      }
      try {
        let count = 0;
        for await (const _ of blob.list()) {
          count += 1;
          if (count > 3) break;
        }
        line("OK", `  remote reachable (found ${count}${count > 3 ? "+" : ""} blobs)`);
      } catch (err) {
        line("FAIL", `  remote unreachable: ${(err as Error).message}`);
      }
    }

    process.exit(ok ? 0 : 1);
  });

function summarizeConfig(config: ReturnType<typeof loadConfig>) {
  return {
    dataDir: config.dataDir,
    sourceDir: config.sourceDir,
    hostId: config.hostId,
    userId: config.userId,
    store: { type: config.store.type },
    blob: describeBlob(config),
    projects: config.projects,
  };
}

function describeBlob(config: ReturnType<typeof loadConfig>): string {
  return config.blob.type === "fs"
    ? `fs @ ${config.blob.root}`
    : `rclone → ${config.blob.remote}`;
}

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
