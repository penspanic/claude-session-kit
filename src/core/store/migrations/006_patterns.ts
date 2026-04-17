import type { Migration } from "./index.js";

// signals_version = 0 means the row was produced before the skill-gap
// detection prompt was introduced and lacks intent/friction_events/corrections.
// `csk patterns` only reads rows at version >= 1.
//
// csk_findings is keyed by (run_id, id) conceptually: each `csk patterns`
// invocation produces a fresh batch tied to a run_id so we can keep history
// and the dashboard can page by run. evidence_json carries session citations
// the LLM produced along with quoted excerpts.
const SQL = `
ALTER TABLE session_summaries ADD COLUMN signals_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE csk_findings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             TEXT    NOT NULL,
  kind               TEXT    NOT NULL,
  cluster_key        TEXT,
  title              TEXT    NOT NULL,
  description        TEXT    NOT NULL,
  suggested_remedy   TEXT,
  evidence_json      TEXT    NOT NULL,
  score              REAL,
  model              TEXT    NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  generated_at       TEXT    NOT NULL
);

CREATE INDEX idx_csk_findings_run
  ON csk_findings (run_id, generated_at DESC);

CREATE INDEX idx_csk_findings_kind
  ON csk_findings (kind);

CREATE TABLE csk_pattern_runs (
  run_id         TEXT    PRIMARY KEY,
  host_id        TEXT    NOT NULL,
  model          TEXT    NOT NULL,
  summary_count  INTEGER NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  finding_count  INTEGER NOT NULL DEFAULT 0,
  filter_json    TEXT,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT
);

CREATE INDEX idx_csk_pattern_runs_started
  ON csk_pattern_runs (started_at DESC);
`;

const migration: Migration = {
  version: 6,
  name: "patterns",
  sql: SQL,
};

export default migration;
