#!/usr/bin/env bash
# RayLaw 単一コンテナ起動: (任意) migrate → (任意) seed → worker + api を同一コンテナで起動。
# どちらかのプロセスが終了したらコンテナも終了する（PaaS 側の再起動に任せる）。
set -euo pipefail
cd /app

export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-${PORT:-10000}}"
# Render は RENDER_EXTERNAL_URL（https://<service>.onrender.com）を注入する。未指定ならそれを公開 origin とみなす
export RAYLOW_PUBLIC_ORIGIN="${RAYLOW_PUBLIC_ORIGIN:-${RENDER_EXTERNAL_URL:-http://localhost:${API_PORT}}}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-${RAYLOW_PUBLIC_ORIGIN}}"
export WEB_DIST_DIR="${WEB_DIST_DIR:-/app/apps/web/dist}"
export DATABASE_URL_SERVICE="${DATABASE_URL_SERVICE:-${DATABASE_URL_APP:-}}"
export DATABASE_URL="${DATABASE_URL:-${DATABASE_URL_SERVICE}}"

if [ "${RAYLOW_MIGRATE_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] applying migrations"
  node scripts/db-migrate.mjs
fi
if [ "${RAYLOW_SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data (no-op if already seeded)"
  node apps/api/dist/seed/run.js
fi

node apps/worker/dist/index.js &
WORKER=$!
node apps/api/dist/index.js &
API=$!
stop_all() { kill -TERM "$WORKER" "$API" 2>/dev/null || true; }
trap stop_all TERM INT

set +e
wait -n "$WORKER" "$API"
code=$?
echo "[entrypoint] a child process exited (code=${code}); stopping the other"
stop_all
wait "$WORKER" "$API" 2>/dev/null
exit "$code"
