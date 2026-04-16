import type { Migration } from "./index.js";

// Resume-picker hints carried by Claude Code in the session file itself:
// `custom-title` records → custom_title; `agent-name` records → agent_name;
// `last-prompt` records → last_prompt (most recent user prompt snippet).
// Surfacing these lets the dashboard show meaningful labels for sessions that
// have no LLM-generated summary yet.
// Invalidate parsed_for_mtime on existing rows so the next \`csk backup\` will
// re-parse and populate the new columns. The columns themselves are nullable;
// the empty-string mtime is the cheapest sentinel that won't equal any real ISO
// timestamp on the source files.
const SQL = `
ALTER TABLE session_details ADD COLUMN custom_title TEXT;
ALTER TABLE session_details ADD COLUMN agent_name   TEXT;
ALTER TABLE session_details ADD COLUMN last_prompt  TEXT;
UPDATE session_details SET parsed_for_mtime = '';
`;

const migration: Migration = {
  version: 5,
  name: "session_resume_fields",
  sql: SQL,
};

export default migration;
