#!/usr/bin/env bash
# Starts the SHAVI YouTube Studio (M13) — the eleven youtube-agent-skill skills, their six
# Python tools, and voice.md, on top of this stack's own NVIDIA model.
#
#   tools/start-shavi-youtube.sh          # foreground
#   tools/start-shavi-youtube.sh --bg     # background, logs to /tmp/shavi-youtube.log
#   SHAVI_YOUTUBE_PORT=3000 bash tools/start-shavi-youtube.sh --bg   # preview port
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

export SHAVI_YOUTUBE_PORT="${SHAVI_YOUTUBE_PORT:-4128}"
export SHAVI_YOUTUBE_HOST="${SHAVI_YOUTUBE_HOST:-0.0.0.0}"
export SHAVI_AI_KEY="${SHAVI_AI_KEY:-$(read_key ai-key.txt)}"

echo "  studio : http://127.0.0.1:${SHAVI_YOUTUBE_PORT}"
echo "  model  : ${SHAVI_YOUTUBE_MODEL:-nvidia/nemotron-3-ultra-550b-a55b}"
echo "  skills : $(ls -d "$ROOT"/shavi-youtube/skills/yt-* | wc -l) · python3 $(python3 --version 2>&1 | awk '{print $2}')"
[ -n "$SHAVI_AI_KEY" ] || echo "  !! SHAVI_AI_KEY missing — tools work, model calls will fail" >&2

cd "$ROOT/shavi-youtube"
if [ "${1:-}" = "--bg" ]; then
  nohup node service.mjs > /tmp/shavi-youtube.log 2>&1 &
  echo "started in background, pid $! — log: /tmp/shavi-youtube.log"
else
  exec node service.mjs
fi
