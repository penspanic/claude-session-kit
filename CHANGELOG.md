# Changelog

All notable changes to `claude-session-kit` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Schema migration system** (#2). `schema_migrations` table tracks applied versions; `SqliteStore.init()` runs pending migrations in a transaction. Existing pre-migration installs are backfilled to v1 automatically.
- **JSONL session parser** (#1). Streams session files to extract message counts, tool usage, model, duration, cwd, git branch, and token usage. Results land in a new `session_details` table, keyed by `(source_key, host_id)`. The parser is incremental — re-runs only when the source file's mtime changes.
- **MCP tools for session queries** (#3). `csk_list_sessions`, `csk_get_session`, `csk_recent` — agents can now ask "what sessions did I run in OpenFieldFramework this week?" directly.
- **Full-text search over user messages** (#10). Parser now extracts user-message content into a new `user_messages` table indexed by FTS5 (external-content virtual table). The `csk_search` MCP tool accepts FTS5 query syntax (boolean, NEAR, phrase) and returns `<mark>`-highlighted snippets with session context.
- `csk status` now shows parsed-session count alongside indexed count.
- `BackupResult.sessionsParsed` field exposes how many files were freshly parsed during a run.

## [0.1.0] — 2026-04-16

### Added

- Initial release: `csk backup`, `csk status`, `csk doctor` CLI.
- MCP server with `csk_backup_status` tool.
- Pluggable `SessionStore` (SQLite) and `BlobStore` (local filesystem, rclone) interfaces.
- Rclone-backed cloud storage — works with Google Drive, OneDrive, Dropbox, S3, B2, and all other rclone backends.
- Incremental backup with mtime tolerance for remote filesystems.
- Session classification (main vs subagent) and parent linkage for subagent logs.
- Cron installer script for daily backups.

[Unreleased]: https://github.com/penspanic/claude-session-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/penspanic/claude-session-kit/releases/tag/v0.1.0
