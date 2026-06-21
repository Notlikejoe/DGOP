#!/usr/bin/env bash
# Run Prisma commands with the root .env loaded.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a

cd "$ROOT/apps/api"

case "${1:-}" in
  generate) npx prisma generate ;;
  migrate)  npx prisma migrate dev --name "${2:-update}" ;;
  deploy)   npx prisma migrate deploy ;;
  seed)     npm run seed ;;
  *) echo "usage: db.sh {generate|migrate [name]|deploy|seed}"; exit 1 ;;
esac
