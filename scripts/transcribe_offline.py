#!/usr/bin/env python3
"""
Offline speech transcription via faster-whisper.

Invoked as a subprocess by LocalSpeechProvider so that model loading happens in
a separate process (whisper keeps the model in RAM and holds the GIL, which
would otherwise stall the Node event loop).

Reads a JSON request on stdin:
    {"audioPath": "...", "modelSize": "base", "language": "en" | null,
     "detectSpeakers": true}

Writes a JSON result on stdout:
    {"ok": true, "text": "...", "segments": [{"start": 0.0, "end": 2.4, "text": "..."}],
     "language": "en", "languageProbability": 0.98, "duration": 12.3, "model": "faster-whisper/base"}

On failure writes {"ok": false, "error": "...", "code": "..."} and exits 1.
Nothing is ever invented: if the audio contains no speech, `text` is empty and
the caller decides what to report.
"""

import json
import os
import sys
import traceback


def fail(message: str, code: str) -> None:
    json.dump({"ok": False, "error": message, "code": code}, sys.stdout)
    sys.stdout.flush()
    sys.exit(1)


def main() -> None:
    try:
        request = json.load(sys.stdin)
    except Exception:
        fail("The transcription request was not valid JSON.", "BAD_REQUEST")

    audio_path = request.get("audioPath")
    if not audio_path or not os.path.exists(audio_path):
        fail("The audio file to transcribe does not exist.", "AUDIO_MISSING")

    model_size = request.get("modelSize") or os.environ.get("RARE_WHISPER_MODEL", "base")
    language = request.get("language")
    # CPU int8 is the only universally available path; it is roughly real-time
    # on a modern core, which is adequate for a background transcription job.
    compute_type = os.environ.get("RARE_WHISPER_COMPUTE_TYPE", "int8")
    device = os.environ.get("RARE_WHISPER_DEVICE", "cpu")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail(
            "faster-whisper is not installed, so offline transcription is unavailable.",
            "PROVIDER_MISSING",
        )

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
    except Exception as error:
        fail(f"The speech model could not be loaded: {error}", "MODEL_LOAD_FAILED")

    try:
        # word_timestamps gives per-word timing, which is what lets the caller
        # place a sentence on the clock rather than guessing.
        segments_iter, info = model.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            word_timestamps=True,
        )
        segments = []
        pieces = []
        for segment in segments_iter:
            text = (segment.text or "").strip()
            if not text:
                continue
            segments.append(
                {
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": text,
                }
            )
            pieces.append(text)
    except Exception as error:
        fail(
            f"The audio could not be transcribed: {error}",
            "TRANSCRIBE_FAILED",
        )

    json.dump(
        {
            "ok": True,
            "text": " ".join(pieces).strip(),
            "segments": segments,
            "language": getattr(info, "language", language),
            "languageProbability": round(float(getattr(info, "language_probability", 0.0)), 4),
            "duration": round(float(getattr(info, "duration", 0.0)), 3),
            "model": f"faster-whisper/{model_size}",
            "segmentCount": len(segments),
        },
        sys.stdout,
    )
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc(file=sys.stderr)
        fail("Unexpected transcription failure.", "UNEXPECTED")
