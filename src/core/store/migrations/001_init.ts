import type { Migration } from "./index.js";

const SQL = `
CREATE TABLE backup_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  files_scanned   INTEGER NOT NULL DEFAULT 0,
  files_copied    INTEGER NOT NULL DEFAULT 0,
  bytes_copied   INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL,
  error_message   TEXT
);

CREATE INDEX idx_backup_runs_host_started
  ON backup_runs (host_id, started_at DESC);

CREATE TABLE sessions (
  source_key         TEXT    NOT NULL,
  host_id            TEXT    NOT NULL,
  user_id            TEXT    NOT NULL,
  project_dir        TEXT    NOT NULL,
  session_id         TEXT    NOT NULL,
  parent_session_id  TEXT,
  kind               TEXT    NOT NULL,
  file_size          INTEGER NOT NULL,
  file_mtime         TEXT    NOT NULL,
  first_seen_at      TEXT    NOT NULL,
  last_seen_at       TEXT    NOT NULL,
  PRIMARY KEY (source_key, host_id)
);

CREATE INDEX idx_sessions_project_last_seen
  ON sessions (project_dir, last_seen_at DESC);

CREATE INDEX idx_sessions_host_user
  ON sessions (host_id, user_id);

CREATE INDEX idx_sessions_parent
  ON sessions (parent_session_id);
`;

const migration: Migration = {
  version: 1,
  name: "init",
  sql: SQL,
};

export default migration;
