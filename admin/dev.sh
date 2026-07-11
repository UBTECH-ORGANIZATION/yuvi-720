#!/usr/bin/env bash
set -euo pipefail

ADMIN_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ADMIN_DIR/frontend"
VENV_DIR="$ADMIN_DIR/.venv"
ADMIN_PORT="${ADMIN_PORT:-9998}"

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  npm --prefix "$FRONTEND_DIR" install
fi
npm --prefix "$FRONTEND_DIR" run build

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/python" -m pip install -r "$ADMIN_DIR/requirements.txt"

cd "$ADMIN_DIR"
exec "$VENV_DIR/bin/python" -m uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port "$ADMIN_PORT" \
  --reload
