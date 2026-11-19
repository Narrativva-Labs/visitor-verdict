#!/usr/bin/env bash
set -eu
ADV_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$ADV_DIR/run-all.mjs" "$@"
