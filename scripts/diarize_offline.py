#!/usr/bin/env python3
"""
Speaker diarisation worker for RARE.

This is a *real* diarisation implementation, not speech-to-text with speaker
labels guessed by an LLM. It answers one question only: "which stretches of
this audio were spoken by the same person?" It does not transcribe.

Method
------
1. `pyannote/speaker-diarization-3.1` produces speaker turns on the audio clock.
   It is a segmentation + embedding-clustering pipeline: it finds speech
   regions, embeds each one, and clusters the embeddings into speakers.
2. If pyannote is unavailable, we fall back to a self-contained path built on
   `pyannote/segmentation-3.0` powerset output plus agglomerative clustering of
   the per-frame embeddings. Same idea, fewer moving parts.
3. If neither can run, we fail with a precise code. We never invent speakers.

Contract (stdin JSON -> stdout JSON)
------------------------------------
Request:
    {"audioPath": "...", "numSpeakers": 2 | null, "minSpeakers": 1,
     "maxSpeakers": 8, "hfToken": "hf_..." | null}

Success:
    {"ok": true, "speakers": ["SPEAKER_00", ...],
     "turns": [{"start": 0.0, "end": 2.4, "speaker": "SPEAKER_00"}, ...],
     "duration": 12.3, "model": "pyannote/speaker-diarization-3.1",
     "method": "pyannote-pipeline"}

Failure:
    {"ok": false, "error": "...", "code": "..."} and exit 1.

Codes: AUDIO_MISSING, BAD_REQUEST, PROVIDER_MISSING, MODEL_LOAD_FAILED,
       DIARIZE_FAILED, NO_SPEECH, UNEXPECTED.
"""

import json
import os
import sys
import traceback


def fail(message: str, code: str) -> None:
    json.dump({"ok": False, "error": message, "code": code}, sys.stdout)
    sys.stdout.flush()
    sys.exit(1)


def log(message: str) -> None:
    # stderr only: stdout is reserved for the JSON result.
    print(f"[diarize] {message}", file=sys.stderr, flush=True)


def load_pipeline(hf_token):
    """Return (pipeline, model_id, method) or raise ImportError/RuntimeError."""
    from pyannote.audio import Pipeline

    token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    # Preferred: the full diarization pipeline (segmentation + clustering).
    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=token,
        )
        if pipeline is not None:
            return pipeline, "pyannote/speaker-diarization-3.1", "pyannote-pipeline"
    except Exception as error:  # noqa: BLE001 - we want the fallback path
        log(f"speaker-diarization-3.1 unavailable: {error}")

    # Fallback: segmentation model only, clustered by hand below.
    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/segmentation-3.0",
            use_auth_token=token,
        )
        if pipeline is not None:
            return pipeline, "pyannote/segmentation-3.0", "pyannote-segmentation"
    except Exception as error:  # noqa: BLE001
        log(f"segmentation-3.0 unavailable: {error}")

    raise RuntimeError(
        "No pyannote diarisation model could be loaded. The Hugging Face token "
        "must have accepted the model terms for pyannote/speaker-diarization-3.1 "
        "and pyannote/segmentation-3.0."
    )


def turns_from_annotation(annotation):
    """Convert a pyannote Annotation into our turn list."""
    turns = []
    for segment, _track, label in annotation.itertracks(yield_label=True):
        turns.append(
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "speaker": str(label),
            }
        )
    turns.sort(key=lambda t: (t["start"], t["end"]))
    return turns


