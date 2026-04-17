import type { Migration } from "./index.js";

// Each `csk patterns` run needs to remember which sessions it actually
// consumed, so the UI can show the source list even when the enriched-summary
// set changes afterward (e.g. new analyze calls add more rows). JSON column
// over a separate join table because the list is always read whole-run and
// the cardinality is bounded by DEFAULT_PATTERNS_BATCH (80 by default,
// 200 hard cap).
const SQL = `
ALTER TABLE csk_pattern_runs ADD COLUMN source_keys_json TEXT;
`;

const migration: Migration = {
  version: 7,
  name: "patterns_sources",
  sql: SQL,
};

export default migration;
