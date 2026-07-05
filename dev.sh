#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

cleanup() {
  echo ""
  echo "Stopping dev servers..."
  jobs -p | xargs -r kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

if [[ ! -d "$FRONTEND_DIR" || ! -d "$BACKEND_DIR" ]]; then
  echo "Expected backend/ and frontend/ folders under: $ROOT_DIR"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but was not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  exit 1
fi

if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
  echo "Creating backend virtualenv..."
  (
    cd "$BACKEND_DIR"
    python3 -m venv .venv
  )
fi

echo "Ensuring backend dependencies are installed..."
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  pip install -r requirements.txt
)

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (
    cd "$FRONTEND_DIR"
    npm install
  )
fi

echo "Starting backend (uvicorn --reload on :8720)..."
(
  cd "$BACKEND_DIR"
  source .venv/bin/activate
  uvicorn server:app --host 0.0.0.0 --port 8720 --reload
) &

BACKEND_PID=$!

echo "Starting frontend (vite dev on :5173 with HMR)..."
(
  cd "$FRONTEND_DIR"
  npm run dev
) &

FRONTEND_PID=$!

echo ""
echo "Dev is up:"
echo "- Frontend: http://localhost:5173"
echo "- Backend:  http://localhost:8720"
echo ""
echo "Press Ctrl+C to stop both."

wait "$BACKEND_PID" "$FRONTEND_PID"
