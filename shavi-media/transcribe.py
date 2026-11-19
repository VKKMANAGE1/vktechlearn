#!/usr/bin/env python3
"""Speech-to-text for the SHAVI Media gateway.

Runs a real whisper model (faster-whisper / CTranslate2) on CPU and prints one JSON
line: {"text": ..., "language": ..., "duration": ...}. Called by gateway.mjs for every
/v1/audio/transcriptions request; no network calls except the one-time model download.
"""
import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--language", default=None)
    parser.add_argument("--model", default="small")
    parser.add_argument("--download-root", default=None)
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--beam-size", type=int, default=5)
    # A Devanagari prompt steers the decoder into Hindi script and punctuation;
    # it is generic text, not the expected transcript.
    parser.add_argument("--initial-prompt", default="यह हिंदी भाषा में बोली गई बातचीत है।")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type=args.compute_type,
        download_root=args.download_root,
    )
    segments, info = model.transcribe(
        args.file,
        language=args.language or None,
        beam_size=args.beam_size,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt=args.initial_prompt or None,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(
        json.dumps(
            {
                "text": text,
                "language": getattr(info, "language", None),
                "language_probability": round(float(getattr(info, "language_probability", 0.0)), 4),
                "duration": round(float(getattr(info, "duration", 0.0)), 3),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
