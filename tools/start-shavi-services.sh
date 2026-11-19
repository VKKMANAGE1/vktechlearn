#!/usr/bin/env bash
# Starts the two local services M10 needs and LibreChat talks to over loopback:
#
#   shavi-rag  :4125   LibreChat-compatible retrieval API (file_search)
#                      embeddings -> NVIDIA nvidia/nemotron-3.5-embed-1b
#   shavi-code :4126   LibreChat Code Interpreter API (execute_code)
#                      runs each call in a namespaced, chrooted, network-less sandbox
#
# Both bind 127.0.0.1 only. The only secrets they receive are the ones they need:
# SHAVI_AI_KEY (embeddings) for RAG, and JWT_SECRET (token verification) for RAG.
# The code interpreter gets no secrets at all — its sandbox has an empty environment.
#
#   bash tools/start-shavi-services.sh          # start (idempotent)
#   bash tools/start-shavi-services.sh stop     # stop the two services by pid file
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="/tmp/shavi-services"
mkdir -p "$PID_DIR"

stop_service() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  [ -f "$pidfile" ] || return 0
  local pid
  pid="$(cat "$pidfile")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
}

if [ "${1:-}" = "stop" ]; then
  stop_service shavi-rag
  stop_service shavi-code
  exit 0
fi

read_key() {
  local file="$ROOT/$1"
  [ -f "$file" ] || return 0
  local value
  value="$(tr -d '\r\n' < "$file")"
  case "$value" in "" | PASTE_YOUR_KEY_HERE) return 0 ;; esac
  printf '%s' "$value"
}

nvidia="$(read_key ai-key.txt)"
export SHAVI_AI_KEY="${SHAVI_AI_KEY:-$nvidia}"

# LibreChat signs the short-lived RAG token with the same secret it loads from .env;
# the RAG service verifies that signature instead of trusting a user id on the wire.
if [ -z "${JWT_SECRET:-}" ] && [ -f "$ROOT/librechat/.env" ]; then
  JWT_SECRET="$(grep -E '^JWT_SECRET=' "$ROOT/librechat/.env" | tail -1 | cut -d= -f2-)"
  export JWT_SECRET
fi

start_service() {
  local name="$1" port="$2" script="$3" log="/tmp/$1.log"
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pidfile"))"
    return 0
  fi
  nohup node "$script" > "$log" 2>&1 &
  echo $! > "$pidfile"
  echo "started $name on :$port (pid $!) — log: $log"
}

start_service shavi-rag 4125 "$ROOT/shavi-rag/service.mjs"
start_service shavi-code 4126 "$ROOT/shavi-code/service.mjs"

for port in 4125 4126; do
  for _ in $(seq 1 40); do
    if curl -fsS -m 2 "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
      echo "  :$port healthy"
      break
    fi
    sleep 0.25
  done
done
