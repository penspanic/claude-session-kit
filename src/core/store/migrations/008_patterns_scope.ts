import type { Migration } from "./index.js";

// `csk patterns` has two distinct modes now: project and global. They produce
// fundamentally different findings (scoped vs universal) so we track which
// mode a run used. `scope_project_dirs_json` is a JSON array of the dirs the
// project-mode run consumed — we store a list so worktree groups
// (e.g. Aethelgard + Aethelgard-work-1..N) can be treated as one logical
// project without a separate aliasing concept.
//
// Existing runs were produced before this split. They were unfiltered so we
// backfill them as 'global'; re-running in either mode is cheap and the user
// can delete stale rows if they prefer.
const SQL = `
ALTER TABLE csk_pattern_runs ADD COLUMN scope TEXT;
ALTER TABLE csk_pattern_runs ADD COLUMN scope_project_dirs_json TEXT;
UPDATE csk_pattern_runs SET scope = 'global' WHERE scope IS NULL;
`;

const migration: Migration = {
  version: 8,
  name: "patterns_scope",
  sql: SQL,
};

export default migration;
