#!/usr/bin/env bash
# Downloads the local speech engines used by the SHAVI Media gateway.
#
#   bash shavi-media/setup-speech.sh            # piper + voices + whisper venv
#   bash shavi-media/setup-speech.sh --models   # also pre-download the whisper model
#
# Everything lands in shavi-media/runtime/ (gitignored): no GPU, no Docker, no API key.
# Image generation needs no runtime — it calls NVIDIA's hosted FLUX endpoint.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA="$ROOT/shavi-media"
RT="$MEDIA/runtime"
PIPER_VERSION="2023.11.14-2"
VOICES=(
  "hi/hi_IN/pratham/medium/hi_IN-pratham-medium"
  "en/en_US/lessac/medium/en_US-lessac-medium"
)
WHISPER_MODEL="${SHAVI_MEDIA_STT_MODEL:-small}"

mkdir -p "$RT/bin" "$RT/models" "$RT/hf/models"

if [ ! -x "$RT/bin/piper/piper" ]; then
  echo "==> piper $PIPER_VERSION"
  curl -fsSL -o "$RT/bin/piper.tgz" \
    "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz"
  tar xzf "$RT/bin/piper.tgz" -C "$RT/bin"
  rm -f "$RT/bin/piper.tgz"
else
  echo "==> piper already installed"
fi

for voice in "${VOICES[@]}"; do
  name="$(basename "$voice")"
  if [ ! -s "$RT/models/${name}.onnx" ]; then
    echo "==> voice ${name}"
    curl -fsSL -o "$RT/models/${name}.onnx" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice}.onnx"
    curl -fsSL -o "$RT/models/${name}.onnx.json" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice}.onnx.json"
  else
    echo "==> voice ${name} already present"
  fi
done

if [ ! -x "$RT/venv/bin/python" ]; then
  echo "==> python venv + faster-whisper"
  python3 -m venv "$RT/venv"
  # faster-whisper pins an old PyAV API; av>=16 breaks its decoder.
  "$RT/venv/bin/pip" install --quiet --upgrade pip
  "$RT/venv/bin/pip" install --quiet faster-whisper "av<16"
else
  echo "==> venv already present"
fi

if [ "${1:-}" = "--models" ]; then
  echo "==> whisper model ${WHISPER_MODEL}"
  "$RT/venv/bin/python" - "$WHISPER_MODEL" "$RT/hf/models" <<'PY'
import sys
from faster_whisper import WhisperModel
WhisperModel(sys.argv[1], device="cpu", compute_type="int8", download_root=sys.argv[2])
print("model ready")
PY
fi

cat <<MSG

==> speech runtime ready in shavi-media/runtime

Start the gateway (needs SHAVI_AI_KEY from ai-key.txt for image generation):
  bash shavi-media/start-gateway.sh --bg

First /v1/audio/transcriptions request downloads the whisper ${WHISPER_MODEL} model
(~460 MB) into shavi-media/runtime/hf/models — run with --models to do it now.
MSG
