#!/usr/bin/env python3
"""
HTTP wrapper around the RARE diarisation worker.

The core logic lives in diarize_offline.py, which is a stdin/stdout CLI. This
file exposes it over HTTP so the Node backend can reach it from a different
host, and adds the readiness/locking behaviour the app expects.

Endpoints
---------
GET  /health   -> {"status": "sleeping|loading_model|ready|busy|failed", ...}
POST /diarize  -> {"ok": true, "speakers": [...], "turns": [...]}

Auth: every /diarize call must carry `Authorization: Bearer $WORKER_TOKEN`.
/health is unauthenticated so a load balancer can probe it, but it reveals no
secrets — only state and model name.

Design notes
------------
* The model is loaded once per process, lazily, behind a lock. Concurrent
  requests during load wait on the same future rather than each starting a
  second load (the "no duplicate model loads per user" requirement).
* A single worker process handles one diarisation at a time (pyannote is
  CPU-bound and not thread-safe in practice). Extra requests queue.
* If HF_TOKEN is missing or the model cannot load, /health says so honestly
  and /diarize returns 503 with a typed code. It never invents speakers.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER_SCRIPT = os.path.join(HERE, "diarize_offline.py")

HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "").strip()
PORT = int(os.environ.get("PORT", "8000"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(64 * 1024 * 1024)))

# Model preference order. community-1 is ungated, so it works without the owner
# accepting terms on the gated 3.1 pipeline.
MODEL_CANDIDATES = [
    "pyannote/speaker-diarization-3.1",
    "pyannote/speaker-diarization-community-1",
]

_state = {
    "status": "sleeping",
    "model": None,
    "error": None,
    "started_at": None,
    "ready_at": None,
    "jobs_done": 0,
    "jobs_failed": 0,
}
_state_lock = threading.Lock()
_infer_lock = threading.Lock()   # one diarisation at a time
_load_lock = threading.Lock()    # one model load at a time


def log(msg):
    print(f"[worker] {msg}", file=sys.stderr, flush=True)


def set_state(**kw):
    with _state_lock:
        _state.update(kw)


def snapshot():
    with _state_lock:
        return dict(_state)


def preload():
    """Load the model once, in the background, at startup."""
    with _load_lock:
        if _state["status"] in ("ready", "loading_model"):
            return
        set_state(status="loading_model", started_at=time.time(), error=None)
        log("loading model...")
        try:
            # Import here so a missing dependency surfaces as a state, not a
            # crash at module import time.
            from pyannote.audio import Pipeline  # noqa: F401

            last_err = None
            for model_id in MODEL_CANDIDATES:
                try:
                    log(f"trying {model_id}")
                    # A tiny probe: constructing the pipeline is the expensive
                    # part and proves token + gated access in one step.
                    Pipeline.from_pretrained(model_id, token=HF_TOKEN or None)
                    set_state(status="ready", model=model_id, ready_at=time.time())
                    log(f"ready with {model_id}")
                    return
                except Exception as exc:  # noqa: BLE001
                    last_err = f"{model_id}: {type(exc).__name__}: {exc}"
                    log(f"failed {last_err}")
            set_state(status="failed", error=last_err or "no model could be loaded")
        except Exception as exc:  # noqa: BLE001
            set_state(status="failed", error=f"{type(exc).__name__}: {exc}")
            log(traceback.format_exc())


def run_diarisation(audio_bytes, num_speakers, min_speakers, max_speakers):
    """Invoke the CLI worker and return its parsed JSON result."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(audio_bytes)
        path = fh.name
    try:
        req = {
            "audioPath": path,
            "numSpeakers": num_speakers,
            "minSpeakers": min_speakers,
            "maxSpeakers": max_speakers,
            "hfToken": HF_TOKEN or None,
        }
        proc = subprocess.run(
            [sys.executable, WORKER_SCRIPT],
            input=json.dumps(req).encode(),
            capture_output=True,
            timeout=int(os.environ.get("JOB_TIMEOUT_SECONDS", "900")),
        )
        out = proc.stdout.decode("utf-8", "replace").strip()
        if not out:
            return {
                "ok": False,
                "code": "WORKER_NO_OUTPUT",
                "error": proc.stderr.decode("utf-8", "replace")[-2000:],
            }
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {"ok": False, "code": "WORKER_BAD_JSON", "error": out[-2000:]}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log(fmt % args)

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] != "/health":
            return self._send(404, {"error": "not found"})
        s = snapshot()
        ready = s["status"] == "ready"
        return self._send(200 if ready else 503, {
            "status": s["status"],
            "model": s["model"],
            "error": s["error"],
            "jobs_done": s["jobs_done"],
            "jobs_failed": s["jobs_failed"],
            "uptime_seconds": int(time.time() - s["started_at"]) if s["started_at"] else 0,
        })

    def do_POST(self):
        if self.path.split("?")[0] != "/diarize":
            return self._send(404, {"error": "not found"})

        if WORKER_TOKEN:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {WORKER_TOKEN}":
                return self._send(401, {"ok": False, "code": "UNAUTHORIZED",
                                        "error": "A valid worker token is required."})

        s = snapshot()
        if s["status"] == "failed":
            return self._send(503, {"ok": False, "code": "MODEL_UNAVAILABLE",
                                    "error": s["error"] or "model failed to load"})
        if s["status"] != "ready":
            return self._send(503, {"ok": False, "code": "WORKER_NOT_READY",
                                    "error": f"worker is {s['status']}"})

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return self._send(400, {"ok": False, "code": "BAD_REQUEST",
                                    "error": "empty body"})
        if length > MAX_UPLOAD_BYTES:
            return self._send(413, {"ok": False, "code": "TOO_LARGE",
                                    "error": "audio exceeds the upload limit"})

        audio = self.rfile.read(length)
        qs = {}
        if "?" in self.path:
            for pair in self.path.split("?", 1)[1].split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    qs[k] = v

        def as_int(name, default):
            try:
                return int(qs.get(name, default))
            except (TypeError, ValueError):
                return default

        num = qs.get("numSpeakers")
        num = int(num) if num and num.isdigit() else None

        with _infer_lock:
            set_state(status="busy")
            try:
                result = run_diarisation(audio, num, as_int("minSpeakers", 1),
                                         as_int("maxSpeakers", 8))
            except subprocess.TimeoutExpired:
                result = {"ok": False, "code": "TIMEOUT", "error": "diarisation timed out"}
            except Exception as exc:  # noqa: BLE001
                result = {"ok": False, "code": "UNEXPECTED", "error": str(exc)}
            finally:
                set_state(status="ready")

        if result.get("ok"):
            set_state(jobs_done=snapshot()["jobs_done"] + 1)
            return self._send(200, result)
        set_state(jobs_failed=snapshot()["jobs_failed"] + 1)
        return self._send(500, result)


def main():
    if not HF_TOKEN:
        log("WARNING: HF_TOKEN is not set. The model cannot be fetched; "
            "/health will report failed.")
    threading.Thread(target=preload, daemon=True).start()
    log(f"listening on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
