#!/usr/bin/env bash
#
# dev_tunnel.sh — expose the local backend to Kata's relay (DEV ONLY).
#
# Kata's servers relay content xAPI to PUBLIC_APP_URL/api/xapi/... . On localhost
# that address is unreachable from Kata, so statements never arrive, current_state
# never advances, and the coach is stuck on the first question. This opens a public
# Cloudflare tunnel to the local backend, points PUBLIC_APP_URL at it in backend/.env,
# and RESTORES the previous value when you stop it (Ctrl+C) — so you never leave a
# dead tunnel URL behind.
#
#   Usage:   bash scripts/dev_tunnel.sh
#            PORT=8720 bash scripts/dev_tunnel.sh   # override port (default 8720)
#
# After it prints the URL, RESTART the backend so it loads the new PUBLIC_APP_URL,
# then keep this terminal open while you test. Bug 1 (iframe restart on refresh) is
# Kata-side and is NOT fixed by this — this only makes statements reach the backend.
#
set -euo pipefail

PORT="${PORT:-8720}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BACKEND_DIR}/.env"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗ cloudflared not found. Install it:  brew install cloudflared" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ ${ENV_FILE} not found — copy env.template to .env first." >&2
  exit 1
fi

# Remember the current PUBLIC_APP_URL line so Ctrl+C can restore it exactly.
PREV_LINE="$(grep -E '^PUBLIC_APP_URL=' "$ENV_FILE" || true)"
LOG="$(mktemp)"
TUNNEL_PID=""

set_public_url() {  # $1 = full "PUBLIC_APP_URL=..." line
  if grep -qE '^PUBLIC_APP_URL=' "$ENV_FILE"; then
    sed -i.bak "s#^PUBLIC_APP_URL=.*#${1}#" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s\n' "$1" >> "$ENV_FILE"
  fi
}

cleanup() {
  if [ -n "$PREV_LINE" ]; then
    set_public_url "$PREV_LINE"
  else
    sed -i.bak '/^PUBLIC_APP_URL=/d' "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  fi
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$LOG"
  echo ""
  echo "↩︎  Restored PUBLIC_APP_URL in .env and stopped the tunnel. Restart the backend."
}
trap cleanup EXIT INT TERM

echo "▶ opening Cloudflare tunnel → http://localhost:${PORT} ..."
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >"$LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "✗ could not obtain a tunnel URL. cloudflared output:" >&2
  cat "$LOG" >&2
  exit 1
fi

set_public_url "PUBLIC_APP_URL=${URL}"
echo ""
echo "✓ PUBLIC_APP_URL=${URL}"
echo "  written to backend/.env"
echo ""
echo "  1) RESTART the backend now so it loads the new PUBLIC_APP_URL."
echo "  2) Do a lesson — statements now reach the backend; current_state advances."
echo "  3) Keep this terminal open. Ctrl+C stops the tunnel and restores .env."
echo ""
wait "$TUNNEL_PID"
