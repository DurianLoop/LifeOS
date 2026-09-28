#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/desktop"
if [ ! -d node_modules/electron ]; then echo "Desktop dependencies missing. Run ./setup_desktop.sh once."; exit 1; fi
if [ -z "${LIFEOS_PYTHON:-}" ] && [ -x .venv/bin/python ]; then export LIFEOS_PYTHON="$PWD/.venv/bin/python"; fi
npm start
