#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/desktop"
if [ ! -d node_modules/electron ]; then echo "Desktop dependencies missing. Run ./setup_desktop.sh once."; exit 1; fi
npm start
