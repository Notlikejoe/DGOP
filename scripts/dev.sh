#!/usr/bin/env bash
# Run API (port 3000) and Angular dev server (port 4200, proxies /api) together.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

( cd "$ROOT/apps/api" && npm run start:dev ) &
API_PID=$!
( cd "$ROOT/apps/web" && npm start ) &
WEB_PID=$!

trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
echo "API  -> http://localhost:${PORT:-3005}/api/health"
echo "Web  -> http://localhost:4205"
wait
