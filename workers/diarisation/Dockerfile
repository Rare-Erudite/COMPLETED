# RARE diarisation worker — deployable image.
#
# Runs the real pyannote pipeline behind a small HTTP API so the Node backend
# can call it from anywhere. Nothing here is a mock: if the model cannot load,
# /health reports not-ready and /diarize returns a typed error.
#
# Build:  docker build -t rare-diarisation .
# Run:    docker run -p 8000:8000 -e HF_TOKEN=hf_... -e WORKER_TOKEN=... rare-diarisation
#
# CPU-only on purpose: the free tiers this targets have no GPU, and pyannote
# runs acceptably on CPU for short recordings.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/models/hf \
    TORCH_HOME=/models/torch \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2

# ffmpeg decodes non-WAV input; libsndfile backs soundfile.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch keeps the image ~2GB smaller than the default CUDA wheels.
COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements.txt

COPY server.py .
COPY diarize_offline.py .

# Model cache lives here so a host with a persistent disk can reuse it.
RUN mkdir -p /models/hf /models/torch

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["python", "server.py"]
