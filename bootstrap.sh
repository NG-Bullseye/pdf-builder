#!/usr/bin/env bash
# bootstrap.sh — idempotentes Aufsetzen: Abhängigkeiten prüfen, npm install (server, app, mcp), MCP bauen. Startet nichts (Start: ./start.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for d in node npm pandoc weasyprint; do command -v "$d" >/dev/null || { echo "missing: $d" >&2; exit 1; }; done
for p in server app mcp; do [ -d "$ROOT/$p/node_modules" ] || npm install --prefix "$ROOT/$p" --silent; done
[ -f "$ROOT/mcp/dist/index.js" ] || npm run build --prefix "$ROOT/mcp" --silent
echo "ok — Start: ./start.sh · CLI: ./build.sh example.md"
