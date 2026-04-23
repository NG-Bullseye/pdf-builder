#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "missing: $1"
    exit 1
  fi
}

check_dep node
check_dep pandoc
check_dep weasyprint

install_if_needed() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "installing $dir..."
    npm install --prefix "$dir" --silent
  fi
}

install_if_needed "$ROOT/server"
install_if_needed "$ROOT/app"

cleanup() {
  kill "$SERVER_PID" "$APP_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

npx --prefix "$ROOT/server" ts-node "$ROOT/server/src/index.ts" &
SERVER_PID=$!

npm start --prefix "$ROOT/app" &
APP_PID=$!

echo "server  → http://localhost:3001"
echo "app     → http://localhost:4200"

wait
