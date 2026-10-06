#!/usr/bin/env bash
# 開発用: API と worker を再起動（ログは .data/logs）。本番では使わない。
set -u
cd "$(dirname "$0")/.."
mkdir -p .data/logs
pkill -f "tsx apps/api/src/index.ts" 2>/dev/null || true
pkill -f "tsx apps/worker/src/index.ts" 2>/dev/null || true
sleep 1
setsid nohup npx tsx apps/api/src/index.ts > .data/logs/api.log 2>&1 < /dev/null &
setsid nohup npx tsx apps/worker/src/index.ts > .data/logs/worker.log 2>&1 < /dev/null &
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then echo "api up"; break; fi
  sleep 1
done
sleep 2
grep -c "worker started" .data/logs/worker.log >/dev/null && echo "worker up"
