#!/usr/bin/env bash
# Simple wrapper that launches the TypeScript dev script
set -e
cd "$(dirname "$0")/.."
bun run scripts/electron-dev.ts "$@"
