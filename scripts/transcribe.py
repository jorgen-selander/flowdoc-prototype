#!/usr/bin/env python3
"""
FlowDoc transcription worker.

Long-lived process. Loads KBLab/kb-whisper-large once, then reads one
audio file path per line on stdin and writes one JSON line per result
on stdout.

Stdout protocol:
  {"ready": true}                           -- model loaded, ready for input
  {"path": "...", "text": "..."}            -- transcription succeeded
  {"path": "...", "error": "..."}           -- transcription failed
"""

import json
import sys


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    try:
        from transformers import pipeline  # type: ignore
    except ImportError as exc:
        emit({"error": f"missing python dependency: {exc}. Run `pip install -r requirements.txt`."})
        return 1

    try:
        pipe = pipeline(
            "automatic-speech-recognition",
            model="KBLab/kb-whisper-large",
            chunk_length_s=30,
        )
    except Exception as exc:  # pylint: disable=broad-except
        emit({"error": f"model load failed: {exc}"})
        return 1

    emit({"ready": True})

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            result = pipe(path, generate_kwargs={"language": "sv", "task": "transcribe"})
            text = (result.get("text") or "").strip()
            emit({"path": path, "text": text})
        except Exception as exc:  # pylint: disable=broad-except
            emit({"path": path, "error": str(exc)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
