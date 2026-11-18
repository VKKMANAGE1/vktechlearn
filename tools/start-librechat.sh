#!/usr/bin/env bash
# Starts the LibreChat (SHAVI AI) backend with provider keys loaded from the
# untracked key files in the repo root. Keys never live in git or in
# librechat.yaml — only in the environment of this process.
#
#   tools/start-librechat.sh          # foreground
#   tools/start-librechat.sh --bg     # background, logs to /tmp/shavi-librechat.log
#
# Key files (paste the key, nothing else):
#   ai-key.txt        NVIDIA NIM      -> SHAVI_AI_KEY
#   openai-key.txt    OpenAI          -> OPENAI_API_KEY
#   deepseek-key.txt  DeepSeek        -> DEEPSEEK_API_KEY
#   gemini-key.txt    Google Gemini   -> GOOGLE_KEY
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
openai="$(read_key openai-key.txt)"
deepseek="$(read_key deepseek-key.txt)"
gemini="$(read_key gemini-key.txt)"

cd "$ROOT/librechat"

if [ ! -d node_modules ]; then
  echo "!! librechat/node_modules missing — run: bash tools/setup-librechat.sh" >&2
  exit 1
fi

export SHAVI_AI_KEY="${SHAVI_AI_KEY:-$nvidia}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-$openai}"
export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-$deepseek}"
export GOOGLE_KEY="${GOOGLE_KEY:-$gemini}"

# OCR (M07): scanned PDFs / images are transcribed by the same NVIDIA account.
# Model + limits are overridable from the environment; no extra key file is needed.
export SHAVI_OCR_API_KEY="${SHAVI_OCR_API_KEY:-$nvidia}"
export SHAVI_OCR_BASE_URL="${SHAVI_OCR_BASE_URL:-https://integrate.api.nvidia.com/v1}"
export SHAVI_OCR_MODEL="${SHAVI_OCR_MODEL:-nvidia/nemotron-3.5-super-vl-120b-a12b}"
export SHAVI_OCR_MAX_PAGES="${SHAVI_OCR_MAX_PAGES:-12}"

for pair in "SHAVI_AI_KEY:$SHAVI_AI_KEY" "OPENAI_API_KEY:$OPENAI_API_KEY" "DEEPSEEK_API_KEY:$DEEPSEEK_API_KEY" "GOOGLE_KEY:$GOOGLE_KEY" "SHAVI_OCR_API_KEY:$SHAVI_OCR_API_KEY"; do
  name="${pair%%:*}"; value="${pair#*:}"
  if [ -n "$value" ]; then echo "  $name: set (${#value} chars)"; else echo "  $name: NOT set"; fi
done

if [ "${1:-}" = "--bg" ]; then
  nohup npm run backend > /tmp/shavi-librechat.log 2>&1 &
  echo "started in background, pid $! — log: /tmp/shavi-librechat.log"
else
  exec npm run backend
fi
