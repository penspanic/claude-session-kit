import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/core/config.js";

export interface TempEnv {
  root: string;
  dataDir: string;
  sourceDir: string;
  config: Config;
}

export function makeTempEnv(overrides: Partial<Config> = {}): TempEnv {
  const root = mkdtempSync(join(tmpdir(), "csk-test-"));
  const dataDir = join(root, "data");
  const sourceDir = join(root, "claude-projects");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });

  const config: Config = {
    dataDir,
    sourceDir,
    hostId: "test-host",
    userId: "test-user",
    store: { type: "sqlite", path: join(dataDir, "index.db") },
    blob: { type: "fs", root: join(dataDir, "mirror") },
    projects: { allow: [], block: [] },
    ...overrides,
  };

  return { root, dataDir, sourceDir, config };
}

export function writeFakeSession(
  sourceDir: string,
  projectDir: string,
  sessionId: string,
  payload: string,
  mtimeSec?: number,
): string {
  const dir = join(sourceDir, projectDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, payload);
  if (mtimeSec !== undefined) utimesSync(filePath, mtimeSec, mtimeSec);
  return filePath;
}

export function writeFakeSubagent(
  sourceDir: string,
  projectDir: string,
  parentSessionId: string,
  subagentId: string,
  payload: string,
  mtimeSec?: number,
): string {
  const dir = join(sourceDir, projectDir, parentSessionId, "subagents");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${subagentId}.jsonl`);
  writeFileSync(filePath, payload);
  if (mtimeSec !== undefined) utimesSync(filePath, mtimeSec, mtimeSec);
  return filePath;
}
