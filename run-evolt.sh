#!/usr/bin/env bash
# EVOLT - one-click local start for macOS / Linux (same behaviour as run-evolt.bat).
# Usage: ./run-evolt.sh [--rebuild] [--no-seed] [--no-open] [--port 3001]
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[EVOLT] Node.js is not installed. Install the LTS version from https://nodejs.org" >&2
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)"; then
  echo "[EVOLT] Node.js 20.9 or newer is required." >&2
  exit 1
fi
if [ ! -f node_modules/next/package.json ] || [ ! -f node_modules/embedded-postgres/package.json ]; then
  echo "[EVOLT] Installing dependencies (first run only)..."
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
fi
exec node scripts/run-local.mjs "$@"
