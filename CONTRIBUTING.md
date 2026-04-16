# Contributing to claude-session-kit

Thanks for your interest! This project is young and feedback on design or scope is just as welcome as code.

## Project layout

```
src/
  core/       # shared logic (config, scan, backup, store, blob)
  bin/        # entry points — cli.ts and mcp.ts share `core/`
tests/        # vitest suite
scripts/      # installers (cron, etc.)
```

The design intent: every feature lives in `core/` and is callable from both the CLI and the MCP server. Adding a new backend (Postgres, S3, ...) means implementing the `SessionStore` or `BlobStore` interface and wiring it into the factory — no changes to call sites.

## Development

```bash
npm install
npm run dev:cli -- backup     # run the CLI without building
npm run dev:mcp               # run the MCP server on stdio
npm test                      # vitest
npm run typecheck
npm run build                 # emit dist/
```

The rclone tests use the `:local:` on-the-fly backend, so they don't need network credentials — but they do require `rclone` on `PATH`. They skip automatically if rclone is missing.

## Adding a blob backend

1. Implement the `BlobStore` interface in `src/core/blob/<name>.ts`.
2. Add a variant to `BlobConfig` in `src/core/config.ts`.
3. Wire it up in `createBlob()` in `src/core/blob/index.ts`.
4. Add tests in `tests/blob.<name>.test.ts` — prefer integration tests over mocks when the backend has a local/test mode.

The `BlobStore` contract:
- `stat(key)` — returns `{ size, mtime }` or `null`.
- `putFile(key, sourcePath)` — copies a local file; **must preserve mtime** so the incremental check in `runBackup` can detect unchanged files.
- `list(prefix?)` — recursive enumeration as an async iterable.
- `delete(key)` — remove, no-op on missing.

## Adding a session store backend

Implement `SessionStore` in `src/core/store/<name>.ts`, add a `StoreType` in `config.ts`, and register in `createStore()`. The current SQLite schema is the reference; team-scale deployments (Postgres) can reuse it nearly verbatim.

## Pull requests

- Prefer small, focused PRs over large rewrites.
- Add tests for new behavior. If the feature depends on an external tool, skip the test gracefully when that tool is absent (see `blob.rclone.test.ts` for a pattern).
- `npm run typecheck && npm test` should pass locally before pushing.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`) appreciated but not required.

## Issues

Bug reports: include the output of `csk doctor`, your config (with any remote credentials redacted), and the command that failed. Feature requests: describe the use case first; a one-line "it would be nice if" goes a long way.
