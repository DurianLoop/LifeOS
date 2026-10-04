#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js LTS is required. Install it from https://nodejs.org/ and retry." >&2
  exit 1
fi
exec node desktop/setup.cjs setup "$@"
