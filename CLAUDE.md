# claude-session-kit — notes for AI agents

Open-source tool. Keep all code, comments, commit messages, and issues in **English**.

## Architecture

Every capability lives in `src/core/` and is surfaced by both `src/bin/cli.ts` and `src/bin/mcp.ts`. If you add a feature, add it to `core/` first; the two entry points should stay thin.

Two pluggable interfaces:

- `SessionStore` (`src/core/store/`) — SQLite today, Postgres planned.
- `BlobStore` (`src/core/blob/`) — `fs` and `rclone` today; S3 native on the roadmap.

Adding a backend = new file + variant in `BlobConfig`/`StoreType` + wire-up in the factory. No call-site changes.

## Invariants

- **Preserve mtime on upload.** The incremental check in `runBackup` relies on size + mtime; `FsBlobStore.putFile` calls `utimes`, rclone does it natively. Any new backend must do the same.
- **Session id is filename-without-`.jsonl`.** Parent-subagent linkage comes from the path layout (`<project>/<sessionId>/subagents/<subagentId>.jsonl`), decoded by `classifySessionFile`.
- **`(source_key, host_id)` is the session PK** — multiple hosts may back up the same session_id independently.
- **No schema migrations yet.** Until we add a migration system, schema changes require wiping `index.db` (the mirror is safe). Design new features additively.

## Workflow

```bash
npm run dev:cli -- backup    # iterate without building
npm test                     # vitest (31 tests, rclone suite skips without rclone)
npm run typecheck
npm run build
```

Integration tests use rclone's `:local:` backend — no credentials needed. They must skip cleanly when rclone is absent.

## Style

- No comments unless the *why* is non-obvious (invariant, gotcha, workaround).
- No backwards-compatibility shims for features shipped this cycle — we're pre-1.0.
- PRs over direct-to-main. Conventional commit prefixes (`feat:`, `fix:`, `docs:`).
