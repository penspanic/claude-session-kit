import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type StoreType = "sqlite";
export type BlobType = "fs" | "rclone";

export type BlobConfig =
  | { type: "fs"; root: string }
  | { type: "rclone"; remote: string; rcloneBin?: string; configPath?: string };

export interface Config {
  dataDir: string;
  sourceDir: string;
  hostId: string;
  userId: string;
  store: { type: StoreType; path: string };
  blob: BlobConfig;
  // Project allowlist/blocklist. Empty allowlist means "include everything".
  projects: { allow: string[]; block: string[] };
}

interface PersistedConfig {
  hostId: string;
  userId: string;
  storeType: StoreType;
  blobType: BlobType;
  blobRclone?: { remote: string; rcloneBin?: string; configPath?: string };
  projects?: { allow?: string[]; block?: string[] };
}

function defaultDataDir(): string {
  return process.env.CSK_DATA_DIR ?? join(homedir(), ".claude-session-kit");
}

function defaultSourceDir(): string {
  return process.env.CSK_SOURCE_DIR ?? join(homedir(), ".claude", "projects");
}

function defaultHostId(): string {
  // hostname() can return `.local` on macOS; strip it for readability.
  return hostname().replace(/\.local$/, "");
}

function defaultUserId(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

export function loadConfig(): Config {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });

  const configPath = join(dataDir, "config.json");
  let persisted: PersistedConfig;

  if (existsSync(configPath)) {
    persisted = JSON.parse(readFileSync(configPath, "utf8")) as PersistedConfig;
  } else {
    persisted = {
      hostId: defaultHostId() || `host-${randomUUID().slice(0, 8)}`,
      userId: defaultUserId(),
      storeType: "sqlite",
      blobType: "fs",
      projects: { allow: [], block: [] },
    };
    writeFileSync(configPath, JSON.stringify(persisted, null, 2) + "\n");
  }

  const storeType = (process.env.CSK_STORE_TYPE as StoreType | undefined) ?? persisted.storeType;
  const blobType = (process.env.CSK_BLOB_TYPE as BlobType | undefined) ?? persisted.blobType;

  return {
    dataDir,
    sourceDir: defaultSourceDir(),
    hostId: persisted.hostId,
    userId: persisted.userId,
    store: {
      type: storeType,
      path: join(dataDir, "index.db"),
    },
    blob: resolveBlobConfig(blobType, dataDir, persisted),
    projects: {
      allow: persisted.projects?.allow ?? [],
      block: persisted.projects?.block ?? [],
    },
  };
}

function resolveBlobConfig(
  blobType: BlobType,
  dataDir: string,
  persisted: PersistedConfig,
): BlobConfig {
  if (blobType === "rclone") {
    const remote = process.env.CSK_RCLONE_REMOTE ?? persisted.blobRclone?.remote;
    if (!remote) {
      throw new Error(
        "blobType is 'rclone' but no remote is configured. Set CSK_RCLONE_REMOTE or add blobRclone.remote to config.json.",
      );
    }
    return {
      type: "rclone",
      remote,
      rcloneBin: process.env.CSK_RCLONE_BIN ?? persisted.blobRclone?.rcloneBin,
      configPath: process.env.CSK_RCLONE_CONFIG ?? persisted.blobRclone?.configPath,
    };
  }
  return { type: "fs", root: join(dataDir, "mirror") };
}

export function isProjectAllowed(config: Config, projectDir: string): boolean {
  if (config.projects.block.includes(projectDir)) return false;
  if (config.projects.allow.length === 0) return true;
  return config.projects.allow.includes(projectDir);
}
