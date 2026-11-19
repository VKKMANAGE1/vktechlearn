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

# Media (M09): the image_gen_oai agent tool and the OpenAI speech providers all talk to
# the local SHAVI Media gateway, which fans out to NVIDIA FLUX (images) and to the
# local Piper / faster-whisper engines (voice). The gateway URL is not a secret; the
# placeholder key only satisfies the tool's env check — the gateway ignores it.
export SHAVI_MEDIA_KEY="${SHAVI_MEDIA_KEY:-shavi-media-local}"
export IMAGE_GEN_OAI_API_KEY="${IMAGE_GEN_OAI_API_KEY:-$SHAVI_MEDIA_KEY}"
export IMAGE_GEN_OAI_BASEURL="${IMAGE_GEN_OAI_BASEURL:-http://127.0.0.1:4123/v1/}"
export IMAGE_GEN_OAI_MODEL="${IMAGE_GEN_OAI_MODEL:-flux.1-dev}"

# Retrieval + code interpreter (M10): both are local services started by
# tools/start-shavi-services.sh. file_search stays hidden until RAG_API_URL answers,
# and execute_code stays hidden until LIBRECHAT_CODE_BASEURL answers, so these two
# URLs are what expose those agent tools at all.
export RAG_API_URL="${RAG_API_URL:-http://127.0.0.1:4125}"
export LIBRECHAT_CODE_BASEURL="${LIBRECHAT_CODE_BASEURL:-http://127.0.0.1:4126}"
export LIBRECHAT_CODE_API_KEY="${LIBRECHAT_CODE_API_KEY:-shavi-code-local}"

# Security (M11): LibreChat ships message rate limiting *disabled* unless LIMIT_MESSAGE_*
# is set, so a single account could otherwise send unlimited chat requests. Enabling it
# here means the limits are enforced by the API (express-rate-limit, per user and per IP)
# and reported by the admin panel at /api/panel/limits.
export LIMIT_MESSAGE_USER="${LIMIT_MESSAGE_USER:-true}"
export LIMIT_MESSAGE_IP="${LIMIT_MESSAGE_IP:-true}"
export MESSAGE_USER_MAX="${MESSAGE_USER_MAX:-40}"
export MESSAGE_USER_WINDOW="${MESSAGE_USER_WINDOW:-1}"
export MESSAGE_IP_MAX="${MESSAGE_IP_MAX:-60}"
export MESSAGE_IP_WINDOW="${MESSAGE_IP_WINDOW:-1}"

for pair in "SHAVI_AI_KEY:$SHAVI_AI_KEY" "OPENAI_API_KEY:$OPENAI_API_KEY" "DEEPSEEK_API_KEY:$DEEPSEEK_API_KEY" "GOOGLE_KEY:$GOOGLE_KEY" "SHAVI_OCR_API_KEY:$SHAVI_OCR_API_KEY" "IMAGE_GEN_OAI_BASEURL:$IMAGE_GEN_OAI_BASEURL" "RAG_API_URL:$RAG_API_URL" "LIBRECHAT_CODE_BASEURL:$LIBRECHAT_CODE_BASEURL"; do
  name="${pair%%:*}"; value="${pair#*:}"
  if [ -n "$value" ]; then echo "  $name: set (${#value} chars)"; else echo "  $name: NOT set"; fi
done
echo "  LIMIT_MESSAGE_USER: $LIMIT_MESSAGE_USER ($MESSAGE_USER_MAX/${MESSAGE_USER_WINDOW}min per user, $MESSAGE_IP_MAX/${MESSAGE_IP_WINDOW}min per IP)"

if [ "${1:-}" = "--bg" ]; then
  nohup npm run backend > /tmp/shavi-librechat.log 2>&1 &
  echo "started in background, pid $! — log: /tmp/shavi-librechat.log"
else
  exec npm run backend
fi
