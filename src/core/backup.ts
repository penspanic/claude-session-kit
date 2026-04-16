import type { BlobStore } from "./blob/index.js";
import type { Config } from "./config.js";
import { isProjectAllowed } from "./config.js";
import { classifySessionFile, projectOf, walkFiles } from "./scan.js";
import type { SessionStore } from "./store/index.js";
import type { BackupRun, SessionRecord } from "./types.js";

/**
 * Remote backends (rclone → GDrive/OneDrive/...) can round mtimes — some APIs
 * store them with millisecond precision, FAT32/SMB round to 2 seconds. We
 * therefore allow a small tolerance when deciding whether a file is unchanged.
 */
const MTIME_TOLERANCE_MS = 2_000;

function isUnchanged(
  existing: { size: number; mtime: Date },
  source: { size: number; mtime: Date },
): boolean {
  if (existing.size !== source.size) return false;
  return Math.abs(existing.mtime.getTime() - source.mtime.getTime()) <= MTIME_TOLERANCE_MS;
}

export interface BackupResult {
  runId: number;
  filesScanned: number;
  filesCopied: number;
  filesSkipped: number;
  bytesCopied: number;
  sessionsIndexed: number;
  durationMs: number;
  status: BackupRun["status"];
  errorMessage: string | null;
}

/**
 * Mirror every file under the source directory into the blob store and index
 * session JSONL files in the session store.
 *
 * - A file is copied iff its size or mtime differs from the mirrored copy.
 * - Non-session files (tool-results, screenshots, meta json) are still mirrored
 *   but are not indexed; the DB only tracks `.jsonl` session files.
 */
export async function runBackup(
  config: Config,
  store: SessionStore,
  blob: BlobStore,
): Promise<BackupResult> {
  const startedAt = new Date();
  const runId = await store.createBackupRun({
    host_id: config.hostId,
    user_id: config.userId,
    started_at: startedAt.toISOString(),
    finished_at: null,
    files_scanned: 0,
    files_copied: 0,
    bytes_copied: 0,
    status: "running",
    error_message: null,
  });

  let filesScanned = 0;
  let filesCopied = 0;
  let filesSkipped = 0;
  let bytesCopied = 0;
  let sessionsIndexed = 0;

  try {
    for await (const file of walkFiles(config.sourceDir)) {
      filesScanned += 1;

      const projectDir = projectOf(file.relativeKey);
      if (!isProjectAllowed(config, projectDir)) {
        filesSkipped += 1;
        continue;
      }

      const existing = await blob.stat(file.relativeKey);
      const unchanged = existing !== null && isUnchanged(existing, file);

      if (unchanged) {
        filesSkipped += 1;
      } else {
        await blob.putFile(file.relativeKey, file.sourcePath);
        filesCopied += 1;
        bytesCopied += file.size;
      }

      const classification = classifySessionFile(file.relativeKey);
      if (classification) {
        const nowIso = new Date().toISOString();
        const record: SessionRecord = {
          source_key: file.relativeKey,
          kind: classification.kind,
          host_id: config.hostId,
          user_id: config.userId,
          project_dir: classification.projectDir,
          session_id: classification.sessionId,
          parent_session_id: classification.parentSessionId,
          file_size: file.size,
          file_mtime: file.mtime.toISOString(),
          first_seen_at: nowIso,
          last_seen_at: nowIso,
        };
        await store.upsertSession(record);
        sessionsIndexed += 1;
      }
    }

    const finishedAt = new Date();
    await store.updateBackupRun(runId, {
      finished_at: finishedAt.toISOString(),
      files_scanned: filesScanned,
      files_copied: filesCopied,
      bytes_copied: bytesCopied,
      status: "success",
    });

    return {
      runId,
      filesScanned,
      filesCopied,
      filesSkipped,
      bytesCopied,
      sessionsIndexed,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "success",
      errorMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();
    await store.updateBackupRun(runId, {
      finished_at: finishedAt.toISOString(),
      files_scanned: filesScanned,
      files_copied: filesCopied,
      bytes_copied: bytesCopied,
      status: "error",
      error_message: message,
    });
    return {
      runId,
      filesScanned,
      filesCopied,
      filesSkipped,
      bytesCopied,
      sessionsIndexed,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: "error",
      errorMessage: message,
    };
  }
}
