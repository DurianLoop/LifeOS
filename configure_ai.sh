#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python3 scripts/configure_ai.py
python3 scripts/test_ai_connection.py
