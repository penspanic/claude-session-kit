import type { Config } from "../config.js";
import type { BackupRun, SessionFilter, SessionRecord } from "../types.js";
import { SqliteStore } from "./sqlite.js";

export interface SessionStore {
  init(): void | Promise<void>;
  close(): void | Promise<void>;

  createBackupRun(run: Omit<BackupRun, "id">): number | Promise<number>;
  updateBackupRun(id: number, patch: Partial<BackupRun>): void | Promise<void>;
  getLastBackupRun(hostId?: string): BackupRun | null | Promise<BackupRun | null>;
  listBackupRuns(limit: number): BackupRun[] | Promise<BackupRun[]>;

  upsertSession(session: SessionRecord): void | Promise<void>;
  listSessions(filter?: SessionFilter): SessionRecord[] | Promise<SessionRecord[]>;
  countSessions(filter?: SessionFilter): number | Promise<number>;
}

export function createStore(config: Config): SessionStore {
  switch (config.store.type) {
    case "sqlite":
      return new SqliteStore(config.store.path);
    default: {
      const type: never = config.store.type;
      throw new Error(`Unsupported store type: ${String(type)}`);
    }
  }
}
