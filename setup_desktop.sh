#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/desktop"
PYTHON_COMMAND="${LIFEOS_PYTHON:-python3}"
if ! "$PYTHON_COMMAND" -c 'import sys; assert sys.version_info >= (3, 10)'; then
  echo "Python 3.10 or newer is required for a source checkout. Set LIFEOS_PYTHON to your Python executable."
  exit 1
fi
if [ -z "${LIFEOS_PYTHON:-}" ]; then
  "$PYTHON_COMMAND" -m venv .venv
  PYTHON_COMMAND="$PWD/.venv/bin/python"
fi
"$PYTHON_COMMAND" -m pip install -r ../requirements.txt
npm ci
echo "Desktop shell ready. Run ../start_desktop.sh"
