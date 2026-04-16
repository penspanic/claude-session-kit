import type { Migration } from "./index.js";

// Summaries are opt-in and expensive to regenerate, so we keep them in their
// own table separate from session_details. `generated_for_mtime` mirrors the
// source file's mtime at generation time — re-analyze invalidates only when
// the session file actually changed.
const SQL = `
CREATE TABLE session_summaries (
  source_key            TEXT    NOT NULL,
  host_id               TEXT    NOT NULL,
  one_liner             TEXT,
  summary_json          TEXT    NOT NULL,
  tags                  TEXT,       -- JSON array, denormalized from summary_json
  model                 TEXT    NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  generated_at          TEXT    NOT NULL,
  generated_for_mtime   TEXT    NOT NULL,
  PRIMARY KEY (source_key, host_id)
);

CREATE INDEX idx_session_summaries_generated
  ON session_summaries (generated_at DESC);
`;

const migration: Migration = {
  version: 4,
  name: "session_summaries",
  sql: SQL,
};

export default migration;
