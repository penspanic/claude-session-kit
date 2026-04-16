# Changelog

All notable changes to `claude-session-kit` are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial release: `csk backup`, `csk status`, `csk doctor` CLI.
- MCP server with `csk_backup_status` tool.
- Pluggable `SessionStore` (SQLite) and `BlobStore` (local filesystem, rclone).
- Rclone-backed cloud storage — works with Google Drive, OneDrive, Dropbox, S3, B2, and all other rclone backends.
- Incremental backup with mtime tolerance for remote filesystems.
- Session classification (main vs subagent) and parent linkage for subagent logs.
- Cron installer script for daily backups.

[Unreleased]: https://github.com/penspanic/claude-session-kit/commits/main
