"""Ty-Code local voice transcription sidecar (faster-whisper, 100% offline).

Protocol (stdin/stdout, no files ever written to disk):
- The parent Node process writes one framed request per transcription:
    4-byte little-endian unsigned length, then that many bytes of raw
    PCM16 LE mono audio sampled at 16 kHz.
- The sidecar answers with exactly one JSON line per request:
    {"type":"result","text":...,"language":...,"durationSec":...,"segments":[...]}
  or {"type":"error","message":"..."}.
- On startup the Whisper model is loaded ONCE, then the sidecar prints
    {"type":"ready"}
  and keeps running until stdin closes.

Run as: python transcriber.py [model_dir]
(the bundled layout provides the model dir via argv; fallback assumes the
script sits next to a `models/tiny.en` folder).
"""

import json
import os
import re
import sys
from typing import Any, Dict

import numpy as np
from faster_whisper import WhisperModel

# Filler-word handling: strip "uh", "um", "ahm", "erm" (plus elongations such
# as "uhh"/"umm/uahmm"/"ermm") while preserving the punctuation that follows
# them so natural pauses keep their comma/period.
FILLER_PATTERN = re.compile(
    r"\b(?:u[h]+m*|u[m]+m*|ahm+|erm+)\b[ \t]*([,.]!?)?[ \t]*",
    re.IGNORECASE,
)

# Collapse whitespace around sentence punctuation so removing a filler never
# leaves artifacts and pauses stay formatted as periods/commas.
SPACE_BEFORE_PUNCTUATION = re.compile(r"\s+([,.!?;])")
MISSING_SPACE_AFTER_PUNCTUATION = re.compile(r"([,.!?;])(?=[A-Za-z])")
MULTIPLE_SPACES = re.compile(r"\s{2,}")
LEADING_BREAKS = re.compile(r"^[\s,.]+")

_SAMPLE_RATE = 16_000


def strip_filler_words(text: str) -> str:
    """Remove filler words and tidy the remaining punctuation/spacing."""
    if not text or not text.strip():
        return ""
    cleaned = FILLER_PATTERN.sub(lambda match: (match.group(1) + " ") if match.group(1) else "", text)
    cleaned = SPACE_BEFORE_PUNCTUATION.sub(r"\1", cleaned)
    cleaned = MISSING_SPACE_AFTER_PUNCTUATION.sub(r"\1 ", cleaned)
    cleaned = MULTIPLE_SPACES.sub(" ", cleaned)
    cleaned = LEADING_BREAKS.sub("", cleaned).strip()
    # Remove any trailing sentence separator that ended up dangling alone.
    cleaned = cleaned.strip(" ,")
    if not cleaned:
        return ""
    # Capitalize the first letter for a clean dictation result.
    cleaned = cleaned[0].upper() + cleaned[1:]
    # Make sure dictations end with a period so chat sends read naturally.
    if not cleaned.endswith((".", "!", "?", ";", ":")):
        cleaned += "."
    return cleaned


def read_exact(stream: Any, count: int) -> bytes | None:
    """Read exactly `count` bytes from a binary stream; None at clean EOF."""
    buffer = bytearray()
    while len(buffer) < count:
        chunk = stream.read(count - len(buffer))
        if not chunk:
            return None
        buffer.extend(chunk)
    return bytes(buffer)


def emit(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def transcribe_pcm(model: WhisperModel, pcm16le: bytes) -> Dict[str, Any]:
    audio = np.frombuffer(pcm16le, dtype="<i2").astype(np.float32) / 32768.0
    segments_iter, info = model.transcribe(
        audio,
        language="en",
        beam_size=1,
        vad_filter=True,
        word_timestamps=False,
    )
    segments = []
    raw_parts = []
    for segment in segments_iter:
        seg_text = segment.text.strip()
        if seg_text:
            segments.append(
                {"start": round(segment.start, 3), "end": round(segment.end, 3), "text": seg_text}
            )
            raw_parts.append(seg_text)
    cleaned = strip_filler_words(" ".join(raw_parts))
    return {
        "type": "result",
        "text": cleaned,
        "language": info.language,
        "durationSec": round(getattr(info, "duration", 0.0) or 0.0, 3),
        "segments": segments,
    }


def main() -> int:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(script_dir, "models", "tiny.en")

    try:
        model = WhisperModel(
            model_dir,
            device="cpu",
            compute_type="int8",
            local_files_only=True,
        )
    except Exception as exc:  # Startup failure: surface once, then exit.
        emit({"type": "error", "message": f"Failed to load Whisper model: {exc}"})
        return 1

    emit({"type": "ready"})

    stdin = sys.stdin.buffer
    while True:
        header = read_exact(stdin, 4)
        if header is None:
            break
        length = int.from_bytes(header, "little", signed=False)
        if length == 0:
            emit(
                {
                    "type": "result",
                    "text": "",
                    "language": "en",
                    "durationSec": 0.0,
                    "segments": [],
                }
            )
            continue
        payload = read_exact(stdin, length)
        if payload is None:
            break
        try:
            emit(transcribe_pcm(model, payload))
        except Exception as exc:
            emit({"type": "error", "message": f"Transcription failed: {exc}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
