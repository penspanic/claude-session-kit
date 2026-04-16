import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { currentVersion, migrate, MIGRATIONS } from "../src/core/store/migrations/index.js";

function newDb() {
  const dir = mkdtempSync(join(tmpdir(), "csk-migr-"));
  return new Database(join(dir, "test.db"));
}

describe("migration runner", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = newDb();
  });

  it("applies every pending migration on a fresh database", () => {
    expect(currentVersion(db)).toBe(0);
    const { applied } = migrate(db);
    expect(applied).toHaveLength(MIGRATIONS.length);
    expect(currentVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.version);
  });

  it("is idempotent — re-running applies nothing", () => {
    migrate(db);
    const { applied } = migrate(db);
    expect(applied).toHaveLength(0);
  });

  it("records each applied migration in schema_migrations", () => {
    migrate(db);
    const rows = db
      .prepare(`SELECT version, name FROM schema_migrations ORDER BY version`)
      .all() as { version: number; name: string }[];
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
  });

  it("backfills v1 when legacy tables exist without a migration record", () => {
    // Simulate a pre-migration install: create the sessions table directly.
    db.exec(`
      CREATE TABLE sessions (
        source_key TEXT NOT NULL,
        host_id TEXT NOT NULL,
        PRIMARY KEY (source_key, host_id)
      );
    `);
    migrate(db);
    const v1 = db
      .prepare(`SELECT name FROM schema_migrations WHERE version = 1`)
      .get() as { name: string } | undefined;
    expect(v1?.name).toBe("init");
    // Should not attempt to re-run 001 (which would fail — table already exists).
    expect(() => migrate(db)).not.toThrow();
  });

  it("creates the tables declared by 001_init", () => {
    migrate(db);
    const tables = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("backup_runs");
    expect(tables).toContain("sessions");
    expect(tables).toContain("schema_migrations");
  });
});
