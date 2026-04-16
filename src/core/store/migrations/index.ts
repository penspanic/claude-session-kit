import type Database from "better-sqlite3";
import m001 from "./001_init.js";
import m002 from "./002_session_details.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered list of all migrations. Add new ones here.
 * Versions must be unique, strictly increasing integers.
 */
const MIGRATIONS: Migration[] = [m001, m002];

// Sanity check: versions are strictly increasing.
for (let i = 1; i < MIGRATIONS.length; i += 1) {
  const prev = MIGRATIONS[i - 1]!;
  const curr = MIGRATIONS[i]!;
  if (curr.version <= prev.version) {
    throw new Error(
      `Migration order broken: ${prev.version} (${prev.name}) then ${curr.version} (${curr.name})`,
    );
  }
}

export { MIGRATIONS };

/**
 * Bring the database up to the latest schema version.
 *
 * Bootstraps the `schema_migrations` table if missing. If legacy tables exist
 * (from a pre-migration install) without a migration record, backfills v1 so
 * we don't try to re-create tables that already exist.
 */
export function migrate(db: Database.Database): { applied: Migration[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      INTEGER PRIMARY KEY,
      name         TEXT    NOT NULL,
      applied_at   TEXT    NOT NULL
    );
  `);

  const hasLegacySessions = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'`)
    .get() as { 1: 1 } | undefined;
  const hasAnyMigration = db
    .prepare(`SELECT 1 FROM schema_migrations LIMIT 1`)
    .get() as { 1: 1 } | undefined;

  if (hasLegacySessions && !hasAnyMigration) {
    db.prepare(
      `INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'init', ?)`,
    ).run(new Date().toISOString());
  }

  const appliedVersions = new Set(
    (db.prepare(`SELECT version FROM schema_migrations`).all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );

  const applied: Migration[] = [];
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  );

  for (const m of MIGRATIONS) {
    if (appliedVersions.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.version, m.name, new Date().toISOString());
    });
    tx();
    applied.push(m);
  }

  return { applied };
}

export function currentVersion(db: Database.Database): number {
  const hasTable = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get();
  if (!hasTable) return 0;
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM schema_migrations`)
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}
