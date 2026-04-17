# Changelog

All notable changes to `claude-session-kit` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-04-17

First publish to npm. Includes every feature shipped since the initial v0.1.0 GitHub release.

### Added

- **Schema migration system** (#2). `schema_migrations` table tracks applied versions; `SqliteStore.init()` runs pending migrations in a transaction. Existing pre-migration installs are backfilled to v1 automatically.
- **JSONL session parser** (#1). Streams session files to extract message counts, tool usage, model, duration, cwd, git branch, and token usage. Results land in a new `session_details` table, keyed by `(source_key, host_id)`. The parser is incremental — re-runs only when the source file's mtime changes.
- **MCP tools for session queries** (#3). `csk_list_sessions`, `csk_get_session`, `csk_recent` — agents can now ask "what sessions did I run in OpenFieldFramework this week?" directly.
- **Full-text search over user messages** (#10). Parser now extracts user-message content into a new `user_messages` table indexed by FTS5 (external-content virtual table). The `csk_search` MCP tool accepts FTS5 query syntax (boolean, NEAR, phrase) and returns `<mark>`-highlighted snippets with session context.
- **LLM-powered session summaries** (#5). Migration 004 adds a `session_summaries` table. `src/core/analyze.ts` builds a token-budgeted prompt from session metadata and user messages, and an injected `LLMClient` generates a structured summary. `AnthropicClient` is the default implementation (Haiku 4.5 by default). New `csk analyze` CLI command; MCP tools `csk_summarize` and `csk_recap`.
- **Web dashboard** (`csk serve`, closes #11). Localhost read-only dashboard with Home (stats + recent projects), per-project session tree (main sessions with collapsible subagents), session detail with user-message viewer, full-text search, and Analyze pages. Hierarchy: subagents render nested under their parent main session, collapsed by default.
- **Interactive `csk analyze` with cost preview** (#15). Plan phase prints per-model rates, estimated input/output tokens, and total cost; confirms before calling the API. Web Analyze page adds a selectable candidate list with live cost estimates, an async job runner with progress polling, and a runtime API-key modal for users who don't want to export `ANTHROPIC_API_KEY`.
- **Cross-session patterns detection** (`csk patterns`, closes #6). Project mode (`csk patterns project --dir <X>`, repeatable, plus `--match <substr>` for worktree groups) finds patterns within one logical project; global mode (`csk patterns global`) requires each finding's evidence to span ≥2 distinct project_dirs. LLM emits findings across 8 kinds: behavior-oriented (`repetition`, `correction_pattern`, `friction`, `skill_gap`) and codebase-oriented (`codebase_smell`, `documentation_gap`, `test_coverage_gap`, `api_friction`). Prompt deliberately resists defaulting to "add a CLAUDE.md rule" when the underlying code is the cause. Findings + source-session lists persist per `run_id` (migrations 006-008); web `/patterns` page has scope tabs, a per-project picker with counts, run history, findings list, and a collapsible source-sessions card. New MCP tool `csk_patterns`.
- **Enriched summary schema** (signals_version = 1). Summaries now carry `intent`, `friction_events`, and verbatim `corrections` alongside the original fields. `csk patterns` only consumes summaries at the current signals_version; older summaries stay readable but are skipped.
- **Free-form output language**. `--lang <label>` on `csk analyze` and `csk patterns`; `language` field in web forms. No whitelist — "auto" (default) matches the user's message language, anything else is interpolated directly ("en", "한국어", "日本語", etc.). Identifier fields, code paths, and verbatim quotes are protected from translation.
- `csk status` now shows parsed-session count alongside indexed count.
- `BackupResult.sessionsParsed` exposes how many files were freshly parsed in a run.

## [0.1.0] — 2026-04-16

### Added

- Initial release: `csk backup`, `csk status`, `csk doctor` CLI.
- MCP server with `csk_backup_status` tool.
- Pluggable `SessionStore` (SQLite) and `BlobStore` (local filesystem, rclone) interfaces.
- Rclone-backed cloud storage — works with Google Drive, OneDrive, Dropbox, S3, B2, and all other rclone backends.
- Incremental backup with mtime tolerance for remote filesystems.
- Session classification (main vs subagent) and parent linkage for subagent logs.
- Cron installer script for daily backups.

[Unreleased]: https://github.com/penspanic/claude-session-kit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/penspanic/claude-session-kit/releases/tag/v0.2.0
[0.1.0]: https://github.com/penspanic/claude-session-kit/releases/tag/v0.1.0