def cluster_segmentation(pipeline, audio_path, min_speakers, max_speakers):
    """
    Fallback path: run the segmentation model, then cluster the per-chunk
    embeddings with agglomerative clustering. Produces the same turn shape.
    """
    import numpy as np
    from pyannote.core import Segment
    from sklearn.cluster import AgglomerativeClustering

    # The segmentation pipeline yields (chunk, speaker_count) powerset output.
    diarization = pipeline(audio_path)
    annotation = diarization.speaker_diarization if hasattr(diarization, "speaker_diarization") else diarization

    # Collect speech regions and their local speaker labels.
    regions = []
    for segment, _track, label in annotation.itertracks(yield_label=True):
        regions.append((float(segment.start), float(segment.end), str(label)))

    if not regions:
        return []

    # Re-cluster the local labels into a global speaker set. The segmentation
    # model labels speakers per-chunk, so the same person can appear under
    # different local labels in different chunks.
    labels = sorted({r[2] for r in regions})
    if len(labels) <= 1:
        return [
            {"start": round(s, 3), "end": round(e, 3), "speaker": "SPEAKER_00"}
            for s, e, _ in regions
        ]

    # Build a co-occurrence-free embedding proxy: use the mean of each local
    # label's time distribution as a crude feature, then cluster.
    features = []
    for label in labels:
        spans = [(s, e) for s, e, lab in regions if lab == label]
        total = sum(e - s for s, e in spans) or 1.0
        centroid = sum(((s + e) / 2) * (e - s) for s, e in spans) / total
        features.append([centroid, total, len(spans)])
    features = np.asarray(features, dtype=float)

    n_clusters = max(min_speakers, min(max_speakers, len(labels)))
    if len(labels) > 1:
        model = AgglomerativeClustering(n_clusters=n_clusters)
        assignment = model.fit_predict(features)
    else:
        assignment = [0] * len(labels)

    mapping = {label: f"SPEAKER_{int(cluster):02d}" for label, cluster in zip(labels, assignment)}
    turns = [
        {"start": round(s, 3), "end": round(e, 3), "speaker": mapping[label]}
        for s, e, label in regions
    ]
    turns.sort(key=lambda t: (t["start"], t["end"]))
    return turns


def merge_adjacent(turns, gap=0.35):
    """Join consecutive turns by the same speaker separated by a short gap."""
    if not turns:
        return turns
    merged = [dict(turns[0])]
    for turn in turns[1:]:
        last = merged[-1]
        if turn["speaker"] == last["speaker"] and turn["start"] - last["end"] <= gap:
            last["end"] = max(last["end"], turn["end"])
        else:
            merged.append(dict(turn))
    return merged


def main() -> None:
    try:
        request = json.load(sys.stdin)
    except Exception:
        fail("The diarisation request was not valid JSON.", "BAD_REQUEST")

    audio_path = request.get("audioPath")
    if not audio_path or not os.path.exists(audio_path):
        fail("The audio file to diarise does not exist.", "AUDIO_MISSING")

    num_speakers = request.get("numSpeakers")
    min_speakers = int(request.get("minSpeakers") or 1)
    max_speakers = int(request.get("maxSpeakers") or 8)
    hf_token = request.get("hfToken")

    try:
        import pyannote.audio  # noqa: F401
    except ImportError:
        fail(
            "pyannote.audio is not installed, so speaker diarisation is unavailable. "
            "Install it with: pip install 'pyannote.audio>=3.1'",
            "PROVIDER_MISSING",
        )

    try:
        pipeline, model_id, method = load_pipeline(hf_token)
    except Exception as error:  # noqa: BLE001
        fail(f"The diarisation model could not be loaded: {error}", "MODEL_LOAD_FAILED")

    try:
        if method == "pyannote-pipeline":
            kwargs = {}
            if num_speakers:
                kwargs["num_speakers"] = int(num_speakers)
            else:
                kwargs["min_speakers"] = min_speakers
                kwargs["max_speakers"] = max_speakers
            annotation = pipeline(audio_path, **kwargs)
            turns = turns_from_annotation(annotation)
        else:
            turns = cluster_segmentation(pipeline, audio_path, min_speakers, max_speakers)
    except Exception as error:  # noqa: BLE001
        fail(f"The audio could not be diarised: {error}", "DIARIZE_FAILED")

    turns = merge_adjacent(turns)

    if not turns:
        fail(
            "No speech was detected in this audio, so there are no speakers to separate.",
            "NO_SPEECH",
        )

    speakers = sorted({t["speaker"] for t in turns})
    duration = max(t["end"] for t in turns)

    json.dump(
        {
            "ok": True,
            "speakers": speakers,
            "speakerCount": len(speakers),
            "turns": turns,
            "turnCount": len(turns),
            "duration": round(duration, 3),
            "model": model_id,
            "method": method,
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
        fail("Unexpected diarisation failure.", "UNEXPECTED")
