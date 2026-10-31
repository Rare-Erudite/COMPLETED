# RARE diarisation worker

Real speaker diarisation (pyannote) behind a small HTTP API. This is the
service the RARE backend calls for advanced audio. It is **not** running in
production yet — Vercel's serverless runtime has no Python, so it needs its own
host. This directory is the complete, deployable artifact.

## Why it is not on Vercel

Vercel functions are Node/Python serverless with a size and duration cap that
cannot hold torch + pyannote + model weights. The worker must run as a
long-lived container.

## Deploy (any container host with >= 2 GB RAM)

```bash
docker build -t rare-diarisation .
docker run -p 8000:8000 \
  -e HF_TOKEN=hf_xxx \
  -e WORKER_TOKEN=$(openssl rand -hex 32) \
  -v rare-models:/models \
  rare-diarisation
```

Then set on the RARE backend (Vercel):

| Variable | Value |
|---|---|
| `DIARISATION_WORKER_URL` | `https://<your-host>` |
| `DIARISATION_WORKER_TOKEN` | the same `WORKER_TOKEN` |

`HF_TOKEN` stays on the worker only. It is never sent to the browser, the APK,
or the repo.

## Endpoints

- `GET /health` — `sleeping | loading_model | ready | busy | failed`, plus the
  loaded model name. Returns 503 until the model is genuinely ready, so a
  load balancer will not route traffic to a cold worker.
- `POST /diarize?numSpeakers=2` — body is raw audio bytes. Requires
  `Authorization: Bearer $WORKER_TOKEN`. Returns
  `{"ok":true,"speakers":[...],"turns":[{"start":0.0,"end":2.4,"speaker":"SPEAKER_00"}]}`.

## Model choice

Tries `pyannote/speaker-diarization-3.1` first, then
`pyannote/speaker-diarization-community-1`. The community model is ungated, so
the worker works without the owner accepting terms on the gated pipeline.
Accepting those terms is an optimisation, not a requirement.

## Honest failure

If `HF_TOKEN` is missing, the model cannot be fetched, or inference fails, the
worker reports `failed` with the real error and `/diarize` returns 503. It never
returns invented speaker labels.

## Resource notes

- CPU-only torch (`--extra-index-url .../whl/cpu`) keeps the image ~2 GB smaller.
- Model load takes 30–90 s on first start; mount `/models` to avoid re-downloading.
- One diarisation at a time per process (pyannote is CPU-bound). Scale with
  replicas, not threads.
