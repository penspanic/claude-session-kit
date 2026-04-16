# claude-session-kit

> Back up, index, and analyze Claude Code session logs. Ships an MCP server so AI agents can query the archive natively.

[![CI](https://github.com/penspanic/claude-session-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/penspanic/claude-session-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Why

Claude Code stores every session under `~/.claude/projects/**/*.jsonl`, but the default `cleanupPeriodDays` is **30** — so a month from now, your debugging traces, tool-use history, and subagent logs are gone. Those artifacts are *exactly* what you want to mine for retrospectives, blog material, and meta-improvements to your workflow.

`claude-session-kit` does four things:

1. **Backup** — mirrors every file under your projects directory (JSONL sessions, subagent logs, `tool-results/`, screenshots, meta JSON) into a blob store. Incremental; safe to run nightly.
2. **Index** — parses session filenames into a SQLite index: main sessions vs subagents, parent linkage, per-host and per-user attribution.
3. **Expose** — runs an MCP server that agents like Claude Code can call as a first-class tool.
4. **Analyze** *(planned)* — LLM-powered summaries, pattern detection, skill-gap extraction.

## Features

- **Zero data loss** — mirrors non-JSONL files too (tool results, screenshots, meta). Anything that would disappear with the session gets preserved.
- **Incremental backups** — size + mtime check, with 2-second tolerance for remote filesystems.
- **Multi-host / multi-user** — every record carries `host_id` and `user_id`, so a team can point multiple machines at one remote store.
- **Pluggable storage** — `SessionStore` (SQLite today; Postgres/Supabase on the roadmap) and `BlobStore` (local filesystem, rclone) interfaces. Swap backends without touching call sites.
- **Rclone-powered cloud** — one backend gives you Google Drive, OneDrive, Dropbox, S3, B2, and 60+ other providers.
- **MCP-first** — the CLI and the MCP server share a single core, so every capability is available to both humans and agents.
- **Project allow/blocklists** — exclude personal or client work from shared stores.

## Install

```bash
npm install -g claude-session-kit
```

Or from source:

```bash
git clone https://github.com/penspanic/claude-session-kit.git
cd claude-session-kit
npm install
npm run build
npm link
```

## Quick start

```bash
# One-shot local backup
csk backup

# Check what was archived
csk status

# Daily backup via cron (3:30 AM by default; HOUR / MINUTE to override)
./scripts/install-cron.sh
```

Data lives at `~/.claude-session-kit/` by default:

```
~/.claude-session-kit/
├── config.json      # host/user id, backend choice, project allow/block
├── index.db         # SQLite index
└── mirror/          # per-project jsonl + subagents + tool-results
```

## Cloud storage (rclone)

`claude-session-kit` delegates cloud uploads to [rclone](https://rclone.org/), so any rclone-supported backend works — Google Drive, OneDrive, Dropbox, S3, Backblaze B2, etc.

**1. Install rclone and configure a remote**

```bash
brew install rclone          # macOS
rclone config                # interactive setup for your provider
# ...creates a remote named e.g. "gdrive"
```

**2. Point CSK at the remote**

Edit `~/.claude-session-kit/config.json`:

```json
{
  "blobType": "rclone",
  "blobRclone": { "remote": "gdrive:claude-sessions" }
}
```

Or use environment variables:

```bash
export CSK_BLOB_TYPE=rclone
export CSK_RCLONE_REMOTE=gdrive:claude-sessions
csk doctor    # verify the remote is reachable
csk backup
```

## MCP integration

Add to your Claude Code `.mcp.json`:

```json
{
  "mcpServers": {
    "csk": {
      "command": "csk-mcp"
    }
  }
}
```

Current tools:

| Tool | Description |
| --- | --- |
| `csk_backup_status` | Returns the most recent backup run, host/user, and total session count. |

More tools coming in subsequent releases (session search, summarization, pattern detection).

## Configuration reference

| Env var | Config key | Default |
| --- | --- | --- |
| `CSK_DATA_DIR` | — | `~/.claude-session-kit` |
| `CSK_SOURCE_DIR` | — | `~/.claude/projects` |
| `CSK_STORE_TYPE` | `storeType` | `sqlite` |
| `CSK_BLOB_TYPE` | `blobType` | `fs` |
| `CSK_RCLONE_REMOTE` | `blobRclone.remote` | — |
| `CSK_RCLONE_BIN` | `blobRclone.rcloneBin` | `rclone` (on `PATH`) |
| `CSK_RCLONE_CONFIG` | `blobRclone.configPath` | rclone default |

Project filters in `config.json`:

```json
{
  "projects": {
    "allow": ["-Users-me-OpenSource"],   // empty means "all"
    "block": ["-Users-me-ClientXYZ"]
  }
}
```

## Commands

```
csk backup              Mirror the source directory into the blob store
csk status [--json]     Summarize the last backup and the index
csk status --host <id>  Filter status by host_id
csk doctor              Verify source, store, and blob backend
```

## Architecture at a glance

```
┌──────────┐     ┌───────────┐     ┌─────────────────────┐
│  csk CLI │     │  csk-mcp  │     │  (future dashboards)│
└────┬─────┘     └─────┬─────┘     └──────────┬──────────┘
     │                 │                      │
     └────────────┬────┴──────────┬───────────┘
                  │               │
              ┌───▼───┐       ┌───▼──────┐
              │ core  │──────▶│ BlobStore│  fs  | rclone
              │       │       └──────────┘  (→ GDrive / OneDrive / S3 / ...)
              │       │       ┌────────────┐
              │       │──────▶│SessionStore│  sqlite
              └───────┘       └────────────┘  (→ postgres planned)
```

## Roadmap

- **v0.1** — backup + status + MCP `backup_status`. **(current)**
- **v0.2** — session JSONL parsing, MCP `search_sessions` + `get_session` + `recent`.
- **v0.3** — LLM summaries (Haiku), `summarize_session`, `recap` (last N days).
- **v0.4** — pattern detection, skill-gap extraction, team aggregation via Postgres.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs, backend implementations, and design feedback all welcome.

## License

MIT. See [LICENSE](./LICENSE).
