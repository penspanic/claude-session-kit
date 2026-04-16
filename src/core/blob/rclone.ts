import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { posix } from "node:path";
import type { BlobEntry, BlobMeta, BlobStore } from "./index.js";

const exec = promisify(execFile);

export interface RcloneOptions {
  /** Target remote, e.g. `"gdrive:claude-sessions"` or `":local:/tmp/mirror"`. */
  remote: string;
  /** Path to the `rclone` binary. Defaults to `rclone` on PATH. */
  rcloneBin?: string;
  /** Override the rclone config file path (otherwise rclone's default is used). */
  configPath?: string;
  /** Soft maximum buffer for command output, in bytes. Large listings go higher. */
  maxBuffer?: number;
}

interface RcloneLsEntry {
  Path: string;
  Name: string;
  Size: number;
  MimeType?: string;
  ModTime: string;
  IsDir: boolean;
}

/**
 * BlobStore backed by the `rclone` CLI. Works with any of rclone's ~70
 * supported backends (Google Drive, OneDrive, Dropbox, S3, B2, ...). The
 * caller is expected to have configured the target remote via `rclone config`
 * before instantiating this store.
 */
export class RcloneBlobStore implements BlobStore {
  private readonly remote: string;
  private readonly rcloneBin: string;
  private readonly configPath: string | undefined;
  private readonly maxBuffer: number;

  constructor(opts: RcloneOptions) {
    this.remote = opts.remote;
    this.rcloneBin = opts.rcloneBin ?? "rclone";
    this.configPath = opts.configPath;
    this.maxBuffer = opts.maxBuffer ?? 64 * 1024 * 1024;
  }

  async stat(key: string): Promise<BlobMeta | null> {
    if (!key) return null;
    const parent = posix.dirname(key);
    const name = posix.basename(key);
    const parentRemote = parent === "." ? this.joinRemote("") : this.joinRemote(parent);

    const entries = await this.lsjson(parentRemote, { filesOnly: true });
    if (entries === null) return null;
    const match = entries.find((e) => e.Name === name);
    return match ? { size: match.Size, mtime: new Date(match.ModTime) } : null;
  }

  async putFile(key: string, sourcePath: string): Promise<BlobMeta> {
    await this.exec(["copyto", sourcePath, this.joinRemote(key)]);
    const stat = await this.stat(key);
    if (!stat) {
      throw new Error(`rclone copyto succeeded but stat returned null for '${key}'`);
    }
    return stat;
  }

  async *list(prefix = ""): AsyncIterable<BlobEntry> {
    const root = prefix ? this.joinRemote(prefix) : this.joinRemote("");
    const entries = await this.lsjson(root, { recursive: true, filesOnly: true });
    if (!entries) return;
    for (const e of entries) {
      const key = prefix ? posix.join(prefix, e.Path) : e.Path;
      yield { key, size: e.Size, mtime: new Date(e.ModTime) };
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.exec(["deletefile", this.joinRemote(key)]);
    } catch (err) {
      // Treat "not found" as a no-op for idempotency.
      const msg = (err as Error & { stderr?: string }).stderr ?? (err as Error).message ?? "";
      if (/not found|doesn't exist/i.test(msg)) return;
      throw err;
    }
  }

  /** Verify that the rclone binary is callable and return its version string. */
  async version(): Promise<string> {
    const { stdout } = await this.exec(["version"]);
    return stdout.split("\n")[0] ?? "";
  }

  private async lsjson(
    target: string,
    opts: { recursive?: boolean; filesOnly?: boolean } = {},
  ): Promise<RcloneLsEntry[] | null> {
    const args = ["lsjson", target];
    if (opts.recursive) args.push("--recursive");
    if (opts.filesOnly) args.push("--files-only");
    try {
      const { stdout } = await this.exec(args);
      return JSON.parse(stdout || "[]") as RcloneLsEntry[];
    } catch (err) {
      const msg = (err as Error & { stderr?: string }).stderr ?? (err as Error).message ?? "";
      if (/directory not found|doesn't exist|not found/i.test(msg)) return null;
      throw err;
    }
  }

  private async exec(args: string[]) {
    const final = this.configPath ? ["--config", this.configPath, ...args] : args;
    return exec(this.rcloneBin, final, { maxBuffer: this.maxBuffer });
  }

  /** Compose a rclone path by joining the configured remote with a key. */
  private joinRemote(key: string): string {
    const base = this.remote.replace(/\/$/, "");
    if (!key) return base;
    const needsSep = !base.endsWith(":");
    return base + (needsSep ? "/" : "") + key;
  }
}
