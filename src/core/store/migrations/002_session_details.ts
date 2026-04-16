import type { Migration } from "./index.js";

const SQL = `
CREATE TABLE session_details (
  source_key                TEXT    NOT NULL,
  host_id                   TEXT    NOT NULL,
  started_at                TEXT,
  ended_at                  TEXT,
  message_count             INTEGER NOT NULL DEFAULT 0,
  user_message_count        INTEGER NOT NULL DEFAULT 0,
  assistant_message_count   INTEGER NOT NULL DEFAULT 0,
  tool_use_count            INTEGER NOT NULL DEFAULT 0,
  tool_names                TEXT,       -- JSON array of distinct tool names
  model                     TEXT,
  cwd                       TEXT,
  git_branch                TEXT,
  input_tokens              INTEGER NOT NULL DEFAULT 0,
  output_tokens             INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens         INTEGER NOT NULL DEFAULT 0,
  parse_error_count         INTEGER NOT NULL DEFAULT 0,
  parsed_at                 TEXT    NOT NULL,
  parsed_for_mtime          TEXT    NOT NULL,
  PRIMARY KEY (source_key, host_id)
);

CREATE INDEX idx_session_details_started
  ON session_details (started_at DESC);

CREATE INDEX idx_session_details_model
  ON session_details (model);
`;

const migration: Migration = {
  version: 2,
  name: "session_details",
  sql: SQL,
};

export default migration;
