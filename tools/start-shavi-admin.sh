#!/usr/bin/env bash
# Starts the SHAVI admin panel gateway (M11) — the admin UI plus usage/cost/privacy API.
#
# The panel reads the *same* rate-limit variables the LibreChat backend is started with
# (tools/start-librechat.sh), so the numbers shown in the panel are the numbers the API
# enforces. Nothing here is a secret; the panel authenticates with LibreChat JWTs.
#
#   tools/start-shavi-admin.sh          # foreground
#   tools/start-shavi-admin.sh --bg     # background, logs to /tmp/shavi-admin.log
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export SHAVI_ADMIN_PORT="${SHAVI_ADMIN_PORT:-4127}"
export SHAVI_LIBRECHAT_URL="${SHAVI_LIBRECHAT_URL:-http://127.0.0.1:3080}"
export MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/LibreChat}"

export LIMIT_MESSAGE_USER="${LIMIT_MESSAGE_USER:-true}"
export LIMIT_MESSAGE_IP="${LIMIT_MESSAGE_IP:-true}"
export MESSAGE_USER_MAX="${MESSAGE_USER_MAX:-40}"
export MESSAGE_USER_WINDOW="${MESSAGE_USER_WINDOW:-1}"
export MESSAGE_IP_MAX="${MESSAGE_IP_MAX:-60}"
export MESSAGE_IP_WINDOW="${MESSAGE_IP_WINDOW:-1}"
export LOGIN_MAX="${LOGIN_MAX:-7}"
export LOGIN_WINDOW="${LOGIN_WINDOW:-5}"
export REGISTER_MAX="${REGISTER_MAX:-7}"
export REGISTER_WINDOW="${REGISTER_WINDOW:-5}"
export TOOL_CALL_USER_MAX="${TOOL_CALL_USER_MAX:-30}"
export TOOL_CALL_USER_WINDOW="${TOOL_CALL_USER_WINDOW:-3}"

echo "  admin panel : http://127.0.0.1:${SHAVI_ADMIN_PORT}"
echo "  LibreChat   : ${SHAVI_LIBRECHAT_URL}"
echo "  Mongo       : ${MONGO_URI}"
echo "  limits      : ${LIMIT_MESSAGE_USER} (user ${MESSAGE_USER_MAX}/${MESSAGE_USER_WINDOW}min, ip ${MESSAGE_IP_MAX}/${MESSAGE_IP_WINDOW}min)"

cd "$ROOT/shavi-admin"
[ -d node_modules ] || npm install --no-audit --no-fund

if [ "${1:-}" = "--bg" ]; then
  nohup node service.mjs > /tmp/shavi-admin.log 2>&1 &
  echo "started in background, pid $! — log: /tmp/shavi-admin.log"
else
  exec node service.mjs
fi
