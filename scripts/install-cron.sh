#!/usr/bin/env bash
# Install a daily cron entry that runs `csk backup`.
#
# Behavior:
#   - Idempotent: re-running updates the existing entry rather than duplicating it.
#   - Uses the absolute path to the built `csk` binary (dist/bin/cli.js), so it
#     does not depend on PATH inside cron's minimal environment.
#   - Logs to $CSK_DATA_DIR/cron.log (default: ~/.claude-session-kit/cron.log).
#
# Usage:
#   ./scripts/install-cron.sh            # installs at 03:30 daily
#   HOUR=4 MINUTE=0 ./scripts/install-cron.sh
#   ./scripts/install-cron.sh --uninstall

set -euo pipefail

HOUR="${HOUR:-3}"
MINUTE="${MINUTE:-30}"
MARKER="# claude-session-kit:backup"

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${repo_root}/dist/bin/cli.js"
data_dir="${CSK_DATA_DIR:-${HOME}/.claude-session-kit}"
log_file="${data_dir}/cron.log"

if [[ "${1:-}" == "--uninstall" ]]; then
  current="$(crontab -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$current" | grep -v -F "$MARKER" || true)"
  printf '%s\n' "$filtered" | crontab -
  echo "uninstalled cron entry"
  exit 0
fi

if [[ ! -f "$cli" ]]; then
  echo "error: $cli not found. Run 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$data_dir"

node_bin="$(command -v node)"
if [[ -z "$node_bin" ]]; then
  echo "error: node not on PATH" >&2
  exit 1
fi

cron_line="${MINUTE} ${HOUR} * * * ${node_bin} ${cli} backup >> ${log_file} 2>&1 ${MARKER}"

current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v -F "$MARKER" || true)"
printf '%s\n%s\n' "$filtered" "$cron_line" | sed '/^$/d' | crontab -

echo "installed cron entry: ${cron_line}"
echo "log file: ${log_file}"
