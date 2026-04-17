# claude-session-kit

> Back up, index, and analyze Claude Code session logs. Ships an MCP server so AI agents can query the archive natively.

[![CI](https://github.com/penspanic/claude-session-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/penspanic/claude-session-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Why

Claude Code stores every session under `~/.claude/projects/**/*.jsonl`, but the default `cleanupPeriodDays` is **30** — so a month from now, your debugging traces, tool-use history, and subagent logs are gone. Those artifacts are *exactly* what you want to mine for retrospectives, blog material, and meta-improvements to your workflow.

`claude-session-kit` does five things:

1. **Backup** — mirrors every file under your projects directory (JSONL sessions, subagent logs, `tool-results/`, screenshots, meta JSON) into a blob store. Incremental; safe to run nightly.
2. **Index** — parses session metadata into a SQLite index: main sessions vs subagents, parent linkage, tool usage, token counts, per-host/per-user attribution, plus FTS5 full-text search over user messages.
3. **Analyze** — LLM-powered summaries of each session (intent, what was tried, outcome, friction events, user corrections).
4. **Detect patterns** — cross-session analysis to surface repeated friction, missing skills, codebase smells, documentation gaps, and test coverage gaps. Two modes: project (one repo or worktree group) and global (habits that span projects).
5. **Expose** — an MCP server and a local read-only web dashboard (`csk serve`) so both AI agents and humans can query the archive.

## Features

- **Zero data loss** — mirrors non-JSONL files too (tool results, screenshots, meta). Anything that would disappear with the session gets preserved.
- **Incremental backups** — size + mtime check, with 2-second tolerance for remote filesystems.
- **Multi-host / multi-user** — every record carries `host_id` and `user_id`, so a team can point multiple machines at one remote store.
- **Pluggable storage** — `SessionStore` (SQLite today; Postgres on the roadmap) and `BlobStore` (local filesystem, rclone; native S3 on the roadmap) interfaces. Swap backends without touching call sites.
- **Rclone-powered cloud** — one backend gives you Google Drive, OneDrive, Dropbox, S3, B2, and 60+ other providers.
- **MCP-first** — the CLI, the web dashboard, and the MCP server share a single core, so every capability is available to humans and agents.
- **Free-form output language** — `--lang <label>` on `csk analyze` and `csk patterns` lets the LLM respond in whatever language you name (`auto`, `en`, `한국어`, `日本語`, …). Identifiers and verbatim quotes stay in their original form.
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
| `csk_backup_status` | Most recent backup run, host/user, and session totals. |
| `csk_list_sessions` | List sessions with parsed metadata. Filter by project, host, kind, date range, pagination. |
| `csk_get_session` | Fetch a single session by `source_key`, with parsed details. |
| `csk_recent` | Per-project session counts over the last N days. |
| `csk_search` | Full-text search (FTS5) over user-message content. Returns highlighted snippets with session context. |
| `csk_summarize` | Return a session's LLM summary. Generates on demand (if `ANTHROPIC_API_KEY` is set) or returns cache. |
| `csk_recap` | List summaries over a date range, grouped by project. "What did I do this week?" in one tool call. |
| `csk_patterns` | Cross-session findings from the latest (or specified) `csk patterns` run. Filter by scope (`project`/`global`), project_dir, kind. |

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
csk backup                        Mirror the source directory into the blob store
csk status [--json]               Summarize the last backup and the index
csk status --host <id>            Filter status by host_id
csk analyze [opts]                LLM-summarize parsed sessions (needs ANTHROPIC_API_KEY)
csk patterns project --dir <X>    Find patterns in one project (repeatable --dir)
csk patterns global               Find cross-project habits (evidence must span ≥2 projects)
csk serve [--port 4567]           Launch the read-only web dashboard
csk doctor                        Verify source, store, and blob backend
```

### `csk analyze`

Generates structured summaries (one-liner, what-tried, outcome, notable events, friction events, user corrections, intent, tags) using Anthropic's API. Summaries are cached in SQLite keyed by the source file's mtime so re-runs skip anything still current.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
csk analyze --limit 10                               # first 10 unanalyzed sessions
csk analyze --project -Users-me-Repo --since 2026-04-01
csk analyze --dry-run --limit 50                     # preview candidates without calling the API
csk analyze --model claude-haiku-4-5-20251001        # override model
csk analyze --lang ko                                # respond in Korean (identifiers stay English)
```

By default uses Haiku. For 1000 sessions expect ~$3-6 in token costs; the CLI prints per-session usage.

### `csk patterns`

Feeds enriched summaries back to an LLM as one cross-session call, emits structured findings (missing skills, recurring frictions, codebase smells, documentation gaps, test-coverage gaps, API friction) with evidence citing the source sessions. Two modes:

```bash
# Project mode — one logical project (possibly many worktrees)
csk patterns project --dir -Users-me-Repo
csk patterns project --dir -Users-me-Repo --dir -Users-me-Repo-worktree-1
csk patterns project --match Repo      # substring-match all project_dirs

# Global mode — habits that show up across projects (≥2 distinct project_dirs required)
csk patterns global --limit 200
csk patterns global --lang 한국어
```

Findings persist in `csk_findings` tied to a `run_id`. View via the web dashboard (`/patterns`) or `csk_patterns` MCP tool. Runs without `-y` show a cost estimate and ask for confirmation first.

### `csk serve`

Localhost web dashboard (read-only by default; Analyze and Patterns pages can trigger LLM runs if `ANTHROPIC_API_KEY` is set or provided via an in-browser modal).

```bash
csk serve                   # http://127.0.0.1:4567
csk serve --port 8080 --host 127.0.0.1
```

Pages: Home (stats + recent projects), per-project session tree (main sessions with collapsible subagents), session detail, full-text search, Analyze (cost preview + per-session selection), Patterns (project/global scope, project picker, findings + source sessions).

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

- **v0.1** — backup, index, MCP backup_status. ✅
- **v0.2** — session parsing, FTS5 search, LLM summaries, interactive analyze, web dashboard, cross-session patterns detection. **(current)** ✅
- **v0.3** — native S3 blob store (no rclone), rclone setup docs for GDrive/OneDrive.
- **v0.4** — PostgresSessionStore for multi-host team aggregation; deeper code-aware pattern detection (feed cited source files to the LLM).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs, backend implementations, and design feedback all welcome.

## License

MIT. See [LICENSE](./LICENSE).
