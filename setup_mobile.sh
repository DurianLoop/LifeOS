#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/mobile"
npm install
printf '\nCapacitor dependencies installed. Next:\n  npm run add:ios      # macOS + Xcode required\n  npm run add:android  # Android Studio/JDK required\n  npm run cap:sync\n'
