# ZERO ROT — single image: React build served by the FastAPI backend (same origin for API, WebSockets and SPA).
FROM node:20-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 curl && rm -rf /var/lib/apt/lists/*
# PyTorch (CPU build) runs the offline Kannada voice; installed first so it is cached between deploys
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
# Kannada female voice (SYSPIN, CC BY 4.0): fetched at build time because it is too large for git
RUN mkdir -p backend/models/tts_kn_female &&     curl -fsSL -o backend/models/tts_kn_female/kn_female_vits_30hrs.pt https://huggingface.co/SYSPIN/tts_vits_coquiai_KannadaFemale/resolve/main/kn_female_vits_30hrs.pt &&     curl -fsSL -o backend/models/tts_kn_female/chars.txt https://huggingface.co/SYSPIN/tts_vits_coquiai_KannadaFemale/resolve/main/chars.txt
COPY backend/ backend/
COPY data/ data/
COPY --from=web /src/frontend/dist frontend/dist
# user id 1000: the id Hugging Face Spaces runs containers with (works the same elsewhere)
RUN mkdir -p backend/vapid && useradd -m -u 1000 zerorot && chown -R zerorot /app
USER zerorot
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/auth/setup')"
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
