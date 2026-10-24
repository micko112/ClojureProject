# BeBetter activity classifier: CLIP ViT-B/32 (quantized ONNX) + trainable head.
# Build: docker build -t bebetter-ml ml/
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MODEL_DIR=/opt/model \
    HEAD_PATH=/data/head.npz \
    PORT=8000 \
    ORT_DISABLE_TELEMETRY=1

WORKDIR /app

# 1. Model files (~155 MB) first: this layer only changes when the pinned
#    revision does, so code/dependency changes don't re-download it.
#    The downloader is stdlib-only and verifies SHA-256 of the ONNX files.
ARG CLIP_REPO=Xenova/clip-vit-base-patch32
ARG CLIP_REVISION=d15189d7028b43f1d3e65039190477f6af591c2a
COPY scripts/download_model.py scripts/download_model.py
RUN CLIP_REPO=${CLIP_REPO} CLIP_REVISION=${CLIP_REVISION} python scripts/download_model.py ${MODEL_DIR}

# 2. Pinned Python dependencies.
COPY requirements.txt .
RUN pip install -r requirements.txt

# 3. Code.
COPY app app

# Non-root; /data holds the trained head (mount a volume there).
RUN useradd --uid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin ml \
 && mkdir -p /data && chown ml /data
USER ml
VOLUME ["/data"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)" || exit 1

CMD ["python", "-m", "app"]
