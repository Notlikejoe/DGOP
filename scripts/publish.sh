#!/usr/bin/env bash
# Simplest external publishing: build, run the API (which serves the web UI),
# then expose it over HTTPS with a Cloudflare quick tunnel (no account needed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

export NODE_ENV=production
export DGOP_REQUIRE_STRICT_RUNTIME=true
export HEALTH_INCLUDE_DETAILS=false

PORT="${PORT:-3005}"
TOOLS="$ROOT/tools"
CF="$TOOLS/cloudflared"
mkdir -p "$TOOLS"

# 1. Download cloudflared if missing (macOS).
if [ ! -x "$CF" ]; then
  echo "Downloading cloudflared..."
  ARCH="$(uname -m)"
  if [ "$ARCH" = "arm64" ]; then PKG="cloudflared-darwin-arm64.tgz"; else PKG="cloudflared-darwin-amd64.tgz"; fi
  curl -fsSL -o "$TOOLS/cf.tgz" "https://github.com/cloudflare/cloudflared/releases/latest/download/$PKG"
  tar -xzf "$TOOLS/cf.tgz" -C "$TOOLS"
  rm -f "$TOOLS/cf.tgz"
  chmod +x "$CF"
fi

# 2. Build if needed.
if [ ! -f "$ROOT/apps/web/dist/web/browser/index.html" ]; then
  echo "Building web..."; npm --prefix "$ROOT/apps/web" run build
fi
if [ ! -f "$ROOT/apps/api/dist/main.js" ]; then
  echo "Building api..."; npm --prefix "$ROOT/apps/api" run build
fi

# 3. Start the API (serves the web UI) in the background.
echo "Starting API on :$PORT with production demo safeguards ..."
( cd "$ROOT" && npm run start:demo ) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

# Wait for the server to answer.
READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "API did not pass the health check; aborting public tunnel." >&2
  exit 1
fi

# 4. Open the public HTTPS tunnel (prints a https://*.trycloudflare.com URL).
echo "Opening public HTTPS tunnel..."
exec "$CF" tunnel --no-autoupdate --url "http://localhost:$PORT"
