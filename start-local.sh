#!/usr/bin/env bash
# One-command local arena: sim + board + web. Prefers Docker Compose;
# falls back to native processes (Python + PHP + Node) on this machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi

SIM_PORT="${SIM_PORT:-8000}"
BOARD_PORT="${BOARD_PORT:-8001}"
WEB_PORT="${WEB_PORT:-3000}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "starting with Docker Compose (sim :${SIM_PORT}, board :${BOARD_PORT}, web :${WEB_PORT})"
  if [ ! -d server/vendor ] && command -v composer >/dev/null 2>&1; then
    echo "installing board dependencies..."
    (cd server && composer install --no-interaction --no-progress)
  fi
  exec docker compose up --build
fi

echo "docker not found; starting native processes (Ctrl-C stops all)"
need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing $1 (needed for native start)" >&2
    exit 1
  }
}
need python3
need php
need node
need npm

if [ ! -x .venv/bin/python ]; then
  echo "creating .venv..."
  python3 -m venv .venv
fi
if ! .venv/bin/python -c "import fastapi" 2>/dev/null; then
  echo "installing sim api extra..."
  .venv/bin/python -m pip install -q -e "app/sim/.[api]"
fi
if [ ! -d server/vendor ]; then
  need composer
  echo "installing board dependencies..."
  (cd server && composer install --no-interaction --no-progress)
fi
if [ ! -d web/node_modules ]; then
  echo "installing web dependencies..."
  (cd web && npm ci --no-audit --no-fund)
fi

(cd server && touch database/database.sqlite && php artisan migrate --force)

export SIM_API_URL="${SIM_API_URL:-http://localhost:${SIM_PORT}}"
export LARAVEL_URL="${LARAVEL_URL:-http://localhost:${BOARD_PORT}}"
export PORT="$WEB_PORT"

cleanup() {
  jobs -p | xargs kill 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "sim   http://localhost:${SIM_PORT}"
./.venv/bin/python -m uvicorn aim_sim.api:create_app --factory --port "$SIM_PORT" --app-dir app/sim/src &
echo "board http://localhost:${BOARD_PORT}"
(cd server && exec php artisan serve --port="$BOARD_PORT" >/tmp/aim-board.log 2>&1) &
echo "web   http://localhost:${WEB_PORT}  (open this in a browser)"
(cd web && exec npm run dev -- --port "$WEB_PORT" >/tmp/aim-web.log 2>&1) &
wait
