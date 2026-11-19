#!/usr/bin/env bash
# Starts the SHAVI Media gateway (OpenAI-compatible images + speech) on 127.0.0.1:4123.
#
#   bash shavi-media/start-gateway.sh          # foreground
#   bash shavi-media/start-gateway.sh --bg     # background, logs to /tmp/shavi-media.log
#
# Image generation uses the NVIDIA key from ai-key.txt (never written to config);
# speech runs locally through Piper / faster-whisper in shavi-media/runtime.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
export SHAVI_MEDIA_PORT="${SHAVI_MEDIA_PORT:-4123}"
export SHAVI_MEDIA_RUNTIME="${SHAVI_MEDIA_RUNTIME:-$ROOT/shavi-media/runtime}"
export SHAVI_MEDIA_STT_MODEL="${SHAVI_MEDIA_STT_MODEL:-small}"

if [ -z "$SHAVI_AI_KEY" ]; then
  echo "!! no NVIDIA key: image generation will report itself as not configured" >&2
else
  echo "  SHAVI_AI_KEY: set (${#SHAVI_AI_KEY} chars)"
fi
echo "  runtime: $SHAVI_MEDIA_RUNTIME"
echo "  port: $SHAVI_MEDIA_PORT"

if [ "${1:-}" = "--bg" ]; then
  nohup node "$ROOT/shavi-media/gateway.mjs" > /tmp/shavi-media.log 2>&1 &
  echo "started in background, pid $! — log: /tmp/shavi-media.log"
else
  exec node "$ROOT/shavi-media/gateway.mjs"
fi
