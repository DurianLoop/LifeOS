#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js LTS is required. Run ./setup_desktop.sh first." >&2
  exit 1
fi
exec node desktop/setup.cjs start "$@"
